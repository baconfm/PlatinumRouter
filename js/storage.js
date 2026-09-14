import {
  FALLBACK_GAME_ID,
  getLegacyDefaultRouteId,
  SELECTED_GAME_STORAGE_KEY,
  getSelectedRouteStorageKey,
  getStateStorageKey,
  readStoredGameId,
  readStoredRouteId,
  sanitizeGameId,
  sanitizeRouteId,
  writeStoredGameId,
  writeStoredRouteId
} from "./game-session.js";

const LEGACY_STORAGE_KEY = "tsushima-router-state";

let activeGameId = readStoredGameId() || FALLBACK_GAME_ID;
let activeRouteId = readStoredRouteId(activeGameId) || getLegacyDefaultRouteId(activeGameId) || "";
let state = null;
const listeners = new Set();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getDefaultState(gameId = activeGameId, routeId = activeRouteId) {
  return {
    timer: {
      startTime: null,
      elapsed: 0,
      running: false
    },

    counters: {},
    totals: {},

    splits: {
      currentIndex: 0,
      completed: [],
      items: []
    },

    phase: "legacy_all",
    phases: {},
    quotas: {},

    settings: {
      difficulty: "",
      remoteCode: "",
      showDeathCounter: false
    },

    misc: {
      dirgeDone: false
    },

    manualLog: {
      nextId: 1,
      events: []
    },

    ui: {
      settingsOpen: false
    },

    gameId,
    routeId
  };
}

function normalizeCounterEntry(value) {
  if (value && typeof value === "object") {
    return {
      value: Math.max(0, Number(value.value || 0)),
      manualDelta: Number(value.manualDelta || 0)
    };
  }

  return {
    value: Math.max(0, Number(value || 0)),
    manualDelta: 0
  };
}

function normalizeCountersObject(rawCounters = {}) {
  const source = safeObject(rawCounters);
  const result = {};

  Object.entries(source).forEach(([key, value]) => {
    result[key] = normalizeCounterEntry(value);
  });

  return result;
}

function normalizeTotalsObject(rawTotals = {}) {
  const source = safeObject(rawTotals);
  const result = {};

  Object.entries(source).forEach(([key, value]) => {
    const total = Number(value || 0);
    result[key] = Number.isFinite(total) && total >= 0 ? total : 0;
  });

  return result;
}

function normalizeManualEvent(value = {}) {
  const source = safeObject(value);
  const rawId = Number(source.id);
  const rawSplitIndex = Number(source.splitIndex);
  const rawElapsedMs = Number(source.elapsedMs);
  const rawAssignedCompletionIndex = source.assignedCompletionIndex;
  const normalizedAssignedCompletionIndex = Number(rawAssignedCompletionIndex);
  const rawDelta = Number(source.delta);
  const rawValueAfter = Number(source.valueAfter);

  return {
    id: Number.isFinite(rawId) && rawId > 0 ? Math.floor(rawId) : 0,
    counterKey: typeof source.counterKey === "string" ? source.counterKey : "",
    delta: Number.isFinite(rawDelta) ? rawDelta : 0,
    valueAfter: Number.isFinite(rawValueAfter) && rawValueAfter >= 0 ? rawValueAfter : 0,
    splitIndex: Number.isFinite(rawSplitIndex) && rawSplitIndex >= 0 ? Math.floor(rawSplitIndex) : 0,
    splitId: typeof source.splitId === "string" ? source.splitId : "",
    splitLabel: typeof source.splitLabel === "string" ? source.splitLabel : "",
    phaseId: typeof source.phaseId === "string" ? source.phaseId : "",
    elapsedMs: Number.isFinite(rawElapsedMs) && rawElapsedMs >= 0 ? rawElapsedMs : 0,
    at: typeof source.at === "string" ? source.at : "",
    source: typeof source.source === "string" ? source.source : "",
    countsAgainstSplitAuto: source.countsAgainstSplitAuto === true,
    assignedCompletionIndex:
      Number.isFinite(normalizedAssignedCompletionIndex) && normalizedAssignedCompletionIndex >= 0
        ? Math.floor(normalizedAssignedCompletionIndex)
        : null,
    completedAt: typeof source.completedAt === "string" ? source.completedAt : ""
  };
}

