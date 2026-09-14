import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { classifyOcrLogEvent } from "../js/ocr-log.js";
import { appendTrainingLog } from "./lib/training-log.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOG = path.join(ROOT, "outputs", "ocr-run-logs", "days-gone", "default", "ocr-run-mrpzis55-vnk6ep.jsonl");
const DEFAULT_SPLIT_LOG = path.join(ROOT, "outputs", "run-exports", "days-gone", "default", "split-log", "days-gone-default-split-log.20260720-095552.json");
const DEFAULT_ROUTE = path.join(ROOT, "data", "days-gone", "default-splits.json");
const DEFAULT_OUTPUT = path.join(ROOT, "outputs", "training", "days-gone", "20260718", "manifest.json");

const REGIONS = {
  topRightCombined: { x: 54, y: 0, width: 46, height: 17 },
  topRightTitle: { x: 76, y: 0, width: 24, height: 7 },
  ipcaPickup: { x: 0, y: 65, width: 16, height: 14 },
  completionAnchor: { x: 2, y: 4, width: 39, height: 15 },
  completionTitle: { x: 23, y: 53, width: 54, height: 15 }
};

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function resolveInput(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findFfprobe() {
  const binRoot = path.join(ROOT, "outputs", "tools", "ffmpeg");
  if (!fs.existsSync(binRoot)) return "";
  const stack = [binRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.toLowerCase() === "ffprobe.exe") return full;
    }
  }
  return "";
}

function inferVideoStart(videoFile) {
  const match = path.basename(videoFile).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function probeVideo(videoFile, ffprobe) {
  const result = spawnSync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration,size,bit_rate,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate",
    "-of", "json",
    videoFile
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) fail(result.stderr || "Could not inspect video.");
  return JSON.parse(result.stdout);
}

function eventLabels(applied = []) {
  const labels = [];
  for (const item of applied) {
    for (const id of item.matchedChecklistIds || []) labels.push({ id, counterKey: item.counterKey, title: item.matchedPhrase || id });
    if (item.counterKey === "trophies" && (item.trophyTitle || item.matchedPhrase)) {
      labels.push({ id: "", counterKey: "trophies", title: item.trophyTitle || item.matchedPhrase });
    }
    if (!(item.matchedChecklistIds || []).length && item.counterKey && item.counterKey !== "trophies") {
      labels.push({ id: "", counterKey: item.counterKey, title: item.matchedPhrase || item.label || item.counterKey });
    }
  }
  return labels;
}

function secondsFrom(videoStartMs, at) {
  return Number(((Date.parse(at) - videoStartMs) / 1000).toFixed(3));
}

