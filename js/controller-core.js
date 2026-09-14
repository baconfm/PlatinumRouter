// js/controller-core.js

import { clamp, normalizeSplits, getActivePhaseId } from "./split-logic.js?v=20260724d";

export const DEFAULT_SETTINGS = {
  showDeathCounter: false
};

export const DEFAULT_MISC = {
  dirgeDone: false
};

export const DEFAULT_MANUAL_LOG = {
  nextId: 1,
  events: []
};

const MIN_FULL_RUN_ESTIMATE_PROGRESS = 0.1;

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function formatMs(ms) {
  const totalSeconds = Math.floor((ms || 0) / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function normalizeCounterState(counterDefs, rawCounters = {}, rawTotals = {}) {
  const counters = {};
  const totals = {};

  const readCounterValue = (key) => {
    const raw = rawCounters?.[key];
    return typeof raw === "object" ? Number(raw?.value || 0) : Number(raw || 0);
  };

  const readCounterManualDelta = (key) => {
    const raw = rawCounters?.[key];
    return typeof raw === "object" ? Number(raw?.manualDelta || 0) : 0;
  };

  Object.entries(counterDefs || {}).forEach(([key, def]) => {
    const hasRawValue = Object.prototype.hasOwnProperty.call(rawCounters || {}, key);
    const rawValue =
      key === "nerosites" && !hasRawValue
        ? readCounterValue("nerocheckpoints") + readCounterValue("neroresearchsites")
        : readCounterValue(key);

    const rawManualDelta =
      key === "nerosites" && !hasRawValue
        ? readCounterManualDelta("nerocheckpoints") + readCounterManualDelta("neroresearchsites")
        : readCounterManualDelta(key);

    const max = Number(rawTotals[key] || def.max || 0);

    counters[key] = {
      value: Number.isFinite(rawValue) ? clamp(rawValue, 0, max) : 0,
      manualDelta: Number.isFinite(rawManualDelta) ? rawManualDelta : 0
    };

    totals[key] = max;
  });

  return { counters, totals };
}

export function getRawSplitItems(raw = {}) {
  const rawSplitBlock = raw.splits || {};

  if (Array.isArray(rawSplitBlock.items)) {
    return rawSplitBlock.items;
  }

  if (Array.isArray(raw.splits)) {
    return raw.splits;
  }

  return [];
}

export function getActivePhase(state, gameData = {}) {
  const items = state?.splits?.items || [];
  const currentIndex = Number(state?.splits?.currentIndex || 0);
  return getActivePhaseId(items, currentIndex, gameData?.phases || {});
}

export function normalizeManualLogState(rawManualLog = {}) {
  const source =
    rawManualLog && typeof rawManualLog === "object" && !Array.isArray(rawManualLog)
      ? rawManualLog
      : DEFAULT_MANUAL_LOG;

  const events = Array.isArray(source.events)
    ? source.events.map((event) => ({
        id: Math.max(0, Number(event?.id || 0)),
        counterKey: typeof event?.counterKey === "string" ? event.counterKey : "",
        delta: Number(event?.delta || 0),
        valueAfter: Math.max(0, Number(event?.valueAfter || 0)),
        splitIndex: Math.max(0, Number(event?.splitIndex || 0)),
        splitId: typeof event?.splitId === "string" ? event.splitId : "",
        splitLabel: typeof event?.splitLabel === "string" ? event.splitLabel : "",
        phaseId: typeof event?.phaseId === "string" ? event.phaseId : "",
        elapsedMs: Math.max(0, Number(event?.elapsedMs || 0)),
        at: typeof event?.at === "string" ? event.at : "",
        source: typeof event?.source === "string" ? event.source : "",
        countsAgainstSplitAuto: event?.countsAgainstSplitAuto === true,
        assignedCompletionIndex:
          Number.isFinite(Number(event?.assignedCompletionIndex)) &&
          Number(event?.assignedCompletionIndex) >= 0
            ? Math.floor(Number(event.assignedCompletionIndex))
            : null,
        completedAt: typeof event?.completedAt === "string" ? event.completedAt : ""
      }))
    : [];

  const highestId = events.reduce((max, event) => Math.max(max, Number(event.id || 0)), 0);
  const requestedNextId = Number(source.nextId || 0);

  return {
    nextId: Math.max(
      highestId + 1,
      Number.isFinite(requestedNextId) && requestedNextId > 0 ? Math.floor(requestedNextId) : 1
    ),
    events
  };
}

export function getPhaseTargetMinutes(phaseId, gameData = {}) {
  const phase = gameData?.phases?.[phaseId];
  const rawValue =
    phase?.targetMinutes ??
    phase?.paceTargetMinutes ??
    phase?.actTargetMinutes ??
    null;

  const minutes = Number(rawValue);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  const routeTargetMs = getRoutePaceTargetMs(gameData);
  const largestPhaseTargetMinutes = Object.values(gameData?.phases || {}).reduce((largest, def) => {
    const value = Number(def?.targetMinutes || 0);
    return Number.isFinite(value) && value > 0 ? Math.max(largest, value) : largest;
  }, 0);

  return routeTargetMs > 0 && largestPhaseTargetMinutes > 0
    ? minutes * ((routeTargetMs / 60000) / largestPhaseTargetMinutes)
    : minutes;
}

export function getDefaultTimerElapsedMs(gameData = {}) {
  const elapsedMs = Number(gameData?.meta?.defaultTimerElapsedMs || 0);
  return Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
}

export function getRoutePaceTargetMs(gameData = {}) {
  const targetMs = Number(gameData?.meta?.paceTargetMs || 0);
  return Number.isFinite(targetMs) && targetMs > 0 ? targetMs : 0;
}

function isPristineRawState(raw = {}) {
  const rawSplitBlock = raw?.splits || {};
  const completed = Array.isArray(rawSplitBlock.completed) ? rawSplitBlock.completed : [];
  const rawSplitItems = getRawSplitItems(raw);
  const rawCounters = raw?.counters || {};

  return (
    Number(raw?.timer?.elapsed || 0) === 0 &&
    !raw?.timer?.running &&
    Number(rawSplitBlock.currentIndex || 0) === 0 &&
    completed.length === 0 &&
    rawSplitItems.length === 0 &&
    Object.keys(rawCounters).length === 0
  );
}

export function buildInitialState(raw = {}, gameData = {}, gameId = "ghost-of-tsushima", routeId = "") {
  const normalized = normalizeCounterState(
    gameData?.counters || {},
    raw.counters || {},
    raw.totals || {}
  );

  const rawSplitBlock = raw.splits || {};
  const rawSplitItems = getRawSplitItems(raw);
  const defaultSplits = Array.isArray(gameData?.defaultSplits) ? gameData.defaultSplits : [];
  const hasSavedSplits = Array.isArray(rawSplitItems) && rawSplitItems.length > 0;
  const useSavedSplitItems =
    rawSplitBlock.useSavedItems === true ||
    rawSplitBlock.source === "imported";

  const splitSource =
    useSavedSplitItems && hasSavedSplits
      ? rawSplitItems
      : defaultSplits.length
        ? defaultSplits
        : rawSplitItems;

  const splits = normalizeSplits(splitSource, defaultSplits);
  const splitCount = splits.length;

  const running = !!raw.timer?.running;
  const rawElapsed = Math.max(0, Number(raw.timer?.elapsed || 0));
  const elapsed =
    rawElapsed > 0 || !isPristineRawState(raw)
      ? rawElapsed
      : getDefaultTimerElapsedMs(gameData);
  const startTime = running
    ? Number(raw.timer?.startTime || Date.now() - elapsed)
    : null;

  const currentIndex = clamp(
    Number(rawSplitBlock.currentIndex || 0),
    0,
    Math.max(0, splitCount)
  );

  const state = {
    timer: {
      startTime,
      elapsed,
      running
    },

    counters: normalized.counters,
    totals: normalized.totals,

    splits: {
      currentIndex,
      completed: Array.isArray(rawSplitBlock.completed) ? rawSplitBlock.completed : [],
      items: splits,
      useSavedItems: useSavedSplitItems && hasSavedSplits
    },

    phase: raw.phase || "legacy_all",

    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw.settings || {})
    },

    misc: {
      ...DEFAULT_MISC,
      ...(raw.misc || {})
    },

    manualLog: normalizeManualLogState(raw.manualLog),

    ui: {
      settingsOpen: raw?.ui?.settingsOpen ?? false
    },

    gameId,
    routeId: routeId || raw.routeId || ""
  };

  state.phase = getActivePhase(state, gameData);

  return state;
}

