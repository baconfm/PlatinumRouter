// js/controller-actions.js

import { updateState, resetState } from "./storage.js";
import {
  buildInitialState,
  clone,
  DEFAULT_SETTINGS,
  applyAutoToCounters,
  buildHistoryEntry,
  formatMs,
  getActivePhase,
  getDefaultTimerElapsedMs,
  summarizeManualEvents
} from "./controller-core.js?v=20260712h";
import { clamp, normalizeSplits } from "./split-logic.js?v=20260724d";

const RUN_EXPORT_ENDPOINT = "/.router-api/save-export";

export function buildExportBaseName(state) {
  const raw = `${state?.gameId || "run"}-${state?.routeId || "default"}`.toLowerCase();
  return raw.replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function buildTimesExportPayload(state, exportedAt = new Date().toISOString()) {
  return {
    timer: state?.timer || {},
    counters: state?.counters || {},
    totals: state?.totals || {},
    splits: state?.splits || {},
    settings: state?.settings || {},
    misc: state?.misc || {},
    manualLog: state?.manualLog || {},
    ui: state?.ui || {},
    gameId: state?.gameId || "",
    routeId: state?.routeId || "",
    exportedAt
  };
}

export function buildSplitLogExportPayload(state, exportedAt = new Date().toISOString()) {
  const currentSplitIndex = Number(state?.splits?.currentIndex || 0);
  const pendingManualEvents = Array.isArray(state?.manualLog?.events)
    ? state.manualLog.events.filter((event) => event.assignedCompletionIndex == null)
    : [];

  return {
    gameId: state?.gameId || "",
    routeId: state?.routeId || "",
    activePhaseId: state?.phase || "",
    exportedAt,
    currentSplitIndex,
    currentSplitLabel:
      state?.splits?.items?.[currentSplitIndex]?.label || "",
    completedSplits: state?.splits?.completed || [],
    pendingManualEvents,
    allManualEvents: state?.manualLog?.events || [],
    counters: state?.counters || {},
    totals: state?.totals || {}
  };
}

export function buildRunDataExportSnapshot(state) {
  const exportedAt = new Date().toISOString();
  const splitLogFilename = `${buildExportBaseName(state)}-split-log.json`;

  return {
    note: "Full backup payload. For AI/debugging, use Copy Compact Snapshot instead of pasting this.",
    exportedAt,
    files: {
      times: "times.json",
      splitLog: splitLogFilename
    },
    times: buildTimesExportPayload(state, exportedAt),
    splitLog: buildSplitLogExportPayload(state, exportedAt)
  };
}

export function createActionController({ gameData, debug, getCurrentState }) {
  let timerInterval = null;

  function getDefaultStartTimeMs() {
    return getDefaultTimerElapsedMs(gameData);
  }

  function getDefaultStartTimeText() {
    return formatMs(getDefaultStartTimeMs());
  }

  function syncPracticeStartTimeInput() {
    const input = document.getElementById("practiceStartTimeInput");
    const resetBtn = document.getElementById("resetStartTimeBtn");
    const text = getDefaultStartTimeText();

    if (input) {
      input.value = text;
      input.placeholder = text;
    }

    if (resetBtn) {
      resetBtn.textContent = `Reset to ${text}`;
    }
  }

  function ensureManualLog(state) {
    if (!state.manualLog || typeof state.manualLog !== "object") {
      state.manualLog = {
        nextId: 1,
        events: []
      };
      return state.manualLog;
    }

    if (!Array.isArray(state.manualLog.events)) {
      state.manualLog.events = [];
    }

    const nextId = Number(state.manualLog.nextId || 0);
    state.manualLog.nextId = Number.isFinite(nextId) && nextId > 0 ? Math.floor(nextId) : 1;
    return state.manualLog;
  }

  function getStateContext() {
    const current = getCurrentState();

    return {
      gameId: current?.gameId,
      routeId: current?.routeId || ""
    };
  }

  function setWholeState(nextState) {
    const context = getStateContext();
    updateState(() => buildInitialState(nextState, gameData, context.gameId, context.routeId));
  }

  function syncPhaseToState() {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      state.phase = getActivePhase(state, gameData);
      return state;
    });
  }

  function ensureTimerLoop() {
    const state = getCurrentState();

    if (!state.timer?.running) {
      stopTimerLoop();
      return;
    }

    if (timerInterval) return;

    timerInterval = window.setInterval(() => {
      updateState((raw) => {
        const context = getStateContext();
        const next = buildInitialState(raw, gameData, context.gameId, context.routeId);
        if (!next.timer.running) return next;

        next.timer.elapsed = Math.max(0, Date.now() - next.timer.startTime);
        return next;
      });
    }, 250);
  }

  function getAutoRemainingAfterTrackedManual(autoMap = {}, manualEvents = []) {
    const remaining = clone(autoMap || {});

    manualEvents.forEach((event) => {
      if (event?.countsAgainstSplitAuto !== true) return;

      const key = event?.counterKey || "";
      const delta = Number(event?.delta || 0);
      const planned = Number(remaining[key] || 0);

      if (!key || delta <= 0 || planned <= 0) return;

      const next = planned - Math.min(planned, delta);
      if (next > 0) {
        remaining[key] = next;
      } else {
        delete remaining[key];
      }
    });

    return remaining;
  }

  function stopTimerLoop() {
    if (!timerInterval) return;
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function startTimer() {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      if (state.timer.running) return state;

      state.timer.running = true;
      state.timer.startTime = Date.now() - state.timer.elapsed;
      return state;
    });

    ensureTimerLoop();
  }

  function pauseTimer() {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      if (!state.timer.running) return state;

      state.timer.elapsed = Math.max(0, Date.now() - state.timer.startTime);
      state.timer.running = false;
      state.timer.startTime = null;
      return state;
    });

    stopTimerLoop();
  }

  function toggleTimer() {
    const state = getCurrentState();
    if (state.timer?.running) pauseTimer();
    else startTimer();
  }

  function completeSplit(options = {}) {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      const manualLog = ensureManualLog(state);
      const splitIndex = Number(state.splits?.currentIndex || 0);
      const split = state.splits?.items?.[splitIndex];

      if (!split) return state;

      const completionIndex = Number(state.splits?.completed?.length || 0);
      const completedAt = new Date().toISOString();
      const manualEvents = manualLog.events
        .filter((event) => event.assignedCompletionIndex == null && Number(event.splitIndex) === splitIndex)
        .map((event) => {
          event.assignedCompletionIndex = completionIndex;
          event.completedAt = completedAt;
          return event;
        });
      const remainingAuto = getAutoRemainingAfterTrackedManual(split.auto || {}, manualEvents);

      applyAutoToCounters(state, gameData, remainingAuto, 1);

      const entry = buildHistoryEntry(state, splitIndex, split, {
        manualEvents,
        manualApplied: summarizeManualEvents(manualEvents)
      });
      entry.autoApplied = remainingAuto;
      if (options.source) entry.source = String(options.source);
      if (options.reason) entry.reason = String(options.reason);
      state.splits.completed = [...(state.splits.completed || []), entry];
      state.splits.currentIndex = clamp(splitIndex + 1, 0, state.splits.items.length);
      state.phase = getActivePhase(state, gameData);

      return state;
    });
  }

  function completeCurrentSplit(options = {}) {
    const state = getCurrentState();
    if (!state.splits?.items?.[state.splits?.currentIndex]) return false;
    completeSplit(options);
    return true;
  }

  function undoSplit() {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      const manualLog = ensureManualLog(state);
      const nextIndex = Number(state.splits?.currentIndex || 0) - 1;

      if (nextIndex < 0) return state;

      const split = state.splits?.items?.[nextIndex];
      const lastCompletionIndex = Number(state.splits?.completed?.length || 0) - 1;
      const lastCompletion = lastCompletionIndex >= 0
        ? state.splits?.completed?.[lastCompletionIndex]
        : null;

      if (split) {
        const appliedAuto = lastCompletion?.autoApplied && typeof lastCompletion.autoApplied === "object"
          ? lastCompletion.autoApplied
          : split.auto || {};
        applyAutoToCounters(state, gameData, appliedAuto, -1);
      }

      if (lastCompletionIndex >= 0) {
        manualLog.events.forEach((event) => {
          if (Number(event.assignedCompletionIndex) === lastCompletionIndex) {
            event.assignedCompletionIndex = null;
            event.completedAt = "";
          }
        });
      }

      state.splits.currentIndex = nextIndex;
      state.splits.completed = (state.splits.completed || []).slice(0, -1);
      state.phase = getActivePhase(state, gameData);

      return state;
    });
  }

  function adjustCounter(counterKey, delta, options = {}) {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      const manualLog = ensureManualLog(state);
      const counter = state.counters?.[counterKey];
      const max = Number(state.totals?.[counterKey] || gameData?.counters?.[counterKey]?.max || 0);

      if (!counter) return state;

      const current = Number(counter.value || 0);
      const next = clamp(current + Number(delta || 0), 0, max);
      const appliedDelta = next - current;

      if (!appliedDelta) return state;

      counter.value = next;
      counter.manualDelta = Number(counter.manualDelta || 0) + appliedDelta;

      const splitIndex = Number(state.splits?.currentIndex || 0);
      const split = state.splits?.items?.[splitIndex] || null;

      manualLog.events.push({
        id: manualLog.nextId,
        counterKey,
        delta: appliedDelta,
        valueAfter: next,
        splitIndex,
        splitId: split?.id || "",
        splitLabel: split?.label || `Split ${splitIndex + 1}`,
        phaseId: state.phase || getActivePhase(state, gameData),
        elapsedMs: Number(state.timer?.elapsed || 0),
        at: new Date().toISOString(),
        source: options.source || "",
        countsAgainstSplitAuto: options.countsAgainstSplitAuto === true,
        assignedCompletionIndex: null,
        completedAt: ""
      });
      manualLog.nextId += 1;

      return state;
    });
  }

  function confirmScreenTrackerSuggestion(suggestion = {}) {
    const counterKey = suggestion?.counterKey || "";
    const delta = Number(suggestion?.delta || 1);

    if (!counterKey || !delta) return false;

    adjustCounter(counterKey, delta, {
      source: "screen-tracker",
      countsAgainstSplitAuto: suggestion?.countsAgainstSplitAuto !== false
    });

    (suggestion?.extraCounters || []).forEach((extra) => {
      const extraKey = extra?.counterKey || "";
      const extraDelta = Number(extra?.delta || 0);
      if (!extraKey || !extraDelta) return;

      adjustCounter(extraKey, extraDelta, {
        source: "screen-tracker",
        countsAgainstSplitAuto: extra?.countsAgainstSplitAuto === true
      });
    });

    return true;
  }

  function applyCounterDelta(counterKey, delta, options = {}) {
    const key = String(counterKey || "");
    const n = Number(delta || 0);
    if (!key || !n || !gameData?.counters?.[key]) return false;

    adjustCounter(key, n, options);
    return true;
  }

  function setDirge(done) {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);

      state.misc.dirgeDone = !!done;

      return state;
    });
  }

  function toggleDirge() {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);

      state.misc.dirgeDone = !state.misc.dirgeDone;

      return state;
    });
  }

  function toggleSettings() {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      state.ui.settingsOpen = !state.ui.settingsOpen;
      return state;
    });
  }

  function setShowDeathCounter(enabled) {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      state.settings.showDeathCounter = !!enabled;
      return state;
    });
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 250);
  }

  function setExportStatus(message, kind = "") {
    const status = document.getElementById("runDataExportStatus");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("is-ok", kind === "ok");
    status.classList.toggle("is-error", kind === "error");
  }

  async function saveRunExport(filename, payload, kind) {
    const response = await fetch(RUN_EXPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        gameId: payload.gameId,
        routeId: payload.routeId || "",
        kind,
        filename,
        data: payload
      })
    });

    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `Local export API failed (${response.status})`);
    }

    return result;
  }

  async function exportJson(filename, payload, kind) {
    setExportStatus("Saving...", "");

    try {
      const result = await saveRunExport(filename, payload, kind);
      const path = result?.path || filename;
      setExportStatus(`Saved: ${path}`, "ok");
      debug.log("Run data export saved", {
        kind,
        path
      });
    } catch (error) {
      const message = error?.message || "unknown";
      const shortMessage = message.includes("404")
        ? "server needs restart"
        : message.slice(0, 80);
      setExportStatus(`Local save failed (${shortMessage}); browser download started`, "error");
      debug.warn("Run data local export failed, falling back to browser download", {
        kind,
        filename,
        message
      });
      downloadJson(filename, payload);
    }
  }

  async function readFileAsJson(file) {
    return JSON.parse(await file.text());
  }

  async function exportTimes() {
    const state = getCurrentState();
    await exportJson("times.json", buildTimesExportPayload(state), "times");
  }

  async function exportSplitLog() {
    const state = getCurrentState();
    await exportJson(
      `${buildExportBaseName(state)}-split-log.json`,
      buildSplitLogExportPayload(state),
      "split-log"
    );
  }

  async function importTimes(file) {
    try {
      const parsed = await readFileAsJson(file);

      updateState((raw) => {
        const context = getStateContext();
        const current = buildInitialState(raw, gameData, context.gameId, context.routeId);
        const next = buildInitialState({
          ...current,
          ...parsed,
          settings: {
            ...current.settings,
            ...(parsed.settings || {})
          },
          misc: {
            ...current.misc,
            ...(parsed.misc || {})
          },
          ui: {
            ...current.ui,
            ...(parsed.ui || {})
          }
        }, gameData, context.gameId, context.routeId);

        if (next.timer.running) {
          next.timer.startTime = Date.now() - next.timer.elapsed;
        }

        next.phase = getActivePhase(next, gameData);
        return next;
      });
    } catch (error) {
      debug.error("Failed to import times", { message: error.message });
      alert("Could not import times JSON");
    }
  }

  async function importSplits(file) {
    try {
      const parsed = await readFileAsJson(file);
      const nextSplits = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.splits)
          ? parsed.splits
          : null;

      if (!nextSplits) {
        throw new Error("Missing splits array");
      }

      updateState((raw) => {
        const context = getStateContext();
        const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
        state.splits.items = normalizeSplits(nextSplits, gameData?.defaultSplits || []);
        state.splits.useSavedItems = true;
        state.splits.currentIndex = clamp(
          Number(state.splits.currentIndex || 0),
          0,
          state.splits.items.length
        );

        state.splits.completed = (state.splits.completed || []).filter(
          (entry) => Number(entry.splitIndex) < state.splits.items.length
        );

        state.phase = getActivePhase(state, gameData);
        return state;
      });
    } catch (error) {
      debug.error("Failed to import splits", { message: error.message });
      alert("Could not import splits JSON");
    }
  }

  function parseTimeStringToMs(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{1,3}):([0-5]\d):([0-5]\d)$/);

    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return null;
    }

    return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
  }

  function setTimerElapsed(nextElapsedMs) {
    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      const elapsed = Math.max(0, Number(nextElapsedMs || 0));

      state.timer.elapsed = elapsed;

      if (state.timer.running) {
        state.timer.startTime = Date.now() - elapsed;
      } else {
        state.timer.startTime = null;
      }

      return state;
    });
  }

  function applyPracticeStartTime() {
    const input = document.getElementById("practiceStartTimeInput");
    const parsedMs = parseTimeStringToMs(input?.value);

    if (parsedMs == null) {
      alert("Use HH:MM:SS format, for example 07:00:00");
      return;
    }

    setTimerElapsed(parsedMs);
  }

  function resetPracticeStartTime() {
    const input = document.getElementById("practiceStartTimeInput");
    const defaultStartTimeMs = getDefaultStartTimeMs();
    const defaultStartTimeText = getDefaultStartTimeText();

    if (input) {
      input.value = defaultStartTimeText;
    }

    setTimerElapsed(defaultStartTimeMs);
  }

  function resetRun() {
    if (!window.confirm("Reset timer, counters, and split progress?")) return;

    const current = getCurrentState();
    stopTimerLoop();

    resetState();

    updateState((raw) => {
      const context = getStateContext();
      const state = buildInitialState(raw, gameData, context.gameId, context.routeId);
      state.settings = clone(current.settings || DEFAULT_SETTINGS);
      state.ui.settingsOpen = !!current.ui?.settingsOpen;
      state.splits.items = normalizeSplits(undefined, gameData?.defaultSplits || []);
      state.splits.useSavedItems = false;
      state.splits.currentIndex = 0;
      state.splits.completed = [];
      state.phase = getActivePhase(state, gameData);
      return state;
    });

    window.dispatchEvent(new CustomEvent("platinum-router-run-reset", {
      detail: {
        gameId: current.gameId || gameData?.meta?.id || "",
        routeId: current.routeId || ""
      }
    }));

    const input = document.getElementById("practiceStartTimeInput");
    if (input) input.value = getDefaultStartTimeText();
  }

  function isTypingTarget(target) {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      !!target.closest("input, textarea, select, [contenteditable='true']")
    );
  }

  function isNativeActionTarget(target) {
    return target instanceof HTMLElement && !!target.closest("button, a, summary, label");
  }

  function handleDocumentClick(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const splitBtn = event.target.closest("[data-split-index]");
    if (splitBtn) {
      const splitIndex = Number(splitBtn.dataset.splitIndex || -1);
      const currentIndex = Number(getCurrentState().splits?.currentIndex || 0);

      if (splitIndex === currentIndex) {
        completeSplit();
      }

      return;
    }

    const counterBtn = event.target.closest("[data-counter-key]");
    if (!counterBtn) {
      const miscBtn = event.target.closest("[data-misc-action]");
      if (miscBtn?.dataset?.miscAction === "toggle-dirge") {
        toggleDirge();
      } else if (miscBtn?.dataset?.miscAction === "set-dirge") {
        setDirge(miscBtn.dataset.value === "1");
      }
      return;
    }

    const key = counterBtn.dataset.counterKey;
    const delta = Number(counterBtn.dataset.delta || 0);

    if (!key || !delta) return;
    adjustCounter(key, delta);
  }

  function handleMiscTokenClick(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const miscBtn = event.target.closest("[data-misc-action]");
    if (!miscBtn) return;

    const action = miscBtn.dataset.miscAction;
    if (action !== "toggle-dirge" && action !== "set-dirge") return;

    event.preventDefault();
    event.stopPropagation();

    if (action === "set-dirge") {
      setDirge(miscBtn.dataset.value === "1");
      return;
    }

    toggleDirge();
  }

  function handleKeyboardShortcuts(event) {
    if (event.defaultPrevented || event.repeat) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;

    if ((event.code === "Space" || event.code === "Enter") && isNativeActionTarget(event.target)) {
      return;
    }

    switch (event.code) {
      case "Space":
        event.preventDefault();
        toggleTimer();
        break;

      case "Enter":
        event.preventDefault();
        const state = getCurrentState();
        if (state.splits?.items?.[state.splits?.currentIndex]) {
          completeSplit();
        }
        break;

      case "Backspace":
        event.preventDefault();
        undoSplit();
        break;

      case "KeyS":
        event.preventDefault();
        toggleSettings();
        break;

      case "KeyD": {
        const state = getCurrentState();
        const deathCounterEnabled = !!state.settings?.showDeathCounter && !!state.counters?.deaths;
        if (!deathCounterEnabled) break;

        event.preventDefault();
        adjustCounter("deaths", event.shiftKey ? -1 : 1);
        break;
      }

      default:
        break;
    }
  }

  function bindStaticEvents() {
    const startPauseBtn = document.getElementById("startPauseBtn");
    const undoBtn = document.getElementById("undoBtn");
    const advanceCurrentBtn = document.getElementById("advanceCurrentBtn");
    const settingsToggle = document.getElementById("settingsToggle");
    const showDeathCounterInput = document.getElementById("showDeathCounterInput");

    syncPracticeStartTimeInput();

    startPauseBtn?.addEventListener("click", toggleTimer);
    undoBtn?.addEventListener("click", undoSplit);
    advanceCurrentBtn?.addEventListener("click", completeSplit);
    settingsToggle?.addEventListener("click", toggleSettings);
    showDeathCounterInput?.addEventListener("change", (event) => {
      setShowDeathCounter(!!event.target?.checked);
    });

    startPauseBtn?.setAttribute("title", "Shortcut: Space");
    startPauseBtn?.setAttribute("aria-keyshortcuts", "Space");
    undoBtn?.setAttribute("title", "Shortcut: Backspace");
    undoBtn?.setAttribute("aria-keyshortcuts", "Backspace");
    advanceCurrentBtn?.setAttribute("title", "Shortcut: Enter");
    advanceCurrentBtn?.setAttribute("aria-keyshortcuts", "Enter");
    settingsToggle?.setAttribute("title", "Shortcut: S");
    settingsToggle?.setAttribute("aria-keyshortcuts", "S");

    document.getElementById("exportTimesBtn")?.addEventListener("click", () => {
      exportTimes().catch((error) => {
        setExportStatus("Export failed", "error");
        debug.error("Failed to export times", {
          message: error?.message || "unknown"
        });
      });
    });
    document.getElementById("exportSplitLogBtn")?.addEventListener("click", () => {
      exportSplitLog().catch((error) => {
        setExportStatus("Export failed", "error");
        debug.error("Failed to export split log", {
          message: error?.message || "unknown"
        });
      });
    });
    document.getElementById("resetBtn")?.addEventListener("click", resetRun);

    document.getElementById("setStartTimeBtn")?.addEventListener("click", applyPracticeStartTime);
    document.getElementById("resetStartTimeBtn")?.addEventListener("click", resetPracticeStartTime);

    document.getElementById("practiceStartTimeInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyPracticeStartTime();
      }
    });

    document.getElementById("importTimesInput")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await importTimes(file);
      event.target.value = "";
    });

    document.getElementById("importSplitsInput")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await importSplits(file);
      event.target.value = "";
    });

    document.addEventListener("click", handleMiscTokenClick, true);
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyboardShortcuts);
  }

  return {
    setWholeState,
    syncPhaseToState,
    ensureTimerLoop,
    stopTimerLoop,
    bindStaticEvents,
    completeCurrentSplit,
    applyCounterDelta,
    confirmScreenTrackerSuggestion
  };
}
