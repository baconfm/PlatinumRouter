import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trainingRoot = path.resolve(ROOT, process.argv[2] || "outputs/training/days-gone/20260718");
const logsRoot = path.join(trainingRoot, "logs");
const outputFile = path.join(trainingRoot, "training-log-analysis.json");

async function readEvents(file) {
  const events = [];
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Keep analysis available even if a run ended during an append.
    }
  }
  return events;
}

if (!fs.existsSync(logsRoot)) {
  console.error(`Training logs not found: ${logsRoot}`);
  process.exit(1);
}

const sessions = [];
for (const entry of fs.readdirSync(logsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sessionDir = path.join(logsRoot, entry.name);
  const eventsFile = path.join(sessionDir, "events.jsonl");
  if (!fs.existsSync(eventsFile)) continue;
  const events = await readEvents(eventsFile);
  const bucketCounts = {};
  for (const event of events) bucketCounts[event.bucket] = (bucketCounts[event.bucket] || 0) + 1;
  const started = events.find((event) => event.status === "run-started");
  const completed = [...events].reverse().find((event) => event.status === "run-completed");
  const failed = [...events].reverse().find((event) => event.bucket === "error");
  const selectedRounds = events.filter((event) => event.status === "new-best-model");
  const finalMetric = [...events].reverse().find((event) => event.status === "model-written");
  const phaseEvents = events.filter((event) => ["phase-completed", "phase-failed"].includes(event.status));
  sessions.push({
    sessionId: entry.name,
    startedAt: started?.at || events[0]?.at || "",
    completedAt: completed?.at || "",
    state: completed ? "completed" : failed ? "failed" : "incomplete",
    eventCount: events.length,
    bucketCounts,
    parameters: started?.data || {},
    phases: phaseEvents.map((event) => ({ status: event.status, message: event.message, at: event.at, ...event.data })),
    bestModelUpdates: selectedRounds.length,
    finalModel: finalMetric?.data || null,
    latestError: failed ? { at: failed.at, message: failed.message, data: failed.data } : null
  });
}

sessions.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
const completedSessions = sessions.filter((session) => session.state === "completed");
const deployableCandidates = sessions.filter((session) => session.finalModel?.deployableCandidate === true);
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  trainingRoot,
  totals: {
    sessions: sessions.length,
    completed: completedSessions.length,
    failed: sessions.filter((session) => session.state === "failed").length,
    incomplete: sessions.filter((session) => session.state === "incomplete").length,
    deployableCandidates: deployableCandidates.length
  },
  latestSession: sessions.at(-1) || null,
  bestDeployableCandidate: deployableCandidates
    .sort((left, right) => Number(right.finalModel?.validationMetrics?.specificity || 0) - Number(left.finalModel?.validationMetrics?.specificity || 0))[0] || null,
  sessions
};

fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputFile, ...report.totals, latestSession: report.latestSession?.sessionId || "" }, null, 2));