export function getCurrentStateFactory({ getState, gameData, gameId, routeId = "" }) {
  return function getCurrentState() {
    return buildInitialState(getState(), gameData, gameId, routeId);
  };
}

export function computePaceText(state, gameData = {}) {
  const phaseId = state?.phase || "legacy_all";
  const phaseTargetMinutes = getPhaseTargetMinutes(phaseId, gameData);

  if (!phaseTargetMinutes) {
    return "No target";
  }

  const targetMs = phaseTargetMinutes * 60 * 1000;
  const diff = Number(state?.timer?.elapsed || 0) - targetMs;

  if (Math.abs(diff) < 1000) return "On pace";
  if (diff < 0) return `${formatMs(Math.abs(diff))} ahead`;
  return `${formatMs(diff)} behind`;
}

function getSplitPhaseId(split) {
  return split?.phase || split?.phaseId || split?.act || "";
}

function buildEffectiveSplitPhaseIds(splits = [], phases = {}) {
  const hasPhaseDefs = phases && Object.keys(phases).length > 0;
  let activePhaseId = "";

  const phaseIds = splits.map((split) => {
    const phaseId = getSplitPhaseId(split);

    if (phaseId && (!hasPhaseDefs || phases[phaseId])) {
      const activeTarget = Number(phases?.[activePhaseId]?.targetMinutes || 0);
      const nextTarget = Number(phases?.[phaseId]?.targetMinutes || 0);
      if (!activePhaseId || !hasPhaseDefs || nextTarget >= activeTarget) {
        activePhaseId = phaseId;
      }
    }

    return activePhaseId;
  });

  const firstAssignedPhaseId = phaseIds.find(Boolean) || "";
  if (firstAssignedPhaseId) {
    for (let index = 0; index < phaseIds.length && !phaseIds[index]; index += 1) {
      phaseIds[index] = firstAssignedPhaseId;
    }
  }

  return phaseIds;
}

