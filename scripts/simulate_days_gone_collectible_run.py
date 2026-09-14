from __future__ import annotations

import argparse
from collections import defaultdict
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


COLLECTIBLE_COUNTERS = {
    "charactercollectibles", "herbology", "historical", "nerointel", "radiofreeoregon",
    "rippersermons", "sarahlabnotes", "songs", "tourism",
}


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def required_score(expected: str) -> float:
    length = len(normalize(expected).replace(" ", ""))
    if length < 8:
        return 0.88
    if length < 14:
        return 0.80
    if length < 22:
        return 0.74
    return 0.68


def title_score(observed: str, expected: str) -> float:
    candidate = normalize(observed)
    target = normalize(expected)
    if not candidate or not target:
        return 0.0
    if target in candidate:
        return 1.0
    words = candidate.split()
    target_words = target.split()
    windows = [candidate]
    for size in range(max(1, len(target_words) - 2), min(len(words), len(target_words) + 2) + 1):
        windows.extend(" ".join(words[start:start + size]) for start in range(len(words) - size + 1))
    return max(SequenceMatcher(None, window, target).ratio() for window in windows)


def live_gate(pixels: np.ndarray) -> tuple[bool, dict[str, float]]:
    height, width = pixels.shape
    step = max(1, width // 360)
    sampled = pixels[::step, ::step]
    left = sampled[:, :-1]
    right = sampled[:, 1:]
    transitions = ((left <= 105) & (right >= 155)) | ((left >= 155) & (right <= 105))
    row_transitions = transitions.sum(axis=1)
    maximum = int(row_transitions.max(initial=0))
    strong_rows = int((row_transitions >= 8).sum())
    medium_rows = int((row_transitions >= 3).sum())
    bright_ratio = float((sampled[:, 1:] >= 170).mean())
    soft_bright_ratio = float((sampled[:, 1:] >= 150).mean())
    dark_ratio = float((sampled[:, 1:] <= 85).mean())
    likely = maximum >= 8 and strong_rows >= 4 and bright_ratio >= 0.002 and dark_ratio >= 0.08
    return likely, {
        "maxTransitions": maximum,
        "strongRows": strong_rows,
        "mediumRows": medium_rows,
        "brightRatio": round(bright_ratio, 5),
        "softBrightRatio": round(soft_bright_ratio, 5),
        "darkRatio": round(dark_ratio, 5),
    }


def decode_window(
    ffmpeg: Path,
    video: Path,
    timestamp: float,
    crop: list[int],
    fps: int,
    before: float,
    after: float,
    hwaccel: str | None,
) -> tuple[float, list[np.ndarray]]:
    start = max(0.0, timestamp - before)
    width, height = 720, 270
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error"]
    if hwaccel:
        command.extend(["-hwaccel", hwaccel])
    command.extend([
        "-ss", f"{start:.3f}", "-i", str(video), "-t", f"{before + after:.3f}", "-an", "-vf",
        f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},scale={width}:{height}:flags=bilinear,fps={fps},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ])
    result = subprocess.run(command, capture_output=True, timeout=60, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    frame_bytes = width * height
    frames = [
        np.frombuffer(result.stdout[offset:offset + frame_bytes], dtype=np.uint8).reshape((height, width)).copy()
        for offset in range(0, len(result.stdout) - frame_bytes + 1, frame_bytes)
    ]
    return start, frames


def ocr_frame(tesseract: Path, pixels: np.ndarray) -> tuple[str, int]:
    started = time.perf_counter()
    image = Image.fromarray(pixels, mode="L")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    result = subprocess.run(
        [str(tesseract), "stdin", "stdout", "--psm", "6", "-l", "eng"],
        input=buffer.getvalue(), capture_output=True, timeout=30, check=False,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    text = normalize_text(result.stdout.decode("utf-8", errors="replace")) if result.returncode == 0 else ""
    return text, elapsed_ms


def child_crop(frame: np.ndarray, union: dict, child: dict, target_width: int = 720) -> np.ndarray:
    height, width = frame.shape
    left = round(width * (child["x"] - union["x"]) / union["width"])
    top = round(height * (child["y"] - union["y"]) / union["height"])
    right = round(width * (child["x"] + child["width"] - union["x"]) / union["width"])
    bottom = round(height * (child["y"] + child["height"] - union["y"]) / union["height"])
    pixels = frame[max(0, top):min(height, bottom), max(0, left):min(width, right)]
    if pixels.size == 0:
        return frame
    target_height = max(180, round(pixels.shape[0] * target_width / max(1, pixels.shape[1])))
    return np.asarray(Image.fromarray(pixels, mode="L").resize((target_width, target_height), Image.Resampling.NEAREST))


def sampled_indices(start: float, frame_count: int, base_fps: int, interval_ms: int, phase_ms: float = 0.0) -> list[int]:
    end = start + frame_count / base_fps
    interval = interval_ms / 1000
    phase = phase_ms / 1000
    number = math.ceil((start - phase) / interval)
    indices = []
    while number * interval + phase < end:
        index = round(((number * interval + phase) - start) * base_fps)
        if 0 <= index < frame_count and (not indices or indices[-1] != index):
            indices.append(index)
        number += 1
    return indices


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    return sorted(values)[min(len(values) - 1, math.floor(len(values) * ratio))]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--intervals", default="100,125,150")
    parser.add_argument("--base-fps", type=int, default=20)
    parser.add_argument("--before", type=float, default=0.45)
    parser.add_argument("--after", type=float, default=0.85)
    parser.add_argument("--max-ocr-attempts", type=int, default=8)
    parser.add_argument("--hwaccel", default="d3d11va")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    training = root / "outputs" / "training" / "days-gone" / "20260718"
    manifest = json.loads((training / "manifest.json").read_text(encoding="utf-8"))
    events = []
    for event in sorted(manifest.get("confirmedEvents", []), key=lambda item: float(item["videoSeconds"])):
        labels = [label for label in event.get("labels", []) if label.get("counterKey") in COLLECTIBLE_COUNTERS]
        if labels:
            events.append({**event, "labels": labels})
    if args.limit:
        events = events[:args.limit]

    video = Path(manifest["source"]["videoFile"])
    ffmpeg = root / "outputs" / "tools" / "ffmpeg" / "ffmpeg-8.1.2-essentials_build" / "bin" / "ffmpeg.exe"
    if not ffmpeg.exists():
        ffmpeg = find_binary(root, "ffmpeg")
    tesseract = find_tesseract()
    source_width = int(next(stream["width"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    source_height = int(next(stream["height"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    region = manifest["regions"].get("topRightCombined", {"x": 54, "y": 0, "width": 46, "height": 17})
    title_region = manifest["regions"].get("topRightTitle", {"x": 76, "y": 0, "width": 24, "height": 7})
    toast_region = {"x": 54, "y": 1, "width": 46, "height": 16}
    crop = [round(source_width * region["width"] / 100), round(source_height * region["height"] / 100),
            round(source_width * region["x"] / 100), round(source_height * region["y"] / 100)]
    intervals = [int(value) for value in args.intervals.split(",")]
    rows_by_interval = {interval: [] for interval in intervals}
    event_rows = []
    started = time.perf_counter()

    for event_index, event in enumerate(events, 1):
        start, frames = decode_window(
            ffmpeg, video, float(event["videoSeconds"]), crop, args.base_fps,
            args.before, args.after, args.hwaccel or None,
        )
        frame_regions = []
        for frame in frames:
            title_pixels = child_crop(frame, region, title_region)
            toast_pixels = child_crop(frame, region, toast_region)
            title_seen, title_gate = live_gate(title_pixels)
            if (not title_seen and title_gate["maxTransitions"] >= 8
                    and title_gate["strongRows"] >= 3 and title_gate["brightRatio"] >= 0.001):
                title_seen = True
            toast_seen, toast_gate = live_gate(toast_pixels)
            frame_regions.append([
                ("topRightTitle", title_pixels, title_seen, title_gate),
                ("topRightToast", toast_pixels, toast_seen, toast_gate),
            ])
        expected = [{"id": label.get("id"), "counterKey": label.get("counterKey"), "title": label.get("title", "")}
                    for label in event["labels"]]
        event_row = {"id": event["id"], "timestamp": event["videoSeconds"], "expected": expected,
                     "frames": len(frames),
                     "gateFrames": sum(1 for regions in frame_regions if any(region_row[2] for region_row in regions))}
        for interval in intervals:
            phase_hits = 0
            phases = 20
            for phase_index in range(phases):
                indices = sampled_indices(start, len(frames), args.base_fps, interval, interval * phase_index / phases)
                if any(any(region_row[2] for region_row in frame_regions[index]) for index in indices):
                    phase_hits += 1
            indices = sampled_indices(start, len(frames), args.base_fps, interval)
            candidates = [
                (index, region_id, pixels)
                for index in indices
                for region_id, pixels, seen, _gate in frame_regions[index]
                if seen
            ]
            recognized_ids = set()
            attempts = []
            for index, region_id, pixels in candidates[:args.max_ocr_attempts]:
                text, elapsed_ms = ocr_frame(tesseract, pixels)
                scores = []
                for item in expected:
                    score = title_score(text, item["title"])
                    scores.append({"id": item["id"], "score": round(score, 4),
                                   "required": required_score(item["title"])})
                    if score >= required_score(item["title"]):
                        recognized_ids.add(item["id"])
                attempts.append({"frame": index, "region": region_id, "text": text,
                                 "scores": scores, "ocrMs": elapsed_ms})
                if len(recognized_ids) == len(expected):
                    break
            row = {
                "eventId": event["id"], "timestamp": event["videoSeconds"], "expected": expected,
                "capturePhasePassRate": phase_hits / phases, "gateCandidates": len(candidates),
                "recognizedIds": sorted(recognized_ids), "fullyRecognized": len(recognized_ids) == len(expected),
                "attempts": attempts,
            }
            rows_by_interval[interval].append(row)
            event_row[str(interval)] = row
        event_rows.append(event_row)
        if event_index % 10 == 0 or event_index == len(events):
            print(f"[collectible-replay] {event_index}/{len(events)} events", flush=True)

    summary = {}
    category_summary = {}
    for interval, rows in rows_by_interval.items():
        ocr_times = [attempt["ocrMs"] for row in rows for attempt in row["attempts"]]
        expected_ids = [item["id"] for row in rows for item in row["expected"]]
        recognized_ids = {item for row in rows for item in row["recognizedIds"]}
        summary[str(interval)] = {
            "events": len(rows), "expectedItems": len(expected_ids),
            "fullyRecognizedEvents": sum(1 for row in rows if row["fullyRecognized"]),
            "recognizedItems": sum(1 for item in expected_ids if item in recognized_ids),
            "itemRecall": round(sum(1 for item in expected_ids if item in recognized_ids) / max(1, len(expected_ids)), 4),
            "meanCapturePhasePassRate": round(sum(row["capturePhasePassRate"] for row in rows) / max(1, len(rows)), 4),
            "zeroGateEvents": sum(1 for row in rows if not row["gateCandidates"]),
            "ocrAttempts": len(ocr_times), "ocrMeanMs": round(sum(ocr_times) / max(1, len(ocr_times)), 1),
            "ocrP95Ms": percentile(ocr_times, 0.95),
        }
        grouped = defaultdict(lambda: {"expected": 0, "recognized": 0})
        for row in rows:
            for item in row["expected"]:
                grouped[item["counterKey"]]["expected"] += 1
                grouped[item["counterKey"]]["recognized"] += int(item["id"] in row["recognizedIds"])
        category_summary[str(interval)] = {
            key: {**values, "recall": round(values["recognized"] / max(1, values["expected"]), 4)}
            for key, values in sorted(grouped.items())
        }

    result = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "video": str(video), "region": region, "baseFps": args.base_fps,
        "window": {"beforeSeconds": args.before, "afterSeconds": args.after},
        "chronologicalEvents": len(events), "summary": summary, "categories": category_summary,
        "elapsedSeconds": round(time.perf_counter() - started, 1), "events": event_rows,
    }
    output = (args.output or training / "simulations" / "collectible-real-run-simulation.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "events": len(events), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
