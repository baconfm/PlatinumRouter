from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


FEATURE_VERSION = "days-gone-popup-features-v1"


class TrainingLogger:
    def __init__(self, training_root: Path) -> None:
        self.session_id = os.environ.get("DAYS_GONE_TRAINING_SESSION_ID", "manual")
        explicit = os.environ.get("DAYS_GONE_TRAINING_LOG_DIR", "")
        self.log_dir = Path(explicit) if explicit else training_root / "logs" / self.session_id
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def append(self, bucket: str, status: str, message: str, data: dict[str, Any] | None = None) -> None:
        event = {
            "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sessionId": self.session_id,
            "bucket": bucket,
            "source": "popup-model-trainer",
            "status": status,
            "message": message,
            "data": data or {},
        }
        line = json.dumps(event, separators=(",", ":")) + "\n"
        for filename in ("events.jsonl", f"{bucket}.jsonl"):
            with (self.log_dir / filename).open("a", encoding="utf-8") as stream:
                stream.write(line)


def image_features(image_path: Path) -> tuple[list[str], np.ndarray]:
    image = Image.open(image_path).convert("L").resize((192, 64), Image.Resampling.BILINEAR)
    pixels = np.asarray(image, dtype=np.float64) / 255.0
    gx = np.abs(np.diff(pixels, axis=1, prepend=pixels[:, :1]))
    gy = np.abs(np.diff(pixels, axis=0, prepend=pixels[:1, :]))
    edge = np.hypot(gx, gy)

    names: list[str] = []
    values: list[float] = []

    def add(name: str, value: float) -> None:
        names.append(name)
        values.append(float(value))

    add("mean", pixels.mean())
    add("std", pixels.std())
    for quantile in (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95):
        add(f"q{int(quantile * 100):02d}", np.quantile(pixels, quantile))
    for threshold in (0.10, 0.20, 0.35, 0.65, 0.80, 0.90):
        add(f"ratio_{threshold:.2f}", np.mean(pixels >= threshold))
    add("edge_mean", edge.mean())
    add("edge_std", edge.std())
    for threshold in (0.05, 0.10, 0.20, 0.30):
        add(f"edge_ratio_{threshold:.2f}", np.mean(edge >= threshold))

    binary = pixels >= 0.62
    transitions = np.sum(binary[:, 1:] != binary[:, :-1], axis=1)
    for quantile in (0.50, 0.75, 0.90, 1.00):
        add(f"row_transitions_q{int(quantile * 100):03d}", np.quantile(transitions, quantile) / pixels.shape[1])
    add("strong_rows_08", np.mean(transitions >= 8))
    add("strong_rows_16", np.mean(transitions >= 16))

    histogram, _ = np.histogram(pixels, bins=12, range=(0, 1), density=False)
    histogram = histogram / pixels.size
    for index, value in enumerate(histogram):
        add(f"hist_{index:02d}", value)

    for row in range(4):
        for column in range(6):
            block = pixels[row * 16:(row + 1) * 16, column * 32:(column + 1) * 32]
            block_edge = edge[row * 16:(row + 1) * 16, column * 32:(column + 1) * 32]
            add(f"block_{row}_{column}_mean", block.mean())
            add(f"block_{row}_{column}_std", block.std())
            add(f"block_{row}_{column}_edge", block_edge.mean())

    return names, np.asarray(values, dtype=np.float64)


def stable_fold(group: str, folds: int = 5) -> int:
    digest = hashlib.sha256(group.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % folds


def load_dataset(manifest_file: Path) -> tuple[list[str], np.ndarray, np.ndarray, list[str], list[str]]:
    root = manifest_file.parent
    positive_index = json.loads((root / "samples" / "index.json").read_text(encoding="utf-8"))
    negative_index = json.loads((root / "negatives" / "index.json").read_text(encoding="utf-8"))

    records: list[tuple[Path, int, str]] = []
    for sample in positive_index.get("samples", []):
        if sample.get("kind") != "confirmed-popup":
            continue
        if sample.get("regionName") != "topRightCombined" or float(sample.get("offsetSeconds", 99)) != 0:
            continue
        records.append((root / "samples" / sample["file"], 1, sample["eventId"]))
    for sample in negative_index.get("samples", []):
        records.append((root / "negatives" / sample["file"], 0, sample["id"]))

    if not records:
        raise RuntimeError("No extracted training samples were found.")

    rows: list[np.ndarray] = []
    labels: list[int] = []
    groups: list[str] = []
    files: list[str] = []
    feature_names: list[str] = []
    for image_path, label, group in records:
        if not image_path.exists():
            continue
        names, features = image_features(image_path)
        if not feature_names:
            feature_names = names
        elif names != feature_names:
            raise RuntimeError("Feature layout changed while loading samples.")
        rows.append(features)
        labels.append(label)
        groups.append(group)
        files.append(str(image_path))

    x = np.vstack(rows)
    y = np.asarray(labels, dtype=np.float64)
    return feature_names, x, y, groups, files


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -35, 35)))


