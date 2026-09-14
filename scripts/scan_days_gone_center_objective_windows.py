#!/usr/bin/env python3
"""Recover every readable center popup around previously timestamped objectives.

The full buffered scanner intentionally stops after the first recognized title.
This targeted pass seeks only around those known timestamps, keeps scanning the
rest of the flurry, and groups the resulting text under the original objective.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from difflib import SequenceMatcher
import json
from pathlib import Path
import subprocess
from typing import Any

import numpy as np

from scan_days_gone_buffered_first_hour import completion_catalog, best_completion_match
from scan_days_gone_center_popups import (
    find_binary,
    find_tesseract,
    normalize_text,
    ocr_frame,
    text_shape_score,
)
from scan_days_gone_buffered_first_hour import probe_video


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def readable_secondary(text: str) -> bool:
    value = normalize_text(text)
    letters = "".join(character for character in value if character.isalpha())
    words = [word for word in value.split() if any(character.isalpha() for character in word)]
    if not value or "continue" in value.lower():
        return False
    if len(letters) < 5 or len(value) > 140 or not words:
        return False
    uppercase = sum(character.isupper() for character in letters) / max(1, len(letters))
    return uppercase >= 0.48 or len(words) >= 2


def merge_windows(anchors: list[dict], before: float, after: float, duration: float) -> list[dict]:
    windows = []
    for anchor in sorted(anchors, key=lambda row: row["localTimestamp"]):
        start = max(0.0, anchor["localTimestamp"] - before)
        end = min(duration, anchor["localTimestamp"] + after)
        if windows and start <= windows[-1]["end"] + 0.35:
            windows[-1]["end"] = max(windows[-1]["end"], end)
            windows[-1]["anchors"].append(anchor)
        else:
            windows.append({"start": start, "end": end, "anchors": [anchor]})
    return windows


def add_candidate(anchor: dict, candidate: dict) -> None:
    rows = anchor.setdefault("popups", [])
    normalized = normalize_text(candidate["text"]).lower()
    for previous in reversed(rows[-4:]):
        previous_normalized = normalize_text(previous["text"]).lower()
        if abs(candidate["timestamp"] - previous["timestamp"]) > 1.6:
            break
        if normalized == previous_normalized or SequenceMatcher(None, normalized, previous_normalized).ratio() >= 0.91:
            if candidate["shapeScore"] > previous["shapeScore"]:
                previous.update(candidate)
            return
    rows.append(candidate)


def scan_source(
    root: Path,
    source: dict,
    center_catalog: list[dict],
    before: float,
    after: float,
    fps: float,
) -> dict:
    result_path = Path(source["resultPath"]).resolve()
    result = load_json(result_path)
    video = Path(result.get("recording") or source.get("video", "")).resolve()
    if not video.exists():
        raise FileNotFoundError(f"Recording not found for {source['id']}: {video}")

    ffmpeg = find_binary(root, "ffmpeg")
    ffprobe = find_binary(root, "ffprobe")
    tesseract = find_tesseract()
    width, height, duration = probe_video(ffprobe, video)
    crop_width = round(width * 54 / 100)
    crop_height = round(height * 15 / 100)
    crop_x = round(width * 23 / 100)
    crop_y = round(height * 53 / 100)
    frame_width, frame_height = 960, 150
    timeline_offset = float(source.get("timelineOffset", 0.0))

    anchors = []
    for index, row in enumerate(result.get("center", {}).get("matches", []), 1):
        canonical = str(row.get("canonicalTitle") or "").strip()
        if not canonical:
            continue
        local_timestamp = float(row["timestamp"])
        anchors.append({
            "id": f"{source['id']}-objective-{index:04d}",
            "sourceId": source["id"],
            "canonicalTitle": canonical,
            "counterKey": str(row.get("counterKey") or ""),
            "primaryObservedText": str(row.get("text") or ""),
            "primaryScore": float(row.get("score") or 0),
            "localTimestamp": local_timestamp,
            "timestamp": round(local_timestamp + timeline_offset, 3),
            "popups": [],
        })

    windows = merge_windows(anchors, before, after, duration)
    print(
        f"[center objectives] {source['label']}: {len(anchors)} anchors in "
        f"{len(windows)} merged windows ({sum(w['end'] - w['start'] for w in windows) / 60:.1f} video min)",
        flush=True,
    )

    for window_index, window in enumerate(windows, 1):
        window_duration = max(0.01, window["end"] - window["start"])
        command = [
            str(ffmpeg), "-hide_banner", "-loglevel", "error",
            "-ss", f"{window['start']:.3f}", "-i", str(video),
            "-t", f"{window_duration:.3f}", "-an", "-vf",
            (
                f"crop={crop_width}:{crop_height}:{crop_x}:{crop_y},"
                f"scale={frame_width}:{frame_height}:flags=lanczos,"
                f"fps={fps},format=gray"
            ),
            "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
        ]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout is not None
        frame_bytes = frame_width * frame_height
        frame_index = 0
        last_ocr_local = -10.0
        while True:
            raw = process.stdout.read(frame_bytes)
            if len(raw) != frame_bytes:
                break
            pixels = np.frombuffer(raw, dtype=np.uint8).reshape((frame_height, frame_width))
            local_timestamp = window["start"] + frame_index / fps
            shape_score, features = text_shape_score(pixels)
            likely_text = (
                shape_score >= 0.24
                and features["mean"] <= 145
                and (features["rowActivity"] >= 0.045 or features["strongRows"] >= 0.035)
            )
            if likely_text and local_timestamp - last_ocr_local >= 0.34:
                last_ocr_local = local_timestamp
                text = ocr_frame(tesseract, pixels)
                if readable_secondary(text):
                    matched, match_score = best_completion_match(text, center_catalog)
                    candidate = {
                        "localTimestamp": round(local_timestamp, 3),
                        "timestamp": round(local_timestamp + timeline_offset, 3),
                        "text": text,
                        "relativeSeconds": 0.0,
                        "matchedCanonicalTitle": matched["canonicalTitle"] if matched else "",
                        "matchedCounterKey": matched["counterKey"] if matched else "",
                        "matchScore": round(float(match_score or 0), 4),
                        "shapeScore": round(float(shape_score), 5),
                    }
                    for anchor in window["anchors"]:
                        if anchor["localTimestamp"] - before <= local_timestamp <= anchor["localTimestamp"] + after:
                            linked = dict(candidate)
                            linked["relativeSeconds"] = round(local_timestamp - anchor["localTimestamp"], 3)
                            linked["role"] = (
                                "primary-retry"
                                if linked["matchedCanonicalTitle"] == anchor["canonicalTitle"]
                                else "secondary-candidate"
                            )
                            add_candidate(anchor, linked)
            frame_index += 1

        return_code = process.wait()
        if return_code != 0:
            error = (process.stderr.read() if process.stderr else b"").decode("utf-8", errors="replace")
            raise RuntimeError(error or f"ffmpeg failed in window {window_index}")
        if window_index % 10 == 0 or window_index == len(windows):
            print(f"[center objectives] {source['label']}: {window_index}/{len(windows)} windows", flush=True)

    for anchor in anchors:
        anchor["popups"].sort(key=lambda row: row["timestamp"])
        anchor["secondaryCandidates"] = sum(row["role"] == "secondary-candidate" for row in anchor["popups"])

    return {
        "id": source["id"],
        "label": source["label"],
        "video": str(video),
        "timelineOffset": timeline_offset,
        "anchors": anchors,
        "summary": {
            "objectiveAnchors": len(anchors),
            "mergedWindows": len(windows),
            "sourceSecondsScanned": round(sum(window["end"] - window["start"] for window in windows), 3),
            "readablePopups": sum(len(anchor["popups"]) for anchor in anchors),
            "secondaryCandidates": sum(anchor["secondaryCandidates"] for anchor in anchors),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Targeted Days Gone center-objective flurry recovery.")
    parser.add_argument("--before", type=float, default=2.0)
    parser.add_argument("--after", type=float, default=12.0)
    parser.add_argument("--fps", type=float, default=6.0)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    output = (args.output or root / "outputs" / "training" / "days-gone" /
              "center-objective-crossmatch" / "result.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    center_catalog = completion_catalog(root / "data" / "days-gone" / "completion-titles.json")

    bacon_result = root / "outputs" / "training" / "days-gone" / "buffered-whole-run-60fps" / "result.json"
    jam_root = root / "outputs" / "training" / "days-gone" / "jamcar-buffered-whole-run-60fps"
    jam_part_1 = jam_root / "part-1" / "result.json"
    jam_part_2 = jam_root / "part-2" / "result.json"
    jam_1_data = load_json(jam_part_1)
    part_1_duration = float(jam_1_data.get("scan", {}).get("durationSeconds") or 0)

    sources = [
        {"id": "bacon", "label": "Bacon Jul 25", "resultPath": str(bacon_result), "timelineOffset": 0.0},
        {"id": "jamcar-part-1", "label": "JamCar WR part 1", "resultPath": str(jam_part_1), "timelineOffset": 0.0},
        {"id": "jamcar-part-2", "label": "JamCar WR part 2", "resultPath": str(jam_part_2), "timelineOffset": part_1_duration},
    ]

    run_results = []
    for source in sources:
        checkpoint = output.parent / f"{source['id']}.json"
        if checkpoint.exists() and not args.force:
            print(f"[center objectives] Reusing {checkpoint.name}", flush=True)
            run_results.append(load_json(checkpoint))
            continue
        scanned = scan_source(root, source, center_catalog, args.before, args.after, args.fps)
        checkpoint.write_text(json.dumps(scanned, indent=2) + "\n", encoding="utf-8")
        run_results.append(scanned)

    bacon = run_results[0]
    jamcar_anchors = run_results[1]["anchors"] + run_results[2]["anchors"]
    by_bacon: dict[str, list[dict]] = {}
    by_jamcar: dict[str, list[dict]] = {}
    for anchor in bacon["anchors"]:
        by_bacon.setdefault(anchor["canonicalTitle"], []).append(anchor)
    for anchor in jamcar_anchors:
        by_jamcar.setdefault(anchor["canonicalTitle"], []).append(anchor)
    shared_titles = sorted(set(by_bacon) & set(by_jamcar))

    result = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scan": {
            "beforeSeconds": args.before,
            "afterSeconds": args.after,
            "fps": args.fps,
            "mode": "timestamp-targeted-primary-and-secondary-center-flurry",
        },
        "runs": {
            "bacon": bacon,
            "jamcar": {
                "id": "jamcar",
                "label": "JamCar WR",
                "anchors": sorted(jamcar_anchors, key=lambda row: row["timestamp"]),
                "parts": [run_results[1]["summary"], run_results[2]["summary"]],
            },
        },
        "crossmatch": {
            "sharedCanonicalTitles": len(shared_titles),
            "titles": [
                {
                    "canonicalTitle": title,
                    "bacon": by_bacon[title],
                    "jamcar": by_jamcar[title],
                }
                for title in shared_titles
            ],
        },
        "safety": {
            "secondaryCandidatesAreEvidenceOnly": True,
            "note": "A secondary candidate must be explicitly mapped to another objective before it can change counters.",
        },
    }
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "sharedCanonicalTitles": len(shared_titles),
        "bacon": bacon["summary"],
        "jamcarPart1": run_results[1]["summary"],
        "jamcarPart2": run_results[2]["summary"],
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