function getPaceWeight(counterDefs = {}, key = "") {
  const weight = Number(counterDefs?.[key]?.paceWeight || 0);
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function getSplitObjectiveWeight(split = {}, counterDefs = {}) {
  return Object.entries(split?.auto || {}).reduce((sum, [key, rawAmount]) => {
    const amount = Math.max(0, Number(rawAmount || 0));
    const weight = getPaceWeight(counterDefs, key);
    return sum + amount * weight;
  }, 0);
}

function getSplitPaceCost(split = {}, counterDefs = {}) {
  const rawBase = Number(split?.paceBaseWeight);
  const base = Number.isFinite(rawBase) ? Math.max(0, rawBase) : 1;
  return base + getSplitObjectiveWeight(split, counterDefs);
}

function getExplicitSplitTargetMs(split = {}) {
  const rawValue =
    split?.paceTargetMs ??
    split?.targetCumulativeMs ??
    split?.paceTargetCumulativeMs ??
    null;
  const targetMs = Number(rawValue);
  return Number.isFinite(targetMs) && targetMs > 0 ? targetMs : null;
}

function getRoutePhaseOrder(phaseIds = []) {
  const seen = new Set();
  const order = [];

  phaseIds.forEach((phaseId) => {
    if (!phaseId || seen.has(phaseId)) return;
    seen.add(phaseId);
    order.push(phaseId);
  });

  return order;
}

function buildSplitPacePlan(
  splits = [],
  phases = {},
  counterDefs = {},
  initialTargetMs = 0,
  routeTargetMs = 0
) {
  const effectivePhaseIds = buildEffectiveSplitPhaseIds(splits, phases);
  const phaseOrder = getRoutePhaseOrder(effectivePhaseIds);
  const plan = Array(splits.length).fill(null);
  let previousPhaseTargetMs = Math.max(0, Number(initialTargetMs || 0));
  const largestPhaseTargetMs = Object.values(phases || {}).reduce((largest, phase) => {
    const minutes = Number(phase?.targetMinutes || 0);
    return Number.isFinite(minutes) && minutes > 0
      ? Math.max(largest, minutes * 60 * 1000)
      : largest;
  }, 0);
  const requestedRouteTargetMs = Number(routeTargetMs || 0);
  const phaseTargetScale =
    requestedRouteTargetMs > 0 && largestPhaseTargetMs > 0
      ? requestedRouteTargetMs / largestPhaseTargetMs
      : 1;

  phaseOrder.forEach((phaseId) => {
    const phaseIndexes = splits
      .map((split, index) => ({ split, index }))
      .filter((entry) => effectivePhaseIds[entry.index] === phaseId);

    if (!phaseIndexes.length) return;

    const explicitTargets = phaseIndexes.map(({ split }) => getExplicitSplitTargetMs(split));
    const hasExplicitTargets = explicitTargets.every((targetMs) => targetMs !== null);
    const phaseTargetMinutes = Number(phases?.[phaseId]?.targetMinutes || 0);
    const phaseTargetMs =
      Number.isFinite(phaseTargetMinutes) && phaseTargetMinutes > 0
        ? phaseTargetMinutes * 60 * 1000 * phaseTargetScale
        : previousPhaseTargetMs;

    if (hasExplicitTargets) {
      phaseIndexes.forEach(({ split, index }, localIndex) => {
        plan[index] = {
          phaseId,
          targetCumulativeMs: explicitTargets[localIndex],
          phaseTargetMs,
          cost: getSplitPaceCost(split, counterDefs)
        };
      });

      previousPhaseTargetMs = Math.max(
        previousPhaseTargetMs,
        Number(explicitTargets[explicitTargets.length - 1] || 0),
        phaseTargetMs
      );
      return;
    }

    const phaseBudgetMs = Math.max(0, phaseTargetMs - previousPhaseTargetMs);
    const costs = phaseIndexes.map(({ split }) => getSplitPaceCost(split, counterDefs));
    const totalCost = costs.reduce((sum, cost) => sum + cost, 0) || phaseIndexes.length || 1;
    let runningTargetMs = previousPhaseTargetMs;

    phaseIndexes.forEach(({ index }, localIndex) => {
      runningTargetMs += phaseBudgetMs * (costs[localIndex] / totalCost);
      plan[index] = {
        phaseId,
        targetCumulativeMs: runningTargetMs,
        phaseTargetMs,
        cost: costs[localIndex]
      };
    });

    previousPhaseTargetMs = Math.max(previousPhaseTargetMs, phaseTargetMs);
  });

  return plan;
}

function getFinalPlanTargetMs(plan = []) {
  const targetMs = plan.reduce((largest, entry) => {
    const targetMs = Number(entry?.targetCumulativeMs || 0);
    return targetMs > 0 ? Math.max(largest, targetMs) : largest;
  }, 0);
  return Math.round(targetMs);
}

function getRoutePaceTotals(plan = [], currentIndex = 0, currentSplitProgress = 0) {
  const totalCost = plan.reduce((sum, entry) => sum + Math.max(0, Number(entry?.cost || 0)), 0);
  const completedCost = plan.reduce((sum, entry, index) => {
    const cost = Math.max(0, Number(entry?.cost || 0));

    if (index < currentIndex) return sum + cost;
    if (index === currentIndex) return sum + cost * clamp(Number(currentSplitProgress || 0), 0, 1);
    return sum;
  }, 0);

  return {
    completedCost,
    totalCost,
    ratio: totalCost > 0 ? clamp(completedCost / totalCost, 0, 1) : 0
  };
}

function getOverallObjectivePaceTotals(state = {}, gameData = {}) {
  const counterDefs = gameData?.counters || {};
  const configuredKeys = gameData?.meta?.overallCounterKeys;
  const keys = Array.isArray(configuredKeys) && configuredKeys.length
    ? configuredKeys
    : Object.keys(counterDefs);

  return keys.reduce((progress, key) => {
    const def = counterDefs?.[key] || {};
    if (key === "deaths" || def?.nonProgress) return progress;

    const max = Math.max(0, Number(def?.max || state?.counters?.[key]?.max || 0));
    if (!max) return progress;

    const value = clamp(Number(state?.counters?.[key]?.value || 0), 0, max);
    progress.completed += value;
    progress.total += max;
    progress.ratio = progress.total > 0 ? progress.completed / progress.total : 0;
    return progress;
  }, { completed: 0, total: 0, ratio: 0 });
}

function countBenchmarkEventsAt(timestampsMs = [], targetMs = 0) {
  let low = 0;
  let high = timestampsMs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestampsMs[middle] <= targetMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function computeHistoricalPaceBenchmark(state = {}, gameData = {}, elapsedMs = 0) {
  const benchmark = gameData?.paceBenchmark;
  const finishMs = Number(benchmark?.finishMs || 0);
  const entries = Object.entries(benchmark?.counters || {}).filter(([, entry]) =>
    Number(entry?.max || 0) > 0 &&
    Number(entry?.weight || 0) > 0 &&
    Array.isArray(entry?.timestampsMs) &&
    entry.timestampsMs.length
  );
  if (!finishMs || !entries.length) return null;

  const candidates = new Set([0, finishMs]);
  entries.forEach(([, entry]) => {
    entry.timestampsMs.forEach((timestampMs) => candidates.add(Number(timestampMs || 0)));
  });

  let bestTimeMs = 0;
  let bestScore = Infinity;
  let totalWeight = 0;
  let coveredWeight = 0;
  let activeWeight = 0;

  entries.forEach(([counterKey, entry]) => {
    const weight = Number(entry.weight || 0);
    totalWeight += weight;
    coveredWeight += weight * clamp(Number(entry.coverage || 0), 0, 1);
    if (Number(state?.counters?.[counterKey]?.value || 0) > 0) activeWeight += weight;
  });

  [...candidates].sort((a, b) => a - b).forEach((candidateMs) => {
    let score = 0;
    entries.forEach(([counterKey, entry]) => {
      const max = Number(entry.max || 0);
      const currentFraction = clamp(
        Number(state?.counters?.[counterKey]?.value || 0) / max,
        0,
        1
      );
      const detectedCount = countBenchmarkEventsAt(entry.timestampsMs, candidateMs);
      const expectedFraction = clamp(
        detectedCount / Math.max(1, Number(entry.sourceCount || entry.timestampsMs.length)),
        0,
        1
      );
      const difference = currentFraction - expectedFraction;
      score += Number(entry.weight || 0) * difference * difference;
    });

    // Prefer an equally good point close to the live clock instead of the
    // beginning of a long PB plateau.
    score += (Math.abs(candidateMs - elapsedMs) / finishMs) * 0.002;
    if (score < bestScore) {
      bestScore = score;
      bestTimeMs = candidateMs;
    }
  });

  const rawDiffMs = elapsedMs - bestTimeMs;
  const coverageFactor = totalWeight > 0 ? coveredWeight / totalWeight : 0;
  const activeFactor = totalWeight > 0 ? activeWeight / totalWeight : 0;
  const elapsedFactor = clamp(elapsedMs / (finishMs * 0.65), 0.12, 1);
  const confidence = clamp(
    coverageFactor * elapsedFactor * (0.55 + activeFactor * 0.45),
    0.08,
    1
  );
  const maximumSwingMs =
    15 * 60 * 1000 +
    90 * 60 * 1000 * clamp(elapsedMs / finishMs, 0, 1);
  const projectedDiffMs = clamp(rawDiffMs * confidence, -maximumSwingMs, maximumSwingMs);

  return {
    label: String(benchmark.label || "PB"),
    finishMs,
    equivalentTimeMs: bestTimeMs,
    rawDiffMs,
    projectedDiffMs,
    confidence,
    score: bestScore,
    counterCount: entries.length
  };
}

function getLastCompletedCumulativeMs(state = {}, fallbackMs = 0) {
  const completed = Array.isArray(state?.splits?.completed) ? state.splits.completed : [];

  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const cumulativeMs = Number(completed[index]?.cumulativeMs);
    if (Number.isFinite(cumulativeMs) && cumulativeMs >= 0) {
      return cumulativeMs;
    }
  }

  return fallbackMs;
}

function getLastProgressElapsedMs(state = {}, fallbackMs = 0) {
  const completedMs = getLastCompletedCumulativeMs(state, fallbackMs);
  const manualEvents = Array.isArray(state?.manualLog?.events) ? state.manualLog.events : [];
  const manualMs = manualEvents.reduce((latest, event) => {
    const elapsedMs = Number(event?.elapsedMs);
    return Number.isFinite(elapsedMs) && elapsedMs >= 0
      ? Math.max(latest, elapsedMs)
      : latest;
  }, fallbackMs);

  return Math.max(fallbackMs, completedMs, manualMs);
}

function getPlannedCounterTotalsBeforeSplit(splits = [], splitIndex = 0) {
  const totals = {};

  splits.slice(0, Math.max(0, splitIndex)).forEach((split) => {
    Object.entries(split?.auto || {}).forEach(([key, rawAmount]) => {
      const amount = Math.max(0, Number(rawAmount || 0));
      if (!amount) return;
      totals[key] = Number(totals[key] || 0) + amount;
    });
  });

  return totals;
}

function getLastCompletedCounterSnapshot(state = {}) {
  const completed = Array.isArray(state?.splits?.completed) ? state.splits.completed : [];

  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const snapshot = completed[index]?.counterSnapshot;
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      return snapshot;
    }
  }

  return null;
}

