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
  return `crop=${Math.round(width * region.width / 100)}:${Math.round(height * region.height / 100)}:${Math.round(width * region.x / 100)}:${Math.round(height * region.y / 100)}`;
}

function overlaps(timestamp, intervals) {
  return intervals.some(([start, end]) => timestamp >= start && timestamp <= end);
}

const manifestArg = process.argv[2];
if (!manifestArg) {
  console.error("Usage: node scripts/extract-days-gone-training-negatives.mjs <manifest.json> [--count N] [--output dir] [--resume]");
  process.exit(1);
}

const manifestFile = resolveInput(manifestArg);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const ffmpeg = findFfmpeg();
if (!ffmpeg) throw new Error("Portable ffmpeg was not found under outputs/tools/ffmpeg.");

const videoStream = (manifest.video?.streams || []).find((stream) => stream.codec_type === "video");
const width = Number(videoStream?.width || 0);
const height = Number(videoStream?.height || 0);
const duration = Number(manifest.video?.durationSeconds || 0);
const regionName = arg("--region", "topRightCombined");
const region = manifest.regions?.[regionName];
if (!width || !height || !duration || !region) throw new Error("Manifest video or region metadata is incomplete.");

const count = Math.max(1, Number(arg("--count", "1200")) || 1200);
const defaultOutputName = regionName === "topRightCombined" ? "negatives" : `${regionName}-negatives`;
const outputDir = resolveInput(arg("--output", path.join(path.dirname(manifestFile), defaultOutputName)));
const resume = process.argv.includes("--resume");
fs.mkdirSync(outputDir, { recursive: true });
appendTrainingLog({
  bucket: "extraction",
  source: "negative-extractor",
  status: "extraction-started",
  message: "Safe background extraction started.",
  trainingRoot: path.dirname(manifestFile),
  data: { outputDir, regionName, requested: count, resume }
});

const excluded = [
  ...(manifest.confirmedEvents || []).map((event) => [event.videoSeconds - 6, event.videoSeconds + 6]),
  ...(manifest.completionEvents || []).map((event) => [event.videoSeconds - 8, event.videoSeconds + 4]),
  ...(manifest.candidateEvents || []).map((event) => [event.videoSeconds - 4, event.videoSeconds + 4]),
  ...(manifest.unresolvedEpisodes || []).map((event) => [event.videoSeconds - 1, event.endVideoSeconds + 1])
].sort((left, right) => left[0] - right[0]);

const firstEvent = Math.max(0, Math.min(...(manifest.confirmedEvents || []).map((event) => event.videoSeconds)) - 60);
const lastEvent = Math.min(duration, Math.max(...(manifest.confirmedEvents || []).map((event) => event.videoSeconds)) + 60);
const timestamps = [];
const attempts = count * 80;
for (let index = 0; index < attempts && timestamps.length < count; index += 1) {
  // A deterministic low-discrepancy sequence spreads samples across the run.
  const fraction = ((index * 0.6180339887498949) % 1);
  const timestamp = firstEvent + fraction * (lastEvent - firstEvent);
  if (overlaps(timestamp, excluded)) continue;
  if (timestamps.some((existing) => Math.abs(existing - timestamp) < 3)) continue;
  timestamps.push(Number(timestamp.toFixed(3)));
}

if (timestamps.length < count) {
  console.warn(`Only ${timestamps.length} safe background timestamps were available for ${count} requested samples.`);
}

const samples = [];
const extractionStartedAt = Date.now();
for (let index = 0; index < timestamps.length; index += 1) {
  const timestamp = timestamps[index];
  const id = `negative-${String(index + 1).padStart(5, "0")}`;
  const outputFile = path.join(outputDir, `${id}.png`);
  if (!(resume && fs.existsSync(outputFile))) {
    const result = spawnSync(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-ss", timestamp.toFixed(3),
      "-i", manifest.source.videoFile,
      "-map", "0:v:0",
      "-frames:v", "1",
      "-vf", cropFilter(region, width, height),
      "-y", outputFile
    ], { encoding: "utf8", timeout: 120000 });
    if (result.status !== 0) throw new Error(result.stderr || `Negative extraction failed at ${timestamp}s.`);
  }
  samples.push({ id, timestamp, regionName, file: path.basename(outputFile) });
  if (samples.length % 100 === 0 || samples.length === timestamps.length) {
    appendTrainingLog({
      bucket: "extraction",
      source: "negative-extractor",
      status: "extraction-progress",
      message: "Safe background extraction progress.",
      trainingRoot: path.dirname(manifestFile),
      data: { completed: samples.length, total: timestamps.length }
    });
  }
  if (samples.length % 25 === 0 || samples.length === timestamps.length) {
    const elapsedSeconds = (Date.now() - extractionStartedAt) / 1000;
    const remainingSeconds = samples.length
      ? (timestamps.length - samples.length) * elapsedSeconds / samples.length
      : 0;
    console.log(`[background extraction] ${samples.length}/${timestamps.length} (${(samples.length / Math.max(1, timestamps.length) * 100).toFixed(1)}%) | ETA ${Math.ceil(remainingSeconds / 60)}m`);
  }
}

fs.writeFileSync(path.join(outputDir, "index.json"), `${JSON.stringify({ createdAt: new Date().toISOString(), manifestFile, samples }, null, 2)}\n`, "utf8");
appendTrainingLog({
  bucket: "extraction",
  source: "negative-extractor",
  status: "extraction-completed",
  message: "Safe background extraction completed.",
  trainingRoot: path.dirname(manifestFile),
  data: { outputDir, regionName, requested: count, extracted: samples.length, resume }
});
console.log(JSON.stringify({ outputDir, requested: count, extracted: samples.length, resume }, null, 2));