async function parseOcrLog(file) {
  const confirmed = [];
  const candidates = [];
  const unresolvedEpisodes = [];
  let openEpisode = null;
  let lineCount = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });

  const closeEpisode = () => {
    if (openEpisode) unresolvedEpisodes.push(openEpisode);
    openEpisode = null;
  };

  for await (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    lineCount += 1;
    const labels = eventLabels(entry.applied || []);
    if (entry.status === "auto-applied" && labels.length) {
      closeEpisode();
      const scanTimingMs = Math.max(0, ...(entry.regions || []).map((region) => Number(region.scanTimingMs || 0)));
      const capturedAt = new Date(Date.parse(entry.at) - scanTimingMs).toISOString();
      confirmed.push({
        at: capturedAt,
        loggedAt: entry.at,
        scanTimingMs,
        splitId: entry.context?.splitId || "",
        splitLabel: entry.context?.splitLabel || "",
        elapsedMs: Number(entry.context?.elapsedMs || 0),
        labels,
        regions: (entry.regions || []).map((region) => ({ id: region.regionId || "", text: region.text || "" }))
      });
      continue;
    }

    const eventBucket = entry.eventBucket || classifyOcrLogEvent({
      ...entry,
      regionTexts: entry.regions || entry.regionTexts || []
    });
    if (eventBucket === "candidate") {
      closeEpisode();
      candidates.push({
        at: entry.at,
        splitId: entry.context?.splitId || "",
        splitLabel: entry.context?.splitLabel || "",
        text: entry.combinedText || ""
      });
      continue;
    }

    if (!["raw", "gibberish"].includes(eventBucket)) {
      closeEpisode();
      continue;
    }

    const timestamp = Date.parse(entry.at || "");
    if (!Number.isFinite(timestamp)) continue;
    const text = String(entry.combinedText || "").trim();
    if (!openEpisode || timestamp - openEpisode.lastTimestamp > 2500) {
      closeEpisode();
      openEpisode = {
        startAt: entry.at,
        endAt: entry.at,
        lastTimestamp: timestamp,
        splitId: entry.context?.splitId || "",
        splitLabel: entry.context?.splitLabel || "",
        buckets: { raw: 0, gibberish: 0 },
        bestText: text,
        bestTextLength: text.length
      };
    }
    openEpisode.endAt = entry.at;
    openEpisode.lastTimestamp = timestamp;
    openEpisode.buckets[eventBucket] += 1;
    if (text.length > openEpisode.bestTextLength) {
      openEpisode.bestText = text;
      openEpisode.bestTextLength = text.length;
    }
  }
  closeEpisode();
  unresolvedEpisodes.forEach((episode) => {
    delete episode.lastTimestamp;
    delete episode.bestTextLength;
  });
  return { lineCount, confirmed, candidates, unresolvedEpisodes };
}

const videoArg = process.argv.find((value) => !value.startsWith("--") && value !== process.argv[0] && value !== process.argv[1]);
if (!videoArg) fail("Usage: node scripts/build-days-gone-training-manifest.mjs <recording.mkv> [--video-start ISO] [--ocr-log file] [--split-log file] [--unlabeled] [--output file]");

const videoFile = resolveInput(videoArg);
const unlabeled = process.argv.includes("--unlabeled");
const ocrLogFile = resolveInput(arg("--ocr-log", DEFAULT_LOG));
const splitLogFile = resolveInput(arg("--split-log", DEFAULT_SPLIT_LOG));
const routeFile = resolveInput(arg("--route", DEFAULT_ROUTE));
const outputFile = resolveInput(arg("--output", DEFAULT_OUTPUT));
const requiredFiles = unlabeled ? [videoFile, routeFile] : [videoFile, ocrLogFile, splitLogFile, routeFile];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) fail(`Required input not found: ${file}`);
}

const ffprobe = findFfprobe();
if (!ffprobe) fail("Portable ffprobe was not found under outputs/tools/ffmpeg.");
const videoStart = arg("--video-start") ? new Date(arg("--video-start")) : inferVideoStart(videoFile);
if (!videoStart || !Number.isFinite(videoStart.getTime())) fail("Could not infer video start time; pass --video-start with an ISO timestamp.");

const probe = probeVideo(videoFile, ffprobe);
const parsedLog = unlabeled
  ? { lineCount: 0, confirmed: [], candidates: [], unresolvedEpisodes: [] }
  : await parseOcrLog(ocrLogFile);
const splitLog = unlabeled ? { completedSplits: [] } : readJson(splitLogFile);
const route = readJson(routeFile);
const videoStartMs = videoStart.getTime();
const videoDurationSeconds = Number(probe.format?.duration || 0);

const confirmedEvents = parsedLog.confirmed
  .map((event, index) => ({
    id: `confirmed-${String(index + 1).padStart(4, "0")}`,
    kind: "confirmed-popup",
    ...event,
    videoSeconds: secondsFrom(videoStartMs, event.at),
    window: { beforeSeconds: 1, afterSeconds: 1 }
  }))
  .filter((event) => event.videoSeconds >= 0 && event.videoSeconds <= videoDurationSeconds);

