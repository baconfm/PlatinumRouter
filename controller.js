// controller.js

import { loadGameData } from "./js/data-loader.js?v=20260725a";
import { getState, setStorageContext, subscribe } from "./js/storage.js";
import { createDebugger } from "./js/debug.js?v=20260524j";
import {
  buildInitialState,
  computeDashboardPace,
  computeRouteHealth,
  getCurrentStateFactory
} from "./js/controller-core.js?v=20260725a";
import { createRenderController } from "./js/controller-render.js?v=20260725a";
import { createActionController } from "./js/controller-actions.js?v=20260724d";
import { createScreenTracker } from "./js/screen-tracker.js?v=20260725a";
import {
  navigateToGame,
  navigateToRoute,
  populateGamePicker,
  populateRoutePicker,
  resolvePageContext
} from "./js/game-context.js?v=20260527a";

const debug = createDebugger({ name: "controller" });

let gameData = null;
let gameId = null;
let routeId = "";
let manifest = null;
let getCurrentState = null;
let renderController = null;
let actionController = null;
let screenTracker = null;

function truncateText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function summarizeCounters(state) {
  const result = {};
  const showDeathCounter = !!state?.settings?.showDeathCounter;

  Object.entries(state?.counters || {}).forEach(([key, counter]) => {
    if (key === "deaths" && !showDeathCounter) return;

    const value = Number(counter?.value || 0);
    const total = Number(state?.totals?.[key] || 0);
    const manualDelta = Number(counter?.manualDelta || 0);
    const manualText = manualDelta
      ? ` (${manualDelta > 0 ? "+" : ""}${manualDelta})`
      : "";

    result[key] = `${value}/${total}${manualText}`;
  });

  return result;
}

function summarizeSplit(split, index) {
  if (!split) return null;

  return {
    index,
    id: split.id || "",
    label: split.label || "",
    phase: split.phase || split.phaseId || split.act || "",
    note: truncateText(split.note),
    auto: split.auto || {}
  };
}

function summarizeCompletedSplits(completed = []) {
  return completed.slice(-4).map((entry) => ({
    index: Number(entry?.splitIndex || 0),
    label: entry?.label || "",
    cumulativeMs: Number(entry?.cumulativeMs || 0),
    segmentMs: Number(entry?.segmentMs || 0),
    autoApplied: entry?.autoApplied || {},
    manualApplied: entry?.manualApplied || {}
  }));
}

function summarizeManualLog(manualLog = {}) {
  const events = Array.isArray(manualLog?.events) ? manualLog.events : [];
  const totals = {};

  events.forEach((event) => {
    const key = event?.counterKey || "";
    const delta = Number(event?.delta || 0);
    if (!key || !delta) return;
    totals[key] = Number(totals[key] || 0) + delta;
  });

  return {
    eventCount: events.length,
    pendingCount: events.filter((event) => event.assignedCompletionIndex == null).length,
    totals,
    recent: events.slice(-10).map((event) => ({
      id: Number(event?.id || 0),
      key: event?.counterKey || "",
      delta: Number(event?.delta || 0),
      valueAfter: Number(event?.valueAfter || 0),
      splitIndex: Number(event?.splitIndex || 0),
      elapsedMs: Number(event?.elapsedMs || 0)
    }))
  };
}

function buildCompactDebugSnapshot() {
  const state = getCurrentState();
  const splits = state?.splits?.items || [];
  const currentIndex = Number(state?.splits?.currentIndex || 0);
  const completed = state?.splits?.completed || [];
  const currentSplit = splits[currentIndex] || null;
  const nextSplit = splits[currentIndex + 1] || null;
  const pace = computeDashboardPace(state, gameData);
  const routeHealth = computeRouteHealth(state, gameData);

  return {
    type: "controller-compact",
    note: "Paste this for AI/debugging. Do not paste Run Data exports unless asked.",
    at: new Date().toISOString(),
    context: {
      gameId,
      routeId,
      routeTitle: gameData?.meta?.activeRouteTitle || gameData?.meta?.title || "",
      routeShortTitle: gameData?.meta?.activeRouteShortTitle || ""
    },
    timer: {
      elapsedMs: Number(state?.timer?.elapsed || 0),
      running: !!state?.timer?.running
    },
    progress: {
      activePhase: state?.phase || "",
      currentSplitIndex: currentIndex,
      completedSplits: completed.length,
      totalSplits: splits.length,
      useSavedSplitItems: !!state?.splits?.useSavedItems
    },
    pace: {
      label: pace?.label || "",
      splitEstimate: pace?.splitEstimate || "",
      runEstimate: pace?.runEstimate || "",
      detail: pace?.detail || "",
      tone: pace?.tone || ""
    },
    routeHealth,
    currentSplit: summarizeSplit(currentSplit, currentIndex),
    nextSplit: summarizeSplit(nextSplit, currentIndex + 1),
    upcomingSplits: splits
      .slice(currentIndex + 2, currentIndex + 6)
      .map((split, offset) => ({
        index: currentIndex + offset + 2,
        label: split?.label || "",
        phase: split?.phase || split?.phaseId || split?.act || ""
      })),
    counters: summarizeCounters(state),
    recentCompletedSplits: summarizeCompletedSplits(completed),
    manualLog: summarizeManualLog(state?.manualLog),
    dataShape: {
      counters: Object.keys(gameData?.counters || {}).length,
      phases: Object.keys(gameData?.phases || {}).length,
      defaultSplits: (gameData?.defaultSplits || []).length,
      routeCount: (gameData?.meta?.routes || []).length
    }
  };
}

async function boot() {
  const pageContext = await resolvePageContext();
  manifest = pageContext.manifest;
  gameId = pageContext.gameId;
  routeId = pageContext.routeId;

  setStorageContext(gameId, routeId);
  gameData = await loadGameData(gameId, routeId);

  getCurrentState = getCurrentStateFactory({
    getState,
    gameData,
    gameId,
    routeId
  });

  const initial = buildInitialState(getState(), gameData, gameId, routeId);

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

  renderController = createRenderController({
    gameData,
    debug,
    getCurrentState
  });

  actionController = createActionController({
    gameData,
    debug,
    getCurrentState
  });

  screenTracker = createScreenTracker({
    gameData,
    debug,
    getCurrentState,
    actionController
  });

  actionController.setWholeState(initial);
  actionController.syncPhaseToState();
  actionController.bindStaticEvents();
  screenTracker.bind();

  subscribe((raw) => {
    const state = buildInitialState(raw, gameData, gameId, routeId);

    if (state.timer?.running) actionController.ensureTimerLoop();
    else actionController.stopTimerLoop();

    renderController.render();
    screenTracker?.renderLookingForDock?.();
  });

  debug.setSnapshotBuilder(buildCompactDebugSnapshot);

  if (getCurrentState().timer?.running) {
    actionController.ensureTimerLoop();
  }

  renderController.render();

  debug.log("Controller booted", {
    counters: Object.keys(gameData?.counters || {}).length,
    phases: Object.keys(gameData?.phases || {}).length,
    splits: (getCurrentState().splits?.items || []).length,
    routeId
  });
}

boot().catch((error) => {
  debug.error("Controller boot failed", {
    message: error.message,
    stack: error.stack
  });

  console.error(error);
});
