import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trainingRoot = path.join(ROOT, "outputs", "training", "days-gone", "20260718");
const logsRoot = path.join(trainingRoot, "logs");
const manifestFile = path.join(trainingRoot, "manifest.json");

function countPngFiles(directory, matcher = () => true) {
  if (!fs.existsSync(directory)) return { count: 0, latestMs: 0 };
  let count = 0;
  let latestMs = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".png") && matcher(full)) {
        count += 1;
        latestMs = Math.max(latestMs, fs.statSync(full).mtimeMs);
      }
    }
  }
  return { count, latestMs };
}

async function readEvents(file) {
  const events = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    try { events.push(JSON.parse(line)); } catch { /* Ignore a partial final line. */ }
  }
  return events;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

if (!fs.existsSync(logsRoot) || !fs.existsSync(manifestFile)) {
  console.error("No Days Gone training run has been started yet.");
  process.exit(1);
}

const sessionDirs = fs.readdirSync(logsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(logsRoot, entry.name))
  .filter((directory) => fs.existsSync(path.join(directory, "events.jsonl")))
  .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
if (!sessionDirs.length) {
  console.error("No structured Days Gone training session was found.");
  process.exit(1);
}

const sessionDir = sessionDirs[0];
const events = await readEvents(path.join(sessionDir, "events.jsonl"));
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const runStart = events.find((event) => event.status === "run-started");
const trainingTrack = runStart?.data?.trainingTrack || "collectible-popup";
const fullTraining = trainingTrack === "full-ocr-overnight";
const runComplete = [...events].reverse().find((event) => event.status === "run-completed");
const dryRunComplete = [...events].reverse().find((event) => event.status === "dry-run-completed");
const clearedFailure = [...events].reverse().find((event) => event.status === "false-failure-cleared");
const latestError = [...events].reverse().find((event) =>
  event.bucket === "error" && (!clearedFailure || Date.parse(event.at) > Date.parse(clearedFailure.at))
);
const latestEvent = events.at(-1);
const latestPhase = [...events].reverse().find((event) => event.status === "phase-started");
const latestProgress = [...events].reverse().find((event) => event.status === "extraction-progress");
const centerScan = trainingTrack === "center-popup-discovery";
const positives = trainingTrack === "completion"
  ? countPngFiles(path.join(trainingRoot, "samples"), (file) => path.basename(file).startsWith("completionAnchor.") || path.basename(file).startsWith("completionTitle."))
  : countPngFiles(path.join(trainingRoot, "samples"));
const negatives = countPngFiles(path.join(trainingRoot, trainingTrack === "completion" ? "completionAnchor-negatives" : "negatives"));
const existingPositiveIndex = trainingTrack === "completion"
  ? path.join(trainingRoot, "samples", "completion-index.json")
  : path.join(trainingRoot, "samples", "index.json");
const indexedPositiveCount = trainingTrack === "completion"
  ? positives.count
  : fs.existsSync(existingPositiveIndex)
  ? JSON.parse(fs.readFileSync(existingPositiveIndex, "utf8")).samples?.length || 0
  : 0;
const positiveTotal = trainingTrack === "completion"
  ? Number(manifest.completionEvents?.length || 0) * 22
  : Number(manifest.totals?.confirmedEvents || 0) * 6;
const negativeTotal = Number(runStart?.data?.negativeCount || 0);
const consoleLog = path.join(sessionDir, "console.log");
const consoleWriteMs = fs.existsSync(consoleLog) ? fs.statSync(consoleLog).mtimeMs : 0;
const freshestWriteMs = Math.max(positives.latestMs, negatives.latestMs, consoleWriteMs, Date.parse(latestEvent?.at || 0));
const quietAfterMs = centerScan || fullTraining ? 15 * 60_000 : 180_000;
const active = !runComplete && !latestError && Date.now() - freshestWriteMs < quietAfterMs;