def fit_logistic(
    x: np.ndarray,
    y: np.ndarray,
    learning_rate: float,
    l2: float,
    epochs: int,
) -> tuple[np.ndarray, float]:
    weights = np.zeros(x.shape[1], dtype=np.float64)
    bias = 0.0
    positives = max(1.0, y.sum())
    negatives = max(1.0, len(y) - positives)
    sample_weights = np.where(y > 0.5, len(y) / (2 * positives), len(y) / (2 * negatives))

    for epoch in range(epochs):
        probabilities = sigmoid(x @ weights + bias)
        error = (probabilities - y) * sample_weights
        rate = learning_rate / math.sqrt(1 + epoch / 100)
        weights -= rate * ((x.T @ error) / len(y) + l2 * weights)
        bias -= rate * float(error.mean())
    return weights, bias


def metrics(y: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, float | int]:
    predicted = probabilities >= threshold
    actual = y >= 0.5
    tp = int(np.sum(predicted & actual))
    fp = int(np.sum(predicted & ~actual))
    tn = int(np.sum(~predicted & ~actual))
    fn = int(np.sum(~predicted & actual))
    recall = tp / max(1, tp + fn)
    precision = tp / max(1, tp + fp)
    specificity = tn / max(1, tn + fp)
    f2 = 5 * precision * recall / max(1e-12, 4 * precision + recall)
    return {
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "recall": recall, "precision": precision, "specificity": specificity, "f2": f2,
    }


