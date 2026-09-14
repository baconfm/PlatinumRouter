// js/splits-page.js

import { loadGameData } from "./data-loader.js?v=20260724d";
import { getState, setStorageContext, updateState, subscribe } from "./storage.js";
import { createSplitEditor } from "./split-editor.js?v=20260724d";
import { getScreenTrackerOcrGoalOptions } from "./screen-tracker.js?v=20260725a";
import { createDebugger } from "./debug.js?v=20260524j";
import { clamp, normalizeSplits } from "./split-logic.js?v=20260724d";
import {
  navigateToGame,
  navigateToRoute,
  populateGamePicker,
  populateRoutePicker,
  resolvePageContext
} from "./game-context.js";

const debug = createDebugger({ name: "splits-page" });

let gameData = null;
let gameId = null;
let routeId = "";
let manifest = null;
let splitEditorApi = null;

const SPLIT_SAVE_ENDPOINT = "/.router-api/save-splits";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeCounterState(counterDefs, rawCounters = {}, rawTotals = {}) {
  const counters = {};
  const totals = {};

  Object.entries(counterDefs || {}).forEach(([key, def]) => {
    const rawValue =
      typeof rawCounters[key] === "object"
        ? Number(rawCounters[key]?.value || 0)
        : Number(rawCounters[key] || 0);

    const rawManualDelta =
      typeof rawCounters[key] === "object"
        ? Number(rawCounters[key]?.manualDelta || 0)
        : 0;

    const max = Number(rawTotals[key] || def.max || 0);

    counters[key] = {
      value: Number.isFinite(rawValue) ? clamp(rawValue, 0, max) : 0,
      manualDelta: Number.isFinite(rawManualDelta) ? rawManualDelta : 0
    };

    totals[key] = max;
  });

  return { counters, totals };
}

function buildInitialState(raw = {}) {
  const normalized = normalizeCounterState(
    gameData?.counters || {},
    raw.counters || {},
    raw.totals || {}
  );

  const rawSplitBlock = raw?.splits;
  const rawSplitItems =
    Array.isArray(rawSplitBlock?.items)
      ? rawSplitBlock.items
      : Array.isArray(rawSplitBlock)
        ? rawSplitBlock
        : [];

  const defaultSplits = Array.isArray(gameData?.defaultSplits) ? gameData.defaultSplits : [];
  const hasSavedSplits = rawSplitItems.length > 0;
  const useSavedSplitItems =
    rawSplitBlock?.useSavedItems === true ||
    rawSplitBlock?.source === "imported";
  const splitSource =
    useSavedSplitItems && hasSavedSplits
      ? rawSplitItems
      : defaultSplits.length
        ? defaultSplits
        : rawSplitItems;

  const splits = normalizeSplits(splitSource, defaultSplits);
  const splitCount = splits.length;

  return {
    timer: {
      startTime: raw.timer?.startTime ?? null,
      elapsed: Math.max(0, Number(raw.timer?.elapsed || 0)),
      running: !!raw.timer?.running
    },

    counters: normalized.counters,
    totals: normalized.totals,

    splits: {
      currentIndex: clamp(Number(raw.splits?.currentIndex || 0), 0, splitCount),
      completed: Array.isArray(raw.splits?.completed) ? raw.splits.completed : [],
      items: splits
    },

    phase: raw.phase || "legacy_all",

    phases: safeObject(raw?.phases),
    quotas: safeObject(raw?.quotas),

    settings: {
      difficulty: raw.settings?.difficulty || gameData?.meta?.defaultDifficulty || "",
      act1TargetMinutes: Number(raw.settings?.act1TargetMinutes || 180),
      remoteCode: raw.settings?.remoteCode || ""
    },

    misc: {
      dirgeDone: !!raw.misc?.dirgeDone
    },

    ui: {
      settingsOpen: !!raw.ui?.settingsOpen
    },

    gameId: raw.gameId || gameId,
    routeId: routeId || raw.routeId || ""
  };
}

function getCurrentState() {
  return buildInitialState(getState());
}

function getEffectivePhases(rawState = null) {
  const source = rawState || getState();
  const stored = safeObject(source?.phases);
  return Object.keys(stored).length ? stored : safeObject(gameData?.phases);
}

function getEffectiveQuotas(rawState = null) {
  const source = rawState || getState();
  const stored = safeObject(source?.quotas);
  return Object.keys(stored).length ? stored : safeObject(gameData?.quotas);
}

