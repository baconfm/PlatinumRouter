#!/usr/bin/env python3
"""Local Platinum Router server with file-backed save endpoints."""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


API_PREFIX = "/.router-api"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
COUNTER_RE = re.compile(r"^[A-Za-z0-9_-]+$")
OCR_LOG_BUCKETS = {"confirmed", "candidate", "raw", "gibberish", "error", "control"}


def infer_ocr_log_bucket(entry: dict[str, object]) -> str:
  explicit = safe_text(entry.get("eventBucket"), 40).strip().lower()
  if explicit in OCR_LOG_BUCKETS:
    return explicit

  status = safe_text(entry.get("status"), 40).strip().lower()
  if status in {"scan-error", "ocr-error"} or entry.get("errors"):
    return "error"
  if status == "auto-applied" or entry.get("applied"):
    return "confirmed"
  if status in {"match-logged", "duplicate"} or entry.get("matches"):
    return "candidate"
  if status in {"video-start", "video-stop", "run-reset"}:
    return "control"
  return "raw"


def utc_stamp() -> str:
  return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def safe_text(value: object, limit: int = 2000) -> str:
  if value is None:
    return ""
  return str(value)[:limit]


def read_json(path: Path) -> object:
  return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def is_relative_to(child: Path, parent: Path) -> bool:
  try:
    child.resolve().relative_to(parent.resolve())
    return True
  except ValueError:
    return False


def resolve_local_path(app_root: Path, base: Path, path_value: str, fallback: str) -> Path:
  raw = safe_text(path_value or fallback, 500).strip() or fallback
  raw = raw.replace("\\", "/")

  if raw.startswith("./"):
    raw = raw[2:]

  if raw.startswith("/") or ".." in Path(raw).parts:
    raise ValueError(f"Unsafe route path: {raw}")

  return (base / raw).resolve()


def sanitize_auto(auto: object) -> dict[str, int | float]:
  if not isinstance(auto, dict):
    return {}

  result: dict[str, int | float] = {}
  for key, raw_value in auto.items():
    key_text = safe_text(key, 80).strip()
    if not key_text or not COUNTER_RE.fullmatch(key_text):
      continue

    try:
      value = float(raw_value)
    except (TypeError, ValueError):
      continue

    if value == 0:
      continue

    result[key_text] = int(value) if value.is_integer() else value

  return result


def sanitize_ocr_goals(goals: object) -> list[dict[str, object]]:
  if not isinstance(goals, list):
    return []

  result: list[dict[str, object]] = []

  for goal in goals[:200]:
    if not isinstance(goal, dict):
      continue

    goal_id = safe_text(goal.get("id"), 180).strip()
    label = safe_text(goal.get("label"), 320).strip()

    if not goal_id and not label:
      continue

    result.append({
      "id": goal_id,
      "type": safe_text(goal.get("type"), 80).strip(),
      "label": label,
      "counterKey": safe_text(goal.get("counterKey"), 120).strip(),
      "optional": bool(goal.get("optional", False))
    })

  return result


def sanitize_ocr_completion(completion: object) -> dict[str, object] | None:
  if not isinstance(completion, dict):
    return None

  mode = safe_text(completion.get("mode"), 80).strip()
  groups: list[list[str]] = []
  raw_groups = completion.get("groups")

  if isinstance(raw_groups, list):
    for raw_group in raw_groups[:120]:
      if not isinstance(raw_group, list):
        continue

      group = []
      for item in raw_group[:80]:
        item_id = safe_text(item, 180).strip()
        if item_id:
          group.append(item_id)

      if group:
        groups.append(group)

  if not mode and not groups:
    return None

  return {
    "mode": mode,
    "groups": groups
  }


def sanitize_split(split: object, index: int) -> dict[str, object]:
  if not isinstance(split, dict):
    split = {}

  raw_id = safe_text(split.get("id"), 140).strip()
  if not raw_id:
    raw_id = f"split_{index}"

  label = safe_text(split.get("label"), 260).strip() or f"Split {index + 1}"
  phase_id = safe_text(
    split.get("phaseId") or split.get("phase") or split.get("act"),
    120
  ).strip()

  result: dict[str, object] = {
    "id": raw_id,
    "label": label,
    "note": safe_text(split.get("note"), 4000),
    "phaseId": phase_id,
    "isPhaseStart": bool(split.get("isPhaseStart", index == 0)),
    "auto": sanitize_auto(split.get("auto"))
  }

  ocr_goals = sanitize_ocr_goals(split.get("ocrGoals"))
  if ocr_goals:
    result["ocrGoals"] = ocr_goals

  ocr_completion = sanitize_ocr_completion(split.get("ocrCompletion"))
  if ocr_completion:
    result["ocrCompletion"] = ocr_completion

  return result


