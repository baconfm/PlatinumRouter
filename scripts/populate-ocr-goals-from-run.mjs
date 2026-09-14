import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import {
  DAYS_GONE_COLLECTIBLE_BY_ID,
  DAYS_GONE_TROPHY_CHECKLIST
} from "../js/screen-tracker.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROUTE = path.join(ROOT, "data", "days-gone", "default-splits.json");
const OCR_LOG_DIR = path.join(ROOT, "outputs", "ocr-run-logs", "days-gone", "default");
const MATCH_WINDOW_MS = 2500;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveInput(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

async function getLogRange(file) {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const timestamp = Date.parse(entry.at || entry.timestamp || "");
      if (!Number.isFinite(timestamp)) continue;
      first = Math.min(first, timestamp);
      last = Math.max(last, timestamp);
    } catch {
      // A malformed historical line is ignored; confirmed lines remain usable.
    }
  }
  return { first, last };
}

async function findCoveringOcrLog(firstEventAt, lastEventAt) {
  const files = fs.readdirSync(OCR_LOG_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(OCR_LOG_DIR, name));

  let best = null;
  for (const file of files) {
    const range = await getLogRange(file);
    const overlap = Math.max(0, Math.min(range.last, lastEventAt) - Math.max(range.first, firstEventAt));
    const coversStart = range.first <= firstEventAt && range.last >= firstEventAt;
    const score = overlap + (coversStart ? 86_400_000 : 0);
    if (!best || score > best.score) best = { file, score, ...range };
  }
  return best?.file || "";
}

function trophyLookup() {
  const lookup = new Map();
  for (const trophy of DAYS_GONE_TROPHY_CHECKLIST) {
    for (const phrase of [trophy.title, ...(trophy.phrases || [])]) {
      const key = normalize(phrase);
      if (key) lookup.set(key, trophy);
    }
  }
  return lookup;
}

function goalFromId(id) {
  const collectible = DAYS_GONE_COLLECTIBLE_BY_ID.get(id);
  if (collectible) {
    return {
      id: collectible.id,
      type: "collectible",
      label: collectible.title,
      counterKey: collectible.counterKey,
      optional: true
    };
  }

  const trophy = DAYS_GONE_TROPHY_CHECKLIST.find((entry) => entry.id === id);
  if (!trophy) return null;
  return {
    id: trophy.id,
    type: "trophy",
    label: trophy.title,
    counterKey: "trophies",
    optional: true
  };
}

async function readAppliedDetections(logFile, trophyByPhrase) {
  const detections = [];
  const lines = readline.createInterface({ input: fs.createReadStream(logFile), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.status !== "auto-applied") continue;

    for (const applied of entry.applied || []) {
      const ids = [...(applied.matchedChecklistIds || [])];
      if (applied.counterKey === "trophies") {
        const trophy = trophyByPhrase.get(normalize(applied.trophyTitle || applied.matchedPhrase));
        if (trophy) ids.push(trophy.id);
      }
      if (!ids.length) continue;
      detections.push({
        at: entry.at,
        timestamp: Date.parse(entry.at || ""),
        counterKey: applied.counterKey,
        ids: [...new Set(ids)]
      });
    }
  }
  return detections;
}

function correlate(detections, manualEvents) {
  const usedEvents = new Set();
  const correlated = [];
  const unmatched = [];

  for (const detection of detections) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < manualEvents.length; index += 1) {
      const event = manualEvents[index];
      if (usedEvents.has(index) || event.counterKey !== detection.counterKey) continue;
      const distance = Math.abs(Date.parse(event.at || "") - detection.timestamp);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex < 0 || bestDistance > MATCH_WINDOW_MS) {
      unmatched.push(detection);
      continue;
    }

    usedEvents.add(bestIndex);
    correlated.push({
      ...detection,
      splitId: manualEvents[bestIndex].splitId,
      splitLabel: manualEvents[bestIndex].splitLabel,
      distanceMs: bestDistance
    });
  }
  return { correlated, unmatched };
}

const exportArg = process.argv[2];
if (!exportArg) fail("Usage: node scripts/populate-ocr-goals-from-run.mjs <split-log-export.json> [ocr-log.jsonl]");