function getSplitAutoCounterDefs() {
  const defs = safeObject(gameData?.counters);
  const allowedKeys = Array.isArray(gameData?.meta?.splitAutoCounterKeys)
    ? gameData.meta.splitAutoCounterKeys
    : [];

  if (!allowedKeys.length) return defs;

  return Object.fromEntries(
    allowedKeys
      .filter((key) => defs[key])
      .map((key) => [key, defs[key]])
  );
}

function syncGameDataFromState(rawState = null) {
  const source = rawState || getState();
  gameData.phases = clone(getEffectivePhases(source));
  gameData.quotas = clone(getEffectiveQuotas(source));
}

function renderHeader() {
  const title = document.querySelector(".title");
  const subtitle = document.getElementById("pageSubtitle");
  const gameTitle = gameData?.meta?.title || "Game";
  const routeTitle = gameData?.meta?.activeRouteTitle || "";

  if (title) {
    title.textContent = routeTitle
      ? `${gameTitle} - ${routeTitle} Split Editor`
      : `${gameTitle} Split Editor`;
  }

  if (subtitle) {
    subtitle.textContent = routeTitle
      ? `${routeTitle}: tune route order, phase links, notes, and planned auto-progress without digging through unrelated splits.`
      : "Tune route order, phase links, notes, and planned auto-progress without digging through unrelated splits.";
  }

  document.title = title?.textContent || `${gameTitle} Split Editor`;
}

function renderSummary(state) {
  const subtitle = document.getElementById("pageSubtitle");
  const notes = document.getElementById("splitEditorNotesText");
  const splitCount = state.splits?.items?.length || 0;
  const routeTitle = gameData?.meta?.activeRouteTitle || "Default Route";
  const phaseCount = new Set(
    (state.splits?.items || [])
      .map((split) => String(split?.phase || split?.phaseId || split?.act || "").trim())
      .filter(Boolean)
  ).size;

  if (subtitle) {
    subtitle.textContent = `${routeTitle}: ${splitCount} splits loaded across ${phaseCount} phases. Edit names, phases, notes, and auto-progress here.`;
  }

  if (notes) {
    notes.textContent =
      `Keep phase assignments deliberate, keep notes route-readable, and keep auto-progress scoped to what still matters at each split.`;
  }
}

function setSaveStatus(message, kind = "") {
  const status = document.getElementById("splitSaveStatus");
  if (!status) return;

  status.textContent = message || "";
  status.classList.toggle("is-ok", kind === "ok");
  status.classList.toggle("is-error", kind === "error");
}

async function saveSplitsToDatabase(splits) {
  const response = await fetch(SPLIT_SAVE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      gameId,
      routeId,
      splits
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const message =
      payload?.error ||
      `Local database API unavailable (${response.status}). Start with start-localhost.bat.`;
    throw new Error(message);
  }

  return payload;
}

function setupSplitEditor() {
  splitEditorApi = createSplitEditor({
    overlayEl: null,
    gridEl: document.getElementById("splitEditorGrid"),
    addBtn: document.getElementById("addSplitEditorBtn"),
    resetBtn: document.getElementById("resetSplitEditorBtn"),
    closeBtn: null,
    saveBtn: document.getElementById("saveSplitEditorBtn"),
    downloadBtn: document.getElementById("downloadSplitBackupBtn"),
    copyBtn: document.getElementById("copySplitBackupBtn"),
    searchInputEl: document.getElementById("splitSearchInput"),
    phaseFilterEl: document.getElementById("splitPhaseFilter"),
    filterResultPillEl: document.getElementById("splitFilterResultPill"),
    filterSummaryPillEl: document.getElementById("splitFilterSummaryPill"),
    expandAllBtn: document.getElementById("expandAllAutoBtn"),
    collapseAllBtn: document.getElementById("collapseAllAutoBtn"),

    getSplits: () => clone(getCurrentState().splits?.items || []),

    setSplits: (splits) => {
      updateState((raw) => {
        const state = buildInitialState(raw);

        state.splits.items = normalizeSplits(splits, gameData?.defaultSplits || []);
        state.splits.currentIndex = clamp(
          Number(state.splits.currentIndex || 0),
          0,
          state.splits.items.length
        );

        state.splits.completed = (state.splits.completed || []).filter(
          (entry) => Number(entry.splitIndex) < state.splits.items.length
        );

        return state;
      });
    },

    getPhases: () => clone(gameData?.phases || {}),
    getQuotas: () => clone(gameData?.quotas || {}),
    getCounterDefs: getSplitAutoCounterDefs,
    getOcrGoalOptions: () => getScreenTrackerOcrGoalOptions(gameId, {
      completionTitles: gameData?.completionTitles || {},
      neroIpcaClusters: gameData?.neroIpcaClusters || []
    }),

    onAfterSave: async (splits) => {
      const state = getCurrentState();
      renderSummary(state);
      setSaveStatus("Saving route file...", "");

      try {
        const result = await saveSplitsToDatabase(splits);
        setSaveStatus(`Saved ${result.splitCount} splits to ${result.path || "route file"}`, "ok");

        debug.log("Split setup saved to database", {
          splitCount: result.splitCount,
          path: result.path,
          backupPath: result.backupPath
        });
      } catch (error) {
        const detail = error?.message ? `: ${error.message}` : "";
        setSaveStatus(`Browser only - DB save failed${detail}`, "error");
        debug.error("Split database save failed", {
          message: error.message,
          endpoint: SPLIT_SAVE_ENDPOINT,
          gameId,
          routeId
        });
      }
    }
  });

  if (typeof splitEditorApi?.open === "function") {
    splitEditorApi.open();
  }
}