def resolve_game_path(app_root: Path, game_id: str) -> Path:
  manifest_path = app_root / "data" / "games.json"
  manifest = read_json(manifest_path)
  games = manifest.get("games", []) if isinstance(manifest, dict) else []
  match = next((game for game in games if game.get("id") == game_id), None)

  if not match:
    raise ValueError(f"Unknown gameId: {game_id}")

  raw_path = safe_text(match.get("path"), 500).strip()
  if raw_path.startswith("./"):
    raw_path = raw_path[2:]
  if raw_path.startswith("/") or ".." in Path(raw_path).parts:
    raise ValueError(f"Unsafe game path for {game_id}")

  game_path = (app_root / raw_path).resolve()
  if not is_relative_to(game_path, app_root / "data"):
    raise ValueError(f"Game path escapes data folder: {game_id}")

  return game_path


def resolve_splits_path(app_root: Path, game_id: str, route_id: str) -> Path:
  game_path = resolve_game_path(app_root, game_id)
  meta = read_json(game_path / "meta.json")
  routes = meta.get("routes", []) if isinstance(meta, dict) else []
  default_route_id = safe_text(meta.get("defaultRouteId"), 120).strip()
  requested_route_id = route_id or default_route_id
  route = next((item for item in routes if item.get("id") == requested_route_id), None)

  if routes and requested_route_id and route is None:
    raise ValueError(f"Unknown routeId for {game_id}: {requested_route_id}")

  route_data = route.get("data", {}) if isinstance(route, dict) else {}
  override = route_data.get("defaultSplits", "") if isinstance(route_data, dict) else ""
  target = resolve_local_path(app_root, game_path, override, "default-splits.json")

  if not is_relative_to(target, game_path):
    raise ValueError("Resolved split file escapes game folder")

  return target


def save_splits(app_root: Path, payload: object) -> dict[str, object]:
  if not isinstance(payload, dict):
    raise ValueError("Request body must be a JSON object")

  game_id = safe_text(payload.get("gameId"), 120).strip().lower()
  route_id = safe_text(payload.get("routeId"), 120).strip().lower()
  raw_splits = payload.get("splits")

  if not game_id or not ID_RE.fullmatch(game_id):
    raise ValueError("Missing or invalid gameId")

  if route_id and not ID_RE.fullmatch(route_id):
    raise ValueError("Invalid routeId")

  if not isinstance(raw_splits, list) or not raw_splits:
    raise ValueError("splits must be a non-empty array")

  if len(raw_splits) > 1000:
    raise ValueError("Refusing to save more than 1000 splits")

  target = resolve_splits_path(app_root, game_id, route_id)
  backup_dir = app_root / "outputs" / "database-backups" / game_id / (route_id or "default")
  backup_path = backup_dir / f"{target.name}.{utc_stamp()}.bak.json"
  backup_dir.mkdir(parents=True, exist_ok=True)

  if target.exists():
    shutil.copy2(target, backup_path)

  sanitized = [sanitize_split(split, index) for index, split in enumerate(raw_splits)]
  write_json(target, {"splits": sanitized})

  return {
    "ok": True,
    "gameId": game_id,
    "routeId": route_id,
    "splitCount": len(sanitized),
    "path": str(target.relative_to(app_root)).replace("\\", "/"),
    "backupPath": str(backup_path.relative_to(app_root)).replace("\\", "/") if backup_path.exists() else ""
  }


def sanitize_filename(value: object, fallback: str = "export.json") -> str:
  raw = Path(safe_text(value, 240).strip() or fallback).name
  cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip(".-")

  if not cleaned:
    cleaned = fallback

  if not cleaned.lower().endswith(".json"):
    cleaned += ".json"

  return cleaned


def sanitize_slug(value: object, fallback: str, limit: int = 120) -> str:
  raw = safe_text(value, limit).strip()
  cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", raw).strip("-_")
  return cleaned[:limit] or fallback


