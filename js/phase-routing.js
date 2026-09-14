export const NO_PHASE_CHAIN = "__none__";

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAuto(auto = {}) {
  const result = {};

  Object.entries(safeObject(auto)).forEach(([key, value]) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed === 0) return;
    result[key] = parsed;
  });

  return result;
}

export function normalizePhaseProgressFrom(value) {
  if (value === null || value === false) {
    return NO_PHASE_CHAIN;
  }

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function getSplitPhaseId(split, phases = {}) {
  const token = String(split?.phase || split?.phaseId || split?.act || "").trim();
  if (!token) return "";
  if (phases[token]) return token;

  const matchedEntry = Object.entries(safeObject(phases)).find(([, phase]) => {
    return String(phase?.label || "").trim() === token;
  });

  return matchedEntry?.[0] || token;
}

export function getRoutePhaseOrder(splits = [], phases = {}) {
  const firstSeen = new Map();

  safeArray(splits).forEach((split, index) => {
    const phaseId = getSplitPhaseId(split, phases);
    if (!phaseId || firstSeen.has(phaseId)) return;
    firstSeen.set(phaseId, index);
  });

  return Array.from(firstSeen.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([phaseId]) => phaseId);
}

export function getResolvedProgressFromPhaseId(phaseId, phases = {}, splits = []) {
  const phase = phases?.[phaseId] || {};
  const explicit = normalizePhaseProgressFrom(phase?.progressFrom);

  if (explicit === NO_PHASE_CHAIN) {
    return "";
  }

  if (explicit && phases?.[explicit] && explicit !== phaseId) {
    return explicit;
  }

  const orderedPhaseIds = getRoutePhaseOrder(splits, phases);
  const phaseIndex = orderedPhaseIds.indexOf(phaseId);

  if (phaseIndex <= 0) {
    return "";
  }

  return orderedPhaseIds[phaseIndex - 1] || "";
}

export function getPriorChainedPhaseIds(phaseId, phases = {}, splits = []) {
  const chain = [];
  const visited = new Set([phaseId]);
  let currentPhaseId = phaseId;

  while (currentPhaseId) {
    const previousPhaseId = getResolvedProgressFromPhaseId(currentPhaseId, phases, splits);

    if (!previousPhaseId || visited.has(previousPhaseId) || !phases?.[previousPhaseId]) {
      break;
    }

    chain.unshift(previousPhaseId);
    visited.add(previousPhaseId);
    currentPhaseId = previousPhaseId;
  }

  return chain;
}

export function getPlannedAutoTotalsForPhaseIds(phaseIds = [], splits = [], phases = {}) {
  const phaseIdSet = new Set(safeArray(phaseIds));
  const totals = {};

  safeArray(splits).forEach((split) => {
    const splitPhaseId = getSplitPhaseId(split, phases);
    if (!phaseIdSet.has(splitPhaseId)) return;

    Object.entries(normalizeAuto(split?.auto || {})).forEach(([key, amount]) => {
      totals[key] = Number(totals[key] || 0) + Number(amount || 0);
    });
  });

  return totals;
}

export function getQuotaTotalsForPhaseIds(phaseIds = [], quotas = {}) {
  const totals = {};

  safeArray(phaseIds).forEach((phaseId) => {
    Object.entries(safeObject(quotas?.[phaseId])).forEach(([key, value]) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      totals[key] = Math.max(Number(totals[key] || 0), parsed);
    });
  });

  return totals;
}

export function getPhaseObjectiveResolution({
  phaseId,
  phase,
  phases = {},
  quotas = {},
  splits = [],
  counterDefs = {}
}) {
  const visibleKeys = Array.isArray(phase?.visibleCounters)
    ? phase.visibleCounters
    : Array.isArray(phase?.visible)
      ? phase.visible
      : Array.isArray(phase?.objectives)
        ? phase.objectives
        : [];

  const uniqueVisibleKeys = [];
  const seen = new Set();

  visibleKeys.forEach((key) => {
    if (!counterDefs[key] || seen.has(key)) return;
    seen.add(key);
    uniqueVisibleKeys.push(key);
  });

  const chainedPhaseIds = getPriorChainedPhaseIds(phaseId, phases, splits);
  const plannedAutoBefore = getPlannedAutoTotalsForPhaseIds(chainedPhaseIds, splits, phases);
  const plannedQuotaBefore = getQuotaTotalsForPhaseIds(chainedPhaseIds, quotas);
  const hiddenCompletedKeys = [];
  const effectiveVisibleKeys = [];

  uniqueVisibleKeys.forEach((key) => {
    const max = Number(counterDefs?.[key]?.max || 0);
    const beforeValue = Math.max(
      Number(plannedAutoBefore?.[key] || 0),
      Number(plannedQuotaBefore?.[key] || 0)
    );

    if (max > 0 && beforeValue >= max) {
      hiddenCompletedKeys.push(key);
      return;
    }

    effectiveVisibleKeys.push(key);
  });

  return {
    phaseId,
    progressFromPhaseId: getResolvedProgressFromPhaseId(phaseId, phases, splits),
    chainedPhaseIds,
    effectiveVisibleKeys,
    hiddenCompletedKeys,
    plannedAutoBefore,
    plannedQuotaBefore
  };
}