function setupSubscriptions() {
  subscribe((raw) => {
    syncGameDataFromState(raw);

    const state = buildInitialState(raw);
    renderSummary(state);

    debug.setStatus("gameId", state.gameId);
    debug.setStatus("routeId", state.routeId || "");
    debug.setStatus("splitCount", state.splits?.items?.length || 0);
    debug.setStatus("currentSplitIndex", state.splits?.currentIndex || 0);
    debug.setStatus("phaseCount", Object.keys(gameData?.phases || {}).length);
  });
}

async function boot() {
  const pageContext = await resolvePageContext();
  manifest = pageContext.manifest;
  gameId = pageContext.gameId;
  routeId = pageContext.routeId;

  setStorageContext(gameId, routeId);
  gameData = await loadGameData(gameId, routeId);

  populateGamePicker({
    manifest,
    currentGameId: gameId,
    onChange: navigateToGame
  });

  populateRoutePicker({
    routes: gameData?.meta?.routes || [],
    currentRouteId: routeId,
    onChange: navigateToRoute
  });

  syncGameDataFromState(getState());

  updateState((raw) => buildInitialState(raw));

  renderHeader();
  setupSplitEditor();
  setupSubscriptions();

  debug.setSnapshotBuilder(() => {
    const state = getCurrentState();
    const splits = state?.splits?.items || [];
    const currentIndex = Number(state?.splits?.currentIndex || 0);

    return {
      type: "split-editor-compact",
      note: "Compact editor snapshot. Use split backups only for file restore, not chat context.",
      at: new Date().toISOString(),
      context: {
        gameId,
        routeId,
        routeTitle: gameData?.meta?.activeRouteTitle || gameData?.meta?.title || ""
      },
      counts: {
        counters: Object.keys(gameData?.counters || {}).length,
        defaultSplits: (gameData?.defaultSplits || []).length,
        liveSplits: splits.length,
        completedSplits: state?.splits?.completed?.length || 0
      },
      currentIndex,
      currentSplit: splits[currentIndex]
        ? {
            id: splits[currentIndex].id || "",
            label: splits[currentIndex].label || "",
            phase: splits[currentIndex].phase || splits[currentIndex].phaseId || ""
          }
        : null,
      nearbySplits: splits.slice(Math.max(0, currentIndex - 2), currentIndex + 5).map((split, offset) => ({
        index: Math.max(0, currentIndex - 2) + offset,
        label: split?.label || "",
        phase: split?.phase || split?.phaseId || ""
      }))
    };
  });

  const state = getCurrentState();
  renderSummary(state);

  debug.log("Split editor page booted", {
    gameId,
    routeId,
    splitCount: state.splits?.items?.length || 0,
    defaultSplitCount: gameData?.defaultSplits?.length || 0,
    counters: Object.keys(gameData?.counters || {}).length
  });
}

boot().catch((error) => {
  debug.error("Split editor page failed", {
    message: error.message,
    stack: error.stack
  });

  console.error(error);
});
