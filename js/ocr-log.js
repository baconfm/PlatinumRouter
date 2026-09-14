export const OCR_LOG_BUCKETS = Object.freeze([
  "confirmed",
  "candidate",
  "raw",
  "gibberish",
  "error",
  "control"
]);

function rawRegionText(regionTexts = []) {
  return (Array.isArray(regionTexts) ? regionTexts : [])
    .map((entry) => String(entry?.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function isLikelyOcrGibberish(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;

  const mojibakeCount = (text.match(/[\uFFFD\u00C3\u00C2\u00E2]/g) || []).length;
  const alphaNumericCount = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const symbolCount = (text.match(/[^\s\p{L}\p{N}]/gu) || []).length;
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const usefulWords = words.filter((word) => word.length >= 3);

  if (mojibakeCount >= 2) return true;
  if (alphaNumericCount < 3) return true;
  if (symbolCount > Math.max(5, alphaNumericCount * 0.75)) return true;
  if (words.length >= 3 && usefulWords.length === 0) return true;
  return false;
}

export function classifyOcrLogEvent({
  status = "scan",
  regionTexts = [],
  matches = [],
  applied = [],
  errors = []
} = {}) {
  if (Array.isArray(errors) && errors.length) return "error";
  if ((Array.isArray(applied) && applied.length) || status === "auto-applied") return "confirmed";
  if ((Array.isArray(matches) && matches.length) || ["match-logged", "duplicate"].includes(status)) {
    return "candidate";
  }
  if (["video-start", "video-stop", "run-reset"].includes(status)) return "control";

  const rawText = rawRegionText(regionTexts);
  if (!rawText) return null;
  return isLikelyOcrGibberish(rawText) ? "gibberish" : "raw";
}

export function buildOcrLogTimestamps(now, elapsedMs, bucket) {
  const capturedAt = new Date(now).toISOString();
  const runElapsedMs = Math.max(0, Number(elapsedMs || 0));
  const isRaw = bucket === "raw" || bucket === "gibberish";
  const isGibberish = bucket === "gibberish";

  return {
    capturedAt,
    runElapsedMs,
    rawTextAt: isRaw ? capturedAt : null,
    rawTextElapsedMs: isRaw ? runElapsedMs : null,
    gibberishAt: isGibberish ? capturedAt : null,
    gibberishElapsedMs: isGibberish ? runElapsedMs : null
  };
}

export function bucketOcrLogEntries(entries = []) {
  const buckets = Object.fromEntries(OCR_LOG_BUCKETS.map((bucket) => [bucket, []]));
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const bucket = OCR_LOG_BUCKETS.includes(entry?.eventBucket)
      ? entry.eventBucket
      : classifyOcrLogEvent({
          ...entry,
          regionTexts: entry?.regions || entry?.regionTexts || []
        }) || "raw";
    buckets[bucket].push(entry);
  });
  return buckets;
}