def save_export(app_root: Path, payload: object) -> dict[str, object]:
  if not isinstance(payload, dict):
    raise ValueError("Request body must be a JSON object")

  game_id = safe_text(payload.get("gameId"), 120).strip().lower()
  route_id = safe_text(payload.get("routeId"), 120).strip().lower()
  export_kind = safe_text(payload.get("kind"), 80).strip().lower() or "run-data"
  export_data = payload.get("data")

  if not game_id or not ID_RE.fullmatch(game_id):
    raise ValueError("Missing or invalid gameId")

  if route_id and not ID_RE.fullmatch(route_id):
    raise ValueError("Invalid routeId")

  if not ID_RE.fullmatch(export_kind):
    raise ValueError("Invalid export kind")

  if export_data is None:
    raise ValueError("Missing export data")

  # Validate the game exists, so typoed route exports do not create random folders.
  resolve_game_path(app_root, game_id)

  filename = sanitize_filename(payload.get("filename"), "run-export.json")
  stem = Path(filename).stem
  target_dir = app_root / "outputs" / "run-exports" / game_id / (route_id or "default") / export_kind
  target_path = target_dir / f"{stem}.{utc_stamp()}.json"

  write_json(target_path, export_data)

  return {
    "ok": True,
    "gameId": game_id,
    "routeId": route_id,
    "kind": export_kind,
    "path": str(target_path.relative_to(app_root)).replace("\\", "/")
  }


def save_ocr_run_log(app_root: Path, payload: object) -> dict[str, object]:
  if not isinstance(payload, dict):
    raise ValueError("Request body must be a JSON object")

  raw_entries = payload.get("entries")
  if raw_entries is None:
    raw_entries = [payload.get("entry")]
  if not isinstance(raw_entries, list):
    raise ValueError("entries must be a list")

  entries = [entry for entry in raw_entries if isinstance(entry, dict)]
  if not entries:
    raise ValueError("No OCR log entries provided")
  if len(entries) > 250:
    raise ValueError("Too many OCR log entries in one request")

  received_at = datetime.now(timezone.utc).isoformat()
  grouped_entries: dict[tuple[str, str, str, str], list[dict[str, object]]] = {}
  skipped_entries = 0

  for entry in entries:
    context = entry.get("context") if isinstance(entry.get("context"), dict) else {}
    if context.get("timerRunning") is not True:
      skipped_entries += 1
      continue

    game_id = safe_text(payload.get("gameId") or context.get("gameId"), 120).strip().lower()
    route_id = safe_text(payload.get("routeId") or context.get("routeId"), 120).strip().lower()
    session_id = sanitize_slug(payload.get("sessionId") or entry.get("sessionId"), "unknown-session")
    event_bucket = infer_ocr_log_bucket(entry)

    if not game_id or not ID_RE.fullmatch(game_id):
      raise ValueError("Missing or invalid gameId")
    if route_id and not ID_RE.fullmatch(route_id):
      raise ValueError("Invalid routeId")
    resolve_game_path(app_root, game_id)
    key = (game_id, route_id, session_id, event_bucket)
    grouped_entries.setdefault(key, []).append(entry)

  written_paths: list[str] = []
  entries_written = 0
  for (game_id, route_id, session_id, event_bucket), bucket_entries in grouped_entries.items():
    target_dir = app_root / "outputs" / "ocr-run-logs" / game_id / (route_id or "default") / session_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{event_bucket}.jsonl"
    with target_path.open("a", encoding="utf-8") as handle:
      for entry in bucket_entries:
        line = {**entry, "fileLoggedAt": received_at}
        handle.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n")
        entries_written += 1
    written_paths.append(str(target_path.relative_to(app_root)).replace("\\", "/"))

  return {
    "ok": True,
    "entriesWritten": entries_written,
    "entriesSkipped": skipped_entries,
    "paths": written_paths
  }


def decode_image_data_url(value: object) -> bytes:
  raw = safe_text(value, 20_000_000).strip()
  if not raw:
    raise ValueError("Missing image data")

  if "," in raw and raw.lower().startswith("data:"):
    raw = raw.split(",", 1)[1]

  try:
    return base64.b64decode(raw, validate=True)
  except Exception as error:  # noqa: BLE001 - convert decode errors to request errors.
    raise ValueError("Invalid base64 image data") from error


