from __future__ import annotations

import argparse
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
import sys

import numpy as np
from PIL import Image

from scan_days_gone_center_popups import find_binary, find_tesseract, normalize_text
from simulate_days_gone_ipca_pickups import ipca_score, text_gate

SCANNER_VERSION = 4


def has_ipca_pickup_text(value: str) -> bool:
    observed = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()
    return bool(
        re.search(r"\bipca\b", observed)
        or re.search(r"\b(?:1|i|l)?pca\s+tech\b", observed)
    )


def ocr_ipca_frame(tesseract: Path, pixels: np.ndarray, threshold: int = 135) -> str:
    image = Image.fromarray(pixels, mode="L")
    image = image.resize(
        (pixels.shape[1] * 3, pixels.shape[0] * 3),
        Image.Resampling.LANCZOS,
    ).point(lambda value: 255 if value >= threshold else 0)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    result = subprocess.run(
        [str(tesseract), "stdin", "stdout", "--psm", "11", "-l", "eng"],
        input=buffer.getvalue(),
        capture_output=True,
        timeout=30,
        check=False,
    )
    return normalize_text(result.stdout.decode("utf-8", errors="replace")) if result.returncode == 0 else ""


def load_json(path: Path) -> dict:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return json.loads(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("utf-8", raw, 0, len(raw), f"Could not decode {path}")


def scan_part(root: Path, manifest_file: Path, timeline_offset: float, fps: float,
              duration_seconds: float = 0) -> dict:
    manifest = load_json(manifest_file)
    video = Path(manifest["source"]["videoFile"])
    stream = next(item for item in manifest["video"]["streams"] if item.get("codec_type") == "video")
    source_width, source_height = int(stream["width"]), int(stream["height"])
    region = manifest.get("regions", {}).get("ipcaPickup", {"x": 0, "y": 65, "width": 16, "height": 14})
    crop = [
        round(source_width * region["width"] / 100),
        round(source_height * region["height"] / 100),
        round(source_width * region["x"] / 100),
        round(source_height * region["y"] / 100),
    ]
    width, height = 720, 360
    ffmpeg, tesseract = find_binary(root, "ffmpeg"), find_tesseract()
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(video),
    ]
    if duration_seconds > 0:
        command.extend(["-t", str(duration_seconds)])
    command.extend([
        "-an",
        "-vf", f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},scale={width}:{height}:flags=bilinear,"
               f"fps={fps},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ])
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    frame_bytes = width * height
    frame_index = attempts = 0
    last_ocr = -10.0
    last_recovery = -10.0
    candidates: list[dict] = []
    matches: list[dict] = []
    while True:
        raw = process.stdout.read(frame_bytes)
        if len(raw) != frame_bytes:
            break
        pixels = np.frombuffer(raw, dtype=np.uint8).reshape((height, width))
        local_time = frame_index / fps
        gated, features = text_gate(pixels)
        if gated and local_time - last_ocr >= 0.35:
            last_ocr = local_time
            attempts += 1
            text = ocr_ipca_frame(tesseract, pixels)
            score = ipca_score(text)
            recovery_text = ""
            if not has_ipca_pickup_text(text) and local_time - last_recovery >= 1.2:
                last_recovery = local_time
                attempts += 1
                recovery_text = ocr_ipca_frame(tesseract, pixels, threshold=115)
                recovery_score = ipca_score(recovery_text)
                if has_ipca_pickup_text(recovery_text) or recovery_score > score:
                    text = recovery_text
                    score = recovery_score
            row = {
                "timestamp": round(timeline_offset + local_time, 3),
                "observedText": text,
                "score": round(score, 4),
                "recoveryText": recovery_text,
                "recoveryUsed": bool(recovery_text),
                "gate": features,
            }
            if text:
                candidates.append(row)
            if score >= 0.72 and has_ipca_pickup_text(text):
                if not matches or row["timestamp"] - matches[-1]["timestamp"] >= 8:
                    matches.append(row)
        frame_index += 1
        if frame_index % max(1, round(fps * 1800)) == 0:
            print(
                f"[ipca progress] {(timeline_offset + local_time) / 3600:.1f}h | "
                f"{len(matches)} pickups | {attempts} OCR",
                flush=True,
            )
    return_code = process.wait()
    if return_code:
        error = (process.stderr.read() if process.stderr else b"").decode("utf-8", errors="replace")
        raise RuntimeError(error or f"ffmpeg stopped with exit code {return_code}")
    return {
        "manifest": str(manifest_file.resolve()),
        "fps": fps,
        "durationSeconds": duration_seconds,
        "frames": frame_index,
        "ocrAttempts": attempts,
        "matches": matches,
        "ocrCandidates": candidates,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan a multipart Days Gone run for lower-left IPCA Tech pickups.")
    parser.add_argument("run_directory", type=Path)
    parser.add_argument("--fps", type=float, default=1.0)
    parser.add_argument("--duration", type=float, default=0, help="Scan only this many seconds from the run.")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    run_directory = args.run_directory.resolve()
    run = load_json(run_directory / "run.json")
    all_matches: list[dict] = []
    all_candidates: list[dict] = []
    frames = attempts = 0
    for part in run.get("parts", []):
        timeline_offset = float(part.get("timelineOffsetSeconds", 0))
        if args.duration > 0:
            remaining_duration = args.duration - timeline_offset
            if remaining_duration <= 0:
                break
            part_duration = min(float(part.get("durationSeconds", remaining_duration)), remaining_duration)
        else:
            part_duration = 0
        manifest_file = run_directory / "manifests" / f"part-{part['part']}.json"
        if not manifest_file.exists() and len(run.get("parts", [])) == 1:
            manifest_file = run_directory / "manifest.json"
        checkpoint = run_directory / f"ipca-progress-part-{part['part']}.json"
        if checkpoint.exists() and not args.force:
            result = load_json(checkpoint)
            if (
                int(result.get("scannerVersion", 0)) == SCANNER_VERSION
                and float(result.get("fps", 0)) == args.fps
                and float(result.get("durationSeconds", 0)) == part_duration
                and result.get("manifest") == str(manifest_file.resolve())
            ):
                print(f"[ipca progress] Reusing completed part {part['part']} checkpoint", flush=True)
            else:
                result = scan_part(
                    root, manifest_file, timeline_offset, args.fps, part_duration
                )
                result["scannerVersion"] = SCANNER_VERSION
                checkpoint.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        else:
            result = scan_part(
                root, manifest_file, timeline_offset, args.fps, part_duration
            )
            result["scannerVersion"] = SCANNER_VERSION
            checkpoint.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        all_matches.extend(result.get("matches", []))
        all_candidates.extend(result.get("ocrCandidates", []))
        frames += int(result.get("frames", 0))
        attempts += int(result.get("ocrAttempts", 0))

    all_matches.sort(key=lambda item: item["timestamp"])
    output = run_directory / "ipca-progress.json"
    payload = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "runDirectory": str(run_directory),
        "scan": {
            "fps": args.fps,
            "durationSeconds": min(float(run.get("totalDurationSeconds", 0) or 0), args.duration)
            if args.duration > 0 else float(run.get("totalDurationSeconds", 0) or 0),
            "frames": frames,
            "ocrAttempts": attempts,
        },
        "summary": {"detectedPickupPopups": len(all_matches), "expected": 18},
        "matches": all_matches,
        "ocrCandidates": all_candidates,
    }
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **payload["scan"], **payload["summary"]}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