let eta = "unknown";
const positiveStart = events.find((event) => event.source === "positive-extractor" && event.status === "extraction-started");
if (active && positiveStart && positives.count > (trainingTrack === "completion" ? 0 : 36) && positives.count < positiveTotal) {
  const elapsedSeconds = (Date.now() - Date.parse(positiveStart.at)) / 1000;
  const producedThisRun = Math.max(1, positives.count - (trainingTrack === "completion" ? 0 : 36));
  eta = formatDuration((positiveTotal - positives.count) * elapsedSeconds / producedThisRun);
}
const completedChunkEvents = events.filter((event) =>
  ["phase-completed", "chunk-completed"].includes(event.status) && event.message === "Center-popup chunk completed."
);
const startedChunkEvents = events.filter((event) =>
  ["phase-started", "chunk-started"].includes(event.status) && event.message === "Scanning center-popup chunk."
);
if ((centerScan || fullTraining) && active && completedChunkEvents.length) {
  const durations = completedChunkEvents.map((completed) => {
    const index = Number(completed.data?.index);
    const started = startedChunkEvents.find((event) => Number(event.data?.index) === index);
    return started ? (Date.parse(completed.at) - Date.parse(started.at)) / 1000 : 0;
  }).filter((seconds) => seconds > 0);
  const averageSeconds = durations.reduce((sum, seconds) => sum + seconds, 0) / Math.max(1, durations.length);
  const totalChunks = Number(runStart?.data?.chunkCount || 0);
  eta = formatDuration(Math.max(0, totalChunks - completedChunkEvents.length) * averageSeconds);
}

const state = runComplete ? "COMPLETE" : dryRunComplete ? "DRY RUN COMPLETE" : latestError ? "FAILED" : active ? "ACTIVE" : "QUIET / CHECK LOG";
console.log(`Days Gone training: ${state}`);
console.log(`Session: ${path.basename(sessionDir)}`);
console.log(`Training track: ${trainingTrack}`);
console.log(`Current phase: ${latestPhase?.message || "Unknown"}`);
if (fullTraining) {
  const popupSamples = countPngFiles(path.join(trainingRoot, "samples"), (file) =>
    !path.basename(file).startsWith("completionAnchor.") && !path.basename(file).startsWith("completionTitle.")
  );
  const completionSamples = countPngFiles(path.join(trainingRoot, "samples"), (file) =>
    path.basename(file).startsWith("completionAnchor.") || path.basename(file).startsWith("completionTitle.")
  );
  console.log(`Top-right popup samples: ${popupSamples.count}`);
  console.log(`Center completion samples: ${completionSamples.count}`);
}
if (centerScan || fullTraining) {
  const chunksDir = path.join(trainingRoot, "center-popup-chunks");
  const chunkFiles = fs.existsSync(chunksDir) ? fs.readdirSync(chunksDir).filter((name) => /^chunk-\d+\.json$/i.test(name)) : [];
  const completedChunks = chunkFiles.length;
  const configuredChunkSeconds = Number(runStart?.data?.chunkSeconds || 1800);
  const totalChunks = Number(runStart?.data?.chunkCount || Math.ceil(Number(manifest.video?.durationSeconds || 0) / configuredChunkSeconds));
  console.log(`Completed video chunks: ${completedChunks}/${totalChunks || "pending"}`);
  const discoveredEpisodes = chunkFiles.reduce((sum, name) => {
    try { return sum + Number(JSON.parse(fs.readFileSync(path.join(chunksDir, name), "utf8")).scan?.episodes || 0); }
    catch { return sum; }
  }, 0);
  console.log(`Discovered center episodes: ${discoveredEpisodes}`);
} else if (!fullTraining) {
  console.log(`Positive images: ${indexedPositiveCount}/${positiveTotal} (${positiveTotal ? (indexedPositiveCount / positiveTotal * 100).toFixed(1) : "0.0"}%)`);
  console.log(`Background images: ${negatives.count}/${negativeTotal || "pending"}`);
}
console.log(`${centerScan || fullTraining ? "Estimated remaining time" : "Current-phase ETA"}: ${eta}`);
console.log(`Latest activity: ${new Date(freshestWriteMs).toISOString()}`);
if ((centerScan || fullTraining) && fs.existsSync(consoleLog)) {
  const progressLines = fs.readFileSync(consoleLog, "utf8").split(/\r?\n/).filter((line) =>
    line.includes("[center popup scan]") || line.includes("Center scan chunk")
  );
  if (progressLines.length) console.log(`Latest milestone: ${progressLines.at(-1)}`);
}
if (latestProgress) console.log(`Latest milestone: ${latestProgress.message} ${JSON.stringify(latestProgress.data)}`);
if (latestError) console.log(`Latest error: ${latestError.message} ${JSON.stringify(latestError.data)}`);
console.log(`Log folder: ${sessionDir}`);