def preprocess_ocr_image(image_bytes: bytes, scale: int = 3, threshold: int | None = None) -> bytes:
  try:
    from PIL import Image, ImageEnhance, ImageFilter
  except Exception:
    return image_bytes

  image = Image.open(io.BytesIO(image_bytes)).convert("L")
  scale = max(1, min(4, int(scale)))
  if scale > 1:
    resampling = Image.Resampling.LANCZOS if threshold is not None else Image.Resampling.NEAREST
    image = image.resize((image.width * scale, image.height * scale), resampling)
  image = ImageEnhance.Contrast(image).enhance(1.8)
  image = image.filter(ImageFilter.SHARPEN)
  if threshold is not None:
    threshold = max(0, min(255, int(threshold)))
    image = image.point(lambda value: 255 if value >= threshold else 0)

  output = io.BytesIO()
  image.save(output, format="PNG")
  return output.getvalue()


def find_tesseract_path() -> str | None:
  candidates = [
    shutil.which("tesseract"),
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    str(Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe")
  ]

  for candidate in candidates:
    if candidate and Path(candidate).exists():
      return candidate

  return None


def get_ocr_status() -> dict[str, object]:
  try:
    import pytesseract  # noqa: F401
    has_pytesseract = True
  except Exception:
    has_pytesseract = False

  return {
    "tesseractPath": find_tesseract_path() or "",
    "hasPytesseract": has_pytesseract
  }


def ocr_with_pytesseract(image_bytes: bytes, psm: int = 6) -> str | None:
  try:
    from PIL import Image
    import pytesseract
  except Exception:
    return None

  tesseract_path = find_tesseract_path()
  if tesseract_path:
    pytesseract.pytesseract.tesseract_cmd = tesseract_path

  image = Image.open(io.BytesIO(image_bytes))
  try:
    text = pytesseract.image_to_string(image, config=f"--psm {psm}")
    return safe_text(text, 8000)
  except Exception:
    return None


def ocr_with_tesseract_cli(image_bytes: bytes, psm: int = 6) -> str | None:
  tesseract_path = find_tesseract_path()
  if not tesseract_path:
    return None

  with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as image_file:
    image_file.write(image_bytes)
    image_path = Path(image_file.name)

  try:
    result = subprocess.run(
      [tesseract_path, str(image_path), "stdout", "--psm", str(psm)],
      check=False,
      capture_output=True,
      text=True,
      timeout=10
    )
    if result.returncode != 0:
      raise ValueError(safe_text(result.stderr, 500) or "Tesseract OCR failed")
    return safe_text(result.stdout, 8000)
  finally:
    try:
      image_path.unlink(missing_ok=True)
    except Exception:
      pass


def scan_ocr(payload: object) -> dict[str, object]:
  if not isinstance(payload, dict):
    raise ValueError("Request body must be a JSON object")

  try:
    preprocess_scale = max(1, min(4, int(payload.get("preprocessScale", 3))))
  except (TypeError, ValueError):
    preprocess_scale = 3
  try:
    psm = max(3, min(13, int(payload.get("psm", 6))))
  except (TypeError, ValueError):
    psm = 6
  try:
    threshold_value = payload.get("preprocessThreshold")
    preprocess_threshold = None if threshold_value is None else max(0, min(255, int(threshold_value)))
  except (TypeError, ValueError):
    preprocess_threshold = None

  image_bytes = preprocess_ocr_image(
    decode_image_data_url(payload.get("imageData")),
    preprocess_scale,
    preprocess_threshold
  )
  text = ocr_with_pytesseract(image_bytes, psm)
  engine = "pytesseract"

  if text is None:
    text = ocr_with_tesseract_cli(image_bytes, psm)
    engine = "tesseract-cli"

  if text is None:
    ocr_status = get_ocr_status()
    return {
      "ok": False,
      "error": (
        "Local OCR engine not ready. "
        f"pytesseract={'yes' if ocr_status['hasPytesseract'] else 'no'}, "
        f"tesseractPath={ocr_status['tesseractPath'] or 'not found'}."
      ),
      "text": "",
      "engine": "",
      "diagnostics": ocr_status
    }

  return {
    "ok": True,
    "text": text,
    "engine": engine,
    "preprocessScale": preprocess_scale,
    "preprocessThreshold": preprocess_threshold,
    "psm": psm
  }


def save_ocr_debug(app_root: Path, payload: object) -> dict[str, object]:
  if not isinstance(payload, dict):
    raise ValueError("Request body must be a JSON object")

  regions = payload.get("regions")
  if not isinstance(regions, list) or not regions:
    raise ValueError("regions must be a non-empty array")

  stamp = utc_stamp()
  target_dir = app_root / "outputs" / "ocr-debug" / stamp
  target_dir.mkdir(parents=True, exist_ok=True)
  manifest = []

  for index, region in enumerate(regions[:12]):
    if not isinstance(region, dict):
      continue

    label = re.sub(r"[^A-Za-z0-9._-]+", "-", safe_text(region.get("label"), 80)).strip("-") or f"region-{index + 1}"
    image_bytes = decode_image_data_url(region.get("imageData"))
    filename = f"{index + 1:02d}-{label}.png"
    image_path = target_dir / filename
    image_path.write_bytes(image_bytes)

    manifest.append({
      "label": safe_text(region.get("label"), 80),
      "file": filename,
      "text": safe_text(region.get("text"), 8000)
    })

  write_json(target_dir / "ocr-debug.json", {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "regions": manifest
  })

  return {
    "ok": True,
    "path": str(target_dir.relative_to(app_root)).replace("\\", "/"),
    "regionCount": len(manifest)
  }


class RouterRequestHandler(SimpleHTTPRequestHandler):
  server_version = "PlatinumRouterLocal/1.0"

  @property
  def app_root(self) -> Path:
    return self.server.app_root  # type: ignore[attr-defined]

  def send_json(self, status: int, payload: object) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(body)

  def do_OPTIONS(self) -> None:
    parsed = urlparse(self.path)
    if parsed.path.startswith(API_PREFIX):
      self.send_response(HTTPStatus.NO_CONTENT)
      self.send_header("Allow", "GET, POST, OPTIONS")
      self.end_headers()
      return
    super().do_OPTIONS()

  def do_GET(self) -> None:
    parsed = urlparse(self.path)
    if parsed.path == f"{API_PREFIX}/health":
      self.send_json(HTTPStatus.OK, {"ok": True, "server": "platinum-router-local"})
      return
    if parsed.path == f"{API_PREFIX}/ocr-health":
      self.send_json(HTTPStatus.OK, {"ok": True, **get_ocr_status()})
      return
    super().do_GET()

  def do_POST(self) -> None:
    parsed = urlparse(self.path)

    if parsed.path not in {
      f"{API_PREFIX}/save-splits",
      f"{API_PREFIX}/save-export",
      f"{API_PREFIX}/ocr-log",
      f"{API_PREFIX}/ocr",
      f"{API_PREFIX}/ocr-debug"
    }:
      self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Unknown API endpoint"})
      return

    try:
      length = int(self.headers.get("Content-Length", "0"))
      if length <= 0:
        raise ValueError("Empty request body")
      if length > 8_000_000:
        raise ValueError("Request body too large")

      payload = json.loads(self.rfile.read(length).decode("utf-8"))
      if parsed.path == f"{API_PREFIX}/save-splits":
        result = save_splits(self.app_root, payload)
      elif parsed.path == f"{API_PREFIX}/save-export":
        result = save_export(self.app_root, payload)
      elif parsed.path == f"{API_PREFIX}/ocr-log":
        result = save_ocr_run_log(self.app_root, payload)
      elif parsed.path == f"{API_PREFIX}/ocr":
        result = scan_ocr(payload)
      else:
        result = save_ocr_debug(self.app_root, payload)
      self.send_json(HTTPStatus.OK, result)
    except Exception as error:  # noqa: BLE001 - local tool should return readable errors.
      self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})


def main() -> None:
  parser = argparse.ArgumentParser(description="Serve Platinum Router with local save endpoints.")
  parser.add_argument("--port", type=int, default=8000)
  parser.add_argument("--host", default="127.0.0.1")
  args = parser.parse_args()

  app_root = Path.cwd().resolve()
  handler = RouterRequestHandler
  server = ThreadingHTTPServer((args.host, args.port), handler)
  server.app_root = app_root  # type: ignore[attr-defined]

  print(f"Serving Platinum Router from {app_root}")
  print(f"Open http://localhost:{args.port}/index.html")
  print("Local save API enabled.")
  server.serve_forever()


if __name__ == "__main__":
  main()
