import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { appendTrainingLog } from "./lib/training-log.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function resolveInput(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function findFfmpeg() {
  const root = path.join(ROOT, "outputs", "tools", "ffmpeg");
  const stack = fs.existsSync(root) ? [root] : [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.toLowerCase() === "ffmpeg.exe") return full;
    }
  }
  return "";
}

function cropFilter(region, width, height) {
  const x = Math.round(width * region.x / 100);
  const y = Math.round(height * region.y / 100);
  const cropWidth = Math.round(width * region.width / 100);
  const cropHeight = Math.round(height * region.height / 100);
  return `crop=${cropWidth}:${cropHeight}:${x}:${y}`;
}

const manifestArg = process.argv[2];
if (!manifestArg) {
  console.error("Usage: node scripts/extract-days-gone-training-samples.mjs <manifest.json> [--limit N] [--output dir]");
  process.exit(1);
}

const manifestFile = resolveInput(manifestArg);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const ffmpeg = findFfmpeg();
if (!ffmpeg) throw new Error("Portable ffmpeg was not found under outputs/tools/ffmpeg.");

const videoStream = (manifest.video?.streams || []).find((stream) => stream.codec_type === "video");
const width = Number(videoStream?.width || 0);
const height = Number(videoStream?.height || 0);
if (!width || !height) throw new Error("Manifest is missing video dimensions.");

const outputDir = resolveInput(arg("--output", path.join(path.dirname(manifestFile), "samples")));
const requestedLimit = Number(arg("--limit", "24"));
const start = Math.max(0, Number(arg("--start", "0")) || 0);
const kind = arg("--kind", "all");
const resume = process.argv.includes("--resume");
const availableEvents = kind === "confirmed"
  ? [...(manifest.confirmedEvents || [])]
  : kind === "completion"
    ? [...(manifest.completionEvents || [])]
    : [...(manifest.confirmedEvents || []), ...(manifest.completionEvents || [])];
const events = availableEvents.slice(start, requestedLimit > 0 ? start + requestedLimit : undefined);

fs.mkdirSync(outputDir, { recursive: true });
appendTrainingLog({
  bucket: "extraction",
  source: "positive-extractor",
  status: "extraction-started",
  message: "Confirmed popup extraction started.",
  trainingRoot: path.dirname(manifestFile),
  data: { outputDir, start, requestedLimit, kind, resume, events: events.length }
});
const index = [];
const extractionStartedAt = Date.now();
for (const event of events) {
  const isCompletion = event.kind === "completion-window";
  const regionNames = isCompletion
    ? ["completionAnchor", "completionTitle"]
    : event.labels?.some((label) => label.counterKey === "ipca")
      ? ["ipcaPickup"]
      : ["topRightCombined", "topRightTitle"];
  const eventDir = path.join(outputDir, event.id);
  fs.mkdirSync(eventDir, { recursive: true });

  const offsets = isCompletion
    ? [-4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1]
    : [-0.5, 0, 0.5];
  for (const offset of offsets) {
    const timestamp = Math.max(0, Number(event.videoSeconds || 0) + offset);
    for (const regionName of regionNames) {
      const outputName = `${regionName}.${offset < 0 ? "m" : "p"}${Math.abs(offset).toFixed(1).replace(".", "")}.png`;
      const outputFile = path.join(eventDir, outputName);
      if (!(resume && fs.existsSync(outputFile))) {
        const result = spawnSync(ffmpeg, [
          "-hide_banner", "-loglevel", "error",
          "-ss", timestamp.toFixed(3),
          "-i", manifest.source.videoFile,
          "-map", "0:v:0",
          "-frames:v", "1",
          "-vf", cropFilter(manifest.regions[regionName], width, height),
          "-y", outputFile
        ], { encoding: "utf8", timeout: 120000 });
        if (result.status !== 0) throw new Error(result.stderr || `Frame extraction failed for ${event.id}.`);
      }
      index.push({ eventId: event.id, kind: event.kind, regionName, offsetSeconds: offset, timestamp, file: path.relative(outputDir, outputFile).replaceAll("\\", "/") });
    }
  }
  if ((index.length && (index.length / 6) % 25 === 0) || event === events.at(-1)) {
    appendTrainingLog({
      bucket: "extraction",
      source: "positive-extractor",
      status: "extraction-progress",
      message: "Confirmed popup extraction progress.",
      trainingRoot: path.dirname(manifestFile),
      data: { eventId: event.id, completedEvents: events.indexOf(event) + 1, totalEvents: events.length, images: index.length }
    });
  }
  const completedEvents = events.indexOf(event) + 1;
  if (completedEvents % 5 === 0 || completedEvents === events.length) {
    const elapsedSeconds = (Date.now() - extractionStartedAt) / 1000;
    const remainingSeconds = completedEvents
      ? (events.length - completedEvents) * elapsedSeconds / completedEvents
      : 0;
    console.log(`[positive extraction] ${completedEvents}/${events.length} (${(completedEvents / Math.max(1, events.length) * 100).toFixed(1)}%) | ETA ${Math.ceil(remainingSeconds / 60)}m`);
  }
}

const indexName = kind === "completion" ? "completion-index.json" : "index.json";
fs.writeFileSync(path.join(outputDir, indexName), `${JSON.stringify({ createdAt: new Date().toISOString(), manifestFile, kind, samples: index }, null, 2)}\n`, "utf8");
appendTrainingLog({
  bucket: "extraction",
  source: "positive-extractor",
  status: "extraction-completed",
  message: "Confirmed popup extraction completed.",
  trainingRoot: path.dirname(manifestFile),
  data: { outputDir, indexName, events: events.length, images: index.length, resume }
});
console.log(JSON.stringify({ outputDir, start, events: events.length, images: index.length, resume }, null, 2));
