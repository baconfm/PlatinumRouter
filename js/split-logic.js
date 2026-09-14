// split-logic.js

/**
 * Clamp number safely
 */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Normalize ONE split
 */
export function normalizeSplit(split = {}, index = 0) {
  return {
    // legacy compatibility
    ...split,

    id: split.id || `split_${index}`,
    label: split.label || `Split ${index + 1}`,

    // phase support (important for your system)
    phase:
      split.phase ||
      split.phaseId ||
      split.act ||
      null,

    note: split.note || "",

    // auto progress (CRITICAL)
    auto: normalizeAuto(split.auto),

    ocrGoals: normalizeOcrGoals(split.ocrGoals),
    ...(normalizeOcrCompletion(split.ocrCompletion)
      ? { ocrCompletion: normalizeOcrCompletion(split.ocrCompletion) }
      : {})
  };
}

/**
 * Normalize auto-progress object
 */
function normalizeAuto(auto) {
  if (!auto || typeof auto !== "object") return {};

  const result = {};

  Object.entries(auto).forEach(([key, value]) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    if (n === 0) return;

    result[key] = n;
  });

  return result;
}

function normalizeOcrGoals(goals) {
  if (!Array.isArray(goals)) return [];

  return goals
    .map((goal) => {
      if (typeof goal === "string") {
        return { id: goal.trim(), type: "" };
      }

      if (!goal || typeof goal !== "object") return null;

      return {
        id: String(goal.id || "").trim(),
        type: String(goal.type || "").trim(),
        label: String(goal.label || "").trim(),
        counterKey: String(goal.counterKey || "").trim(),
        optional: !!goal.optional,
        linkedCounters: Array.isArray(goal.linkedCounters)
          ? goal.linkedCounters
            .map((entry) => ({
              counterKey: String(entry?.counterKey || "").trim(),
              delta: Number(entry?.delta || 0)
            }))
            .filter((entry) => entry.counterKey && Number.isFinite(entry.delta) && entry.delta > 0)
          : []
      };
    })
    .filter((goal) => goal?.id || goal?.label);
}

function normalizeOcrCompletion(completion = null) {
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) return null;

  const mode = String(completion.mode || "").trim();
  const groups = Array.isArray(completion.groups)
    ? completion.groups
        .map((group) => Array.isArray(group)
          ? group.map((id) => String(id || "").trim()).filter(Boolean)
          : [])
        .filter((group) => group.length > 0)
    : [];

  if (!mode && !groups.length) return null;

  return {
    mode,
    groups
  };
}

/**
 * Normalize full split list
 * This FIXES your "default splits not loading" issue
 */
export function normalizeSplits(rawSplits, fallbackSplits = []) {
  let source = rawSplits;

  // ❗ KEY FIX: fallback to default splits if empty or invalid
  if (!Array.isArray(source) || source.length === 0) {
    source = fallbackSplits;
  }

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((split, i) => normalizeSplit(split, i));
}

/**
 * Get active phase based on current split
 */
export function getActivePhaseId(splits, currentIndex, phases = {}) {
  if (!Array.isArray(splits) || splits.length === 0) {
    return "legacy_all";
  }

  const index = clamp(currentIndex, 0, splits.length - 1);

  // walk backwards to find nearest phase
  for (let i = index; i >= 0; i--) {
    const split = splits[i];

    const phaseId =
      split?.phase ||
      split?.phaseId ||
      split?.act;

    if (phaseId && phases[phaseId]) {
      return phaseId;
    }
  }

  return "legacy_all";
}

/**
 * Apply auto progress to counters
 */
export function applyAutoProgress(counters, totals, autoMap = {}, direction = 1) {
  const result = { ...counters };

  Object.entries(autoMap).forEach(([key, amount]) => {
    if (!result[key]) return;

    const max = Number(totals?.[key] || 0);
    const current = Number(result[key]?.value || 0);
    const delta = Number(amount || 0) * direction;

    const next = clamp(current + delta, 0, max);

    result[key] = {
      ...result[key],
      value: next
    };
  });

  return result;
}

/**
 * Build split history entry
 */
export function buildSplitHistoryEntry(state, splitIndex, split) {
  const completed = state.splits?.completed || [];
  const previous = completed[completed.length - 1];

  const cumulativeMs = Number(state.timer?.elapsed || 0);
  const previousMs = Number(previous?.cumulativeMs || 0);

  return {
    splitIndex,
    label: split.label || `Split ${splitIndex + 1}`,
    cumulativeMs,
    segmentMs: Math.max(0, cumulativeMs - previousMs),
    autoApplied: { ...(split.auto || {}) },
    at: new Date().toISOString()
  };
}
