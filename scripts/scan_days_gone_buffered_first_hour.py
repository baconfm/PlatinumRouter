from __future__ import annotations

import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import subprocess
import time

import numpy as np

from scan_days_gone_center_popups import (
    classify_title,
    find_binary,
    find_tesseract,
    ocr_frame as ocr_center_frame,
    text_shape_score,
    useful_text,
)
from scan_days_gone_collectible_progress import (
    best_catalog_match,
    collectible_catalog,
    ocr_collectible_frame,
)
from scan_days_gone_ipca_progress import (
    has_ipca_pickup_text,
    ipca_score,
    ocr_ipca_frame,
    text_gate as ipca_text_gate,
)
from simulate_days_gone_collectible_run import live_gate


SCANNER_VERSION = 3
CENTER_FLURRY_PRE_ROLL_SECONDS = 3.0
CENTER_FLURRY_QUIET_SECONDS = 1.8
CENTER_FLURRY_MAX_SECONDS = 12.0
CENTER_FLURRY_CANDIDATE_SECONDS = 3.0
CENTER_FLURRY_SAMPLE_SECONDS = 0.10
CENTER_FLURRY_FRAME_MAX = 18

REGIONS = {
    "top": (54, 0, 46, 17),
    "ipca": (0, 65, 16, 14),
    "center": (23, 53, 54, 15),
}
# Match the actual 1920x1080 OBS screenshot used by the live router. The old
# replay shrank these regions further and erased the thin pickup font.
COMPOSITE_WIDTH = 1040
TOP_SIZE = (883, 184)
IPCA_SIZE = (307, 151)
CENTER_SIZE = (1037, 162)
TOP_OFFSET = 0
IPCA_OFFSET = TOP_SIZE[1]
CENTER_OFFSET = TOP_SIZE[1] + IPCA_SIZE[1]
COMPOSITE_HEIGHT = TOP_SIZE[1] + IPCA_SIZE[1] + CENTER_SIZE[1]
TOP_CHILDREN = {
    "topRightTitle": (461, 11, 413, 54),
    "topRightWideTitle": (115, 11, 758, 54),
    "topRightToast": (0, 11, 883, 173),
}


