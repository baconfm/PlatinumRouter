#!/usr/bin/env python3
"""Scan JamCar's two-part Days Gone run and join it onto one timeline."""

from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
from pathlib import Path

from scan_days_gone_buffered_first_hour import find_binary, probe_video
from scan_days_gone_buffered_whole_run import merge_chunks


def find_part(folder: Path, number: int) -> Path:
    matches = sorted(
        folder.glob(f"Days Gone 100% Speedrun pt.{number}*"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not matches:
        raise FileNotFoundError(f"JamCar part {number} was not found directly inside {folder}")
    return matches[0].resolve()


def shift_timestamps(result: dict, offset: float) -> dict:
    shifted = copy.deepcopy(result)
    shifted["scan"]["startSeconds"] = offset
    for section in ("collectibles", "ipca", "center"):
        for row in shifted.get(section, {}).get("matches", []):
            row["timestamp"] = round(float(row["timestamp"]) + offset, 3)
    for row in shifted.get("ocrEpisodes", []):
        row["timestamp"] = round(float(row["timestamp"]) + offset, 3)
    return shifted


def remove_achievements(result: dict) -> None:
    rows = [
        row for row in result.get("collectibles", {}).get("matches", [])
        if row.get("counterKey") != "trophies"
    ]
    result.setdefault("collectibles", {})["matches"] = rows
    result["collectibles"]["detected"] = len(rows)


def find_anchor(result: dict, preferred_ids: tuple[str, ...]) -> tuple[str, float]:
    by_id = {row.get("id"): row for row in result.get("collectibles", {}).get("matches", [])}
    for item_id in preferred_ids:
        if item_id in by_id:
            return item_id, float(by_id[item_id]["timestamp"])
    raise RuntimeError(f"None of the alignment anchors were detected: {', '.join(preferred_ids)}")


def build_bacon_comparison(root: Path, jamcar: dict, output_folder: Path) -> Path | None:
    bacon_path = root / "outputs" / "training" / "days-gone" / "buffered-whole-run-60fps" / "result.json"
    if not bacon_path.exists():
        print("[JamCar] Bacon whole-run result is absent; skipping automatic comparison.", flush=True)
        return None

    bacon = json.loads(bacon_path.read_text(encoding="utf-8"))
    jam_anchor_id, jam_anchor = find_anchor(jamcar, ("charactercollectibles-01", "finders-keepers"))
    bacon_anchor_id, bacon_anchor = find_anchor(bacon, ("charactercollectibles-01", "finders-keepers"))
    jam_rows = {
        row["id"]: row for row in jamcar.get("collectibles", {}).get("matches", [])
        if row.get("counterKey") != "trophies"
    }
    bacon_rows = {
        row["id"]: row for row in bacon.get("collectibles", {}).get("matches", [])
        if row.get("counterKey") != "trophies"
    }

    shared: list[dict] = []
    wins = {"jamcar": 0, "bacon": 0, "tie": 0}
    for item_id in sorted(set(jam_rows) & set(bacon_rows), key=lambda key: jam_rows[key]["timestamp"]):
        jam_seconds = float(jam_rows[item_id]["timestamp"]) - jam_anchor
        bacon_seconds = float(bacon_rows[item_id]["timestamp"]) - bacon_anchor
        delta = bacon_seconds - jam_seconds
        winner = "tie" if abs(delta) < 1 else ("jamcar" if delta > 0 else "bacon")
        wins[winner] += 1
        shared.append({
            "id": item_id,
            "title": jam_rows[item_id]["title"],
            "counterKey": jam_rows[item_id]["counterKey"],
            "jamcarSecondsFromLeon": round(jam_seconds, 3),
            "baconSecondsFromLeon": round(bacon_seconds, 3),
            "jamcarAdvantageSeconds": round(delta, 3),
            "winner": winner,
        })

    jam_ipca = jamcar.get("ipca", {}).get("matches", [])
    bacon_ipca = bacon.get("ipca", {}).get("matches", [])
    ipca_progress = []
    for index in range(min(len(jam_ipca), len(bacon_ipca))):
        jam_seconds = float(jam_ipca[index]["timestamp"]) - jam_anchor
        bacon_seconds = float(bacon_ipca[index]["timestamp"]) - bacon_anchor
        ipca_progress.append({
            "pickupNumber": index + 1,
            "jamcarSecondsFromLeon": round(jam_seconds, 3),
            "baconSecondsFromLeon": round(bacon_seconds, 3),
            "jamcarAdvantageSeconds": round(bacon_seconds - jam_seconds, 3),
        })

    comparison = {
        "schemaVersion": 1,
        "achievementComparisonExcluded": True,
        "alignment": {
            "description": "Leon collectible / Finders Keepers route moment",
            "jamcar": {"id": jam_anchor_id, "timestamp": jam_anchor},
            "bacon": {"id": bacon_anchor_id, "timestamp": bacon_anchor},
        },
        "summary": {
            "sharedNamedCollectibles": len(shared),
            "collectibleWins": wins,
            "jamcarIpcaDetected": len(jam_ipca),
            "baconIpcaDetected": len(bacon_ipca),
        },
        "sharedCollectibles": shared,
        "ipcaOrdinalProgress": ipca_progress,
        "centerActivityWarning": (
            "Center OCR rows remain provisional and are not used to declare winners until titles are "
            "matched to exact activity names."
        ),
        "centerCategoryCounts": {
            "jamcar": {
                category: sum(1 for row in jamcar.get("center", {}).get("matches", []) if row.get("category") == category)
                for category in ("horde", "ambush-camp", "infestation", "nero")
            },
            "bacon": {
                category: sum(1 for row in bacon.get("center", {}).get("matches", []) if row.get("category") == category)
                for category in ("horde", "ambush-camp", "infestation", "nero")
            },
        },
    }
    comparison_path = output_folder / "comparison-vs-bacon-july25.json"
    comparison_path.write_text(json.dumps(comparison, indent=2) + "\n", encoding="utf-8")
    return comparison_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan and join JamCar's two-part Days Gone run.")
    parser.add_argument("--folder", type=Path, default=Path(r"E:\Train\New folder"))
    parser.add_argument("--part1", type=Path)
    parser.add_argument("--part2", type=Path)
    parser.add_argument("--fps", type=float, default=60)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--hwaccel", default="d3d11va")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--center-only", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    part1 = (args.part1 or find_part(args.folder, 1)).resolve()
    part2 = (args.part2 or find_part(args.folder, 2)).resolve()
    output = (args.output or root / "outputs" / "training" / "days-gone" /
              "jamcar-buffered-whole-run-60fps" / "result.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    ffprobe = find_binary(root, "ffprobe")
    _, _, duration1 = probe_video(ffprobe, part1)
    _, _, duration2 = probe_video(ffprobe, part2)
    whole_scanner = Path(__file__).with_name("scan_days_gone_buffered_whole_run.py")
    part_results: list[dict] = []

    print(f"[JamCar] Part 1: {part1}", flush=True)
    print(f"[JamCar] Part 2: {part2}", flush=True)
    print(f"[JamCar] Combined duration: {(duration1 + duration2) / 3600:.2f} hours", flush=True)
    print("[JamCar] Trophy/achievement detections will be excluded.", flush=True)

    for number, video in ((1, part1), (2, part2)):
        part_output = output.parent / f"part-{number}" / "result.json"
        command = [
            sys.executable, str(whole_scanner), str(video),
            "--fps", str(args.fps), "--workers", str(args.workers),
            "--hwaccel", args.hwaccel, "--output", str(part_output),
        ]
        if args.center_only:
            command.append("--center-only")
        print(f"[JamCar] Starting/resuming part {number}/2", flush=True)
        subprocess.run(command, check=True)
        result = json.loads(part_output.read_text(encoding="utf-8"))
        remove_achievements(result)
        part_results.append(result)

    shifted_parts = [shift_timestamps(part_results[0], 0), shift_timestamps(part_results[1], duration1)]
    combined = merge_chunks(part1, shifted_parts, output)
    combined.pop("recording", None)
    combined["recordings"] = [str(part1), str(part2)]
    combined["partBoundarySeconds"] = round(duration1, 3)
    combined["achievementsExcluded"] = True
    combined["comparisonUse"] = "Compare collectibles, IPCA Tech, NERO and activity completions; ignore trophies."
    output.write_text(json.dumps(combined, indent=2) + "\n", encoding="utf-8")
    comparison_path = None if args.center_only else build_bacon_comparison(root, combined, output.parent)

    print(json.dumps({
        "output": str(output),
        "durationHours": round((duration1 + duration2) / 3600, 3),
        "partBoundarySeconds": round(duration1, 3),
        "collectibles": combined["collectibles"]["detected"],
        "ipca": combined["ipca"]["detected"],
        "center": combined["center"]["detected"],
        "achievementsExcluded": True,
        "comparison": str(comparison_path) if comparison_path else None,
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