def choose_threshold(y: np.ndarray, probabilities: np.ndarray, target_recall: float) -> tuple[float, dict[str, Any]]:
    candidates = sorted(set([0.0, 1.0, *probabilities.tolist()]))
    eligible: list[tuple[float, dict[str, Any]]] = []
    fallback: list[tuple[float, dict[str, Any]]] = []
    for threshold in candidates:
        result = metrics(y, probabilities, threshold)
        fallback.append((threshold, result))
        if result["recall"] >= target_recall:
            eligible.append((threshold, result))
    if eligible:
        return max(eligible, key=lambda item: (item[1]["specificity"], item[1]["precision"], item[0]))
    return max(fallback, key=lambda item: (item[1]["f2"], item[1]["recall"]))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the local Days Gone popup-presence model.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--rounds", type=int, default=96)
    parser.add_argument("--target-recall", type=float, default=0.995)
    args = parser.parse_args()

    manifest_file = args.manifest.resolve()
    training_logger = TrainingLogger(manifest_file.parent)
    output_file = (args.output or manifest_file.parent / "models" / "top-right-popup-model.json").resolve()
    output_file.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_file = output_file.with_suffix(".checkpoint.json")

    feature_names, x, y, groups, files = load_dataset(manifest_file)
    training_logger.append("dataset", "dataset-loaded", "Popup model dataset loaded.", {
        "samples": len(y),
        "positives": int(y.sum()),
        "negatives": int(len(y) - y.sum()),
        "features": len(feature_names),
    })
    validation_mask = np.asarray([stable_fold(group) == 0 for group in groups], dtype=bool)
    if np.sum(validation_mask & (y > 0.5)) == 0 or np.sum(validation_mask & (y < 0.5)) == 0:
        validation_mask = np.asarray([index % 5 == 0 for index in range(len(y))], dtype=bool)
    training_mask = ~validation_mask

    mean = x[training_mask].mean(axis=0)
    scale = x[training_mask].std(axis=0)
    scale[scale < 1e-8] = 1.0
    normalized = (x - mean) / scale

    configurations = []
    learning_rates = (0.015, 0.03, 0.06, 0.10)
    regularization = (0.0, 0.0005, 0.002, 0.01, 0.04)
    epochs = (400, 700, 1100, 1600)
    for index in range(max(1, args.rounds)):
        configurations.append((
            learning_rates[index % len(learning_rates)],
            regularization[(index // len(learning_rates)) % len(regularization)],
            epochs[(index // (len(learning_rates) * len(regularization))) % len(epochs)],
        ))

    best: dict[str, Any] | None = None
    for round_index, (learning_rate, l2, epoch_count) in enumerate(configurations, start=1):
        weights, bias = fit_logistic(normalized[training_mask], y[training_mask], learning_rate, l2, epoch_count)
        validation_probabilities = sigmoid(normalized[validation_mask] @ weights + bias)
        threshold, validation_metrics = choose_threshold(y[validation_mask], validation_probabilities, args.target_recall)
        score = (
            validation_metrics["recall"] >= args.target_recall,
            validation_metrics["specificity"],
            validation_metrics["precision"],
            validation_metrics["f2"],
        )
        if best is None or score > best["score"]:
            all_probabilities = sigmoid(normalized @ weights + bias)
            best = {
                "score": score,
                "round": round_index,
                "learningRate": learning_rate,
                "l2": l2,
                "epochs": epoch_count,
                "weights": weights,
                "bias": bias,
                "threshold": threshold,
                "validationMetrics": validation_metrics,
                "allMetrics": metrics(y, all_probabilities, threshold),
            }
            checkpoint_file.write_text(json.dumps({
                "round": round_index,
                "threshold": threshold,
                "validationMetrics": validation_metrics,
            }, indent=2) + "\n", encoding="utf-8")
            training_logger.append("optimization", "new-best-model", "A better popup model was checkpointed.", {
                "round": round_index,
                "learningRate": learning_rate,
                "l2": l2,
                "epochs": epoch_count,
                "threshold": threshold,
                "validationMetrics": validation_metrics,
            })
        training_logger.append("optimization", "round-completed", "Optimization round completed.", {
            "round": round_index,
            "totalRounds": len(configurations),
            "learningRate": learning_rate,
            "l2": l2,
            "epochs": epoch_count,
            "threshold": threshold,
            "validationMetrics": validation_metrics,
        })

    assert best is not None
    final_probabilities = sigmoid(normalized @ best["weights"] + best["bias"])
    false_positive_files = [
        {"file": files[index], "probability": float(final_probabilities[index])}
        for index in range(len(y))
        if validation_mask[index] and y[index] < 0.5 and final_probabilities[index] >= best["threshold"]
    ]
    false_negative_files = [
        {"file": files[index], "probability": float(final_probabilities[index])}
        for index in range(len(y))
        if validation_mask[index] and y[index] >= 0.5 and final_probabilities[index] < best["threshold"]
    ]
    model = {
        "schemaVersion": 1,
        "featureVersion": FEATURE_VERSION,
        "purpose": "Days Gone top-right popup presence gating",
        "manifestFile": str(manifest_file),
        "training": {
            "samples": len(y),
            "positives": int(y.sum()),
            "negatives": int(len(y) - y.sum()),
            "validationSamples": int(validation_mask.sum()),
            "rounds": len(configurations),
            "selectedRound": best["round"],
            "learningRate": best["learningRate"],
            "l2": best["l2"],
            "epochs": best["epochs"],
            "targetRecall": args.target_recall,
        },
        "featureNames": feature_names,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "weights": best["weights"].tolist(),
        "bias": float(best["bias"]),
        "threshold": float(best["threshold"]),
        "validationMetrics": best["validationMetrics"],
        "allMetrics": best["allMetrics"],
        "deployableCandidate": bool(
            int(y.sum()) >= 100
            and int(len(y) - y.sum()) >= 500
            and best["validationMetrics"]["recall"] >= args.target_recall
            and best["validationMetrics"]["specificity"] >= 0.95
        ),
        "deploymentNote": "Offline candidate only. The live scanner must not load this model until deployableCandidate is true and its review samples pass.",
        "review": {
            "falsePositives": sorted(false_positive_files, key=lambda item: item["probability"], reverse=True)[:100],
            "falseNegatives": sorted(false_negative_files, key=lambda item: item["probability"])[:100],
        },
        "sourceFiles": files,
    }
    output_file.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    training_logger.append("review", "review-queue-written", "Model misclassification review queue written.", {
        "falsePositives": len(model["review"]["falsePositives"]),
        "falseNegatives": len(model["review"]["falseNegatives"]),
    })
    training_logger.append("metric", "model-written", "Optimized popup model written.", {
        "outputFile": str(output_file),
        "deployableCandidate": model["deployableCandidate"],
        "threshold": model["threshold"],
        "training": model["training"],
        "validationMetrics": model["validationMetrics"],
        "allMetrics": model["allMetrics"],
    })
    print(json.dumps({
        "outputFile": str(output_file),
        "samples": model["training"]["samples"],
        "positives": model["training"]["positives"],
        "negatives": model["training"]["negatives"],
        "threshold": model["threshold"],
        "validationMetrics": model["validationMetrics"],
    }, indent=2))


if __name__ == "__main__":
    main()
