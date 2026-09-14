from __future__ import annotations

import argparse
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

from scan_days_gone_center_popups import find_binary, find_tesseract, normalize_text
from simulate_days_gone_collectible_run import child_crop, live_gate, normalize, required_score, title_score

SCANNER_VERSION = 5


def ocr_collectible_frame(tesseract: Path, pixels: np.ndarray, psm: int, threshold: int | None = None) -> str:
    image = Image.fromarray(pixels, mode="L")
    if threshold is not None:
        image = image.point(lambda value: 255 if value >= threshold else 0)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    result = subprocess.run(
        [str(tesseract), "stdin", "stdout", "--psm", str(psm), "-l", "eng"],
        input=buffer.getvalue(), capture_output=True, timeout=30, check=False,
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


def collectible_catalog(route_file: Path) -> list[dict]:
    route = load_json(route_file)
    unique: dict[str, dict] = {}
    for split in route.get("splits", []):
        for goal in split.get("ocrGoals", []):
            if goal.get("type") not in {"collectible", "trophy"}:
                continue
            title = str(goal.get("label", "")).strip()
            if goal.get("type") == "trophy" and title.lower().startswith("trophies:"):
                title = title.split(":", 1)[1].strip()
            if title:
                unique.setdefault(normalize(title), {
                    "id": goal.get("id"),
                    "title": title,
                    "counterKey": goal.get("counterKey", "routecollectibles"),
                    "goalType": goal.get("type"),
                })
    return list(unique.values())


def best_catalog_match(text: str, catalog: list[dict]) -> tuple[dict | None, float, dict | None]:
    best = None
    best_score = 0.0
    for item in catalog:
        score = title_score(text, item["title"])
        if score > best_score:
            best = item
            best_score = score
    if not best:
        return None, 0.0, None
    compact_length = len(normalize(best["title"]).replace(" ", ""))
    # Very short labels (for example "Yeast") are otherwise easy to hallucinate
    # out of unrelated scenery. Require an almost exact reading for them.
    threshold = 0.96 if compact_length < 8 else max(0.68, required_score(best["title"]) - 0.02)
    return (best, best_score, best) if best_score >= threshold else (None, best_score, best)


def scan_part(root: Path, manifest_file: Path, timeline_offset: float, fps: float,
              catalog: list[dict], already_seen: set[str],
              duration_seconds: float = 0) -> tuple[list[dict], list[dict], list[dict], int, int]:
    manifest = load_json(manifest_file)
    video_file = Path(manifest["source"]["videoFile"])
    video_stream = next(stream for stream in manifest["video"]["streams"] if stream.get("codec_type") == "video")
    source_width = int(video_stream["width"])
    source_height = int(video_stream["height"])
    # Mirror the live Days Gone top-right toast region so this is a true
    # preflight of tomorrow's scanner, including wider PlayStation trophy toasts.
    region = manifest.get("regions", {}).get(
        "topRightCombined", {"x": 54, "y": 0, "width": 46, "height": 17}
    )
    crop = [
        round(source_width * region["width"] / 100),
        round(source_height * region["height"] / 100),
        round(source_width * region["x"] / 100),
        round(source_height * region["y"] / 100),
    ]
    # Keep the union crop at native resolution. Downscaling the large combined
    # box before extracting the title strips erased the thin Days Gone font.
    frame_width, frame_height = crop[0], crop[1]
    title_region = manifest.get("regions", {}).get(
        "topRightTitle", {"x": 76, "y": 0, "width": 24, "height": 7}
    )
    wide_title_region = {"x": 60, "y": 1, "width": 39.5, "height": 5}
    toast_region = {"x": 54, "y": 1, "width": 46, "height": 16}
    ffmpeg = find_binary(root, "ffmpeg")
    tesseract = find_tesseract()
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(video_file),
    ]
    if duration_seconds > 0:
        command.extend(["-t", str(duration_seconds)])
    command.extend([
        "-an",
        "-vf", f"crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},fps={fps},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ])
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    frame_bytes = frame_width * frame_height
    matches: list[dict] = []
    candidates: list[dict] = []
    duplicates: list[dict] = []
    frame_index = 0
    ocr_attempts = 0
    last_ocr_by_region: dict[str, float] = {}
    last_recovery_by_region: dict[str, float] = {}
    while True:
        raw = process.stdout.read(frame_bytes)
        if len(raw) != frame_bytes:
            break
        pixels = np.frombuffer(raw, dtype=np.uint8).reshape((frame_height, frame_width))
        local_timestamp = frame_index / fps
        region_candidates = []
        for region_id, child_region in (
            ("topRightTitle", title_region),
            ("topRightWideTitle", wide_title_region),
            ("topRightToast", toast_region),
        ):
            child_pixels = child_crop(pixels, region, child_region, target_width=960)
            likely, features = live_gate(child_pixels)
            if region_id in {"topRightTitle", "topRightWideTitle"}:
                likely = likely or (
                    features["maxTransitions"] >= 8
                    and features["strongRows"] >= 2
                    and features["darkRatio"] >= 0.08
                    and (
                        features["brightRatio"] >= 0.0001
                        or features["softBrightRatio"] >= 0.001
                        or features["maxTransitions"] >= 11
                    )
                )
            elif region_id == "topRightToast":
                likely = likely or (
                    features["maxTransitions"] >= 9
                    and features["strongRows"] >= 1
                    and features["darkRatio"] >= 0.08
                )
            if likely:
                region_candidates.append((region_id, child_pixels, features))

        for region_id, child_pixels, features in region_candidates:
            last_ocr_local = last_ocr_by_region.get(region_id, -10.0)
            minimum_interval = {
                "topRightTitle": 0.2,
                "topRightWideTitle": 0.45,
                "topRightToast": 0.35,
            }.get(region_id, 0.35)
            if local_timestamp - last_ocr_local < minimum_interval:
                continue
            last_ocr_by_region[region_id] = local_timestamp
            ocr_attempts += 1
            psm = 7 if region_id in {"topRightTitle", "topRightWideTitle"} else 6
            text = ocr_collectible_frame(tesseract, child_pixels, psm)
            item, score, closest = best_catalog_match(text, catalog)
            recovery_text = ""
            last_recovery_local = last_recovery_by_region.get(region_id, -10.0)
            if (
                not item
                and features["maxTransitions"] >= 8
                and features["darkRatio"] >= 0.08
                and local_timestamp - last_recovery_local >= 1.2
            ):
                last_recovery_by_region[region_id] = local_timestamp
                ocr_attempts += 1
                recovery_text = ocr_collectible_frame(tesseract, child_pixels, psm, threshold=155)
                recovery_item, recovery_score, recovery_closest = best_catalog_match(recovery_text, catalog)
                if recovery_item or recovery_score > score:
                    text = recovery_text
                    item, score, closest = recovery_item, recovery_score, recovery_closest
            candidate = {
                "timestamp": round(timeline_offset + local_timestamp, 3),
                "regionId": region_id,
                "observedText": text,
                "closestId": closest["id"] if closest else None,
                "closestTitle": closest["title"] if closest else None,
                "score": round(score, 4),
                "accepted": bool(item),
                "recoveryText": recovery_text,
                "recoveryUsed": bool(recovery_text),
                "gate": features,
            }
            if text:
                candidates.append(candidate)
            if item and item["id"] not in already_seen:
                already_seen.add(item["id"])
                matches.append({
                    "id": item["id"],
                    "title": item["title"],
                    "counterKey": item["counterKey"],
                    "timestamp": candidate["timestamp"],
                    "observedText": text,
                    "score": round(score, 4),
                })
            elif item:
                duplicates.append({
                    "id": item["id"], "title": item["title"],
                    "timestamp": candidate["timestamp"], "observedText": text,
                    "score": round(score, 4),
                })
        frame_index += 1
        if frame_index % max(1, round(fps * 1800)) == 0:
            print(f"[collectible progress] {(timeline_offset + local_timestamp) / 3600:.1f}h | {len(already_seen)} unique | {ocr_attempts} OCR", flush=True)

    return_code = process.wait()
    if return_code != 0:
        error = (process.stderr.read() if process.stderr else b"").decode("utf-8", errors="replace")
        raise RuntimeError(error or f"ffmpeg stopped with exit code {return_code}")
    return matches, candidates, duplicates, frame_index, ocr_attempts


def main() -> None:
    parser = argparse.ArgumentParser(description="Build timestamped Days Gone collectible progress for route comparison.")
    parser.add_argument("run_directory", type=Path)
    parser.add_argument("--fps", type=float, default=0.5)
    parser.add_argument("--duration", type=float, default=0, help="Scan only this many seconds from the run.")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--force", action="store_true", help="Ignore completed per-part checkpoints.")
    parser.add_argument(
        "--merge-existing",
        action="store_true",
        help="Keep previously accepted matches that the new sampling phase does not rediscover.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    run_directory = args.run_directory.resolve()
    run = load_json(run_directory / "run.json")
    catalog = collectible_catalog(root / "data" / "days-gone" / "default-splits.json")
    seen: set[str] = set()
    matches: list[dict] = []
    candidates: list[dict] = []
    duplicates: list[dict] = []
    total_frames = 0
    total_ocr = 0
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
        checkpoint_file = run_directory / f"collectible-progress-part-{part['part']}.json"
        checkpoint = None
        if checkpoint_file.exists() and not args.force:
            loaded = load_json(checkpoint_file)
            if (
                int(loaded.get("scannerVersion", 0)) == SCANNER_VERSION
                and float(loaded.get("fps", 0)) == args.fps
                and float(loaded.get("durationSeconds", 0)) == part_duration
                and loaded.get("manifest") == str(manifest_file.resolve())
            ):
                checkpoint = loaded
                print(f"[collectible progress] Reusing completed part {part['part']} checkpoint", flush=True)
        if checkpoint:
            part_matches = checkpoint.get("matches", [])
            part_candidates = checkpoint.get("ocrCandidates", [])
            part_duplicates = checkpoint.get("duplicateSightings", [])
            frames = int(checkpoint.get("frames", 0))
            attempts = int(checkpoint.get("ocrAttempts", 0))
            seen.update(item["id"] for item in part_matches)
        else:
            part_matches, part_candidates, part_duplicates, frames, attempts = scan_part(
                root, manifest_file, timeline_offset, args.fps, catalog, seen, part_duration
            )
            checkpoint_file.write_text(json.dumps({
                "schemaVersion": 1,
                "scannerVersion": SCANNER_VERSION,
                "manifest": str(manifest_file.resolve()),
                "fps": args.fps,
                "durationSeconds": part_duration,
                "frames": frames,
                "ocrAttempts": attempts,
                "matches": part_matches,
                "ocrCandidates": part_candidates,
                "duplicateSightings": part_duplicates,
            }, indent=2) + "\n", encoding="utf-8")
            print(f"[collectible progress] Saved part {part['part']} checkpoint", flush=True)
        matches.extend(part_matches)
        candidates.extend(part_candidates)
        duplicates.extend(part_duplicates)
        total_frames += frames
        total_ocr += attempts

    output = (args.output or run_directory / "collectible-progress.json").resolve()
    if args.merge_existing and output.exists():
        previous = load_json(output)
        by_id = {item["id"]: item for item in previous.get("matches", [])}
        for item in matches:
            current = by_id.get(item["id"])
            if current is None or float(item["timestamp"]) < float(current["timestamp"]):
                by_id[item["id"]] = item
        matches = list(by_id.values())
        seen.update(by_id)

    matches.sort(key=lambda item: item["timestamp"])
    source_duration = float(run.get("totalDurationSeconds", 0) or 0)
    for index, match in enumerate(matches, 1):
        match["detectedCount"] = index
        match["runProgressPercent"] = round(match["timestamp"] / source_duration * 100, 4) if source_duration else 0
    per_counter: dict[str, int] = {}
    for match in matches:
        per_counter[match["counterKey"]] = per_counter.get(match["counterKey"], 0) + 1
    missing = [item for item in catalog if item["id"] not in seen]
    result = {
        "schemaVersion": 2,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "runDirectory": str(run_directory),
        "sourceDurationSeconds": source_duration,
        "catalogItems": len(catalog),
        "scan": {
            "fps": args.fps,
            "durationSeconds": min(source_duration, args.duration) if args.duration > 0 else source_duration,
            "frames": total_frames,
            "ocrAttempts": total_ocr,
        },
        "summary": {
            "detectedCollectibles": len(matches),
            "catalogItems": len(catalog),
            "coveragePercent": round(len(matches) / len(catalog) * 100, 2) if catalog else 0,
            "readableCandidates": len(candidates),
            "duplicateSightings": len(duplicates),
            "unmatchedCandidates": sum(1 for item in candidates if not item["accepted"]),
            "perCounter": per_counter,
        },
        "matches": matches,
        "missingCatalogItems": missing,
        "duplicateSightings": duplicates,
        "ocrCandidates": candidates,
    }
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), **result["scan"], **result["summary"]}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