function normalizeManualLog(rawManualLog = {}) {
  const source = safeObject(rawManualLog);
  const events = Array.isArray(source.events)
    ? source.events.map((event) => normalizeManualEvent(event))
    : [];

  const highestId = events.reduce((max, event) => Math.max(max, Number(event.id || 0)), 0);
  const requestedNextId = Number(source.nextId || 0);
  const nextId = Math.max(
    highestId + 1,
    Number.isFinite(requestedNextId) && requestedNextId > 0 ? Math.floor(requestedNextId) : 1
  );

  return {
    nextId,
    events
  };
}

function normalizeGhostAliases(source, aliases, normalizer) {
  const normalized = normalizer(source);

  Object.entries(aliases).forEach(([canonicalKey, aliasKeys]) => {
    if (normalized[canonicalKey]) return;

    const aliasKey = aliasKeys.find((key) => source?.[key] != null);
    if (!aliasKey) return;

    normalized[canonicalKey] = normalizer({ [canonicalKey]: source[aliasKey] })[canonicalKey];
  });

  return normalized;
}

function normalizeCountersForGame(rawCounters = {}, gameId = activeGameId) {
  const nextGameId = sanitizeGameId(gameId);

  if (nextGameId !== "ghost-of-tsushima") {
    return normalizeCountersObject(rawCounters);
  }

  return normalizeGhostAliases(rawCounters, {
    hotsprings: ["hotSpring"],
    shrines: ["shinto"],
    lighthouses: ["lighthouse"],
    hiddenaltars: ["hiddenAltars"],
    territories: ["mongolTerritories"],
    mythictales: ["mythic"],
    sidetales: ["sideTales"],
    cooper: ["coOp"]
  }, normalizeCountersObject);
}

function normalizeTotalsForGame(rawTotals = {}, gameId = activeGameId) {
  const nextGameId = sanitizeGameId(gameId);

  if (nextGameId !== "ghost-of-tsushima") {
    return normalizeTotalsObject(rawTotals);
  }

  return normalizeGhostAliases(rawTotals, {
    hotsprings: ["hotSpring"],
    shrines: ["shinto"],
    lighthouses: ["lighthouse"],
    hiddenaltars: ["hiddenAltars"],
    territories: ["mongolTerritories"],
    mythictales: ["mythic"],
    sidetales: ["sideTales"],
    cooper: ["coOp"]
  }, normalizeTotalsObject);
}

function sanitizeLoadedState(raw, gameId = activeGameId, routeId = activeRouteId) {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  const nextRouteId =
    sanitizeRouteId(routeId) ||
    sanitizeRouteId(raw?.routeId) ||
    getLegacyDefaultRouteId(nextGameId) ||
    "";
  const fallback = getDefaultState(nextGameId, nextRouteId);

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const rawSplits = safeObject(raw.splits);
  const splitItems =
    Array.isArray(rawSplits.items)
      ? rawSplits.items
      : Array.isArray(raw.splits)
        ? raw.splits
        : [];

  return {
    timer: {
      startTime: raw.timer?.startTime ?? fallback.timer.startTime,
      elapsed: Math.max(0, Number(raw.timer?.elapsed || 0)),
      running: !!raw.timer?.running
    },

    counters: normalizeCountersForGame(raw.counters, nextGameId),
    totals: normalizeTotalsForGame(raw.totals, nextGameId),

    splits: {
      currentIndex: Math.max(0, Number(rawSplits.currentIndex || 0)),
      completed: Array.isArray(rawSplits.completed) ? rawSplits.completed : [],
      items: splitItems,
      useSavedItems: rawSplits.useSavedItems === true || rawSplits.source === "imported"
    },

    phase: raw.phase || fallback.phase,
    phases: safeObject(raw.phases),
    quotas: safeObject(raw.quotas),

    settings: {
      ...fallback.settings,
      ...(safeObject(raw.settings))
    },

    misc: {
      ...fallback.misc,
      ...(safeObject(raw.misc))
    },

    manualLog: normalizeManualLog(raw.manualLog),

    ui: {
      ...fallback.ui,
      ...(safeObject(raw.ui))
    },

    gameId: nextGameId,
    routeId: nextRouteId
  };
}

function readStorageValue(storageKey) {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStorageValue(storageKey, value) {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage failures and keep the app responsive.
  }
}