const completionCounters = new Set(["nerosites", "infestations", "ambushcamps", "hordes", "encampmentjobs"]);
const completionEvents = (splitLog.completedSplits || [])
  .filter((split) => split.at)
  .map((split, index) => {
    const counters = Object.entries(split.autoApplied || {})
      .filter(([counterKey, delta]) => completionCounters.has(counterKey) && Number(delta) > 0)
      .map(([counterKey, delta]) => ({ counterKey, delta: Number(delta) }));
    return {
      id: `completion-${String(index + 1).padStart(4, "0")}`,
      kind: "completion-window",
      at: split.at,
      videoSeconds: secondsFrom(videoStartMs, split.at),
      splitId: split.splitId,
      splitLabel: split.label,
      source: split.source || "",
      reason: split.reason || "",
      counters,
      window: { beforeSeconds: 4, afterSeconds: 1 }
    };
  })
  .filter((event) => event.videoSeconds >= 0 && event.videoSeconds <= videoDurationSeconds)
  .filter((event) => event.counters.length || /ocr|screen-tracker/i.test(`${event.source} ${event.reason}`));

const confirmedIds = new Set(confirmedEvents.flatMap((event) => event.labels.map((label) => label.id).filter(Boolean)));
const completedSplitIds = new Set((splitLog.completedSplits || []).map((split) => split.splitId));
const missingExpectedGoals = route.splits.flatMap((split) => {
  if (!completedSplitIds.has(split.id)) return [];
  return (split.ocrGoals || [])
    .filter((goal) => !confirmedIds.has(goal.id))
    .map((goal) => ({ splitId: split.id, splitLabel: split.label, ...goal }));
});

const unresolvedEpisodes = parsedLog.unresolvedEpisodes
  .map((episode, index) => ({
    id: `unresolved-${String(index + 1).padStart(5, "0")}`,
    kind: "unresolved-ocr-episode",
    ...episode,
    videoSeconds: secondsFrom(videoStartMs, episode.startAt),
    endVideoSeconds: secondsFrom(videoStartMs, episode.endAt)
  }))
  .filter((event) => event.videoSeconds >= 0 && event.videoSeconds <= videoDurationSeconds);

const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  purpose: "Replay-backed Days Gone popup detection and OCR regression dataset",
  source: {
    videoFile,
    videoStartAt: videoStart.toISOString(),
    ocrLogFile: unlabeled ? "" : ocrLogFile,
    splitLogFile: unlabeled ? "" : splitLogFile,
    routeFile
  },
  video: {
    durationSeconds: videoDurationSeconds,
    sizeBytes: Number(probe.format?.size || 0),
    bitRate: Number(probe.format?.bit_rate || 0),
    streams: probe.streams || []
  },
  regions: REGIONS,
  policy: {
    confirmed: "Only historical auto-applied OCR events are positive labels.",
    unresolved: "Raw/gibberish episodes are review candidates, not automatic training truth.",
    missing: "Expected goals absent from confirmed events identify split-level search targets, not exact timestamps."
  },
  totals: {
    ocrLogLines: parsedLog.lineCount,
    confirmedEvents: confirmedEvents.length,
    completionWindows: completionEvents.length,
    candidateEvents: parsedLog.candidates.length,
    unresolvedEpisodes: unresolvedEpisodes.length,
    missingExpectedGoals: missingExpectedGoals.length
  },
  confirmedEvents,
  completionEvents,
  candidateEvents: parsedLog.candidates.map((event, index) => ({
    id: `candidate-${String(index + 1).padStart(4, "0")}`,
    kind: "candidate-popup",
    ...event,
    videoSeconds: secondsFrom(videoStartMs, event.at)
  })),
  unresolvedEpisodes,
  missingExpectedGoals
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
appendTrainingLog({
  bucket: "dataset",
  source: "manifest-builder",
  status: "manifest-written",
  message: "Replay training manifest written.",
  trainingRoot: path.dirname(outputFile),
  data: { outputFile, totals: manifest.totals, video: manifest.video }
});
console.log(JSON.stringify({ outputFile, ...manifest.totals, video: manifest.video }, null, 2));