function getCompletedAppliedCounterTotals(state = {}) {
  const completed = Array.isArray(state?.splits?.completed) ? state.splits.completed : [];
  const totals = {};

  completed.forEach((entry) => {
    [entry?.autoApplied, entry?.manualApplied].forEach((deltaMap) => {
      Object.entries(deltaMap || {}).forEach(([key, rawAmount]) => {
        const amount = Number(rawAmount || 0);
        if (!Number.isFinite(amount) || amount === 0) return;
        totals[key] = Number(totals[key] || 0) + amount;
      });
    });
  });

  return totals;
}

function hasCompressedRecentCompletions(state = {}) {
  const completed = Array.isArray(state?.splits?.completed) ? state.splits.completed : [];
  if (completed.length < 2) return false;

  const recent = completed.slice(-4);
  const compressedCount = recent.filter((entry) => Number(entry?.segmentMs || 0) <= 1000).length;
  if (compressedCount >= 2) return true;

  const last = recent[recent.length - 1];
  const lastMs = Number(last?.cumulativeMs || 0);
  if (!Number.isFinite(lastMs) || lastMs <= 0) return false;

  const sameTimestampCount = recent.filter((entry) => Number(entry?.cumulativeMs || 0) === lastMs).length;
  return sameTimestampCount >= 3;
}

