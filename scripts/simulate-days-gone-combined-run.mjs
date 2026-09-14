import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const simulationRoot = path.join(root, "outputs", "training", "days-gone", "20260718", "simulations");
const interval = String(process.argv.find((value) => /^\d+$/.test(value)) || "125");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(simulationRoot, name), "utf8"));

const collectibles = readJson("collectible-real-run-simulation-v2.json");
const completions = readJson("live-replay-simulation.json");
const ipca = readJson("ipca-pickup-first-event-20fps.json");
const events = [];

for (const event of collectibles.events || []) {
  const row = event[interval];
  const recognized = new Set(row.recognizedIds || []);
  events.push({
    id: event.id,
    timestamp: Number(event.timestamp),
    track: "collectible",
    priority: 70,
    expectedItems: (event.expected || []).map((item) => ({
      ...item,
      recognized: recognized.has(item.id)
    })),
    processingMs: (row.attempts || []).reduce((sum, attempt) => sum + Number(attempt.ocrMs || 0), 0),
    capturePhasePassRate: Number(row.capturePhasePassRate || 0),
    recognized: row.fullyRecognized === true
  });
}

for (const event of completions.events || []) {
  const row = event[interval];
  events.push({
    id: event.id,
    timestamp: Number(event.timestamp),
    track: "center-completion",
    priority: 100,
    expectedItems: [{
      id: event.id,
      counterKey: event.counterKey,
      title: event.canonicalTitle,
      recognized: row.recognized === true
    }],
    processingMs: (row.attempts || []).reduce((sum, attempt) => sum + Number(attempt.ocrMs || 0), 0),
    capturePhasePassRate: Number(row.capturePhasePassRate || 0),
    recognized: row.recognized === true
  });
}

const exactIpca = ipca.exactMatches || [];
events.push({
  id: "ipca-verified-01",
  timestamp: exactIpca.length ? Number(exactIpca[0].timestamp) : 1402,
  track: "ipca",
  priority: 40,
  expectedItems: [{
    id: "ipca-verified-01",
    counterKey: "ipca",
    title: "IPCA Tech",
    recognized: exactIpca.length > 0
  }],
  processingMs: exactIpca.length ? Number(exactIpca[0].ocrMs || 0) : 0,
  capturePhasePassRate: Number(ipca.intervalSimulation?.[interval]?.exactLivePhaseRate || 0),
  recognized: exactIpca.length > 0
});

events.sort((left, right) => left.timestamp - right.timestamp || right.priority - left.priority);

let workerFreeAt = 0;
let maximumQueueDelayMs = 0;
let staleDrops = 0;
const queueDelays = [];
for (const event of events) {
  const arrival = event.timestamp * 1000;
  const queueDelayMs = Math.max(0, workerFreeAt - arrival);
  const stale = queueDelayMs > 2000 && event.priority < 100;
  event.queueDelayMs = Math.round(queueDelayMs);
  event.staleDropped = stale;
  event.completedAt = stale ? null : Math.round(Math.max(workerFreeAt, arrival) + event.processingMs);
  maximumQueueDelayMs = Math.max(maximumQueueDelayMs, queueDelayMs);
  queueDelays.push(Math.round(queueDelayMs));
  if (stale) {
    staleDrops += 1;
  } else {
    workerFreeAt = event.completedAt;
  }
}

const allItems = events.flatMap((event) => event.expectedItems.map((item) => ({ ...item, track: event.track })));
const recognizedItems = allItems.filter((item) => item.recognized);
const categoryMap = new Map();
for (const item of allItems) {
  const row = categoryMap.get(item.counterKey) || { expected: 0, recognized: 0 };
  row.expected += 1;
  row.recognized += item.recognized ? 1 : 0;
  categoryMap.set(item.counterKey, row);
}
const categories = Object.fromEntries([...categoryMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, row]) => [key, {
  ...row,
  recall: Number((row.recognized / Math.max(1, row.expected)).toFixed(4))
}]));

const closePairs = [];
for (let index = 1; index < events.length; index += 1) {
  const gapSeconds = events[index].timestamp - events[index - 1].timestamp;
  if (gapSeconds < 5) {
    closePairs.push({
      gapSeconds: Number(gapSeconds.toFixed(3)),
      first: `${events[index - 1].track}:${events[index - 1].id}`,
      second: `${events[index].track}:${events[index].id}`
    });
  }
}

queueDelays.sort((left, right) => left - right);
const percentile = (ratio) => queueDelays[Math.min(queueDelays.length - 1, Math.floor(queueDelays.length * ratio))] || 0;
const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  intervalMs: Number(interval),
  sources: {
    collectibles: "collectible-real-run-simulation-v2.json",
    centerCompletions: "live-replay-simulation.json",
    ipca: "ipca-pickup-first-event-20fps.json"
  },
  scope: {
    chronologicalEvents: events.length,
    expectedItems: allItems.length,
    tracks: {
      collectibles: events.filter((event) => event.track === "collectible").length,
      centerCompletions: events.filter((event) => event.track === "center-completion").length,
      verifiedIpca: events.filter((event) => event.track === "ipca").length
    }
  },
  summary: {
    recognizedItems: recognizedItems.length,
    missedItems: allItems.length - recognizedItems.length,
    combinedRecall: Number((recognizedItems.length / Math.max(1, allItems.length)).toFixed(4)),
    meanCapturePhasePassRate: Number((events.reduce((sum, event) => sum + event.capturePhasePassRate, 0) / Math.max(1, events.length)).toFixed(4)),
    maximumQueueDelayMs: Math.round(maximumQueueDelayMs),
    queueDelayP95Ms: percentile(0.95),
    staleDrops,
    closePairsUnderFiveSeconds: closePairs.length,
    crossTrackPairsUnderFiveSeconds: closePairs.filter((pair) => pair.first.split(":")[0] !== pair.second.split(":")[0]).length
  },
  categories,
  closePairs,
  misses: events.flatMap((event) => event.expectedItems.filter((item) => !item.recognized).map((item) => ({
    timestamp: event.timestamp,
    track: event.track,
    counterKey: item.counterKey,
    id: item.id,
    title: item.title
  }))),
  events
};

const output = path.join(simulationRoot, `combined-real-run-simulation-${interval}ms.json`);
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, scope: result.scope, summary: result.summary, categories: result.categories }, null, 2));
