from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
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


def ipca_score(value: str) -> float:
    observed = normalize(value)
    if "ipca tech" in observed or re.search(r"\bipca\b", observed):
        return 1.0
    words = observed.split()
    windows = [" ".join(words[index:index + size]) for size in (1, 2, 3)
               for index in range(max(0, len(words) - size + 1))]
    return max((SequenceMatcher(None, window, "ipca tech").ratio() for window in windows), default=0.0)


def text_gate(pixels: np.ndarray) -> tuple[bool, dict[str, float]]:
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
    likely = (
        maximum >= 8 and strong_rows >= 4 and bright_ratio >= 0.002 and dark_ratio >= 0.08
    ) or (
        maximum >= 3 and medium_rows >= 3 and soft_bright_ratio >= 0.003 and dark_ratio >= 0.08
    )
    return likely, {
        "maxTransitions": maximum,
        "strongRows": strong_rows,
        "mediumRows": medium_rows,
        "brightRatio": round(bright_ratio, 5),
        "softBrightRatio": round(soft_bright_ratio, 5),
        "darkRatio": round(dark_ratio, 5),
    }


def extract_frame(ffmpeg: Path, video: Path, timestamp: float, crop: list[int]) -> np.ndarray | None:
    width, height = 720, 360
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-ss", f"{timestamp:.3f}",
        "-i", str(video), "-frames:v", "1", "-an", "-vf",
        f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},scale={width}:{height}:flags=bilinear,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"
    ]
    result = subprocess.run(command, capture_output=True, timeout=45, check=False)
    expected = width * height
    if result.returncode != 0 or len(result.stdout) < expected:
        return None
    return np.frombuffer(result.stdout[:expected], dtype=np.uint8).reshape((height, width)).copy()


def decode_dense_window(
    ffmpeg: Path,
    video: Path,
    start: float,
    duration: float,
    crop: list[int],
    fps: int,
    hwaccel: str | None = None,
) -> list[np.ndarray]:
    width, height = 720, 360
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error",
    ]
    if hwaccel:
        command.extend(["-hwaccel", hwaccel])
    command.extend([
        "-ss", f"{start:.3f}", "-i", str(video), "-t", f"{duration:.3f}", "-an", "-vf",
        f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},scale={width}:{height}:flags=bilinear,fps={fps},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"
    ])
    result = subprocess.run(command, capture_output=True, timeout=max(60, round(duration * 4)), check=False)
    if result.returncode != 0:
        return []
    frame_bytes = width * height
    return [
        np.frombuffer(result.stdout[offset:offset + frame_bytes], dtype=np.uint8).reshape((height, width)).copy()
        for offset in range(0, len(result.stdout) - frame_bytes + 1, frame_bytes)
    ]