function getCurrentSplitWeightedProgress({
  split,
  baselineCounters,
  currentCounters,
  counterDefs
}) {
  let completedWeight = 0;
  let totalWeight = 0;

  Object.entries(split?.auto || {}).forEach(([key, rawAmount]) => {
    const plannedDelta = Math.max(0, Number(rawAmount || 0));
    const weight = getPaceWeight(counterDefs, key);
    if (plannedDelta <= 0 || weight <= 0) return;

    const currentValue = Number(currentCounters?.[key]?.value || 0);
    const beforeValue = Number(baselineCounters?.[key] || 0);
    const completedDelta = clamp(currentValue - beforeValue, 0, plannedDelta);

    completedWeight += completedDelta * weight;
    totalWeight += plannedDelta * weight;
  });

  return {
    completedWeight,
    totalWeight,
    ratio: totalWeight > 0 ? clamp(completedWeight / totalWeight, 0, 1) : 0
  };
}

export function computeObjectivePaceEstimate(state, gameData = {}) {
  const splits = state?.splits?.items || [];
  const counterDefs = gameData?.counters || {};
  const phases = gameData?.phases || {};

  if (!splits.length) return null;

  const plan = buildSplitPacePlan(
    splits,
    phases,
    counterDefs,
    getDefaultTimerElapsedMs(gameData),
    getRoutePaceTargetMs(gameData)
  );
  const currentIndex = clamp(
    Number(state?.splits?.currentIndex || 0),
    0,
    splits.length
  );
  const elapsedMs = Number(state?.timer?.elapsed || 0);
  const historicalBenchmark = computeHistoricalPaceBenchmark(state, gameData, elapsedMs);

  if (currentIndex >= splits.length) {
    const finalTargetMs =
      Number(historicalBenchmark?.finishMs || 0) ||
      getFinalPlanTargetMs(plan);
    if (!finalTargetMs) return null;

    return {
      kind: "objective",
      status: "complete",
      diffMs: elapsedMs - finalTargetMs,
      fullRunDiffMs: elapsedMs - finalTargetMs,
      fullRunEstimateMs: elapsedMs,
      fullRunTargetMs: finalTargetMs,
      fullRunEstimateReady: true,
      fullRunEstimateMinProgress: MIN_FULL_RUN_ESTIMATE_PROGRESS,
      routeProgress: 1,
      elapsedMs,
      targetNowMs: finalTargetMs,
      splitEstimateMs: elapsedMs,
      targetSplitMs: finalTargetMs,
      previousTargetMs: finalTargetMs,
      splitProgress: 1,
      currentSplitLabel: "Run complete"
    };
  }

  const currentSplit = splits[currentIndex];
  const currentPlan = plan[currentIndex];
  if (!currentPlan?.targetCumulativeMs) return null;

  const routeStartMs = getDefaultTimerElapsedMs(gameData);
  const finalTargetMs = getFinalPlanTargetMs(plan);
  const fullRunTargetMs =
    Number(historicalBenchmark?.finishMs || 0) ||
    finalTargetMs;
  const previousTargetMs =
    currentIndex > 0
      ? Number(plan[currentIndex - 1]?.targetCumulativeMs || 0)
      : routeStartMs;
  const splitTargetMs = Number(currentPlan.targetCumulativeMs || previousTargetMs);
  const plannedBefore = getPlannedCounterTotalsBeforeSplit(splits, currentIndex);
  const completedAppliedCounters = getCompletedAppliedCounterTotals(state);
  const splitStartCounters =
    getLastCompletedCounterSnapshot(state) ||
    (Object.keys(completedAppliedCounters).length ? completedAppliedCounters : plannedBefore);
  const splitProgress = getCurrentSplitWeightedProgress({
    split: currentSplit,
    baselineCounters: splitStartCounters,
    currentCounters: state?.counters || {},
    counterDefs
  });
  const hasMeasuredSplitProgress =
    splitProgress.totalWeight > 0 && splitProgress.completedWeight > 0;
  const targetNowMs = hasMeasuredSplitProgress
    ? previousTargetMs + (splitTargetMs - previousTargetMs) * splitProgress.ratio
    : splitTargetMs;
  const diffMs = elapsedMs - targetNowMs;
  const splitStartMs =
    currentIndex > 0
      ? getLastCompletedCumulativeMs(state, routeStartMs)
      : routeStartMs;
  const objectivePace = getOverallObjectivePaceTotals(state, gameData);
  const progressElapsedMs = elapsedMs;
  const hasReliableTiming = true;
  const fullRunEstimateReady =
    fullRunTargetMs > 0 &&
    currentIndex > 0 &&
    hasReliableTiming;
  // Objective completion is deliberately not used to extrapolate the finish.
  // Days Gone's optional objectives are clustered around a much longer mandatory
  // story route, so elapsed / objective-percent can produce impossible forecasts.
  // Prefer the non-linear PB category benchmark. If a game has no benchmark,
  // carry forward measured route-split variance instead. While the current split
  // has no measurable progress, anchor to the last completed split rather than
  // treating all time before the current split's due time as banked time.
  const completedSplitDiffMs = splitStartMs - previousTargetMs;
  const splitProjectedDiffMs = hasMeasuredSplitProgress ? diffMs : completedSplitDiffMs;
  const projectedDiffMs = historicalBenchmark
    ? historicalBenchmark.projectedDiffMs
    : splitProjectedDiffMs;
  const fullRunEstimateMs =
    fullRunEstimateReady
      ? Math.max(elapsedMs, fullRunTargetMs + projectedDiffMs)
      : fullRunTargetMs;
  const splitElapsedMs = Math.max(0, elapsedMs - splitStartMs);
  const splitEstimateMs =
    hasMeasuredSplitProgress && splitProgress.ratio > 0
      ? splitStartMs + (splitElapsedMs / splitProgress.ratio)
      : splitTargetMs;

  return {
    kind: "objective",
    status: "live",
    diffMs,
    fullRunDiffMs: projectedDiffMs,
    fullRunEstimateMs,
    fullRunTargetMs,
    fullRunEstimateReady,
    fullRunEstimateBlockedReason:
      currentIndex <= 0
        ? "Complete the first route split"
        : hasReliableTiming
          ? ""
          : "Recent split history was compressed after route edits",
    fullRunEstimateMinProgress: MIN_FULL_RUN_ESTIMATE_PROGRESS,
    paceBenchmarkLabel: historicalBenchmark?.label || "",
    paceBenchmarkEquivalentMs: historicalBenchmark?.equivalentTimeMs || 0,
    paceBenchmarkRawDiffMs: historicalBenchmark?.rawDiffMs || 0,
    paceBenchmarkConfidence: historicalBenchmark?.confidence || 0,
    paceBenchmarkCounterCount: historicalBenchmark?.counterCount || 0,
    routeProgress: objectivePace.ratio,
    routeCompletedCost: objectivePace.completed,
    routeTotalCost: objectivePace.total,
    progressElapsedMs,
    elapsedMs,
    targetNowMs,
    splitEstimateMs,
    targetSplitMs: splitTargetMs,
    previousTargetMs,
    splitStartMs,
    compareMode: hasMeasuredSplitProgress ? "weighted-progress" : "split-due",
    splitProgress: splitProgress.ratio,
    completedWeight: splitProgress.completedWeight,
    totalWeight: splitProgress.totalWeight,
    currentSplitLabel: currentSplit?.label || `Split ${currentIndex + 1}`
  };
}

