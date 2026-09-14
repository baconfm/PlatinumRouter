#!/usr/bin/env python3
"""Run the buffered Days Gone OCR replay in resumable one-hour chunks."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from scan_days_gone_buffered_first_hour import SCANNER_VERSION, find_binary, latest_recording, probe_video


def load_completed_chunk(path: Path, recording: Path, start: float, duration: float,
                         mode: str = "all-regions") -> dict | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    scan = data.get("scan", {})
    if int(scan.get("scannerVersion", 0)) != SCANNER_VERSION:
        return None
    if Path(data.get("recording", "")).resolve() != recording.resolve():
        return None
    if abs(float(scan.get("startSeconds", -1)) - start) > 0.01:
        return None
    if abs(float(scan.get("durationSeconds", -1)) - duration) > 0.1:
        return None
    if str(scan.get("mode") or "all-regions") != mode:
        return None
    return data


def normalized_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def merge_chunks(recording: Path, chunks: list[dict], output: Path) -> dict:
    collectible_by_id: dict[str, dict] = {}
    ipca_rows: list[dict] = []
    center_rows: list[dict] = []
    center_windows: list[dict] = []
    episode_rows: list[dict] = []

    for chunk in chunks:
        for row in chunk.get("collectibles", {}).get("matches", []):
            previous = collectible_by_id.get(row["id"])
            if previous is None or row["timestamp"] < previous["timestamp"]:
                collectible_by_id[row["id"]] = row
        ipca_rows.extend(chunk.get("ipca", {}).get("matches", []))
        center_rows.extend(chunk.get("center", {}).get("matches", []))
        center_windows.extend(chunk.get("center", {}).get("windows", []))
        episode_rows.extend(chunk.get("ocrEpisodes", []))

    deduped_ipca: list[dict] = []
    for row in sorted(ipca_rows, key=lambda item: item["timestamp"]):
        if not deduped_ipca or row["timestamp"] - deduped_ipca[-1]["timestamp"] >= 8:
            deduped_ipca.append(row)

    deduped_center: list[dict] = []
    for row in sorted(center_rows, key=lambda item: item["timestamp"]):
        key = normalized_text(row.get("text", ""))
        if deduped_center:
            previous = deduped_center[-1]
            same_text = key and key == normalized_text(previous.get("text", ""))
            if same_text and row["timestamp"] - previous["timestamp"] < 20:
                continue
        deduped_center.append(row)

    scan_rows = [chunk.get("scan", {}) for chunk in chunks]
    center_windows.sort(key=lambda row: row.get("startTimestamp", 0))
    for index, row in enumerate(center_windows, 1):
        row["id"] = f"center-window-{index:05d}"
    total_duration = sum(float(row.get("durationSeconds", 0)) for row in scan_rows)
    total_wall = sum(float(row.get("wallSeconds", 0)) for row in scan_rows)
    result = {
        "schemaVersion": 2,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "recording": str(recording),
        "scan": {
            "durationSeconds": total_duration,
            "startSeconds": 0,
            "fps": scan_rows[0].get("fps", 60) if scan_rows else 60,
            "hwaccel": scan_rows[0].get("hwaccel", "") if scan_rows else "",
            "ocrWorkers": scan_rows[0].get("ocrWorkers", 0) if scan_rows else 0,
            "chunks": len(chunks),
            "framesInspected": sum(int(row.get("framesInspected", 0)) for row in scan_rows),
            "wallSeconds": round(total_wall, 3),
            "realtimeFactor": round(total_duration / max(total_wall, 0.001), 3),
            "episodesBuffered": sum(int(row.get("episodesBuffered", 0)) for row in scan_rows),
            "framesMerged": sum(int(row.get("framesMerged", 0)) for row in scan_rows),
            "scannerVersion": SCANNER_VERSION,
            "mode": scan_rows[0].get("mode", "all-regions") if scan_rows else "all-regions",
            "centerFlurryMode": (scan_rows[0].get("centerFlurryMode", "") if scan_rows else
                                 "chronological-known-title-early-exit"),
        },
        "collectibles": {
            "detected": len(collectible_by_id),
            "matches": sorted(collectible_by_id.values(), key=lambda row: row["timestamp"]),
        },
        "ipca": {"detected": len(deduped_ipca), "matches": deduped_ipca},
        "center": {"detected": len(deduped_center), "matches": deduped_center,
                   "windows": center_windows},
        "ocrEpisodes": sorted(episode_rows, key=lambda row: row["timestamp"]),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Resumable whole-run Days Gone buffered OCR replay.")
    parser.add_argument("recording", nargs="?", type=Path)
    parser.add_argument("--train-folder", type=Path, default=Path(r"E:\Train"))
    parser.add_argument("--chunk-seconds", type=float, default=3600)
    parser.add_argument("--fps", type=float, default=60)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--hwaccel", default="d3d11va")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--center-only", action="store_true")
    parser.add_argument("--center-segmented", action="store_true")
    args = parser.parse_args()
    if args.center_segmented and not args.center_only:
        parser.error("--center-segmented requires --center-only")

    root = Path(__file__).resolve().parent.parent
    recording = (args.recording or latest_recording(args.train_folder)).resolve()
    output = (args.output or root / "outputs" / "training" / "days-gone" /
              "buffered-whole-run-60fps" / "result.json").resolve()
    chunk_folder = output.parent / "chunks"
    chunk_folder.mkdir(parents=True, exist_ok=True)

    ffprobe = find_binary(root, "ffprobe")
    _, _, video_duration = probe_video(ffprobe, recording)
    chunk_count = max(1, int((video_duration + args.chunk_seconds - 0.001) // args.chunk_seconds))
    scanner = Path(__file__).with_name("scan_days_gone_buffered_first_hour.py")
    chunks: list[dict] = []

    print(f"[whole run] Recording: {recording}", flush=True)
    print(f"[whole run] Duration: {video_duration / 3600:.2f} hours | chunks: {chunk_count}", flush=True)
    print("[whole run] Completed chunks are reusable if the scan is interrupted.", flush=True)

    for index in range(chunk_count):
        start = index * args.chunk_seconds
        duration = min(args.chunk_seconds, video_duration - start)
        chunk_path = chunk_folder / f"chunk-{index + 1:02d}.json"
        mode = ("center-segmented" if args.center_segmented else
                "center-only" if args.center_only else "all-regions")
        completed = load_completed_chunk(chunk_path, recording, start, duration, mode)
        if completed is not None:
            print(f"[whole run] Reusing chunk {index + 1}/{chunk_count}", flush=True)
            chunks.append(completed)
            continue

        print(f"[whole run] Scanning chunk {index + 1}/{chunk_count} "
              f"({start / 3600:.1f}h to {(start + duration) / 3600:.1f}h)", flush=True)
        command = [
            sys.executable, str(scanner), str(recording),
            "--start", str(start), "--duration", str(duration),
            "--fps", str(args.fps), "--workers", str(args.workers),
            "--hwaccel", args.hwaccel, "--output", str(chunk_path),
        ]
        if args.center_only:
            command.append("--center-only")
        if args.center_segmented:
            command.append("--center-segmented")
        subprocess.run(command, check=True)
        completed = load_completed_chunk(chunk_path, recording, start, duration, mode)
        if completed is None:
            raise RuntimeError(f"Chunk {index + 1} did not produce a valid result")
        chunks.append(completed)

    result = merge_chunks(recording, chunks, output)
    print(json.dumps({
        "output": str(output),
        "scan": result["scan"],
        "collectibles": result["collectibles"]["detected"],
        "ipca": result["ipca"]["detected"],
        "center": result["center"]["detected"],
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