def ocr_frame(tesseract: Path, pixels: np.ndarray) -> tuple[str, int]:
    started = time.perf_counter()
    image = Image.fromarray(pixels, mode="L")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    result = subprocess.run(
        [str(tesseract), "stdin", "stdout", "--psm", "6", "-l", "eng"],
        input=buffer.getvalue(), capture_output=True, timeout=30, check=False
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    text = normalize_text(result.stdout.decode("utf-8", errors="replace")) if result.returncode == 0 else ""
    return text, elapsed_ms


def scan_point(ffmpeg: Path, tesseract: Path, video: Path, timestamp: float, crop: list[int]) -> dict:
    pixels = extract_frame(ffmpeg, video, timestamp, crop)
    if pixels is None:
        return {"timestamp": timestamp, "error": "decode-failed", "gated": False}
    gated, gate = text_gate(pixels)
    row = {"timestamp": timestamp, "gated": gated, "gate": gate}
    if gated:
        text, elapsed_ms = ocr_frame(tesseract, pixels)
        score = ipca_score(text)
        row.update({
            "text": text,
            "normalizedText": normalize(text),
            "score": round(score, 4),
            "exactLiveMatch": "ipca" in normalize(text).split(),
            "ocrMs": elapsed_ms,
        })
    return row


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    return sorted(values)[min(len(values) - 1, math.floor(len(values) * ratio))]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback", type=float, default=240.0)
    parser.add_argument("--sample-seconds", type=float, default=1.0)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--fuzzy-threshold", type=float, default=0.72)
    parser.add_argument("--dense-start", type=float)
    parser.add_argument("--dense-duration", type=float, default=10.0)
    parser.add_argument("--dense-fps", type=int, default=8)
    parser.add_argument("--hwaccel", default="d3d11va")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    training = root / "outputs" / "training" / "days-gone" / "20260718"
    manifest = json.loads((training / "manifest.json").read_text(encoding="utf-8"))
    split_log = json.loads(Path(manifest["source"]["splitLogFile"]).read_text(encoding="utf-8"))
    video = Path(manifest["source"]["videoFile"])
    video_start = datetime.fromisoformat(manifest["source"]["videoStartAt"].replace("Z", "+00:00"))
    source_width = int(next(stream["width"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    source_height = int(next(stream["height"] for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video"))
    region = manifest["regions"].get("ipcaPickup", {"x": 0, "y": 65, "width": 16, "height": 14})
    crop = [
        round(source_width * region["width"] / 100),
        round(source_height * region["height"] / 100),
        round(source_width * region["x"] / 100),
        round(source_height * region["y"] / 100),
    ]
    ffmpeg = root / "outputs" / "tools" / "ffmpeg" / "ffmpeg-8.1.2-essentials_build" / "bin" / "ffmpeg.exe"
    if not ffmpeg.exists():
        ffmpeg = find_binary(root, "ffmpeg")
    tesseract = find_tesseract()

    if args.dense_start is not None:
        started = time.perf_counter()
        frames = decode_dense_window(
            ffmpeg, video, args.dense_start, args.dense_duration, crop, args.dense_fps, args.hwaccel or None
        )
        rows = []
        for index, pixels in enumerate(frames):
            timestamp = args.dense_start + (index / args.dense_fps)
            gated, gate = text_gate(pixels)
            row = {"timestamp": round(timestamp, 3), "gated": gated, "gate": gate}
            if gated:
                text, elapsed_ms = ocr_frame(tesseract, pixels)
                row.update({"text": text, "normalizedText": normalize(text), "score": round(ipca_score(text), 4),
                            "exactLiveMatch": "ipca" in normalize(text).split(), "ocrMs": elapsed_ms})
            rows.append(row)
        exact = [row for row in rows if row.get("exactLiveMatch")]
        fuzzy = [row for row in rows if float(row.get("score", 0)) >= args.fuzzy_threshold]
        interval_simulation = {}
        frame_tolerance = (0.5 / args.dense_fps) + 0.001
        for interval_ms in (100, 125, 150):
            phases = 20
            exact_phase_hits = 0
            fuzzy_phase_hits = 0
            for phase_index in range(phases):
                phase = (interval_ms / 1000) * phase_index / phases
                sample_times = np.arange(
                    args.dense_start + phase,
                    args.dense_start + args.dense_duration,
                    interval_ms / 1000,
                )
                if any(any(abs(float(row["timestamp"]) - sample) <= frame_tolerance for sample in sample_times) for row in exact):
                    exact_phase_hits += 1
                if any(any(abs(float(row["timestamp"]) - sample) <= frame_tolerance for sample in sample_times) for row in fuzzy):
                    fuzzy_phase_hits += 1
            interval_simulation[str(interval_ms)] = {
                "testedCapturePhases": phases,
                "exactLivePhaseHits": exact_phase_hits,
                "exactLivePhaseRate": round(exact_phase_hits / phases, 4),
                "fuzzyDiagnosticPhaseHits": fuzzy_phase_hits,
                "fuzzyDiagnosticPhaseRate": round(fuzzy_phase_hits / phases, 4),
            }
        result = {
            "schemaVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "video": str(video),
            "region": region,
            "method": {"denseStart": args.dense_start, "duration": args.dense_duration, "fps": args.dense_fps},
            "summary": {"frames": len(rows), "gatedFrames": sum(1 for row in rows if row["gated"]),
                        "exactMatches": len(exact), "fuzzyMatches": len(fuzzy),
                        "elapsedSeconds": round(time.perf_counter() - started, 1)},
            "intervalSimulation": interval_simulation,
            "exactMatches": exact,
            "fuzzyMatches": fuzzy,
            "bestCandidates": sorted((row for row in rows if row["gated"]),
                                     key=lambda row: float(row.get("score", 0)), reverse=True)[:20],
        }
        output = (args.output or training / "simulations" / "ipca-pickup-dense-simulation.json").resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(output), "summary": result["summary"]}, indent=2))
        return

    completed = split_log.get("completedSplits", [])
    expected = []
    previous_seconds = 0.0
    for split in completed:
        at = datetime.fromisoformat(split["at"].replace("Z", "+00:00"))
        end_seconds = (at - video_start).total_seconds()
        if int((split.get("autoApplied") or {}).get("ipca", 0)) > 0:
            expected.append({
                "splitIndex": split.get("splitIndex"),
                "splitLabel": split.get("label"),
                "splitLabelRole": "route-description-not-ocr-target",
                "windowSource": "completed-route-split-with-auto-applied-ipca-counter",
                "start": max(previous_seconds, end_seconds - args.lookback),
                "end": end_seconds,
                "expectedDelta": int(split["autoApplied"]["ipca"]),
            })
        previous_seconds = end_seconds

    points: list[tuple[int, float]] = []
    for index, window in enumerate(expected):
        timestamp = window["start"]
        while timestamp <= window["end"]:
            points.append((index, round(timestamp, 3)))
            timestamp += args.sample_seconds

    started = time.perf_counter()
    rows_by_window: list[list[dict]] = [[] for _ in expected]
    completed_points = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(scan_point, ffmpeg, tesseract, video, timestamp, crop): window_index
            for window_index, timestamp in points
        }
        for future in as_completed(futures):
            window_index = futures[future]
            rows_by_window[window_index].append(future.result())
            completed_points += 1
            if completed_points % 100 == 0:
                print(f"[ipca-replay] {completed_points}/{len(points)} samples", flush=True)

    ocr_times = []
    exact_windows = 0
    fuzzy_windows = 0
    for window, rows in zip(expected, rows_by_window):
        rows.sort(key=lambda row: row["timestamp"])
        candidates = [row for row in rows if row.get("gated")]
        exact = [row for row in candidates if row.get("exactLiveMatch")]
        fuzzy = [row for row in candidates if float(row.get("score", 0)) >= args.fuzzy_threshold]
        ocr_times.extend(int(row.get("ocrMs", 0)) for row in candidates if row.get("ocrMs"))
        window.update({
            "samples": len(rows),
            "gatedSamples": len(candidates),
            "exactLiveMatches": exact,
            "fuzzyDiagnosticMatches": fuzzy,
            "exactDetected": bool(exact),
            "fuzzyDetected": bool(fuzzy),
            "bestCandidates": sorted(candidates, key=lambda row: float(row.get("score", 0)), reverse=True)[:8],
        })
        exact_windows += int(bool(exact))
        fuzzy_windows += int(bool(fuzzy))

    elapsed = time.perf_counter() - started
    result = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "video": str(video),
        "region": region,
        "method": {
            "expectedWindows": "Coarse search windows derived from route splits whose autoApplied counters include IPCA Tech",
            "splitLabelMeaning": "Human route description only; never an OCR target or an IPCA pickup name",
            "metricMeaning": "Detection rate inside route-derived time windows; not per-location pickup recall",
            "lookbackSeconds": args.lookback,
            "sampleSeconds": args.sample_seconds,
            "workers": args.workers,
            "fuzzyThreshold": args.fuzzy_threshold,
        },
        "summary": {
            "expectedPickupWindows": len(expected),
            "sampledFrames": len(points),
            "gatedFrames": sum(window["gatedSamples"] for window in expected),
            "exactLiveDetectedWindows": exact_windows,
            "exactLiveWindowRate": round(exact_windows / max(1, len(expected)), 4),
            "fuzzyDiagnosticDetectedWindows": fuzzy_windows,
            "fuzzyDiagnosticWindowRate": round(fuzzy_windows / max(1, len(expected)), 4),
            "ocrMeanMs": round(sum(ocr_times) / max(1, len(ocr_times)), 1),
            "ocrP95Ms": percentile(ocr_times, 0.95),
            "elapsedSeconds": round(elapsed, 1),
        },
        "windows": expected,
    }
    output = (args.output or training / "simulations" / "ipca-pickup-replay-simulation.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "summary": result["summary"]}, indent=2))


if __name__ == "__main__":
    main()