function formatVariance(diffMs, { buffer = false, suffix = "" } = {}) {
  const diff = Number(diffMs || 0);
  const absDiffText = formatMs(Math.abs(diff));

  if (Math.abs(diff) < 1000) return suffix ? `On ${suffix}` : "On target";
  if (buffer && diff < 0) return `${absDiffText} buffer`;
  if (diff < 0) return `${absDiffText} ahead`;
  return suffix ? `${absDiffText} behind ${suffix}` : `${absDiffText} behind`;
}

export function computeDashboardPace(state, gameData = {}) {
  const estimate = computeObjectivePaceEstimate(state, gameData);

  if (estimate) {
    const diff = Number(estimate.diffMs || 0);
    const fullRunDiff = Number(estimate.fullRunDiffMs ?? diff);
    const fullRunReady = estimate.fullRunEstimateReady !== false;
    const minProgressPercent = Math.round(
      clamp(Number(estimate.fullRunEstimateMinProgress || MIN_FULL_RUN_ESTIMATE_PROGRESS), 0, 1) * 100
    );
    const fullRunBlockedReason = estimate.fullRunEstimateBlockedReason || "";
    const label = !fullRunReady
      ? "Collecting pace"
      : estimate.fullRunEstimateMs
      ? `Est finish ${formatMs(estimate.fullRunEstimateMs)}`
      : formatVariance(fullRunDiff);
    const tone =
      !fullRunReady
        ? "neutral"
        : Math.abs(fullRunDiff) < 1000
        ? "on"
        : fullRunDiff < 0
          ? "ahead"
          : "behind";
    const splitPercent = Math.round(clamp(Number(estimate.splitProgress || 0), 0, 1) * 100);
    const routePercent = Math.round(clamp(Number(estimate.routeProgress || 0), 0, 1) * 100);

    const detailTargetLabel = estimate.compareMode === "split-due" ? "Due" : "Target now";
    const hasProjectedSplit = estimate.compareMode === "weighted-progress";
    const splitDiff = hasProjectedSplit
      ? Number(estimate.splitEstimateMs || estimate.targetSplitMs || 0) -
        Number(estimate.targetSplitMs || 0)
      : diff;
    const splitStatus = formatVariance(diff, {
      buffer: !hasProjectedSplit && estimate.compareMode === "split-due",
      suffix: !hasProjectedSplit && estimate.compareMode === "split-due" ? "split" : ""
    });
    const projectedSplitStatus = hasProjectedSplit
      ? formatVariance(splitDiff)
      : splitStatus;
    const fullRunStatus = fullRunReady
      ? formatVariance(fullRunDiff)
      : fullRunBlockedReason || `needs ${minProgressPercent}% route`;
    const benchmarkConfidencePercent = Math.round(
      clamp(Number(estimate.paceBenchmarkConfidence || 0), 0, 1) * 100
    );
    const detail = estimate.paceBenchmarkLabel
      ? `${estimate.paceBenchmarkLabel} equivalent ${formatMs(estimate.paceBenchmarkEquivalentMs)} | ${benchmarkConfidencePercent}% confidence | split ${splitPercent}%`
      : `Objectives ${routePercent}% | split ${splitPercent}% | ${detailTargetLabel} ${formatMs(estimate.targetNowMs)}`;

    return {
      ...estimate,
      label,
      tone,
      splitEstimate: `${formatMs(estimate.splitEstimateMs || estimate.targetSplitMs)} | ${projectedSplitStatus}`,
      runEstimate: estimate.fullRunTargetMs
        ? fullRunReady
          ? `${formatMs(estimate.fullRunEstimateMs || estimate.fullRunTargetMs)} | ${fullRunStatus}`
          : `${formatMs(estimate.fullRunTargetMs)} target | ${fullRunStatus}`
        : fullRunStatus,
      detail
    };
  }

  return {
    kind: "phase",
    label: computePaceText(state, gameData),
    tone: "neutral",
    splitEstimate: "No split estimate",
    runEstimate: "No full-run estimate",
    detail: "Phase target only"
  };
}

