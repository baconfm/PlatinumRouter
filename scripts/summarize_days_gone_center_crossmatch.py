#!/usr/bin/env python3
"""Turn the raw center-window scan into a conservative, reviewable result.

The whole-run detector deliberately favors recall, so its anchor ledger can
contain map descriptions, tutorials, and objective-start cards.  Those are
useful for finding video windows but must not be counted as completions.  This
post-pass keeps the raw evidence intact and emits a second file containing only
title-card-shaped anchors and short secondary popup candidates.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import unicodedata

from scan_days_gone_buffered_first_hour import best_completion_match, completion_catalog


REJECT_CUES = (
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
    "proceed cancel",
    "permanently skip",
    "discover new locations",
)

SECONDARY_REJECT_CUES = REJECT_CUES + (
    "mission complete",
    "storyline updated",
    "continue",
    "map legend",
    "current objective",
)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = value.replace("’", "'").replace("`", "'")
    value = re.sub(r"[^A-Za-z0-9']+", " ", value)
    return re.sub(r"\s+", " ", value).strip().lower()


def anchor_quality(anchor: dict) -> tuple[bool, int, list[str]]:
    text = normalize(str(anchor.get("primaryObservedText") or ""))
    canonical = normalize(str(anchor.get("canonicalTitle") or ""))
    score = float(anchor.get("primaryScore") or 0.0)
    reasons: list[str] = []
    if not text or not canonical:
        return False, 0, ["missing text"]
    for cue in REJECT_CUES:
        if cue in text:
            return False, 0, [f"objective/tutorial cue: {cue}"]

    canonical_words = canonical.split()
    observed_words = text.split()
    covered = sum(word in observed_words for word in canonical_words)
    coverage = covered / max(1, len(canonical_words))
    has_xp = bool(re.search(r"\b\d[\d ]{0,8}xp\b|\bxp\b", text))
    compact = len(observed_words) <= len(canonical_words) + 9
    exact_phrase = canonical in text

    accepted = score >= 0.90 and coverage >= 0.75 and compact
    if exact_phrase and score >= 0.90 and len(text) <= max(90, len(canonical) * 3):
        accepted = True
    if not accepted:
        reasons.append(
            f"weak title shape (score={score:.3f}, coverage={coverage:.2f}, words={len(observed_words)})"
        )
        return False, 0, reasons

    quality = round(score * 100)
    quality += round(coverage * 30)
    quality += 35 if exact_phrase else 0
    quality += 45 if has_xp else 0
    quality += 12 if len(observed_words) <= len(canonical_words) + 2 else 0
    reasons.extend([
        f"score={score:.3f}",
        f"word coverage={coverage:.2f}",
        "XP line" if has_xp else "short title",
    ])
    return True, quality, reasons


def secondary_quality(row: dict, canonical_title: str) -> tuple[bool, str]:
    text = normalize(str(row.get("text") or ""))
    canonical = normalize(canonical_title)
    if not text or text == canonical:
        return False, ""
    if float(row.get("relativeSeconds") or 0.0) < -0.8:
        return False, ""
    if any(cue in text for cue in SECONDARY_REJECT_CUES):
        return False, ""
    words = text.split()
    letters = re.sub(r"[^a-z]", "", text)
    if len(letters) < 6 or len(words) < 2 or len(words) > 10 or len(text) > 85:
        return False, ""
    numeric_words = sum(word.isdigit() for word in words)
    if numeric_words > max(2, len(words) // 2):
        return False, ""
    # Only a strong completion-catalog match to a *different* title is safe
    # enough to propose as a linked objective. Unmatched short text is kept in
    # the raw result for human inspection; counting it here inflated the useful
    # secondary total with background OCR and reward-card fragments.
    matched = normalize(str(row.get("matchedCanonicalTitle") or ""))
    if matched and matched != canonical and float(row.get("matchScore") or 0) >= 0.88:
        return True, "catalog match"
    return False, ""


def pick_trusted_anchors(anchors: list[dict]) -> tuple[list[dict], list[dict]]:
    accepted_by_title: dict[str, list[dict]] = defaultdict(list)
    rejected: list[dict] = []
    for anchor in anchors:
        accepted, quality, reasons = anchor_quality(anchor)
        decorated = dict(anchor)
        decorated["reviewQuality"] = quality
        decorated["reviewReasons"] = reasons
        if accepted:
            accepted_by_title[anchor["canonicalTitle"]].append(decorated)
        else:
            rejected.append(decorated)

    trusted: list[dict] = []
    for title, rows in accepted_by_title.items():
        # Prefer a completion card with an XP line, then OCR quality.  For a tie,
        # prefer the later occurrence: objective-start cards precede completion.
        chosen = max(rows, key=lambda row: (row["reviewQuality"], row["timestamp"]))
        secondaries = []
        seen = set()
        for popup in chosen.get("popups", []):
            keep, reason = secondary_quality(popup, title)
            key = normalize(str(popup.get("text") or ""))
            if keep and key not in seen:
                item = dict(popup)
                item["reviewReason"] = reason
                secondaries.append(item)
                seen.add(key)
        chosen["reviewedSecondaryCandidates"] = secondaries
        chosen["discardedDuplicateAnchors"] = len(rows) - 1
        trusted.append(chosen)
    trusted.sort(key=lambda row: row["timestamp"])
    rejected.sort(key=lambda row: row["timestamp"])
    return trusted, rejected


def anchors_from_buffered(run_id: str, buffered: dict, catalog: list[dict]) -> list[dict]:
    anchors = []
    for index, row in enumerate(buffered.get("center", {}).get("matches", []), 1):
        canonical = str(row.get("canonicalTitle") or "").strip()
        matched_score = float(row.get("score") or 0.0)
        matched_item = None
        if not canonical:
            matched_item, matched_score = best_completion_match(
                str(row.get("text") or row.get("observedText") or ""), catalog
            )
            if matched_item:
                canonical = matched_item["canonicalTitle"]
        if not canonical:
            continue
        timestamp = float(row.get("timestamp") or 0.0)
        counter_key = str(row.get("counterKey") or "")
        if not counter_key and matched_item:
            counter_key = str(matched_item.get("counterKey") or "")
        if not counter_key:
            counter_key = {
                "horde": "hordes",
                "infestation": "infestations",
                "ambush-camp": "ambushcamps",
                "nero": "nerosites",
                "camp-job": "encampmentjobs",
            }.get(str(row.get("category") or ""), "")
        anchors.append({
            "id": f"{run_id}-objective-{index:04d}",
            "sourceId": run_id,
            "canonicalTitle": canonical,
            "counterKey": counter_key,
            "primaryObservedText": str(row.get("text") or row.get("observedText") or ""),
            "primaryScore": matched_score,
            "localTimestamp": timestamp,
            "timestamp": timestamp,
            "popups": [],
        })
    return anchors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--bacon-result", type=Path)
    parser.add_argument("--jamcar-result", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    source_path = (args.input or root / "outputs" / "training" / "days-gone" /
                   "center-objective-crossmatch" / "result.json").resolve()
    output_path = (args.output or source_path.with_name("reviewed-result.json")).resolve()
    if bool(args.bacon_result) != bool(args.jamcar_result):
        parser.error("--bacon-result and --jamcar-result must be supplied together")
    if args.bacon_result and args.jamcar_result:
        catalog = completion_catalog(root / "data" / "days-gone" / "completion-titles.json")
        bacon_path = args.bacon_result.resolve()
        jamcar_path = args.jamcar_result.resolve()
        bacon_data = load_json(bacon_path)
        jamcar_data = load_json(jamcar_path)
        source = {
            "runs": {
                "bacon": {
                    "id": "bacon",
                    "label": "Bacon Jul 25",
                    "anchors": anchors_from_buffered("bacon", bacon_data, catalog),
                },
                "jamcar": {
                    "id": "jamcar",
                    "label": "JamCar WR",
                    "anchors": anchors_from_buffered("jamcar", jamcar_data, catalog),
                },
            }
        }
        source_description: object = {"bacon": str(bacon_path), "jamcar": str(jamcar_path)}
    else:
        source = load_json(source_path)
        source_description = str(source_path)

    reviewed_runs = {}
    for run_id in ("bacon", "jamcar"):
        run = source["runs"][run_id]
        trusted, rejected = pick_trusted_anchors(run.get("anchors", []))
        reviewed_runs[run_id] = {
            "id": run_id,
            "label": run.get("label", run_id),
            "trustedAnchors": trusted,
            "rejectedAnchors": rejected,
            "summary": {
                "rawAnchors": len(run.get("anchors", [])),
                "trustedTitles": len(trusted),
                "rejectedAnchorRows": len(rejected),
                "reviewedSecondaryCandidates": sum(
                    len(row["reviewedSecondaryCandidates"]) for row in trusted
                ),
            },
        }

    bacon_by_title = {row["canonicalTitle"]: row for row in reviewed_runs["bacon"]["trustedAnchors"]}
    jamcar_by_title = {row["canonicalTitle"]: row for row in reviewed_runs["jamcar"]["trustedAnchors"]}
    shared = sorted(set(bacon_by_title) & set(jamcar_by_title))
    result = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": source_description,
        "policy": "conservative post-filter; no counter mutations",
        "runs": reviewed_runs,
        "crossmatch": {
            "sharedTrustedTitles": len(shared),
            "titles": [
                {
                    "canonicalTitle": title,
                    "bacon": bacon_by_title[title],
                    "jamcar": jamcar_by_title[title],
                    "deltaSeconds": round(
                        bacon_by_title[title]["timestamp"] - jamcar_by_title[title]["timestamp"], 3
                    ),
                }
                for title in shared
            ],
        },
    }
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output_path),
        "bacon": reviewed_runs["bacon"]["summary"],
        "jamcar": reviewed_runs["jamcar"]["summary"],
        "sharedTrustedTitles": len(shared),
    }, indent=2))


if __name__ == "__main__":
    main()