const exportFile = resolveInput(exportArg);
const routeFile = DEFAULT_ROUTE;
if (!fs.existsSync(exportFile)) fail(`Split-log export not found: ${exportFile}`);

const splitLog = readJson(exportFile);
if (splitLog.gameId !== "days-gone") fail("This importer only accepts Days Gone split-log exports.");

const manualEvents = (splitLog.allManualEvents || []).filter((event) =>
  Number(event.delta || 0) > 0 && /screen-tracker/.test(String(event.source || ""))
);
if (!manualEvents.length) fail("The split-log export contains no applied screen-tracker events.");

const eventTimes = manualEvents.map((event) => Date.parse(event.at || "")).filter(Number.isFinite);
const ocrLogFile = process.argv[3]
  ? resolveInput(process.argv[3])
  : await findCoveringOcrLog(Math.min(...eventTimes), Math.max(...eventTimes));
if (!ocrLogFile || !fs.existsSync(ocrLogFile)) fail("Could not find the OCR JSONL log for this run.");

const detections = await readAppliedDetections(ocrLogFile, trophyLookup());
const { correlated, unmatched } = correlate(detections, manualEvents);
const route = readJson(routeFile);
const splitById = new Map(route.splits.map((split) => [split.id, split]));
const existingAssignments = new Map();
for (const split of route.splits) {
  for (const goal of split.ocrGoals || []) existingAssignments.set(goal.id, split.id);
}

const detectedAssignments = new Map();
const ambiguous = [];
for (const detection of correlated) {
  for (const id of detection.ids) {
    const previous = detectedAssignments.get(id);
    if (previous && previous.splitId !== detection.splitId) {
      ambiguous.push({ id, splitIds: [previous.splitId, detection.splitId] });
      detectedAssignments.delete(id);
      continue;
    }
    if (!ambiguous.some((entry) => entry.id === id)) detectedAssignments.set(id, detection);
  }
}

const additions = [];
const preservedConflicts = [];
const unknown = [];
for (const [id, detection] of detectedAssignments) {
  const existingSplitId = existingAssignments.get(id);
  if (existingSplitId) {
    if (existingSplitId !== detection.splitId) {
      preservedConflicts.push({ id, existingSplitId, detectedSplitId: detection.splitId });
    }
    continue;
  }

  const split = splitById.get(detection.splitId);
  const goal = goalFromId(id);
  if (!split || !goal) {
    unknown.push({ id, splitId: detection.splitId });
    continue;
  }
  split.ocrGoals ||= [];
  split.ocrGoals.push(goal);
  additions.push({ splitId: split.id, splitLabel: split.label, ...goal });
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const backupDir = path.join(ROOT, "outputs", "database-backups", "days-gone", "default");
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `default-splits.json.${stamp}.pre-ocr-import.bak.json`);
fs.copyFileSync(routeFile, backupFile);
fs.writeFileSync(routeFile, `${JSON.stringify(route, null, 2)}\n`, "utf8");

const report = {
  createdAt: new Date().toISOString(),
  splitLogExport: path.relative(ROOT, exportFile).replaceAll("\\", "/"),
  ocrLog: path.relative(ROOT, ocrLogFile).replaceAll("\\", "/"),
  routeFile: path.relative(ROOT, routeFile).replaceAll("\\", "/"),
  backupFile: path.relative(ROOT, backupFile).replaceAll("\\", "/"),
  policy: "Confirmed auto-applied detections only; new goals are optional; existing assignments are never moved.",
  totals: {
    detections: detections.length,
    correlated: correlated.length,
    unmatched: unmatched.length,
    added: additions.length,
    preservedConflicts: preservedConflicts.length,
    ambiguous: ambiguous.length,
    unknown: unknown.length,
    maximumCorrelationDistanceMs: correlated.length
      ? Math.max(...correlated.map((entry) => entry.distanceMs))
      : 0
  },
  additions,
  preservedConflicts,
  ambiguous,
  unknown
};
const reportFile = path.join(path.dirname(exportFile), `ocr-goal-import.${stamp}.json`);
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ reportFile, ...report.totals }, null, 2));