export function computeRouteHealth(state = {}, gameData = {}) {
  const issues = [];
  const splits = Array.isArray(state?.splits?.items) ? state.splits.items : [];
  const currentIndex = clamp(Number(state?.splits?.currentIndex || 0), 0, Math.max(0, splits.length));
  const currentSplit = currentIndex < splits.length ? splits[currentIndex] : null;
  const counterDefs = gameData?.counters || {};
  const currentAuto = currentSplit?.auto || {};

  function addIssue(tone, title, detail) {
    issues.push({ tone, title, detail });
  }

  if (state?.splits?.useSavedItems) {
    addIssue(
      "warn",
      "Imported split list active",
      "This run is using saved split items instead of the route file. Route edits may not match the active run."
    );
  }

  if (hasCompressedRecentCompletions(state)) {
    addIssue(
      "warn",
      "Pace projection paused",
      "Recent splits were completed at the same timestamp or near-zero duration, usually after route edits or catch-up logging."
    );
  }

  if (currentSplit && !Object.keys(currentAuto).length) {
    addIssue(
      "info",
      "No split objectives",
      "The current split has notes but no planned counter changes."
    );
  }

  if (currentSplit) {
    const plannedBefore = getPlannedCounterTotalsBeforeSplit(splits, currentIndex);
    const completedAppliedCounters = getCompletedAppliedCounterTotals(state);
    const splitStartCounters =
      getLastCompletedCounterSnapshot(state) ||
      (Object.keys(completedAppliedCounters).length ? completedAppliedCounters : plannedBefore);
    const splitProgress = getCurrentSplitWeightedProgress({
      split: currentSplit,
      baselineCounters: splitStartCounters,
      currentCounters: state?.counters || {},
      counterDefs
    });

    if (splitProgress.totalWeight > 0 && splitProgress.ratio >= 1) {
      addIssue(
        "warn",
        "Current split objectives already met",
        "The weighted counters for this split are already at their post-split values. Complete the split or check if route order changed."
      );
    }
  }

  const completedApplied = getCompletedAppliedCounterTotals(state);
  Object.entries(completedApplied).forEach(([key, plannedValue]) => {
    const def = counterDefs?.[key];
    if (!def) return;

    const actual = Number(state?.counters?.[key]?.value || 0);
    const planned = Number(plannedValue || 0);
    const label = def.shortLabel || def.queueLabel || def.label || key;

    if (actual > planned) {
      addIssue(
        "info",
        `${label} ahead of completed route`,
        `${actual}/${Number(def.max || 0)} tracked, ${planned} expected from completed splits. This is fine after manual pickups, but it can affect objective pace.`
      );
    } else if (actual < planned) {
      addIssue(
        "warn",
        `${label} behind completed route`,
        `${actual}/${Number(def.max || 0)} tracked, ${planned} expected from completed splits. Check missed undo/manual corrections.`
      );
    }
  });

  return {
    ok: issues.every((issue) => issue.tone !== "warn" && issue.tone !== "error"),
    issues
  };
}

