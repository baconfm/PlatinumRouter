import fs from "node:fs";
import path from "node:path";

export const TRAINING_LOG_BUCKETS = Object.freeze([
  "control",
  "extraction",
  "dataset",
  "optimization",
  "metric",
  "review",
  "error"
]);

function cleanSegment(value, fallback) {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export function resolveTrainingLogContext({ trainingRoot = "", sessionId = "" } = {}) {
  const root = trainingRoot || process.env.DAYS_GONE_TRAINING_ROOT || "";
  const id = cleanSegment(sessionId || process.env.DAYS_GONE_TRAINING_SESSION_ID, "manual");
  const explicitDir = process.env.DAYS_GONE_TRAINING_LOG_DIR || "";
  const logDir = explicitDir || (root ? path.join(root, "logs", id) : "");
  return { trainingRoot: root, sessionId: id, logDir };
}

export function appendTrainingLog({
  bucket = "control",
  source = "training",
  status = "info",
  message = "",
  data = {},
  trainingRoot = "",
  sessionId = ""
} = {}) {
  const context = resolveTrainingLogContext({ trainingRoot, sessionId });
  if (!context.logDir) return null;
  const safeBucket = TRAINING_LOG_BUCKETS.includes(bucket) ? bucket : "control";
  const event = {
    at: new Date().toISOString(),
    sessionId: context.sessionId,
    bucket: safeBucket,
    source: String(source || "training"),
    status: String(status || "info"),
    message: String(message || ""),
    data: data && typeof data === "object" ? data : { value: data }
  };
  fs.mkdirSync(context.logDir, { recursive: true });
  const line = `${JSON.stringify(event)}\n`;
  fs.appendFileSync(path.join(context.logDir, "events.jsonl"), line, "utf8");
  fs.appendFileSync(path.join(context.logDir, `${safeBucket}.jsonl`), line, "utf8");
  return event;
}
