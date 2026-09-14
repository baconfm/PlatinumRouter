from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

import numpy as np
from PIL import Image


def find_binary(root: Path, name: str) -> Path:
    for candidate in (root / "outputs" / "tools" / "ffmpeg").rglob(f"{name}.exe"):
        return candidate
    raise RuntimeError(f"Portable {name}.exe was not found under outputs/tools/ffmpeg.")


def find_tesseract() -> Path:
    configured = os.environ.get("TESSERACT_EXE", "")
    for candidate in (Path(configured) if configured else None, Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")):
        if candidate and candidate.exists():
            return candidate
    raise RuntimeError("Tesseract OCR was not found.")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9'& -]+", " ", value)).strip()


def ocr_frame(tesseract: Path, pixels: np.ndarray) -> str:
    image = Image.fromarray(pixels, mode="L")
    enlarged = image.resize((pixels.shape[1] * 2, pixels.shape[0] * 2), Image.Resampling.LANCZOS)
    buffer = BytesIO()
    enlarged.save(buffer, format="PNG")
    result = subprocess.run(
        [str(tesseract), "stdin", "stdout", "--psm", "6", "-l", "eng"],
        input=buffer.getvalue(), capture_output=True, timeout=30, check=False
    )
    return normalize_text(result.stdout.decode("utf-8", errors="replace")) if result.returncode == 0 else ""


def text_shape_score(pixels: np.ndarray) -> tuple[float, dict[str, float]]:
    values = pixels.astype(np.int16)
    gx = np.abs(np.diff(values, axis=1, prepend=values[:, :1]))
    gy = np.abs(np.diff(values, axis=0, prepend=values[:1, :]))
    edges = gx + gy
    bright_edges = (edges >= 55) & (values >= 135)
    edge_ratio = float(np.mean(bright_edges))
    bright_ratio = float(np.mean(values >= 185))
    row_activity = float(np.mean(np.sum(bright_edges, axis=1) >= max(8, pixels.shape[1] * 0.018)))
    transitions = np.sum((values[:, 1:] >= 170) != (values[:, :-1] >= 170), axis=1)
    strong_rows = float(np.mean(transitions >= 14))
    darkness = float(1.0 - np.mean(values) / 255.0)
    score = edge_ratio * 8.0 + row_activity * 0.9 + strong_rows * 0.8 + min(darkness, 0.75) * 0.18
    return score, {
        "score": round(score, 5), "edgeRatio": round(edge_ratio, 5), "brightRatio": round(bright_ratio, 5),
        "rowActivity": round(row_activity, 5), "strongRows": round(strong_rows, 5), "mean": round(float(np.mean(values)), 2)
    }


def classify_title(text: str) -> str:
    value = text.lower()
    if "nero" in value and ("checkpoint" in value or "research" in value): return "nero"
    if "infestation" in value: return "infestation"
    if "ambush" in value and "camp" in value: return "ambush-camp"
    if "horde" in value: return "horde"
    return "unclassified"


def useful_text(text: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", text)
    words = re.findall(r"[A-Za-z]{2,}", text)
    if "continue" in text.lower(): return False
    if not (5 <= len(letters) <= 70 and 1 <= len(words) <= 10 and len(text) <= 90): return False
    if classify_title(text) != "unclassified": return True
    uppercase_ratio = sum(character.isupper() for character in letters) / max(1, len(letters))
    meaningful = [word for word in words if len(word) >= 3 and re.search(r"[AEIOUaeiou]", word)]
    return uppercase_ratio >= 0.62 and bool(meaningful)


def main() -> None:
    parser = argparse.ArgumentParser(description="Find Days Gone center-screen popup flurries without relying on top-left text.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--duration", type=float, default=0)
    parser.add_argument("--fps", type=float, default=6.0)
    parser.add_argument("--visual-threshold", type=float, default=0.36)
    parser.add_argument("--episode-gap", type=float, default=25.0)
    parser.add_argument(
        "--timeline-offset",
        type=float,
        default=0.0,
        help="Seconds added to reported timestamps when scanning one part of a multi-part recording.",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    manifest_file = args.manifest.resolve()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    video_file = Path(manifest["source"]["videoFile"])
    output = (args.output or manifest_file.parent / "center-popup-scan.json").resolve()
    image_dir = output.parent / f"{output.stem}-images"
    image_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_binary(root, "ffmpeg")
    tesseract = find_tesseract()

    # The useful payload sits around the middle title, away from objectives, subtitles, and the stream overlay.
    source_width = int(next(stream["width"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    source_height = int(next(stream["height"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    region = manifest["regions"].get("completionTitle", {"x": 23, "y": 53, "width": 54, "height": 15})
    crop = [
        round(source_width * region["width"] / 100),
        round(source_height * region["height"] / 100),
        round(source_width * region["x"] / 100),
        round(source_height * region["y"] / 100),
    ]
    frame_width, frame_height = 640, 100
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-ss", str(max(0, args.start)), "-i", str(video_file)]
    if args.duration > 0: command += ["-t", str(args.duration)]
    command += ["-an", "-vf", f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},scale={frame_width}:{frame_height}:flags=bilinear,fps={args.fps},format=gray",
                "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    frame_bytes = frame_width * frame_height
    hits: list[dict[str, Any]] = []
    visual_streak = 0
    last_ocr_second = -10.0
    frame_index = 0
    while True:
        raw = process.stdout.read(frame_bytes)
        if len(raw) != frame_bytes: break
        pixels = np.frombuffer(raw, dtype=np.uint8).reshape((frame_height, frame_width))
        local_timestamp = args.start + frame_index / args.fps
        timestamp = args.timeline_offset + local_timestamp
        score, features = text_shape_score(pixels)
        # Completion panels dim the scene and concentrate large, bright letter strokes into several rows.
        # Detailed scenery can have a high raw edge score, but it is usually brighter and lacks those active text rows.
        title_shape_seen = score >= args.visual_threshold and features["mean"] <= 105 and features["rowActivity"] >= 0.07
        visual_streak = visual_streak + 1 if title_shape_seen else 0
        if visual_streak >= 2 and timestamp - last_ocr_second >= 0.45:
            last_ocr_second = timestamp
            text = ocr_frame(tesseract, pixels)
            if useful_text(text):
                image_file = image_dir / f"candidate-{len(hits) + 1:05d}-{timestamp:.3f}.png"
                Image.fromarray(pixels, mode="L").save(image_file)
                hits.append({"timestamp": round(timestamp, 3), "text": text, "category": classify_title(text),
                             "features": features, "image": str(image_file.relative_to(output.parent)).replace("\\", "/")})
        frame_index += 1
        if frame_index % max(1, round(args.fps * 300)) == 0:
            elapsed = frame_index / args.fps
            print(f"[center popup scan] {elapsed / 60:.1f} video minutes | {len(hits)} OCR candidates", flush=True)

    return_code = process.wait()
    if return_code != 0:
        error = (process.stderr.read() if process.stderr else b"").decode("utf-8", errors="replace")
        raise RuntimeError(error or f"ffmpeg stopped with exit code {return_code}")

    episodes: list[dict[str, Any]] = []
    for hit in hits:
        if not episodes or hit["timestamp"] - episodes[-1]["lastTimestamp"] > args.episode_gap:
            episodes.append({"id": f"center-popup-{len(episodes) + 1:04d}", "firstTimestamp": hit["timestamp"],
                             "lastTimestamp": hit["timestamp"], "primaryTitle": hit["text"], "popups": [hit]})
        else:
            episodes[-1]["lastTimestamp"] = hit["timestamp"]
            episodes[-1]["popups"].append(hit)
    category_counts = Counter(hit["category"] for hit in hits if hit["category"] != "unclassified")
    result = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {"manifest": str(manifest_file), "video": str(video_file)},
        "scan": {"start": args.start, "timelineOffset": args.timeline_offset,
                 "duration": args.duration, "fps": args.fps, "visualThreshold": args.visual_threshold,
                 "frames": frame_index, "ocrCandidates": len(hits), "episodes": len(episodes)},
        "expectedLedger": {"storyMissionsApprox": 60, "neroSites": 30, "infestations": 12, "ambushCamps": 15,
                           "campJobs": 34, "hordes": 37,
                           "note": "Targets guide review; one completion can produce several progression popups."},
        "recognizedCategoryPopups": dict(category_counts), "episodes": episodes,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **result["scan"], "recognizedCategoryPopups": dict(category_counts)}, indent=2))


if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: sys.exit(130)
