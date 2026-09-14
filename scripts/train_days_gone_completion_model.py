from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any

import numpy as np
from PIL import Image

from train_days_gone_popup_model import (
    FEATURE_VERSION,
    TrainingLogger,
    choose_threshold,
    fit_logistic,
    image_features,
    metrics,
    sigmoid,
    stable_fold,
)


def find_tesseract() -> Path:
    configured = os.environ.get("TESSERACT_EXE", "")
    candidates = [
        Path(configured) if configured else None,
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    raise RuntimeError("Tesseract OCR was not found. Set TESSERACT_EXE to tesseract.exe.")


def ocr_image(tesseract: Path, image_file: Path, psm: int) -> str:
    result = subprocess.run(
        [str(tesseract), str(image_file), "stdout", "--psm", str(psm), "-l", "eng"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def anchor_score(text: str) -> float:
    compact = re.sub(r"[^a-z0-9]", "", text.lower())
    target = "missioncomplete"
    if target in compact:
        return 1.0
    if not compact:
        return 0.0
    best = SequenceMatcher(None, compact, target).ratio()
    for start in range(len(compact)):
        for length in range(max(8, len(target) - 4), min(len(compact) - start, len(target) + 5) + 1):
            best = max(best, SequenceMatcher(None, compact[start:start + length], target).ratio())
    return best


def categories_for_event(event: dict[str, Any]) -> list[str]:
    mapping = {
        "missions": "mission",
        "nerosites": "nero",
        "infestations": "infestation",
        "ambushcamps": "ambush-camp",
        "encampmentjobs": "camp-job",
        "hordes": "horde",
    }
    categories = [mapping[item.get("counterKey", "")] for item in event.get("counters", []) if item.get("counterKey", "") in mapping]
    return sorted(set(categories)) or ["unclassified"]


def add_manual_completion_samples(
    manifest_file: Path,
    records: list[tuple[Path, int, str]],
    audited: list[dict[str, Any]],
    logger: TrainingLogger,
) -> int:
    manual_root = manifest_file.parent.parent / "manual-samples" / "completions"
    if not manual_root.exists():
        return 0

    derived_root = manifest_file.parent / "manual-derived" / "completion-anchors"
    derived_root.mkdir(parents=True, exist_ok=True)
    category_names = {
        "missions": "mission",
        "nerosites": "nero",
        "infestations": "infestation",
        "ambushcamps": "ambush-camp",
        "encampmentjobs": "camp-job",
        "hordes": "horde",
    }
    added = 0
    for sample_file in sorted(manual_root.rglob("sample.json")):
        try:
            sample = json.loads(sample_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        source_name = str(sample.get("source") or sample.get("sourceImage") or "full.png")
        source_file = sample_file.parent / source_name
        if not source_file.exists():
            continue

        relative_id = sample_file.parent.relative_to(manual_root).as_posix()
        event_id = f"manual:{relative_id}"
        output_file = derived_root / f"{re.sub(r'[^a-z0-9]+', '-', relative_id.lower()).strip('-')}.png"
        if not output_file.exists() or output_file.stat().st_mtime < source_file.stat().st_mtime:
            with Image.open(source_file) as image:
                width, height = image.size
                left = int(width * 0.02)
                top = int(height * 0.04)
                right = int(width * 0.41)
                bottom = int(height * 0.19)
                image.crop((left, top, right, bottom)).save(output_file)

        category = str(sample.get("category") or "").strip().lower()
        title = str(sample.get("target") or sample.get("label") or relative_id).strip()
        records.append((output_file, 1, event_id))
        audited.append({
            "labelVersion": 1,
            "file": str(output_file.relative_to(manifest_file.parent)).replace("\\", "/"),
            "eventId": event_id,
            "offsetSeconds": None,
            "anchorText": "MANUAL CONFIRMED MISSION COMPLETE",
            "anchorScore": 1.0,
            "isCompletion": True,
            "titleText": title,
            "categories": [category_names.get(category, category or "unclassified")],
            "splitId": None,
            "splitLabel": title,
            "source": "manual-screenshot",
        })
        added += 1

    if added:
        logger.append("dataset", "manual-completion-samples-added", "Manual completion screenshots were added to the gate dataset.", {
            "samples": added, "sourceRoot": str(manual_root), "derivedRoot": str(derived_root),
        })
    return added


def load_dataset(manifest_file: Path, logger: TrainingLogger) -> tuple[list[str], np.ndarray, np.ndarray, list[str], list[str], list[dict[str, Any]]]:
    root = manifest_file.parent
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    positive_index = json.loads((root / "samples" / "completion-index.json").read_text(encoding="utf-8"))
    negative_index = json.loads((root / "completionAnchor-negatives" / "index.json").read_text(encoding="utf-8"))
    events = {event["id"]: event for event in manifest.get("completionEvents", [])}
    title_samples = {
        (sample["eventId"], float(sample["offsetSeconds"])): root / "samples" / sample["file"]
        for sample in positive_index.get("samples", [])
        if sample.get("regionName") == "completionTitle"
    }
    tesseract = find_tesseract()
    audit_file = root / "completion-labels.json"
    previous_audit: dict[str, dict[str, Any]] = {}
    if audit_file.exists():
        for item in json.loads(audit_file.read_text(encoding="utf-8")).get("samples", []):
            previous_audit[item.get("file", "")] = item

    audited: list[dict[str, Any]] = []
    records: list[tuple[Path, int, str]] = []
    anchors = [sample for sample in positive_index.get("samples", []) if sample.get("regionName") == "completionAnchor"]
    for index, sample in enumerate(anchors, start=1):
        image_file = root / "samples" / sample["file"]
        relative = sample["file"]
        prior = previous_audit.get(relative)
        if prior and prior.get("labelVersion") == 1:
            audit = prior
        else:
            texts = [ocr_image(tesseract, image_file, psm) for psm in (6, 11)]
            scores = [anchor_score(text) for text in texts]
            best_index = int(np.argmax(scores))
            event = events.get(sample["eventId"], {})
            title_file = title_samples.get((sample["eventId"], float(sample["offsetSeconds"])))
            title_text = ocr_image(tesseract, title_file, 6) if title_file and title_file.exists() and scores[best_index] >= 0.68 else ""
            audit = {
                "labelVersion": 1,
                "file": relative,
                "eventId": sample["eventId"],
                "offsetSeconds": sample["offsetSeconds"],
                "anchorText": texts[best_index],
                "anchorScore": scores[best_index],
                "isCompletion": scores[best_index] >= 0.68,
                "titleText": title_text,
                "categories": categories_for_event(event),
                "splitId": event.get("splitId"),
                "splitLabel": event.get("splitLabel"),
                "source": event.get("source"),
            }
        audited.append(audit)
        if audit["isCompletion"] and image_file.exists():
            records.append((image_file, 1, sample["eventId"]))
        if index % 25 == 0 or index == len(anchors):
            print(f"[completion OCR labels] {index}/{len(anchors)}")

    for sample in negative_index.get("samples", []):
        image_file = root / "completionAnchor-negatives" / sample["file"]
        if image_file.exists():
            records.append((image_file, 0, sample["id"]))
    add_manual_completion_samples(manifest_file, records, audited, logger)
    positive_events = len({record[2] for record in records if record[1] == 1})
    positive_frames = sum(1 for record in records if record[1] == 1)
    audit_file.write_text(json.dumps({"schemaVersion": 1, "samples": audited}, indent=2) + "\n", encoding="utf-8")
    logger.append("dataset", "completion-labels-written", "Completion OCR labels and category audit written.", {
        "auditFile": str(audit_file), "windows": len(audited), "positiveFrames": positive_frames, "positiveEvents": positive_events,
    })
    if positive_events < 5 or len(records) < 20:
        raise RuntimeError(f"Too few OCR-confirmed completion samples ({len(records)} rows, {positive_events} events).")

    feature_names: list[str] = []
    rows: list[np.ndarray] = []
    labels: list[int] = []
    groups: list[str] = []
    files: list[str] = []
    for image_file, label, group in records:
        names, features = image_features(image_file)
        if not feature_names:
            feature_names = names
        elif names != feature_names:
            raise RuntimeError("Feature layout changed while loading completion samples.")
        rows.append(features)
        labels.append(label)
        groups.append(group)
        files.append(str(image_file))
    return feature_names, np.vstack(rows), np.asarray(labels, dtype=np.float64), groups, files, audited


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the Days Gone mission-complete popup model.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--rounds", type=int, default=160)
    parser.add_argument("--target-recall", type=float, default=0.995)
    args = parser.parse_args()

    manifest_file = args.manifest.resolve()
    logger = TrainingLogger(manifest_file.parent)
    output_file = (args.output or manifest_file.parent / "models" / "completion-popup-model.json").resolve()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    feature_names, x, y, groups, files, audit = load_dataset(manifest_file, logger)
    positive_events = len({groups[index] for index in range(len(y)) if y[index] > 0.5})
    logger.append("dataset", "dataset-loaded", "Completion popup dataset loaded.", {
        "samples": len(y), "positives": int(y.sum()), "positiveEvents": positive_events,
        "negatives": int(len(y) - y.sum()), "features": len(feature_names),
    })

    validation_mask = np.asarray([stable_fold(group) == 0 for group in groups], dtype=bool)
    if np.sum(validation_mask & (y > 0.5)) == 0 or np.sum(validation_mask & (y < 0.5)) == 0:
        validation_mask = np.asarray([index % 5 == 0 for index in range(len(y))], dtype=bool)
    training_mask = ~validation_mask
    mean = x[training_mask].mean(axis=0)
    scale = x[training_mask].std(axis=0)
    scale[scale < 1e-8] = 1.0
    normalized = (x - mean) / scale

    learning_rates = (0.015, 0.03, 0.06, 0.10)
    regularization = (0.0, 0.0005, 0.002, 0.01, 0.04)
    epochs = (400, 700, 1100, 1600)
    configurations = [(
        learning_rates[index % len(learning_rates)],
        regularization[(index // len(learning_rates)) % len(regularization)],
        epochs[(index // (len(learning_rates) * len(regularization))) % len(epochs)],
    ) for index in range(max(1, args.rounds))]

    best: dict[str, Any] | None = None
    for round_index, (learning_rate, l2, epoch_count) in enumerate(configurations, start=1):
        weights, bias = fit_logistic(normalized[training_mask], y[training_mask], learning_rate, l2, epoch_count)
        probabilities = sigmoid(normalized[validation_mask] @ weights + bias)
        threshold, result = choose_threshold(y[validation_mask], probabilities, args.target_recall)
        score = (result["recall"] >= args.target_recall, result["specificity"], result["precision"], result["f2"])
        if best is None or score > best["score"]:
            best = {"score": score, "round": round_index, "learningRate": learning_rate, "l2": l2, "epochs": epoch_count,
                    "weights": weights, "bias": bias, "threshold": threshold, "validationMetrics": result}
            logger.append("optimization", "new-best-model", "A better completion model was checkpointed.", {
                "round": round_index, "threshold": threshold, "validationMetrics": result,
            })
        logger.append("optimization", "round-completed", "Completion optimization round completed.", {
            "round": round_index, "totalRounds": len(configurations), "threshold": threshold, "validationMetrics": result,
        })

    assert best is not None
    all_probabilities = sigmoid(normalized @ best["weights"] + best["bias"])
    all_metrics = metrics(y, all_probabilities, best["threshold"])
    false_positives = [{"file": files[i], "probability": float(all_probabilities[i])} for i in range(len(y))
                       if validation_mask[i] and y[i] < 0.5 and all_probabilities[i] >= best["threshold"]]
    false_negatives = [{"file": files[i], "probability": float(all_probabilities[i])} for i in range(len(y))
                       if validation_mask[i] and y[i] > 0.5 and all_probabilities[i] < best["threshold"]]
    category_counts: dict[str, int] = {}
    for item in audit:
        if item.get("isCompletion"):
            for category in item.get("categories", []):
                category_counts[category] = category_counts.get(category, 0) + 1
    deployable = bool(positive_events >= 15 and int(len(y) - y.sum()) >= 500
                      and best["validationMetrics"]["recall"] >= args.target_recall
                      and best["validationMetrics"]["specificity"] >= 0.95)
    model = {
        "schemaVersion": 1,
        "featureVersion": FEATURE_VERSION,
        "purpose": "Days Gone mission-complete screen presence gating",
        "manifestFile": str(manifest_file),
        "training": {"samples": len(y), "positives": int(y.sum()), "positiveEvents": positive_events,
                     "negatives": int(len(y) - y.sum()), "validationSamples": int(validation_mask.sum()),
                     "rounds": len(configurations), "selectedRound": best["round"], "targetRecall": args.target_recall,
                     "categoryFrameCounts": category_counts},
        "featureNames": feature_names, "mean": mean.tolist(), "scale": scale.tolist(),
        "weights": best["weights"].tolist(), "bias": float(best["bias"]), "threshold": float(best["threshold"]),
        "validationMetrics": best["validationMetrics"], "allMetrics": all_metrics,
        "deployableCandidate": deployable,
        "deploymentNote": "Offline candidate only. Keep collectible detection separate and review errors before enabling this completion gate live.",
        "review": {"falsePositives": sorted(false_positives, key=lambda item: item["probability"], reverse=True)[:100],
                   "falseNegatives": sorted(false_negatives, key=lambda item: item["probability"])[:100]},
    }
    output_file.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    logger.append("metric", "model-written", "Optimized completion popup model written.", {
        "outputFile": str(output_file), "deployableCandidate": deployable,
        "validationMetrics": best["validationMetrics"], "allMetrics": all_metrics,
    })
    print(json.dumps({"outputFile": str(output_file), "training": model["training"],
                      "validationMetrics": model["validationMetrics"], "deployableCandidate": deployable}, indent=2))


if __name__ == "__main__":
    main()
