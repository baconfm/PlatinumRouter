from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from scan_days_gone_collectible_progress import collectible_catalog, load_json


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    run_directory = root / "outputs" / "training" / "days-gone" / "20260718"
    manifest = load_json(run_directory / "manifest.json")
    run = load_json(run_directory / "run.json")
    catalog = collectible_catalog(root / "data" / "days-gone" / "default-splits.json")
    by_id = {item["id"]: item for item in catalog}
    seen: set[str] = set()
    matches: list[dict] = []
    duplicates: list[dict] = []

    for event in manifest.get("confirmedEvents", []):
        timestamp = float(event.get("videoSeconds", 0))
        observed = " ".join(
            str(region.get("text", "")).strip() for region in event.get("regions", []) if region.get("text")
        ).strip()
        for label in event.get("labels", []):
            item = by_id.get(label.get("id"))
            if not item:
                continue
            row = {
                "id": item["id"],
                "title": item["title"],
                "counterKey": item["counterKey"],
                "timestamp": round(timestamp, 3),
                "observedText": observed or str(label.get("title", "")),
                "score": 1.0,
                "evidence": "confirmed-historical-ocr",
            }
            if item["id"] in seen:
                duplicates.append(row)
            else:
                seen.add(item["id"])
                matches.append(row)

    matches.sort(key=lambda item: item["timestamp"])
    duration = float(run.get("totalDurationSeconds", 0))
    per_counter: dict[str, int] = {}
    for index, match in enumerate(matches, 1):
        match["detectedCount"] = index
        match["runProgressPercent"] = round(match["timestamp"] / duration * 100, 4) if duration else 0
        key = match["counterKey"]
        per_counter[key] = per_counter.get(key, 0) + 1

    result = {
        "schemaVersion": 2,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "runDirectory": str(run_directory),
        "sourceDurationSeconds": duration,
        "catalogItems": len(catalog),
        "scan": {
            "method": "confirmed-historical-ocr",
            "confirmedEventsReviewed": len(manifest.get("confirmedEvents", [])),
        },
        "summary": {
            "detectedCollectibles": len(matches),
            "catalogItems": len(catalog),
            "coveragePercent": round(len(matches) / len(catalog) * 100, 2) if catalog else 0,
            "duplicateSightings": len(duplicates),
            "perCounter": per_counter,
        },
        "matches": matches,
        "missingCatalogItems": [item for item in catalog if item["id"] not in seen],
        "duplicateSightings": duplicates,
        "ocrCandidates": [],
    }
    for output in (
        run_directory / "collectible-progress.json",
        run_directory / "collectible-progress-confirmed.json",
    ):
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(run_directory / "collectible-progress.json"), **result["summary"]}, indent=2))


if __name__ == "__main__":
    main()
