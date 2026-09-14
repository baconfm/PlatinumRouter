import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const collectible = readJson("outputs/training/days-gone/bacon-pb/collectible-progress.json");
const completions = readJson(
  "outputs/training/days-gone/bacon-pb/models/completion-title-model.json"
);
const counters = readJson("data/days-gone/counters.json");
const run = readJson("outputs/training/days-gone/bacon-pb/run.json");

const weights = {
  trophies: 4,
  encampmentjobs: 5,
  nerosites: 5,
  infestations: 7,
  ambushcamps: 8,
  hordes: 11,
  charactercollectibles: 0.7,
  nerointel: 0.7,
  sarahlabnotes: 0.7,
  radiofreeoregon: 0.55,
  colonelspeeches: 0.55,
  historical: 0.55,
  tourism: 0.55,
  rippersermons: 0.55,
  herbology: 0.45,
  songs: 0.55
};

const grouped = new Map();
const addTimestamp = (counterKey, timestampSeconds) => {
  const timestampMs = Math.round(Number(timestampSeconds || 0) * 1000);
  if (!counterKey || !Number.isFinite(timestampMs) || timestampMs < 0) return;
  if (!grouped.has(counterKey)) grouped.set(counterKey, []);
  grouped.get(counterKey).push(timestampMs);
};

for (const match of collectible.matches || []) {
  addTimestamp(match.counterKey, match.timestamp);
}

for (const [counterKey, category] of Object.entries(completions.categories || {})) {
  for (const match of category.matches || []) {
    if (match.countsTowardCounter === false) continue;
    addTimestamp(counterKey, match.timestamp);
  }
}

const trophyCandidates = (collectible.ocrCandidates || [])
  .filter((candidate) => /trophy\s+earned/i.test(String(candidate.observedText || "")))
  .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

let previousTrophySeconds = -Infinity;
for (const candidate of trophyCandidates) {
  const timestampSeconds = Number(candidate.timestamp || 0);
  if (timestampSeconds - previousTrophySeconds < 8) continue;
  addTimestamp("trophies", timestampSeconds);
  previousTrophySeconds = timestampSeconds;
}

const benchmarkCounters = {};
for (const [counterKey, timestampsMs] of grouped.entries()) {
  const max = Number(counters?.[counterKey]?.max || 0);
  const weight = Number(weights[counterKey] || 0);
  if (!max || !weight || !timestampsMs.length) continue;

  benchmarkCounters[counterKey] = {
    max,
    weight,
    sourceCount: timestampsMs.length,
    coverage: Number((timestampsMs.length / max).toFixed(4)),
    timestampsMs: timestampsMs.sort((a, b) => a - b)
  };
}

const output = {
  schemaVersion: 1,
  baselineId: "bacon-pb",
  label: "Bacon PB",
  finishMs: Math.round(Number(run.totalDurationSeconds || collectible.sourceDurationSeconds || 0) * 1000),
  generatedAt: new Date().toISOString(),
  method: "Non-linear PB category curves with activity-cost weighting",
  notes: [
    "Collectible curves are normalized for OCR coverage.",
    "Hordes, ambush camps, infestations, NERO sites, and camp jobs carry more weight than pickup popups.",
    "Early forecasts are damped because early collectibles and trophies have fewer prerequisites."
  ],
  counters: benchmarkCounters
};

const outputPath = path.join(root, "data/days-gone/pb-pace-benchmark.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} with ${Object.keys(benchmarkCounters).length} curves.`);