def latest_recording(folder: Path) -> Path:
    candidates = [path for path in folder.iterdir() if path.suffix.lower() in {".mkv", ".mp4", ".mov", ".avi"}]
    if not candidates:
        raise FileNotFoundError(f"No recording found in {folder}")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def probe_video(ffprobe: Path, video: Path) -> tuple[int, int, float]:
    result = subprocess.run(
        [str(ffprobe), "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(result.stdout)
    stream = data["streams"][0]
    return int(stream["width"]), int(stream["height"]), float(data["format"]["duration"])


def crop_from_percent(width: int, height: int, region: tuple[float, float, float, float]) -> tuple[int, int, int, int]:
    x, y, w, h = region
    return round(width * w / 100), round(height * h / 100), round(width * x / 100), round(height * y / 100)


def fingerprint(pixels: np.ndarray) -> str:
    height, width = pixels.shape
    bits: list[str] = []
    for cell_y in range(8):
        y0, y1 = round(cell_y * height / 8), max(round((cell_y + 1) * height / 8), 1)
        for cell_x in range(24):
            x0, x1 = round(cell_x * width / 24), max(round((cell_x + 1) * width / 24), 1)
            cell = pixels[y0:y1, x0:x1]
            minimum = int(cell.min(initial=255))
            maximum = int(cell.max(initial=0))
            bits.append("1" if maximum - minimum >= 75 and maximum >= 145 and minimum <= 105 else "0")
    return "".join(bits)


def fingerprint_difference(left: str, right: str) -> float:
    if not left or not right or len(left) != len(right):
        return 1.0
    return sum(a != b for a, b in zip(left, right)) / len(left)


class EpisodeBuffer:
    def __init__(self, name: str) -> None:
        self.name = name
        self.active: dict | None = None
        self.episodes: list[dict] = []
        self.merged_frames = 0

    def observe(self, timestamp: float, pixels: np.ndarray, quality: float, seen: bool) -> None:
        if not seen:
            if self.active and timestamp - self.active["lastSeen"] >= 0.25:
                self.flush()
            return
        current_fingerprint = ""
        if self.active and timestamp - self.active["firstTimestamp"] >= 2.0:
            self.flush()
        # Every frame still passes the text gate. Episode identity is checked at
        # 10 Hz so moving gameplay cannot create sixty buffered entries per
        # second; a 20-frame popup still receives three or four checks.
        if not self.active or timestamp - self.active["lastFingerprintAt"] >= 0.10:
            current_fingerprint = fingerprint(pixels)
            difference_limit = 0.08 if self.name == "completionTitle" else 0.16
            if self.active and fingerprint_difference(self.active["lastFingerprint"], current_fingerprint) > difference_limit:
                self.flush()
        if not self.active:
            if not current_fingerprint:
                current_fingerprint = fingerprint(pixels)
            self.active = {
                "regionId": self.name,
                "firstTimestamp": timestamp,
                "lastSeen": timestamp,
                "bestTimestamp": timestamp,
                "quality": quality,
                "lastFingerprint": current_fingerprint,
                "lastFingerprintAt": timestamp,
                "candidates": [{"timestamp": timestamp, "quality": quality, "pixels": pixels.copy()}],
                "frames": 1,
            }
            return
        self.active["lastSeen"] = timestamp
        self.active["frames"] += 1
        self.merged_frames += 1
        if current_fingerprint:
            self.active["lastFingerprint"] = current_fingerprint
            self.active["lastFingerprintAt"] = timestamp
        candidates = self.active["candidates"]
        if quality > self.active["quality"]:
            self.active["quality"] = quality
            self.active["bestTimestamp"] = timestamp
        # Retain several strong moments from the popup animation. OCR quality
        # does not always correlate perfectly with the visual gate score.
        if len(candidates) < 3 or quality > candidates[-1]["quality"]:
            candidates.append({"timestamp": timestamp, "quality": quality, "pixels": pixels.copy()})
            candidates.sort(key=lambda row: row["quality"], reverse=True)
            del candidates[3:]

    def flush(self) -> None:
        if self.active:
            self.episodes.append(self.active)
            self.active = None


class CenterFlurryBuffer:
    """Keep one chronological episode for the whole completion popup flurry."""

    def __init__(self) -> None:
        self.name = "completionTitle"
        self.active: dict | None = None
        self.episodes: list[dict] = []
        self.history: deque[dict] = deque()
        self.merged_frames = 0
        self.last_episode_end = -1e9

    def observe(self, timestamp: float, pixels: np.ndarray, quality: float, seen: bool) -> None:
        if not self.history or timestamp - self.history[-1]["timestamp"] >= CENTER_FLURRY_SAMPLE_SECONDS:
            self.history.append({
                "timestamp": timestamp,
                "quality": quality,
                "seen": seen,
                "pixels": pixels.copy(),
            })
        while self.history and timestamp - self.history[0]["timestamp"] > CENTER_FLURRY_PRE_ROLL_SECONDS:
            self.history.popleft()

        if not seen:
            if self.active and timestamp - self.active["lastSeen"] >= CENTER_FLURRY_QUIET_SECONDS:
                self.flush()
            return

        if self.active and timestamp - self.active["firstTimestamp"] >= CENTER_FLURRY_MAX_SECONDS:
            self.flush()

        if not self.active:
            candidates = [
                {
                    "timestamp": row["timestamp"],
                    "quality": row["quality"],
                    "pixels": row["pixels"],
                }
                for row in self.history
                if row["seen"] and row["timestamp"] > self.last_episode_end
            ][-CENTER_FLURRY_FRAME_MAX:]
            if not candidates:
                candidates = [{"timestamp": timestamp, "quality": quality, "pixels": pixels.copy()}]
            self.active = {
                "regionId": self.name,
                "firstTimestamp": candidates[0]["timestamp"],
                "lastSeen": timestamp,
                "bestTimestamp": candidates[0]["timestamp"],
                "quality": quality,
                "candidates": candidates,
                "frames": 1,
                "flurry": True,
            }
            return

        self.active["lastSeen"] = timestamp
        self.active["frames"] += 1
        self.merged_frames += 1
        candidates = self.active["candidates"]
        within_first_title = timestamp - self.active["firstTimestamp"] <= CENTER_FLURRY_CANDIDATE_SECONDS
        sampled = not candidates or timestamp - candidates[-1]["timestamp"] >= CENTER_FLURRY_SAMPLE_SECONDS
        if within_first_title and sampled and len(candidates) < CENTER_FLURRY_FRAME_MAX:
            candidates.append({"timestamp": timestamp, "quality": quality, "pixels": pixels.copy()})

    def flush(self) -> None:
        if self.active:
            self.active["candidates"].sort(key=lambda row: row["timestamp"])
            self.episodes.append(self.active)
            self.last_episode_end = self.active["lastSeen"]
            self.active = None


def normalized_title(value: str) -> str:
    return " ".join("".join(character.lower() if character.isalnum() else " " for character in value).split())


def completion_title_only(value: str) -> str:
    words = normalized_title(value).replace("mission complete", " ").split()
    kept: list[str] = []
    for word in words:
        if word.endswith("xp") or word.endswith("trust") or word.endswith("credits") or word.endswith("%"):
            break
        kept.append(word)
    return " ".join(kept)


def completion_phrase_score(observed: str, expected: str) -> float:
    candidate = completion_title_only(observed)
    target = completion_title_only(expected)
    if not candidate or not target:
        return 0.0
    if candidate == target or target in candidate:
        return 1.0
    candidate_words = candidate.split()
    target_words = target.split()
    windows = [candidate]
    for size in range(max(1, len(target_words) - 1), min(len(candidate_words), len(target_words) + 1) + 1):
        windows.extend(" ".join(candidate_words[start:start + size])
                       for start in range(len(candidate_words) - size + 1))
    return max(SequenceMatcher(None, window, target).ratio() for window in windows)


def required_completion_score(expected: str) -> float:
    length = len(completion_title_only(expected).replace(" ", ""))
    if length < 10:
        return 0.90
    if length < 16:
        return 0.82
    if length < 24:
        return 0.76
    return 0.72


COMPLETION_CONTEXT_REJECT_CUES = (
    "find the horde",
    "clear the ambush camp",
    "clear all ambush camps",
    "locate bounty target",
    "ride out to meet",
    "deacon clears",
    "deacon searches",
    "fast travel",
    "set marker",
    "freaker infestations are",
    "nero injectors can be found",
    "mmu fuse panels",
    "permanently skip",
    "proceed cancel",
)


def valid_completion_context(observed: str, item: dict) -> bool:
    """Reject objective starts, tutorials and map prose before catalog matching."""
    candidate = normalized_title(observed)
    if not candidate or any(cue in candidate for cue in COMPLETION_CONTEXT_REJECT_CUES):
        return False
    expected = normalized_title(item["canonicalTitle"])
    observed_words = set(candidate.split())
    expected_words = expected.split()
    def has_word(expected_word: str, minimum: float = 0.78) -> bool:
        """Allow common OCR substitutions without weakening the title gate."""
        return any(
            word == expected_word
            or SequenceMatcher(None, word, expected_word).ratio() >= minimum
            for word in observed_words
        )

    generic = {"horde", "ambush", "camp", "nero", "checkpoint", "infestation"}
    specific = [word for word in expected_words if word not in generic]
    if specific and sum(has_word(word) for word in specific) / len(specific) < 0.5:
        return False
    counter_key = item.get("counterKey", "")
    required_category_word = {
        "hordes": "horde",
        "infestations": "infestation",
        "nerosites": "checkpoint",
    }.get(counter_key)
    if required_category_word and not has_word(required_category_word):
        return False
    if counter_key == "ambushcamps" and not (has_word("ambush") and has_word("camp")):
        return False
    return True


def completion_catalog(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for counter_key, category in data.get("categories", {}).items():
        for entry in category.get("titles", []):
            rows.append({
                "counterKey": counter_key,
                "categoryLabel": category.get("label", counter_key),
                "canonicalTitle": entry["title"],
                "phrases": [entry["title"], *entry.get("aliases", [])],
                "countsTowardCounter": entry.get("countsTowardCounter", True),
            })
    return rows


def best_completion_match(text: str, catalog: list[dict]) -> tuple[dict | None, float]:
    best: dict | None = None
    best_score = 0.0
    for item in catalog:
        if not valid_completion_context(text, item):
            continue
        for phrase in item["phrases"]:
            score = completion_phrase_score(text, phrase)
            if score >= required_completion_score(phrase) and score > best_score:
                best, best_score = item, score
    return best, best_score


def top_gate(region_id: str, pixels: np.ndarray) -> tuple[bool, dict]:
    likely, features = live_gate(pixels)
    if region_id in {"topRightTitle", "topRightWideTitle"}:
        likely = likely or (
            features["maxTransitions"] >= 8
            and features["strongRows"] >= 2
            and features["darkRatio"] >= 0.08
            and (features["brightRatio"] >= 0.0001 or features.get("softBrightRatio", 0) >= 0.001
                 or features["maxTransitions"] >= 11)
        )
    else:
        likely = likely or (
            features["maxTransitions"] >= 9
            and features["strongRows"] >= 1
            and features["darkRatio"] >= 0.08
        )
    return likely, features


def main() -> None:
    parser = argparse.ArgumentParser(description="Single-pass, episode-buffered Days Gone OCR replay.")
    parser.add_argument("recording", nargs="?", type=Path)
    parser.add_argument("--train-folder", type=Path, default=Path(r"E:\Train"))
    parser.add_argument("--duration", type=float, default=3600)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--fps", type=float, default=60)
    parser.add_argument("--workers", type=int, default=max(2, min(8, os.cpu_count() or 4)))
    parser.add_argument("--hwaccel", default="d3d11va")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--center-only", action="store_true",
                        help="Decode and OCR only center completion-title episodes.")
    parser.add_argument("--center-segmented", action="store_true",
                        help="High-recall center rescan: split changing center text into short visual stages.")
    args = parser.parse_args()
    if args.center_segmented and not args.center_only:
        parser.error("--center-segmented requires --center-only")

    root = Path(__file__).resolve().parent.parent
    video = (args.recording or latest_recording(args.train_folder)).resolve()
    output = (args.output or root / "outputs" / "training" / "days-gone" / "buffered-first-hour-60fps" / "result.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_binary(root, "ffmpeg")
    ffprobe = find_binary(root, "ffprobe")
    tesseract = find_tesseract()
    source_width, source_height, video_duration = probe_video(ffprobe, video)
    duration = min(args.duration, max(0, video_duration - args.start))
    top = crop_from_percent(source_width, source_height, REGIONS["top"])
    ipca = crop_from_percent(source_width, source_height, REGIONS["ipca"])
    center = crop_from_percent(source_width, source_height, REGIONS["center"])

    if args.center_only:
        filter_graph = (
            f"[0:v]crop={center[0]}:{center[1]}:{center[2]}:{center[3]},"
            f"scale={CENTER_SIZE[0]}:{CENTER_SIZE[1]}:flags=lanczos,"
            f"fps={args.fps},format=gray[out]"
        )
    else:
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
    command.extend([
        "-i", str(video), "-t", str(duration),
        "-an", "-filter_complex", filter_graph, "-map", "[out]", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ])
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    frame_width = CENTER_SIZE[0] if args.center_only else COMPOSITE_WIDTH
    frame_height = CENTER_SIZE[1] if args.center_only else COMPOSITE_HEIGHT
    frame_bytes = frame_width * frame_height
    buffers = {} if args.center_only else {
        name: EpisodeBuffer(name) for name in (*TOP_CHILDREN.keys(), "ipcaPickup")
    }
    # The live flurry buffer intentionally follows the first title.  Offline
    # recovery instead uses short fingerprinted stages so unrelated center UI
    # cannot consume the first three seconds and hide a later completion card.
    buffers["completionTitle"] = (
        EpisodeBuffer("completionTitle") if args.center_segmented else CenterFlurryBuffer()
    )
    frame_index = 0
    started = time.perf_counter()
    next_progress = 300

    print(f"[buffered scan] Recording: {video}", flush=True)
    print(f"[buffered scan] Inspecting {duration / 60:.0f} minutes at {args.fps:g} FPS in one video pass", flush=True)
    while True:
        raw = process.stdout.read(frame_bytes)
        if len(raw) != frame_bytes:
            break
        frame = np.frombuffer(raw, dtype=np.uint8).reshape((frame_height, frame_width))
        timestamp = args.start + frame_index / args.fps
        if not args.center_only:
            top_pixels = frame[TOP_OFFSET:TOP_OFFSET + TOP_SIZE[1], :TOP_SIZE[0]]
            for region_id, (x, y, width, height) in TOP_CHILDREN.items():
                pixels = top_pixels[y:y + height, x:x + width]
                seen, features = top_gate(region_id, pixels)
                quality = features["strongRows"] * 12 + features.get("mediumRows", 0) * 3 + features["maxTransitions"]
                buffers[region_id].observe(timestamp, pixels, quality, seen)
            ipca_pixels = frame[IPCA_OFFSET:IPCA_OFFSET + IPCA_SIZE[1], :IPCA_SIZE[0]]
            seen, features = ipca_text_gate(ipca_pixels)
            quality = features["strongRows"] * 12 + features["maxTransitions"]
            buffers["ipcaPickup"].observe(timestamp, ipca_pixels, quality, seen)
        center_pixels = (
            frame[:, :CENTER_SIZE[0]] if args.center_only
            else frame[CENTER_OFFSET:CENTER_OFFSET + CENTER_SIZE[1], :CENTER_SIZE[0]]
        )
        score, features = text_shape_score(center_pixels)
        if args.center_segmented:
            seen = score >= 0.28 and features["mean"] <= 125 and features["rowActivity"] >= 0.045
        else:
            seen = score >= 0.36 and features["mean"] <= 105 and features["rowActivity"] >= 0.07
        buffers["completionTitle"].observe(timestamp, center_pixels, score * 100, seen)
        frame_index += 1
        scanned_seconds = frame_index / args.fps
        if scanned_seconds >= next_progress:
            elapsed = time.perf_counter() - started
            speed = scanned_seconds / max(elapsed, 0.001)
            remaining = max(0, duration - scanned_seconds) / max(speed, 0.001)
            episode_count = sum(len(buffer.episodes) for buffer in buffers.values())
            print(f"[buffered scan] {scanned_seconds / 60:.0f}/{duration / 60:.0f} video min | {speed:.2f}x realtime | "
                  f"gate ETA {remaining / 60:.1f} min | {episode_count} episodes", flush=True)
            next_progress += 300

    return_code = process.wait()
    if return_code:
        error = (process.stderr.read() if process.stderr else b"").decode("utf-8", errors="replace")
        raise RuntimeError(error or f"ffmpeg stopped with exit code {return_code}")
    for buffer in buffers.values():
        buffer.flush()

    catalog = collectible_catalog(root / "data" / "days-gone" / "default-splits.json")
    center_catalog = completion_catalog(root / "data" / "days-gone" / "completion-titles.json")
    matches: dict[str, dict] = {}
    ocr_rows: list[dict] = []
    ipca_matches: list[dict] = []
    center_matches: list[dict] = []
    center_windows: list[dict] = []
    episodes = [episode for buffer in buffers.values() for episode in buffer.episodes]
    episodes.sort(key=lambda row: row["bestTimestamp"])
    print(f"[buffered scan] Gate pass complete in {(time.perf_counter() - started) / 60:.1f} min; OCRing {len(episodes)} episodes", flush=True)
    non_trophy_catalog = [item for item in catalog if item.get("goalType") != "trophy"]

    def catalog_for_text(text: str) -> list[dict]:
        # A collectible title can overlap a trophy title (for example Manny's
        # "Zen and the Art of Bike Repair"). Only consider trophies when the
        # PlayStation toast cue is present, matching the live scanner guard.
        return catalog if "trophy earned" in text.lower() else non_trophy_catalog

    def ocr_episode(episode: dict) -> dict:
        region_id = episode["regionId"]
        attempts: list[str] = []
        accepted_text = ""
        accepted_item = None
        accepted_score = 0.0
        accepted = False
        accepted_timestamp = episode["bestTimestamp"]
        accepted_center_item = None
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
            # The first recognized title is authoritative. OCR candidates are
            # deliberately chronological and later reward/story cards are never
            # allowed to replace an earlier known completion title.
            for candidate in candidates:
                text = ocr_center_frame(tesseract, candidate["pixels"])
                attempts.append(text)
                item, score = best_completion_match(text, center_catalog)
                if item:
                    accepted_text = text
                    accepted_score = score
                    accepted_timestamp = candidate["timestamp"]
                    accepted_center_item = item
                    accepted = True
                    break
                if useful_text(text) and len(text) > len(accepted_text):
                    accepted_text = text
                    accepted_timestamp = candidate["timestamp"]
            accepted = accepted or bool(accepted_text)
        return {"episode": episode, "text": accepted_text or max(attempts, key=len, default=""),
                "attempts": attempts, "item": accepted_item, "score": accepted_score,
                "accepted": accepted, "acceptedTimestamp": accepted_timestamp,
                "centerItem": accepted_center_item}

    print(f"[buffered scan] OCR workers: {args.workers}", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for index, resolved in enumerate(executor.map(ocr_episode, episodes), 1):
            episode = resolved["episode"]
            region_id = episode["regionId"]
            text = resolved["text"]
            accepted_timestamp = float(resolved.get("acceptedTimestamp", episode["bestTimestamp"]))
            if resolved["item"]:
                item = resolved["item"]
                normalized_observed = normalized_title(text)
                normalized_expected = normalized_title(item["title"])
                exact_title = bool(normalized_expected and normalized_expected in normalized_observed)
                row = {"id": item["id"], "title": item["title"], "counterKey": item["counterKey"],
                       "timestamp": round(episode["bestTimestamp"], 3), "observedText": text,
                       "score": round(resolved["score"], 4),
                       "evidence": "exact-title" if exact_title else "fuzzy-title"}
                previous = matches.get(item["id"])
                row_rank = (1 if exact_title else 0, row["score"], -row["timestamp"])
                previous_rank = (
                    1 if previous and previous.get("evidence") == "exact-title" else 0,
                    previous.get("score", 0) if previous else 0,
                    -previous.get("timestamp", 0) if previous else 0,
                )
                if previous is None or row_rank > previous_rank:
                    matches[item["id"]] = row
            elif region_id == "ipcaPickup" and resolved["accepted"]:
                if not ipca_matches or episode["bestTimestamp"] - ipca_matches[-1]["timestamp"] >= 8:
                    ipca_matches.append({"timestamp": round(episode["bestTimestamp"], 3),
                                         "observedText": text, "score": round(resolved["score"], 4)})
            elif region_id == "completionTitle" and resolved["accepted"]:
                center_item = resolved.get("centerItem")
                counter_key = center_item["counterKey"] if center_item else ""
                category = {
                    "hordes": "horde",
                    "ambushcamps": "ambush-camp",
                    "infestations": "infestation",
                    "nerosites": "nero",
                    "encampmentjobs": "camp-job",
                }.get(counter_key, counter_key or classify_title(text))
                center_matches.append({
                    "timestamp": round(accepted_timestamp, 3),
                    "text": text,
                    "category": category,
                    "counterKey": counter_key,
                    "canonicalTitle": center_item["canonicalTitle"] if center_item else "",
                    "score": round(resolved["score"], 4),
                    "earlyExit": bool(center_item),
                    "framesTried": len(resolved["attempts"]),
                    "framesDiscarded": max(0, len(episode["candidates"]) - len(resolved["attempts"])),
                })
            if region_id == "completionTitle":
                center_item = resolved.get("centerItem")
                attempt_texts = []
                for attempt in resolved["attempts"]:
                    cleaned = str(attempt or "").strip()
                    if cleaned and cleaned not in attempt_texts:
                        attempt_texts.append(cleaned)
                first_timestamp = float(episode.get("firstTimestamp", accepted_timestamp))
                last_timestamp = float(episode.get("lastSeen", accepted_timestamp))
                center_windows.append({
                    "id": f"center-window-{len(center_windows) + 1:05d}",
                    "startTimestamp": round(first_timestamp, 3),
                    "endTimestamp": round(last_timestamp, 3),
                    "bestTimestamp": round(float(episode.get("bestTimestamp", accepted_timestamp)), 3),
                    "contextStartTimestamp": round(max(0.0, first_timestamp - 3.0), 3),
                    "contextEndTimestamp": round(last_timestamp + 5.0, 3),
                    "framesSeen": int(episode.get("frames", 0)),
                    "candidateFrames": len(episode.get("candidates", [])),
                    "ocrAttempts": len(resolved["attempts"]),
                    "observedCandidates": attempt_texts,
                    "selectedText": text,
                    "catalogMatched": bool(center_item),
                    "canonicalTitle": center_item["canonicalTitle"] if center_item else "",
                    "counterKey": center_item["counterKey"] if center_item else "",
                    "score": round(float(resolved.get("score") or 0.0), 4),
                })
            ocr_rows.append({"regionId": region_id, "timestamp": round(accepted_timestamp, 3),
                             "framesMerged": episode["frames"], "observedText": text,
                             "ocrAttempts": len(resolved["attempts"]), "accepted": resolved["accepted"],
                             "earlyExit": bool(resolved.get("centerItem"))})
            if index % 50 == 0:
                print(f"[buffered scan] OCR {index}/{len(episodes)}", flush=True)

    wall_seconds = round(time.perf_counter() - started, 3)
    result = {
        "schemaVersion": 2,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "recording": str(video),
        "scan": {
            "durationSeconds": duration,
            "startSeconds": args.start,
            "fps": args.fps,
            "hwaccel": args.hwaccel,
            "ocrWorkers": args.workers,
            "framesInspected": frame_index,
            "wallSeconds": wall_seconds,
            "realtimeFactor": round(duration / max(wall_seconds, 0.001), 3),
            "episodesBuffered": len(episodes),
            "framesMerged": sum(buffer.merged_frames for buffer in buffers.values()),
            "scannerVersion": SCANNER_VERSION,
            "mode": ("center-segmented" if args.center_segmented else
                     "center-only" if args.center_only else "all-regions"),
            "centerFlurryMode": ("fingerprinted-high-recall-stages" if args.center_segmented else
                                 "chronological-known-title-early-exit"),
        },
        "collectibles": {"detected": len(matches), "matches": sorted(matches.values(), key=lambda row: row["timestamp"])},
        "ipca": {"detected": len(ipca_matches), "matches": ipca_matches},
        "center": {"detected": len(center_matches), "matches": center_matches,
                   "windows": center_windows},
        "ocrEpisodes": ocr_rows,
    }
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "scan": result["scan"], "collectibles": len(matches),
                      "ipca": len(ipca_matches), "center": len(center_matches)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