export function summarizeManualEvents(events = []) {
  const totals = {};

  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = typeof event?.counterKey === "string" ? event.counterKey : "";
    const delta = Number(event?.delta || 0);

    if (!key || !delta) return;

    totals[key] = Number(totals[key] || 0) + delta;
  });

  Object.keys(totals).forEach((key) => {
    if (!totals[key]) {
      delete totals[key];
    }
  });

  return totals;
}

export function buildHistoryEntry(state, splitIndex, split, details = {}) {
  const completed = state?.splits?.completed || [];
  const previous = completed[completed.length - 1];
  const cumulativeMs = Number(state?.timer?.elapsed || 0);
  const previousCumulativeMs = Number(previous?.cumulativeMs || 0);
  const manualEvents = Array.isArray(details?.manualEvents) ? clone(details.manualEvents) : [];
  const manualApplied = clone(details?.manualApplied || summarizeManualEvents(manualEvents));
  const counterSnapshot = {};

  Object.entries(state?.counters || {}).forEach(([key, value]) => {
    counterSnapshot[key] = Number(value?.value || 0);
  });

  return {
    splitIndex,
    splitId: split?.id || "",
    label: split?.label || `Split ${splitIndex + 1}`,
    phaseId: split?.phaseId || split?.phase || "",
    cumulativeMs,
    segmentMs: Math.max(0, cumulativeMs - previousCumulativeMs),
    autoApplied: clone(split?.auto || {}),
    manualApplied,
    manualEventCount: manualEvents.length,
    manualEvents,
    counterSnapshot,
    at: new Date().toISOString()
  };
}

export function applyAutoToCounters(state, gameData, autoMap = {}, direction = 1) {
  Object.entries(autoMap || {}).forEach(([key, amount]) => {
    if (!state?.counters?.[key]) return;

    const max = Number(state?.totals?.[key] || gameData?.counters?.[key]?.max || 0);
    const current = Number(state.counters[key]?.value || 0);
    const next = clamp(current + Number(amount || 0) * direction, 0, max);

    state.counters[key].value = next;
  });
}
