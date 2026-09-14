from __future__ import annotations

import argparse
from datetime import datetime, timezone
from difflib import SequenceMatcher
from io import BytesIO
import json
import math
from pathlib import Path
import re
import subprocess
import time

import numpy as np
from PIL import Image

from scan_days_gone_center_popups import find_binary, find_tesseract, normalize_text


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def required_score(expected: str) -> float:
    length = len(normalize(expected).replace(" ", ""))
    if length < 10: return 0.90
    if length < 16: return 0.82
    if length < 24: return 0.76
    return 0.72


def title_score(observed: str, expected: str) -> float:
    candidate = normalize(observed)
    target = normalize(expected)
    if not candidate or not target: return 0.0
    if target in candidate: return 1.0
    words = candidate.split()
    target_words = target.split()
    windows = [candidate]
    for size in range(max(1, len(target_words) - 1), min(len(words), len(target_words) + 1) + 1):
        windows.extend(" ".join(words[start:start + size]) for start in range(0, len(words) - size + 1))
    return max(SequenceMatcher(None, window, target).ratio() for window in windows)


def live_gate(pixels: np.ndarray) -> tuple[bool, dict[str, float]]:
    height, width = pixels.shape
    step = max(1, width // 360)
    sampled = pixels[::step, ::step]
    left = sampled[:, :-1]
    right = sampled[:, 1:]
    transitions = ((left <= 105) & (right >= 155)) | ((left >= 155) & (right <= 105))
    row_transitions = transitions.sum(axis=1)
    max_transitions = int(row_transitions.max(initial=0))
    strong_rows = int((row_transitions >= 8).sum())
    bright_ratio = float((sampled[:, 1:] >= 170).mean())
    dark_ratio = float((sampled[:, 1:] <= 85).mean())
    likely = max_transitions >= 8 and strong_rows >= 4 and bright_ratio >= 0.002 and dark_ratio >= 0.08
    return likely, {
        "maxTransitions": max_transitions,
        "strongRows": strong_rows,
        "brightRatio": round(bright_ratio, 5),
        "darkRatio": round(dark_ratio, 5),
    }


def ocr_frame(tesseract: Path, pixels: np.ndarray) -> tuple[str, int]:
    started = time.perf_counter()
    image = Image.fromarray(pixels, mode="L")
    enlarged = image.resize((pixels.shape[1] * 2, pixels.shape[0] * 2), Image.Resampling.LANCZOS)
    buffer = BytesIO()
    enlarged.save(buffer, format="PNG")
    result = subprocess.run(
        [str(tesseract), "stdin", "stdout", "--psm", "6", "-l", "eng"],
        input=buffer.getvalue(), capture_output=True, timeout=30, check=False
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    text = normalize_text(result.stdout.decode("utf-8", errors="replace")) if result.returncode == 0 else ""
    return text, elapsed_ms


def decode_window(ffmpeg: Path, video: Path, timestamp: float, crop: list[int], fps: int, before: float, after: float) -> tuple[float, list[np.ndarray]]:
    start = max(0.0, timestamp - before)
    width, height = 640, 100
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-ss", str(start), "-i", str(video),
        "-t", str(before + after), "-an", "-vf",
        f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},scale={width}:{height}:flags=bilinear,fps={fps},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"
    ]
    result = subprocess.run(command, capture_output=True, timeout=60, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    frame_bytes = width * height
    frames = [
        np.frombuffer(result.stdout[offset:offset + frame_bytes], dtype=np.uint8).reshape((height, width)).copy()
        for offset in range(0, len(result.stdout) - frame_bytes + 1, frame_bytes)
    ]
    return start, frames


def sampled_indices(start: float, frame_count: int, base_fps: int, interval_ms: int, phase_ms: float = 0.0) -> list[int]:
    end = start + frame_count / base_fps
    interval = interval_ms / 1000.0
    phase = phase_ms / 1000.0
    first = math.ceil((start - phase) / interval)
    indices: list[int] = []
    n = first
    while n * interval + phase < end:
        index = round(((n * interval + phase) - start) * base_fps)
        if 0 <= index < frame_count and (not indices or indices[-1] != index): indices.append(index)
        n += 1
    return indices


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--intervals", default="100,125,150")
    parser.add_argument("--base-fps", type=int, default=20)
    parser.add_argument("--before", type=float, default=0.45)
    parser.add_argument("--after", type=float, default=0.75)
    parser.add_argument("--max-ocr-attempts", type=int, default=4)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    training = root / "outputs" / "training" / "days-gone" / "20260718"
    manifest = json.loads((training / "manifest.json").read_text(encoding="utf-8"))
    model = json.loads((training / "models" / "completion-title-model.json").read_text(encoding="utf-8"))
    video = Path(manifest["source"]["videoFile"])
    ffmpeg = root / "outputs" / "tools" / "ffmpeg" / "ffmpeg-8.1.2-essentials_build" / "bin" / "ffmpeg.exe"
    if not ffmpeg.exists():
        ffmpeg = find_binary(root, "ffmpeg")
    tesseract = find_tesseract()
    source_width = int(next(stream["width"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    source_height = int(next(stream["height"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    region = manifest["regions"].get("completionTitle", {"x": 23, "y": 53, "width": 54, "height": 15})
    crop = [round(source_width * region["width"] / 100), round(source_height * region["height"] / 100),
            round(source_width * region["x"] / 100), round(source_height * region["y"] / 100)]
    intervals = [int(value) for value in args.intervals.split(",")]
    matches = []
    for category in model["categories"].values():
        matches.extend(category.get("matches", []))

    interval_rows = {interval: [] for interval in intervals}
    event_rows = []
    for event_index, match in enumerate(matches, 1):
        start, frames = decode_window(ffmpeg, video, float(match["timestamp"]), crop, args.base_fps, args.before, args.after)
        gates = [live_gate(frame) for frame in frames]
        event = {"id": match["id"], "timestamp": match["timestamp"], "counterKey": match["counterKey"],
                 "canonicalTitle": match["canonicalTitle"], "frames": len(frames), "gateFrames": sum(1 for seen, _ in gates if seen)}
        for interval in intervals:
            phase_hits = 0
            phase_count = 20
            for phase_index in range(phase_count):
                indices = sampled_indices(start, len(frames), args.base_fps, interval, interval * phase_index / phase_count)
                if any(gates[index][0] for index in indices): phase_hits += 1
            indices = sampled_indices(start, len(frames), args.base_fps, interval, 0)
            candidates = [index for index in indices if gates[index][0]]
            recognized = False
            attempts = []
            for index in candidates[:args.max_ocr_attempts]:
                text, elapsed_ms = ocr_frame(tesseract, frames[index])
                score = title_score(text, match["canonicalTitle"])
                attempts.append({"frame": index, "text": text, "score": round(score, 4), "ocrMs": elapsed_ms})
                if score >= required_score(match["canonicalTitle"]):
                    recognized = True
                    break
            row = {"eventId": match["id"], "counterKey": match["counterKey"], "title": match["canonicalTitle"],
                   "capturePhasePassRate": phase_hits / phase_count, "gateCandidates": len(candidates),
                   "recognized": recognized, "attempts": attempts}
            interval_rows[interval].append(row)
            event[str(interval)] = row
        event_rows.append(event)
        print(f"[replay] {event_index}/{len(matches)} {match['canonicalTitle']}", flush=True)

    summary = {}
    for interval, rows in interval_rows.items():
        ocr_times = [attempt["ocrMs"] for row in rows for attempt in row["attempts"]]
        summary[str(interval)] = {
            "events": len(rows),
            "recognized": sum(1 for row in rows if row["recognized"]),
            "recognitionRate": round(sum(1 for row in rows if row["recognized"]) / max(1, len(rows)), 4),
            "meanCapturePhasePassRate": round(sum(row["capturePhasePassRate"] for row in rows) / max(1, len(rows)), 4),
            "zeroGateEvents": sum(1 for row in rows if not row["gateCandidates"]),
            "ocrAttempts": len(ocr_times),
            "ocrMeanMs": round(sum(ocr_times) / max(1, len(ocr_times)), 1),
            "ocrP95Ms": sorted(ocr_times)[min(len(ocr_times) - 1, math.floor(len(ocr_times) * .95))] if ocr_times else 0,
        }

    result = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "video": str(video), "knownNamedEvents": len(matches), "baseFps": args.base_fps,
              "window": {"beforeSeconds": args.before, "afterSeconds": args.after}, "summary": summary, "events": event_rows}
    output = (args.output or training / "simulations" / "live-replay-simulation.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "knownNamedEvents": len(matches), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
