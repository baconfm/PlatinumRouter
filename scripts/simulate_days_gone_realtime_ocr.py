from __future__ import annotations

import argparse
from collections import Counter, deque
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import time

import numpy as np

from scan_days_gone_buffered_first_hour import (
    CENTER_OFFSET,
    CENTER_SIZE,
    COMPOSITE_HEIGHT,
    COMPOSITE_WIDTH,
    IPCA_OFFSET,
    IPCA_SIZE,
    REGIONS,
    TOP_CHILDREN,
    TOP_OFFSET,
    TOP_SIZE,
    CenterFlurryBuffer,
    EpisodeBuffer,
    best_catalog_match,
    best_completion_match,
    classify_title,
    collectible_catalog,
    completion_catalog,
    crop_from_percent,
    find_binary,
    find_tesseract,
    has_ipca_pickup_text,
    ipca_score,
    ipca_text_gate,
    latest_recording,
    normalized_title,
    ocr_center_frame,
    ocr_collectible_frame,
    ocr_ipca_frame,
    probe_video,
    text_shape_score,
    top_gate,
    useful_text,
)


SCANNER_VERSION = 2
REGION_PRIORITY = {
    "ipcaPickup": 0,
    "topRightTitle": 1,
    "topRightWideTitle": 2,
    "topRightToast": 3,
    # Center crops are captured immediately, but their expensive retries run
    # on an isolated background executor so they cannot delay pickups.
    "completionTitle": 9,
}


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def format_clock(seconds: float) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def build_ocr_resolver(tesseract: Path, catalog: list[dict], center_catalog: list[dict]):
    non_trophy_catalog = [item for item in catalog if item.get("goalType") != "trophy"]

    def catalog_for_text(text: str) -> list[dict]:
        return catalog if "trophy earned" in text.lower() else non_trophy_catalog

    def resolve(episode: dict) -> dict:
        processing_started = time.perf_counter()
        region_id = episode["regionId"]
        attempts: list[str] = []
        accepted_text = ""
        accepted_item = None
        accepted_center_item = None
        accepted_score = 0.0
        accepted_timestamp = float(episode.get("bestTimestamp", episode["firstTimestamp"]))
        candidates = episode["candidates"]

        if region_id.startswith("topRight"):
            psm = 7 if region_id != "topRightToast" else 6
            for candidate in candidates:
                text = ocr_collectible_frame(tesseract, candidate["pixels"], psm)
                attempts.append(text)
                item, score, _ = best_catalog_match(text, catalog_for_text(text))
                if item and score > accepted_score:
                    accepted_text, accepted_item, accepted_score = text, item, score
            if not accepted_item and candidates:
                text = ocr_collectible_frame(tesseract, candidates[0]["pixels"], psm, 155)
                attempts.append(text)
                item, score, _ = best_catalog_match(text, catalog_for_text(text))
                if item:
                    accepted_text, accepted_item, accepted_score = text, item, score
            accepted = accepted_item is not None
        elif region_id == "ipcaPickup":
            for threshold in (135, 115):
                for candidate in candidates:
                    text = ocr_ipca_frame(tesseract, candidate["pixels"], threshold)
                    attempts.append(text)
                    score = ipca_score(text)
                    if score >= 0.72 and has_ipca_pickup_text(text) and score > accepted_score:
                        accepted_text, accepted_score = text, score
                if accepted_text:
                    break
            accepted = bool(accepted_text)
        else:
            # Center flurries are chronological: the first catalog match wins,
            # and later reward cards are discarded immediately.
            for candidate in candidates:
                text = ocr_center_frame(tesseract, candidate["pixels"])
                attempts.append(text)
                item, score = best_completion_match(text, center_catalog)
                if item:
                    accepted_text = text
                    accepted_score = score
                    accepted_timestamp = candidate["timestamp"]
                    accepted_center_item = item
                    break
                if useful_text(text) and len(text) > len(accepted_text):
                    accepted_text = text
                    accepted_timestamp = candidate["timestamp"]
            accepted = bool(accepted_text)

        return {
            "episode": episode,
            "text": accepted_text or max(attempts, key=len, default=""),
            "attempts": attempts,
            "item": accepted_item,
            "centerItem": accepted_center_item,
            "score": accepted_score,
            "accepted": accepted,
            "acceptedTimestamp": accepted_timestamp,
            "processingSeconds": time.perf_counter() - processing_started,
        }

    return resolve


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replay Days Gone OCR chronologically with a bounded live queue."
    )
    parser.add_argument("recording", nargs="?", type=Path)
    parser.add_argument("--train-folder", type=Path, default=Path(r"E:\Train"))
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--fps", type=float, default=60)
    parser.add_argument("--workers", type=int, default=max(2, min(8, os.cpu_count() or 4)))
    parser.add_argument("--center-workers", type=int, default=2,
                        help="Workers reserved for deferred center-flurry OCR.")
    parser.add_argument("--max-pending", type=int, default=256)
    parser.add_argument("--playback-speed", type=float, default=1.0,
                        help="1.0 is real time. Values above 1 are only for short smoke tests.")
    parser.add_argument("--hwaccel", default="d3d11va")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.fps <= 0 or args.workers <= 1 or args.max_pending <= 0 or args.playback_speed <= 0:
        parser.error("fps, max-pending and playback-speed must be positive; workers must exceed one")
    if args.center_workers <= 0 or args.center_workers >= args.workers:
        parser.error("center-workers must be positive and smaller than workers")
    realtime_workers = args.workers - args.center_workers

    root = Path(__file__).resolve().parent.parent
    video = (args.recording or latest_recording(args.train_folder)).resolve()
    output = (args.output or root / "outputs" / "training" / "days-gone" /
              "realtime-live-replay" / "result.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_binary(root, "ffmpeg")
    ffprobe = find_binary(root, "ffprobe")
    tesseract = find_tesseract()
    source_width, source_height, video_duration = probe_video(ffprobe, video)
    duration = min(args.duration if args.duration is not None else video_duration - args.start,
                   max(0.0, video_duration - args.start))

    top = crop_from_percent(source_width, source_height, REGIONS["top"])
    ipca = crop_from_percent(source_width, source_height, REGIONS["ipca"])
    center = crop_from_percent(source_width, source_height, REGIONS["center"])
    filter_graph = (
        f"[0:v]split=3[t0][i0][c0];"
        f"[t0]crop={top[0]}:{top[1]}:{top[2]}:{top[3]},scale={TOP_SIZE[0]}:{TOP_SIZE[1]}:flags=lanczos,pad={COMPOSITE_WIDTH}:{TOP_SIZE[1]}:0:0[t];"
        f"[i0]crop={ipca[0]}:{ipca[1]}:{ipca[2]}:{ipca[3]},scale={IPCA_SIZE[0]}:{IPCA_SIZE[1]}:flags=lanczos,pad={COMPOSITE_WIDTH}:{IPCA_SIZE[1]}:0:0[i];"
        f"[c0]crop={center[0]}:{center[1]}:{center[2]}:{center[3]},scale={CENTER_SIZE[0]}:{CENTER_SIZE[1]}:flags=lanczos,pad={COMPOSITE_WIDTH}:{CENTER_SIZE[1]}:0:0[c];"
        f"[t][i][c]vstack=inputs=3,fps={args.fps},format=gray[out]"
    )
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error"]
    if args.hwaccel and args.hwaccel.lower() != "none":
        command.extend(["-hwaccel", args.hwaccel])
    if args.start > 0:
        command.extend(["-ss", str(args.start)])
    command.extend(["-i", str(video), "-t", str(duration), "-an", "-filter_complex",
                    filter_graph, "-map", "[out]", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"])

    catalog = collectible_catalog(root / "data" / "days-gone" / "default-splits.json")
    center_catalog = completion_catalog(root / "data" / "days-gone" / "completion-titles.json")
    resolver = build_ocr_resolver(tesseract, catalog, center_catalog)
    buffers: dict[str, EpisodeBuffer | CenterFlurryBuffer] = {
        name: EpisodeBuffer(name) for name in (*TOP_CHILDREN.keys(), "ipcaPickup")
    }
    buffers["completionTitle"] = CenterFlurryBuffer()
    matches: dict[str, dict] = {}
    ipca_matches: list[dict] = []
    center_matches: list[dict] = []
    ocr_rows: list[dict] = []
    pending: deque[dict] = deque()
    queue_waits: list[float] = []
    processing_times: list[float] = []
    completion_latencies: list[float] = []
    schedule_lags: list[float] = []
    queue_depth_samples: list[int] = []
    dropped: list[dict] = []
    counts = Counter()
    max_pending_seen = 0
    max_realtime_pending_seen = 0
    max_center_pending_seen = 0
    max_capture_lag = 0.0

    def apply_result(resolved: dict, queued_at: float, completed_at: float) -> None:
        episode = resolved["episode"]
        region_id = episode["regionId"]
        text = resolved["text"]
        timestamp = float(resolved.get("acceptedTimestamp", episode["bestTimestamp"]))
        processing_times.append(float(resolved["processingSeconds"]))
        queue_waits.append(max(0.0, completed_at - queued_at - resolved["processingSeconds"]))
        completion_latencies.append(max(0.0, completed_at - playback_started -
                                          (timestamp - args.start) / args.playback_speed))
        counts["completed"] += 1
        counts[f"completed:{region_id}"] += 1

        if resolved["item"]:
            item = resolved["item"]
            observed = normalized_title(text)
            expected = normalized_title(item["title"])
            exact = bool(expected and expected in observed)
            row = {"id": item["id"], "title": item["title"], "counterKey": item["counterKey"],
                   "timestamp": round(timestamp, 3), "observedText": text,
                   "score": round(resolved["score"], 4),
                   "evidence": "exact-title" if exact else "fuzzy-title"}
            previous = matches.get(item["id"])
            rank = (1 if exact else 0, row["score"], -row["timestamp"])
            previous_rank = ((1 if previous and previous.get("evidence") == "exact-title" else 0),
                             previous.get("score", 0) if previous else 0,
                             -previous.get("timestamp", 0) if previous else 0)
            if previous is None or rank > previous_rank:
                matches[item["id"]] = row
        elif region_id == "ipcaPickup" and resolved["accepted"]:
            if not ipca_matches or timestamp - ipca_matches[-1]["timestamp"] >= 8:
                ipca_matches.append({"timestamp": round(timestamp, 3), "observedText": text,
                                     "score": round(resolved["score"], 4)})
        elif region_id == "completionTitle" and resolved["accepted"]:
            item = resolved.get("centerItem")
            counter_key = item["counterKey"] if item else ""
            category = {"hordes": "horde", "ambushcamps": "ambush-camp",
                        "infestations": "infestation", "nerosites": "nero",
                        "encampmentjobs": "camp-job"}.get(counter_key,
                                                            counter_key or classify_title(text))
            center_matches.append({"timestamp": round(timestamp, 3), "text": text,
                                   "category": category, "counterKey": counter_key,
                                   "canonicalTitle": item["canonicalTitle"] if item else "",
                                   "score": round(resolved["score"], 4),
                                   "framesTried": len(resolved["attempts"]),
                                   "earlyExit": bool(item)})
        ocr_rows.append({"regionId": region_id, "timestamp": round(timestamp, 3),
                         "observedText": text, "accepted": resolved["accepted"],
                         "ocrAttempts": len(resolved["attempts"]),
                         "processingSeconds": round(resolved["processingSeconds"], 4),
                         "completionDelaySeconds": round(completion_latencies[-1], 4)})

    def harvest(block: bool = False) -> None:
        if block and pending:
            pending[0]["future"].result()
        now = time.perf_counter()
        retained: deque[dict] = deque()
        while pending:
            row = pending.popleft()
            future: Future = row["future"]
            if future.done():
                try:
                    apply_result(future.result(), row["queuedAt"], now)
                except Exception as error:
                    counts["ocrErrors"] += 1
                    dropped.append({"regionId": row["regionId"], "timestamp": row["timestamp"],
                                    "reason": f"ocr-error: {error}"})
            else:
                retained.append(row)
        pending.extend(retained)

    def submit_episode(executors: dict[str, ThreadPoolExecutor], episode: dict) -> None:
        nonlocal max_pending_seen, max_realtime_pending_seen, max_center_pending_seen
        harvest()
        lane = "center" if episode["regionId"] == "completionTitle" else "realtime"
        priority = REGION_PRIORITY.get(episode["regionId"], 9)
        if len(pending) >= args.max_pending:
            # Preserve center/IPCA by cancelling a queued lower-priority task
            # when possible. Capture itself never blocks on a full OCR queue.
            evicted = None
            for row in reversed(pending):
                if row["priority"] > priority and row["future"].cancel():
                    evicted = row
                    break
            if evicted is not None:
                pending.remove(evicted)
                counts["evicted"] += 1
                dropped.append({"regionId": evicted["regionId"],
                                "timestamp": evicted["timestamp"], "reason": "priority-evicted"})
            else:
                counts["dropped"] += 1
                dropped.append({"regionId": episode["regionId"],
                                "timestamp": round(float(episode["bestTimestamp"]), 3),
                                "reason": "queue-full"})
                return
        queued_at = time.perf_counter()
        future = executors[lane].submit(resolver, episode)
        pending.append({"future": future, "queuedAt": queued_at, "priority": priority,
                        "lane": lane,
                        "regionId": episode["regionId"],
                        "timestamp": round(float(episode["bestTimestamp"]), 3)})
        counts["submitted"] += 1
        counts[f"submitted:{episode['regionId']}"] += 1
        max_pending_seen = max(max_pending_seen, len(pending))
        realtime_pending = sum(row["lane"] == "realtime" for row in pending)
        center_pending = len(pending) - realtime_pending
        max_realtime_pending_seen = max(max_realtime_pending_seen, realtime_pending)
        max_center_pending_seen = max(max_center_pending_seen, center_pending)

    def submit_new(executors: dict[str, ThreadPoolExecutor]) -> None:
        for buffer in buffers.values():
            # Episodes contain full-resolution candidate crops. Keeping every
            # submitted episode until the end of a 15-hour replay grows into
            # gigabytes and eventually makes capture fall behind. Transfer
            # ownership to the Future and immediately release the buffer list.
            episodes = buffer.episodes
            buffer.episodes = []
            for episode in episodes:
                submit_episode(executors, episode)

    def current_result(frame_index: int, wall_seconds: float, complete: bool) -> dict:
        scan_seconds = frame_index / args.fps
        return {
            "schemaVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "complete": complete,
            "recording": str(video),
            "scan": {
                "mode": "chronological-bounded-live-queue",
                "scannerVersion": SCANNER_VERSION,
                "startSeconds": args.start,
                "durationSeconds": duration,
                "videoSecondsProcessed": round(scan_seconds, 3),
                "fps": args.fps,
                "framesInspected": frame_index,
                "playbackSpeed": args.playback_speed,
                "wallSeconds": round(wall_seconds, 3),
                "ocrWorkers": args.workers,
                "realtimeWorkers": realtime_workers,
                "centerWorkers": args.center_workers,
                "maxPendingAllowed": args.max_pending,
                "maxPendingSeen": max_pending_seen,
                "maxRealtimePendingSeen": max_realtime_pending_seen,
                "maxCenterPendingSeen": max_center_pending_seen,
                "pendingAtSnapshot": len(pending),
                "submitted": counts["submitted"],
                "completed": counts["completed"],
                "dropped": counts["dropped"],
                "evicted": counts["evicted"],
                "ocrErrors": counts["ocrErrors"],
                "queueWaitP50Seconds": round(percentile(queue_waits, .50), 4),
                "queueWaitP95Seconds": round(percentile(queue_waits, .95), 4),
                "queueWaitMaxSeconds": round(max(queue_waits, default=0), 4),
                "processingP95Seconds": round(percentile(processing_times, .95), 4),
                "completionDelayP50Seconds": round(percentile(completion_latencies, .50), 4),
                "completionDelayP95Seconds": round(percentile(completion_latencies, .95), 4),
                "completionDelayMaxSeconds": round(max(completion_latencies, default=0), 4),
                "captureLagP95Seconds": round(percentile(schedule_lags, .95), 4),
                "captureLagMaxSeconds": round(max_capture_lag, 4),
                "queueDepthP95": round(percentile([float(x) for x in queue_depth_samples], .95), 2),
                "submittedByRegion": {name: counts[f"submitted:{name}"] for name in REGION_PRIORITY},
                "completedByRegion": {name: counts[f"completed:{name}"] for name in REGION_PRIORITY},
            },
            "collectibles": {"detected": len(matches),
                             "matches": sorted(matches.values(), key=lambda row: row["timestamp"])},
            "ipca": {"detected": len(ipca_matches), "matches": ipca_matches},
            "center": {"detected": len(center_matches), "matches": center_matches},
            "ocrEpisodes": ocr_rows,
            "droppedEpisodes": dropped,
        }

    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    frame_bytes = COMPOSITE_WIDTH * COMPOSITE_HEIGHT
    frame_index = 0
    playback_started = time.perf_counter()
    next_report_video = 60.0
    next_checkpoint_video = 300.0
    print(f"[live replay] Recording: {video}", flush=True)
    print(f"[live replay] {format_clock(duration)} at {args.playback_speed:g}x wall-clock speed; "
          f"60 FPS gates, {realtime_workers} pickup workers + {args.center_workers} deferred center workers, "
          f"queue {args.max_pending}", flush=True)

    try:
        with (ThreadPoolExecutor(max_workers=realtime_workers) as realtime_executor,
              ThreadPoolExecutor(max_workers=args.center_workers) as center_executor):
            executors = {"realtime": realtime_executor, "center": center_executor}
            while True:
                raw = process.stdout.read(frame_bytes)
                if len(raw) != frame_bytes:
                    break
                video_elapsed = frame_index / args.fps
                target_wall = playback_started + video_elapsed / args.playback_speed
                wait = target_wall - time.perf_counter()
                if wait > 0:
                    time.sleep(wait)
                capture_lag = max(0.0, time.perf_counter() - target_wall)
                max_capture_lag = max(max_capture_lag, capture_lag)

                frame = np.frombuffer(raw, dtype=np.uint8).reshape((COMPOSITE_HEIGHT, COMPOSITE_WIDTH))
                timestamp = args.start + video_elapsed
                top_pixels = frame[TOP_OFFSET:TOP_OFFSET + TOP_SIZE[1], :TOP_SIZE[0]]
                for region_id, (x, y, width, height) in TOP_CHILDREN.items():
                    pixels = top_pixels[y:y + height, x:x + width]
                    seen, features = top_gate(region_id, pixels)
                    quality = features["strongRows"] * 12 + features.get("mediumRows", 0) * 3 + features["maxTransitions"]
                    buffers[region_id].observe(timestamp, pixels, quality, seen)
                ipca_pixels = frame[IPCA_OFFSET:IPCA_OFFSET + IPCA_SIZE[1], :IPCA_SIZE[0]]
                seen, features = ipca_text_gate(ipca_pixels)
                buffers["ipcaPickup"].observe(timestamp, ipca_pixels,
                                               features["strongRows"] * 12 + features["maxTransitions"], seen)
                center_pixels = frame[CENTER_OFFSET:CENTER_OFFSET + CENTER_SIZE[1], :CENTER_SIZE[0]]
                score, features = text_shape_score(center_pixels)
                center_seen = score >= .36 and features["mean"] <= 105 and features["rowActivity"] >= .07
                buffers["completionTitle"].observe(timestamp, center_pixels, score * 100, center_seen)

                submit_new(executors)
                harvest()
                frame_index += 1
                video_elapsed = frame_index / args.fps

                # One sample per second is enough for long-run percentiles and
                # avoids retaining 3.2 million Python objects for a 15h run.
                if frame_index % max(1, round(args.fps)) == 0:
                    schedule_lags.append(capture_lag)
                    queue_depth_samples.append(len(pending))

                if video_elapsed >= next_report_video:
                    print(f"[live replay] {format_clock(video_elapsed)}/{format_clock(duration)} | "
                          f"queue {len(pending)}/{args.max_pending} (max {max_pending_seen}) | "
                          f"OCR {counts['completed']} | dropped {counts['dropped'] + counts['evicted']} | "
                          f"delay p95 {percentile(completion_latencies, .95):.2f}s", flush=True)
                    next_report_video += 60
                if video_elapsed >= next_checkpoint_video:
                    atomic_json(output, current_result(frame_index, time.perf_counter() - playback_started, False))
                    next_checkpoint_video += 300

            return_code = process.wait()
            if return_code:
                error = (process.stderr.read() if process.stderr else b"").decode("utf-8", errors="replace")
                raise RuntimeError(error or f"ffmpeg stopped with exit code {return_code}")
            for buffer in buffers.values():
                buffer.flush()
            submit_new(executors)
            while pending:
                harvest(block=True)
    except KeyboardInterrupt:
        atomic_json(output, current_result(frame_index, time.perf_counter() - playback_started, False))
        process.terminate()
        print(f"\n[live replay] Stopped. Partial report saved: {output}", flush=True)
        return

    result = current_result(frame_index, time.perf_counter() - playback_started, True)
    atomic_json(output, result)
    scan = result["scan"]
    report = output.parent / "LIVE-REPLAY-REPORT.txt"
    report.write_text(
        "Days Gone real-time OCR replay\n"
        f"Recording: {video}\n"
        f"Video processed: {format_clock(scan['videoSecondsProcessed'])}\n"
        f"Queue maximum: {scan['maxPendingSeen']} / {scan['maxPendingAllowed']}\n"
        f"Dropped/evicted: {scan['dropped']} / {scan['evicted']}\n"
        f"OCR completion delay p95/max: {scan['completionDelayP95Seconds']}s / {scan['completionDelayMaxSeconds']}s\n"
        f"Capture lag p95/max: {scan['captureLagP95Seconds']}s / {scan['captureLagMaxSeconds']}s\n"
        f"Collectibles/IPCA/center: {len(matches)} / {len(ipca_matches)} / {len(center_matches)}\n",
        encoding="utf-8",
    )
    print("[live replay] COMPLETE", flush=True)
    print(json.dumps({"output": str(output), "report": str(report), "scan": scan,
                      "collectibles": len(matches), "ipca": len(ipca_matches),
                      "center": len(center_matches)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