function loadStateFromStorage(gameId = activeGameId, routeId = activeRouteId) {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  const nextRouteId =
    sanitizeRouteId(routeId) ||
    getLegacyDefaultRouteId(nextGameId) ||
    "";
  const storageKey = getStateStorageKey(nextGameId, nextRouteId);

  let raw = readStorageValue(storageKey);

  if (
    raw == null &&
    nextGameId === "ghost-of-tsushima" &&
    (!sanitizeRouteId(nextRouteId) || nextRouteId === getLegacyDefaultRouteId(nextGameId))
  ) {
    raw = readStorageValue(LEGACY_STORAGE_KEY);
    if (raw != null) {
      writeStorageValue(storageKey, raw);
    }
  }

  if (raw == null) {
    return getDefaultState(nextGameId, nextRouteId);
  }

  try {
    return sanitizeLoadedState(JSON.parse(raw), nextGameId, nextRouteId);
  } catch (error) {
    console.error("Failed to parse state, resetting:", error);
    return getDefaultState(nextGameId, nextRouteId);
  }
}

function loadState() {
  if (state) return state;
  state = loadStateFromStorage(activeGameId, activeRouteId);
  return state;
}

function saveState() {
  const storageKey = getStateStorageKey(activeGameId, activeRouteId);
  writeStorageValue(storageKey, JSON.stringify(state));

  if (
    activeGameId === "ghost-of-tsushima" &&
    (!activeRouteId || activeRouteId === getLegacyDefaultRouteId(activeGameId))
  ) {
    writeStorageValue(LEGACY_STORAGE_KEY, JSON.stringify(state));
  }
}

function emit() {
  const snapshot = clone(loadState());
  listeners.forEach((fn) => fn(snapshot));
}

export function setStorageGameId(gameId) {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  const nextRouteId = readStoredRouteId(nextGameId) || getLegacyDefaultRouteId(nextGameId) || "";

  if (nextGameId === activeGameId && nextRouteId === activeRouteId) {
    writeStoredGameId(nextGameId);
    writeStoredRouteId(nextGameId, nextRouteId);
    return;
  }

  activeGameId = nextGameId;
  activeRouteId = nextRouteId;
  state = null;
  writeStoredGameId(nextGameId);
  writeStoredRouteId(nextGameId, nextRouteId);
}

export function setStorageContext(gameId, routeId = "") {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  const nextRouteId =
    sanitizeRouteId(routeId) ||
    getLegacyDefaultRouteId(nextGameId) ||
    "";

  if (nextGameId === activeGameId && nextRouteId === activeRouteId) {
    writeStoredGameId(nextGameId);
    writeStoredRouteId(nextGameId, nextRouteId);
    return;
  }

  activeGameId = nextGameId;
  activeRouteId = nextRouteId;
  state = null;
  writeStoredGameId(nextGameId);
  writeStoredRouteId(nextGameId, nextRouteId);
}

export function getStorageGameId() {
  return activeGameId;
}

export function getStorageRouteId() {
  return activeRouteId;
}

export function readStoredState(gameId, routeId = "") {
  return clone(loadStateFromStorage(gameId, routeId));
}

export function getState() {
  return clone(loadState());
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

export function updateState(updater) {
  const current = loadState();
  const next = updater(clone(current));

  if (!next || typeof next !== "object") {
    console.warn("updateState returned invalid state - ignoring");
    return;
  }

  state = sanitizeLoadedState(next, activeGameId, activeRouteId);
  saveState();
  emit();
}

export function resetState() {
  state = getDefaultState(activeGameId, activeRouteId);
  saveState();
  emit();
}

window.addEventListener("storage", (event) => {
  if (event.key === SELECTED_GAME_STORAGE_KEY) {
    const nextGameId = sanitizeGameId(event.newValue);
    if (nextGameId && nextGameId !== activeGameId) {
      activeGameId = nextGameId;
      activeRouteId = readStoredRouteId(nextGameId) || getLegacyDefaultRouteId(nextGameId) || "";
      state = null;
      emit();
    }
    return;
  }

  if (event.key === getSelectedRouteStorageKey(activeGameId)) {
    const nextRouteId =
      sanitizeRouteId(event.newValue) ||
      getLegacyDefaultRouteId(activeGameId) ||
      "";

    if (nextRouteId !== activeRouteId) {
      activeRouteId = nextRouteId;
      state = null;
      emit();
    }

    return;
  }

  if (event.key !== getStateStorageKey(activeGameId, activeRouteId)) return;

  try {
    state = event.newValue
      ? sanitizeLoadedState(JSON.parse(event.newValue), activeGameId, activeRouteId)
      : getDefaultState(activeGameId, activeRouteId);

    emit();
  } catch (error) {
    console.error("Storage sync failed:", error);
  }
});
