import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { DAYS_GONE_COLLECTIBLE_CHECKLIST } from "../js/screen-tracker.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logsRoot = path.resolve(
  ROOT,
  process.argv[2] || "outputs/ocr-run-logs/days-gone/default"
);

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function formatMs(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function createRegionStats(regionId, regionLabel = "") {
  return {
    regionId,
    regionLabel,
    events: 0,
    confirmed: 0,
    candidates: 0,
    raw: 0,
    gibberish: 0,
    errors: 0,
    forced: 0,
    forcedUseful: 0,
    forcedPassingRevisedGate: 0,
    forcedUsefulPassingRevisedGate: 0,
    textLike: 0,
    timingMs: [],
    queueDelayMs: [],
    scanTimingMs: [],
    confirmedChecklistIds: new Set(),
    confirmedCounters: new Map()
  };
}

function passesRevisedGate(regionId, gate = {}) {
  if (gate.likelyText) return true;
  const maxTransitions = Number(gate.maxTransitions || 0);
  const strongRows = Number(gate.strongRows || 0);
  const mediumRows = Number(gate.mediumRows || 0);
  const brightRatio = Number(gate.brightRatio || 0);
  const softBrightRatio = Number(gate.softBrightRatio || 0);
  const darkRatio = Number(gate.darkRatio || 0);
  if (
    ["days_gone_top_right_title", "days_gone_top_right_wide_title"].includes(regionId)
    && maxTransitions >= 8
    && strongRows >= 2
    && darkRatio >= 0.08
    && (brightRatio >= 0.0001 || softBrightRatio >= 0.001 || maxTransitions >= 11)
  ) return true;
  if (
    regionId === "days_gone_top_right_toast"
    && maxTransitions >= 9
    && strongRows >= 1
    && darkRatio >= 0.08
  ) return true;
  if (
    regionId === "days_gone_ipca_pickup"
    && maxTransitions >= 3
    && mediumRows >= 3
    && softBrightRatio >= 0.003
    && darkRatio >= 0.08
  ) return true;
  if (
    regionId === "days_gone_pickup_left"
    && maxTransitions >= 8
    && strongRows >= 1
    && darkRatio >= 0.75
  ) return true;
  return false;
}

async function visitJsonLines(file, callback) {
  if (!fs.existsSync(file)) return;
  const lines = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      callback(JSON.parse(line));
    } catch {
      // A live run can end in the middle of an append. Keep the rest usable.
    }
  }
}

function findLatestSession(root) {
  if (!fs.existsSync(root)) throw new Error(`OCR log root not found: ${root}`);
  const directConfirmed = path.join(root, "confirmed.jsonl");
  if (fs.existsSync(directConfirmed)) return root;
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((entry) => fs.existsSync(path.join(entry, "raw.jsonl")))
    .sort((left, right) => {
      const leftTime = fs.statSync(path.join(left, "raw.jsonl")).mtimeMs;
      const rightTime = fs.statSync(path.join(right, "raw.jsonl")).mtimeMs;
      return rightTime - leftTime;
    });
  if (!candidates.length) throw new Error(`No OCR sessions found under: ${root}`);
  return candidates[0];
}

const sessionDir = findLatestSession(logsRoot);
const buckets = ["confirmed", "candidate", "raw", "gibberish", "error", "control"];
const bucketCounts = Object.fromEntries(buckets.map((bucket) => [bucket, 0]));
const regionStats = new Map();
const confirmedCounters = new Map();
const confirmedChecklistIds = new Set();
const confirmedEvents = [];
const errors = [];
const controlEvents = [];
let firstElapsedMs = null;
let lastElapsedMs = null;

for (const bucket of buckets) {
  await visitJsonLines(path.join(sessionDir, `${bucket}.jsonl`), (event) => {
    bucketCounts[bucket] += 1;
    const elapsedMs = Number(event?.context?.elapsedMs);
    if (Number.isFinite(elapsedMs)) {
      firstElapsedMs = firstElapsedMs === null ? elapsedMs : Math.min(firstElapsedMs, elapsedMs);
      lastElapsedMs = lastElapsedMs === null ? elapsedMs : Math.max(lastElapsedMs, elapsedMs);
    }
    if (bucket === "control") controlEvents.push(event);
    if (bucket === "error") errors.push(event);

    for (const region of event.regions || []) {
      const regionId = region.regionId || "unknown";
      const stats = regionStats.get(regionId) || createRegionStats(regionId, region.regionLabel);
      stats.events += 1;
      stats[bucket] = (stats[bucket] || 0) + 1;
      if (region?.gate?.forced) stats.forced += 1;
      if (region?.gate?.forced && ["confirmed", "candidate"].includes(bucket)) {
        stats.forcedUseful += 1;
      }
      if (region?.gate?.forced && passesRevisedGate(regionId, region.gate)) {
        stats.forcedPassingRevisedGate += 1;
        if (["confirmed", "candidate"].includes(bucket)) {
          stats.forcedUsefulPassingRevisedGate += 1;
        }
      }
      if (region?.gate?.likelyText) stats.textLike += 1;
      if (Number.isFinite(Number(region.timingMs))) stats.timingMs.push(Number(region.timingMs));
      if (Number.isFinite(Number(region.queueDelayMs))) stats.queueDelayMs.push(Number(region.queueDelayMs));
      if (Number.isFinite(Number(region.scanTimingMs))) stats.scanTimingMs.push(Number(region.scanTimingMs));

      if (bucket === "confirmed") {
        for (const applied of event.applied || []) {
          for (const id of applied.matchedChecklistIds || []) {
            stats.confirmedChecklistIds.add(id);
            confirmedChecklistIds.add(id);
          }
          const counterKey = applied.counterKey || applied.label || "unknown";
          const delta = Number(applied.delta || 0);
          stats.confirmedCounters.set(
            counterKey,
            (stats.confirmedCounters.get(counterKey) || 0) + delta
          );
          confirmedCounters.set(counterKey, (confirmedCounters.get(counterKey) || 0) + delta);
        }
      }
      regionStats.set(regionId, stats);
    }

    if (bucket === "confirmed") {
      confirmedEvents.push({
        elapsedMs,
        splitLabel: event?.context?.splitLabel || "",
        message: event.message || "",
        regions: (event.regions || []).map((region) => region.regionId || "unknown"),
        applied: event.applied || []
      });
    }
  });
}

