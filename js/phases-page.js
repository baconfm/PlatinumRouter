// js/phases-page.js

import { loadGameData, resolveGameDataFiles } from "./data-loader.js";
import { getState, setStorageContext, updateState, subscribe } from "./storage.js";
import { createActsEditor } from "./acts-editor.js?v=20260711h";
import { createDebugger } from "./debug.js?v=20260524j";
import { clamp, normalizeSplits, getActivePhaseId } from "./split-logic.js";
import {
  navigateToGame,
  navigateToRoute,
  populateGamePicker,
  populateRoutePicker,
  resolvePageContext
} from "./game-context.js";

const debug = createDebugger({ name: "phases-page" });

let gameData = null;
let gameId = null;
let routeId = "";
let manifest = null;
let actsEditorApi = null;
let projectRootHandle = null;

const HANDLE_DB_NAME = "platinum-router-handles";
const HANDLE_STORE_NAME = "handles";
const PROJECT_ROOT_HANDLE_KEY = "project-root";

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

  const splitItems = normalizeSplits(rawSplitItems, gameData?.defaultSplits || []);
  const currentIndex = clamp(Number(raw?.splits?.currentIndex || 0), 0, splitItems.length);

  const phaseSource =
    Object.keys(safeObject(raw?.phases)).length > 0
      ? raw.phases
      : gameData?.phases || {};

  const phase =
    raw.phase ||
    getActivePhaseId(splitItems, currentIndex, phaseSource) ||
    "legacy_all";

  return {
    timer: {
      startTime: raw.timer?.startTime ?? null,
      elapsed: Math.max(0, Number(raw.timer?.elapsed || 0)),
      running: !!raw.timer?.running
    },

    counters: normalized.counters,
    totals: normalized.totals,

    splits: {
      currentIndex,
      completed: Array.isArray(raw?.splits?.completed) ? raw.splits.completed : [],
      items: splitItems
    },

    phase,

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
      ? `${gameTitle} - ${routeTitle} Phase Editor`
      : `${gameTitle} Phase Editor`;
  }

  if (subtitle) {
    subtitle.textContent = routeTitle
      ? `${routeTitle}: edit pacing, visible objectives, notes, and quotas without wading through every counter at once.`
      : "Edit pacing, visible objectives, notes, and quotas without wading through every counter at once.";
  }

  document.title = title?.textContent || `${gameTitle} Phase Editor`;
}

function renderSummary(state) {
  const phaseCount = Object.keys(gameData?.phases || {}).length;
  const activePhase = state.phase || "legacy_all";
  const routeTitle = gameData?.meta?.activeRouteTitle || "Default Route";
  const subtitle = document.getElementById("pageSubtitle");
  const notesCard = document.getElementById("editorNotesText");

  if (subtitle) {
    subtitle.textContent =
      `${routeTitle}: ${phaseCount} phases loaded. Shape what the controller shows, what each phase is targeting, and how the run is paced.`;
  }

  if (notesCard) {
    notesCard.textContent =
      `Current active phase: ${activePhase}. Keep visible objectives lean, keep quotas phase-specific, and keep pace targets readable.`;
  }
}

function syncPhaseToCurrentSplits(nextState) {
  const phaseSource =
    Object.keys(safeObject(nextState?.phases)).length > 0
      ? nextState.phases
      : gameData?.phases || {};

  nextState.phase =
    getActivePhaseId(
      nextState.splits?.items || [],
      Number(nextState.splits?.currentIndex || 0),
      phaseSource
    ) || "legacy_all";

  return nextState;
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function getSaveFilesButton() {
  return document.getElementById("savePhaseFilesBtn");
}

function setSaveFilesButtonState(text, disabled = false) {
  const button = getSaveFilesButton();
  if (!button) return;
  button.textContent = text;
  button.disabled = disabled;
}

function setEditorNote(message) {
  const notesCard = document.getElementById("editorNotesText");
  if (!notesCard) return;
  notesCard.textContent = message;
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME);
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function loadStoredProjectRootHandle() {
  try {
    const db = await openHandleDb();

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(HANDLE_STORE_NAME, "readonly");
      const store = transaction.objectStore(HANDLE_STORE_NAME);
      const request = store.get(PROJECT_ROOT_HANDLE_KEY);

      request.addEventListener("success", () => resolve(request.result || null));
      request.addEventListener("error", () => reject(request.error));
    });
  } catch (error) {
    console.warn("Could not load stored project handle", error);
    return null;
  }
}