const regions = [...regionStats.values()]
  .map((stats) => {
    const useful = stats.confirmed + Number(stats.candidate || 0);
    const noisy = stats.raw + stats.gibberish + stats.errors;
    return {
      regionId: stats.regionId,
      regionLabel: stats.regionLabel,
      events: stats.events,
      confirmed: stats.confirmed,
      candidates: stats.candidate,
      raw: stats.raw,
      gibberish: stats.gibberish,
      errors: stats.errors,
      forced: stats.forced,
      forcedUseful: stats.forcedUseful,
      forcedPassingRevisedGate: stats.forcedPassingRevisedGate,
      forcedUsefulPassingRevisedGate: stats.forcedUsefulPassingRevisedGate,
      textLike: stats.textLike,
      usefulRatePercent: stats.events ? Number((100 * useful / stats.events).toFixed(2)) : 0,
      noiseRatePercent: stats.events ? Number((100 * noisy / stats.events).toFixed(2)) : 0,
      forcedUsefulRatePercent: stats.forced
        ? Number((100 * stats.forcedUseful / stats.forced).toFixed(2))
        : 0,
      timingP50Ms: Math.round(percentile(stats.timingMs, 0.5)),
      timingP95Ms: Math.round(percentile(stats.timingMs, 0.95)),
      queueDelayP50Ms: Math.round(percentile(stats.queueDelayMs, 0.5)),
      queueDelayP95Ms: Math.round(percentile(stats.queueDelayMs, 0.95)),
      scanTimingP95Ms: Math.round(percentile(stats.scanTimingMs, 0.95)),
      uniqueChecklistItems: stats.confirmedChecklistIds.size,
      confirmedCounters: Object.fromEntries(
        [...stats.confirmedCounters.entries()].sort((left, right) => left[0].localeCompare(right[0]))
      )
    };
  })
  .sort((left, right) => right.events - left.events);

const errorTimeline = errors.map((event) => ({
  elapsed: formatMs(event?.context?.elapsedMs),
  regionId: event?.regions?.[0]?.regionId || "",
  message: event?.errors?.[0]?.message || event.message || ""
}));

const checklistCoverage = {};
for (const entry of DAYS_GONE_COLLECTIBLE_CHECKLIST) {
  const counterKey = entry.counterKey || "unknown";
  const category = checklistCoverage[counterKey] || {
    catalogItems: 0,
    autoConfirmedItems: 0,
    coveragePercent: 0,
    missingItems: []
  };
  category.catalogItems += 1;
  if (confirmedChecklistIds.has(entry.id)) {
    category.autoConfirmedItems += 1;
  } else {
    category.missingItems.push({
      id: entry.id,
      title: entry.title,
      phrases: entry.phrases || []
    });
  }
  checklistCoverage[counterKey] = category;
}
for (const category of Object.values(checklistCoverage)) {
  category.coveragePercent = Number(
    (100 * category.autoConfirmedItems / Math.max(1, category.catalogItems)).toFixed(2)
  );
}

const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sessionDir,
  runWindow: {
    firstElapsed: formatMs(firstElapsedMs),
    lastElapsed: formatMs(lastElapsedMs),
    durationObserved: formatMs((lastElapsedMs || 0) - (firstElapsedMs || 0))
  },
  bucketCounts,
  totals: {
    events: Object.values(bucketCounts).reduce((sum, value) => sum + value, 0),
    uniqueConfirmedChecklistItems: confirmedChecklistIds.size,
    confirmedCounterDeltas: Object.fromEntries(
      [...confirmedCounters.entries()].sort((left, right) => left[0].localeCompare(right[0]))
    ),
    errors: errors.length
  },
  checklistCoverage,
  regions,
  errorTimeline,
  controlEvents: controlEvents.map((event) => ({
    elapsed: formatMs(event?.context?.elapsedMs),
    status: event.status || "",
    message: event.message || "",
    queueStats: event.queueStats || null
  })),
  confirmedEvents
};

const outputDir = path.resolve(ROOT, "outputs/training/days-gone/latest-live-ocr-audit");
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = path.join(outputDir, "live-ocr-audit.json");
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outputFile,
  sessionDir,
  runWindow: report.runWindow,
  bucketCounts,
  totals: report.totals,
  checklistCoverage: Object.fromEntries(
    Object.entries(checklistCoverage).map(([counterKey, category]) => [
      counterKey,
      {
        catalogItems: category.catalogItems,
        autoConfirmedItems: category.autoConfirmedItems,
        coveragePercent: category.coveragePercent
      }
    ])
  ),
  regions: regions.map((region) => ({
    regionId: region.regionId,
    events: region.events,
    confirmed: region.confirmed,
    candidates: region.candidates,
    forced: region.forced,
    forcedUseful: region.forcedUseful,
    forcedUsefulRatePercent: region.forcedUsefulRatePercent,
    usefulRatePercent: region.usefulRatePercent,
    timingP95Ms: region.timingP95Ms,
    queueDelayP95Ms: region.queueDelayP95Ms,
    uniqueChecklistItems: region.uniqueChecklistItems
  })),
  errorTimeline
}, null, 2));