async function storeProjectRootHandle(handle) {
  try {
    const db = await openHandleDb();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(HANDLE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(HANDLE_STORE_NAME);
      const request = store.put(handle, PROJECT_ROOT_HANDLE_KEY);

      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error));
    });
  } catch (error) {
    console.warn("Could not persist project handle", error);
  }
}

async function removeStoredProjectRootHandle() {
  try {
    const db = await openHandleDb();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(HANDLE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(HANDLE_STORE_NAME);
      const request = store.delete(PROJECT_ROOT_HANDLE_KEY);

      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error));
    });
  } catch (error) {
    console.warn("Could not clear stored project handle", error);
  }
}

async function ensureDirectoryHandle(parentHandle, directoryName) {
  return parentHandle.getDirectoryHandle(directoryName, { create: false });
}

async function isProjectRootHandle(handle) {
  try {
    await ensureDirectoryHandle(handle, "data");
    await ensureDirectoryHandle(handle, "js");
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectRootHandle(candidateHandle) {
  if (await isProjectRootHandle(candidateHandle)) {
    return candidateHandle;
  }

  try {
    const nestedHandle = await candidateHandle.getDirectoryHandle("PlatinumRouter-main", { create: false });
    if (await isProjectRootHandle(nestedHandle)) {
      return nestedHandle;
    }
  } catch {
    // ignore
  }

  throw new Error("Choose the app folder that contains data/, js/, and the HTML files.");
}

async function ensureProjectRootHandle() {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error("This browser does not support local file saving from the app.");
  }

  if (!projectRootHandle) {
    projectRootHandle = await loadStoredProjectRootHandle();
  }

  if (projectRootHandle) {
    try {
      const permission = await projectRootHandle.queryPermission({ mode: "readwrite" });

      if (permission === "granted") {
        return resolveProjectRootHandle(projectRootHandle);
      }

      if (permission === "prompt") {
        const requested = await projectRootHandle.requestPermission({ mode: "readwrite" });
        if (requested === "granted") {
          return resolveProjectRootHandle(projectRootHandle);
        }
      }
    } catch (error) {
      console.warn("Stored project handle is no longer usable", error);
    }
  }

  const pickedHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  const resolvedHandle = await resolveProjectRootHandle(pickedHandle);
  projectRootHandle = resolvedHandle;
  await storeProjectRootHandle(resolvedHandle);
  return resolvedHandle;
}

async function writeTextFile(rootHandle, relativePath, text) {
  const cleanPath = String(relativePath || "").replace(/^\.\//, "");
  const segments = cleanPath.split("/").filter(Boolean);

  if (!segments.length) {
    throw new Error("Missing file path.");
  }

  const fileName = segments.pop();
  let directoryHandle = rootHandle;

  for (const segment of segments) {
    directoryHandle = await directoryHandle.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

function buildPhasesFilePayload(phases = {}) {
  const result = {};

  Object.entries(safeObject(phases)).forEach(([phaseId, phase]) => {
    const entry = {
      label: phase?.label || phaseId,
      note: phase?.note || "",
      targetMinutes: Number(phase?.targetMinutes || 0),
      visible: Array.isArray(phase?.visibleCounters)
        ? phase.visibleCounters
        : Array.isArray(phase?.visible)
          ? phase.visible
          : Array.isArray(phase?.objectives)
            ? phase.objectives
            : []
    };

    if (phase?.description) {
      entry.description = phase.description;
    }

    if (phase?.objectiveNote) {
      entry.objectiveNote = phase.objectiveNote;
    }

    if (phase?.progressFrom === null) {
      entry.progressFrom = null;
    } else if (typeof phase?.progressFrom === "string" && phase.progressFrom.trim()) {
      entry.progressFrom = phase.progressFrom.trim();
    }

    result[phaseId] = entry;
  });

  return result;
}

function buildQuotasFilePayload(phases = {}, quotas = {}) {
  const result = { quotas: {} };

  Object.entries(safeObject(phases)).forEach(([phaseId, phase]) => {
    const rawTargets = safeObject(quotas?.[phaseId]);
    const targets = {};

    Object.entries(rawTargets).forEach(([key, value]) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      targets[key] = parsed;
    });

    result.quotas[phaseId] = {
      label: phase?.label || phaseId,
      targets
    };
  });

  return result;
}

async function savePhaseFilesToDisk() {
  if (!actsEditorApi) {
    throw new Error("Phase editor is not ready.");
  }

  actsEditorApi.save();

  const files = gameData?.files || await resolveGameDataFiles(gameId, routeId);
  const state = getCurrentState();
  const phases = Object.keys(safeObject(state?.phases)).length ? state.phases : gameData?.phases || {};
  const quotas = Object.keys(safeObject(state?.quotas)).length ? state.quotas : gameData?.quotas || {};
  const rootHandle = await ensureProjectRootHandle();
  const phasesPayload = buildPhasesFilePayload(phases);
  const quotasPayload = buildQuotasFilePayload(phases, quotas);

  await writeTextFile(rootHandle, files.phasesPath, `${prettyJson(phasesPayload)}\n`);
  await writeTextFile(rootHandle, files.quotasPath, `${prettyJson(quotasPayload)}\n`);

  return {
    phasesPath: files.phasesPath,
    quotasPath: files.quotasPath
  };
}

function setupLocalFileSave() {
  const saveFilesBtn = getSaveFilesButton();
  if (!saveFilesBtn) return;

  saveFilesBtn.addEventListener("click", async () => {
    setSaveFilesButtonState("Saving...", true);

    try {
      const result = await savePhaseFilesToDisk();
      setEditorNote(
        `Saved phase files to ${result.phasesPath} and ${result.quotasPath}.`
      );
      setSaveFilesButtonState("Saved Local Files", false);

      setTimeout(() => {
        setSaveFilesButtonState("Save Local Files", false);
      }, 1800);
    } catch (error) {
      if (error?.name === "NotAllowedError") {
        setEditorNote("Local file save was cancelled before permission was granted.");
      } else {
        setEditorNote(error?.message || "Could not save local phase files.");
      }

      if (error?.name === "DataCloneError" || error?.name === "InvalidStateError") {
        projectRootHandle = null;
        await removeStoredProjectRootHandle();
      }

      console.error(error);
      setSaveFilesButtonState("Save Local Files", false);
    }
  });
}

function setupActsEditor() {
  actsEditorApi = createActsEditor({
    overlayEl: null,
    phaseListEl: document.getElementById("actsEditorPhaseList"),
    formEl: document.getElementById("actsEditorForm"),
    addBtn: document.getElementById("addActsEditorBtn"),
    closeBtn: null,
    saveBtn: document.getElementById("saveActsEditorBtn"),
    resetBtn: document.getElementById("resetActsEditorBtn"),
    exportBtn: document.getElementById("exportActsEditorBtn"),
    importInput: document.getElementById("importActsEditorInput"),
    copyBtn: document.getElementById("copyActsEditorBtn"),

    getPhases: () => clone(gameData?.phases || {}),
    getQuotas: () => clone(gameData?.quotas || {}),
    getCounterDefs: () => gameData?.counters || {},
    getSplits: () => clone(getCurrentState().splits?.items || []),
    getPreferredPhaseId: () => getCurrentState().phase || "",

    setPhases: (phases) => {
      const nextPhases = clone(phases || {});
      gameData.phases = nextPhases;

      updateState((raw) => {
        const state = buildInitialState(raw);
        state.phases = nextPhases;
        return syncPhaseToCurrentSplits(state);
      });
    },

    setQuotas: (quotas) => {
      const nextQuotas = clone(quotas || {});
      gameData.quotas = nextQuotas;

      updateState((raw) => {
        const state = buildInitialState(raw);
        state.quotas = nextQuotas;
        return state;
      });
    },

    setSplits: (splits) => {
      const nextSplits = clone(splits || []);

      updateState((raw) => {
        const state = buildInitialState(raw);
        state.splits.items = nextSplits;
        return syncPhaseToCurrentSplits(state);
      });
    },

    onAfterSave: () => {
      const rawState = getState();
      syncGameDataFromState(rawState);

      const state = getCurrentState();
      renderSummary(state);

      debug.log("Phase setup saved", {
        phaseCount: Object.keys(gameData?.phases || {}).length,
        quotaCount: Object.keys(gameData?.quotas || {}).length
      });
    }
  });

  if (typeof actsEditorApi?.open === "function") {
    actsEditorApi.open();
  }
}

function setupSubscriptions() {
  subscribe((raw) => {
    syncGameDataFromState(raw);

    const state = buildInitialState(raw);
    renderSummary(state);

    debug.setStatus("gameId", state.gameId);
    debug.setStatus("routeId", state.routeId || "");
    debug.setStatus("phaseCount", Object.keys(gameData?.phases || {}).length);
    debug.setStatus("quotaCount", Object.keys(gameData?.quotas || {}).length);
    debug.setStatus("activePhase", state.phase || "legacy_all");
    debug.setStatus("splitCount", state.splits?.items?.length || 0);
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

  const rawState = getState();

  if (Object.keys(safeObject(rawState?.phases)).length > 0) {
    gameData.phases = clone(rawState.phases);
  }

  if (Object.keys(safeObject(rawState?.quotas)).length > 0) {
    gameData.quotas = clone(rawState.quotas);
  }

  updateState((raw) => {
    const state = buildInitialState(raw);

    if (!Object.keys(safeObject(state.phases)).length && Object.keys(safeObject(gameData?.phases)).length) {
      state.phases = clone(gameData.phases);
    }

    if (!Object.keys(safeObject(state.quotas)).length && Object.keys(safeObject(gameData?.quotas)).length) {
      state.quotas = clone(gameData.quotas);
    }

    return syncPhaseToCurrentSplits(state);
  });

  renderHeader();
  setupActsEditor();
  setupLocalFileSave();
  setupSubscriptions();

  debug.setSnapshotBuilder(() => {
    const state = getCurrentState();
    const phases = safeObject(state?.phases);

    return {
      type: "phase-editor-compact",
      note: "Compact editor snapshot. Use phase exports only for file restore, not chat context.",
      at: new Date().toISOString(),
      context: {
        gameId,
        routeId,
        routeTitle: gameData?.meta?.activeRouteTitle || gameData?.meta?.title || ""
      },
      counts: {
        counters: Object.keys(gameData?.counters || {}).length,
        phases: Object.keys(phases).length,
        quotaPhases: Object.keys(safeObject(state?.quotas)).length,
        splits: state?.splits?.items?.length || 0
      },
      activePhase: state?.phase || "",
      phases: Object.entries(phases).map(([id, phase]) => ({
        id,
        label: phase?.label || "",
        targetMinutes: Number(phase?.targetMinutes || 0),
        visibleCount: (phase?.visibleCounters || phase?.visible || []).length,
        objectiveCount: (phase?.objectives || []).length
      }))
    };
  });

  const state = getCurrentState();
  renderSummary(state);

  debug.log("Phase editor page booted", {
    gameId,
    routeId,
    phaseCount: Object.keys(gameData?.phases || {}).length,
    quotaCount: Object.keys(gameData?.quotas || {}).length,
    splitCount: state.splits?.items?.length || 0,
    counters: Object.keys(gameData?.counters || {}).length
  });
}

boot().catch((error) => {
  debug.error("Phase editor page failed", {
    message: error.message,
    stack: error.stack
  });

  console.error(error);
});
