import { loadGameData } from "./data-loader.js?v=20260721a";
import { getState, setStorageContext, updateState } from "./storage.js";
import {
  applyAutoToCounters,
  buildHistoryEntry,
  buildInitialState,
  clone,
  formatMs,
  getActivePhase,
  summarizeManualEvents
} from "./controller-core.js?v=20260712h";
import { readStoredRouteId } from "./game-session.js";
import { getObjectiveIconMarkup } from "./objective-icons.js?v=20260712c";
import {
  DAYS_GONE_COLLECTIBLE_BY_ID,
  DAYS_GONE_TROPHY_BY_ID,
  loadDaysGoneCollectibleProgress,
  saveDaysGoneCollectibleProgress,
  loadDaysGoneTrophyProgress,
  saveDaysGoneTrophyProgress,
  loadDaysGoneCompletionProgress,
  saveDaysGoneCompletionProgress,
  loadDaysGoneMissedGoals,
  saveDaysGoneMissedGoals,
  pruneDaysGoneMissedGoals,
  recordDaysGoneMissedGoalsFromState,
  resolveDaysGoneOcrGoal
} from "./screen-tracker.js?v=20260725a";

const GAME_ID = "days-gone";
const routeId = readStoredRouteId(GAME_ID) || "";
setStorageContext(GAME_ID, routeId);

const listNode = document.getElementById("missedDashboardList");
const countNode = document.getElementById("missedCountPill");
const runStateNode = document.getElementById("missedRunState");
const refreshButton = document.getElementById("missedRefreshBtn");
const currentSplitTitleNode = document.getElementById("currentSplitTitle");
const currentSplitGoalsNode = document.getElementById("currentSplitGoals");
const completeCurrentSplitButton = document.getElementById("completeCurrentSplitBtn");
const undoCurrentSplitButton = document.getElementById("undoCurrentSplitBtn");

let gameData = null;
let lastMissedListSignature = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureManualLog(state) {
  if (!state.manualLog || typeof state.manualLog !== "object") {
    state.manualLog = { nextId: 1, events: [] };
  }
  if (!Array.isArray(state.manualLog.events)) {
    state.manualLog.events = [];
  }
  const nextId = Number(state.manualLog.nextId || 0);
  state.manualLog.nextId = Number.isFinite(nextId) && nextId > 0 ? Math.floor(nextId) : 1;
  return state.manualLog;
}

function addCounterDelta(state, counterKey, delta) {
  if (!counterKey || !delta || !gameData?.counters?.[counterKey]) return;
  const current = state.counters?.[counterKey] || { value: 0, manualDelta: 0 };
  const max = Number(state.totals?.[counterKey] ?? gameData.counters[counterKey]?.max ?? 0);
  const nextValue = clamp(Number(current.value || 0) + delta, 0, Math.max(0, max));

  state.counters[counterKey] = {
    value: nextValue,
    manualDelta: Number(current.manualDelta || 0) + delta
  };

  const manualLog = ensureManualLog(state);
  const splitIndex = Number(state.splits?.currentIndex || 0);
  const split = state.splits?.items?.[splitIndex] || {};
  manualLog.events.push({
    id: manualLog.nextId,
    counterKey,
    delta,
    valueAfter: nextValue,
    splitIndex,
    splitId: split.id || "",
    splitLabel: split.label || `Split ${splitIndex + 1}`,
    phaseId: state.phase || "",
    elapsedMs: Number(state.timer?.elapsed || 0),
    at: new Date().toISOString(),
    source: "missed-dashboard",
    countsAgainstSplitAuto: false,
    assignedCompletionIndex: null,
    completedAt: ""
  });
  manualLog.nextId += 1;
}

function getCompletedTrophyCount(completedTrophies) {
  return [...DAYS_GONE_TROPHY_BY_ID.values()]
    .filter((entry) => completedTrophies.has(entry.id)).length;
}

function syncTrophyCounterFromChecklist(state, completedTrophies) {
  const currentValue = Number(state?.counters?.trophies?.value || 0);
  const targetValue = getCompletedTrophyCount(completedTrophies);
  const delta = targetValue - currentValue;
  if (!delta) return;

  addCounterDelta(state, "trophies", delta);
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
    if (next > 0) remaining[key] = next;
    else delete remaining[key];
  });

  return remaining;
}

function completeCurrentSplit() {
  let advanced = false;

  updateState((raw) => {
    const state = buildInitialState(raw, gameData, GAME_ID, routeId);
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
    entry.source = "missed-dashboard";
    entry.reason = "manual-current-split-complete";

    state.splits.completed = [...(state.splits.completed || []), entry];
    state.splits.currentIndex = clamp(splitIndex + 1, 0, state.splits.items.length);
    state.phase = getActivePhase(state, gameData);
    advanced = true;
    return state;
  });

  if (advanced) render();
}

function undoCurrentSplit() {
  let reopenedSplitIndex = null;

  updateState((raw) => {
    const state = buildInitialState(raw, gameData, GAME_ID, routeId);
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
    reopenedSplitIndex = nextIndex;
    return state;
  });

  if (reopenedSplitIndex != null) {
    const remainingMissed = loadDaysGoneMissedGoals()
      .filter((item) => Number(item.splitIndex || 0) < reopenedSplitIndex);
    saveDaysGoneMissedGoals(remainingMissed);
    render();
  }
}

function getLinkedTrophyIdsForCollectibles(collectibleIds = []) {
  const ids = new Set(collectibleIds);
  return [...DAYS_GONE_TROPHY_BY_ID.values()]
    .filter((entry) => entry.linkedCollectibleId && ids.has(entry.linkedCollectibleId))
    .map((entry) => entry.id);
}

function getGoalCompletionIds(goal) {
  const collectibleIds = [];
  const trophyIds = [];
  const completionIds = [];

  if (goal.type === "collectible") {
    collectibleIds.push(goal.id);
    trophyIds.push(...getLinkedTrophyIdsForCollectibles(collectibleIds));
  }

  if (goal.type === "trophy") {
    trophyIds.push(goal.id);
    const trophy = DAYS_GONE_TROPHY_BY_ID.get(goal.id);
    if (trophy?.linkedCollectibleId) collectibleIds.push(trophy.linkedCollectibleId);
  }

  if (!["collectible", "trophy"].includes(goal.type)) completionIds.push(goal.id);

  return {
    collectibleIds: [...new Set(collectibleIds)],
    trophyIds: [...new Set(trophyIds)],
    completionIds: [...new Set(completionIds)]
  };
}

function completeMissedGoal(rawGoal) {
  const goal = resolveDaysGoneOcrGoal(rawGoal);
  if (!goal) return;

  const { collectibleIds, trophyIds, completionIds } = getGoalCompletionIds(goal);
  const completedCollectibles = loadDaysGoneCollectibleProgress();
  const completedTrophies = loadDaysGoneTrophyProgress();
  const completedCompletions = loadDaysGoneCompletionProgress();
  const collectibleCounterKeys = new Set(gameData?.meta?.collectibleCounterKeys || []);
  const newlyCompletedCollectibles = collectibleIds.filter((id) => !completedCollectibles.has(id));
  const newlyCompletedTrophies = trophyIds.filter((id) => !completedTrophies.has(id));
  const newlyCompletedCompletions = completionIds.filter((id) => !completedCompletions.has(id));

  newlyCompletedCollectibles.forEach((id) => completedCollectibles.add(id));
  newlyCompletedTrophies.forEach((id) => completedTrophies.add(id));
  newlyCompletedCompletions.forEach((id) => completedCompletions.add(id));
  saveDaysGoneCollectibleProgress(completedCollectibles);
  saveDaysGoneTrophyProgress(completedTrophies);
  saveDaysGoneCompletionProgress(completedCompletions);

  updateState((raw) => {
    const state = buildInitialState(raw, gameData, GAME_ID, routeId);

    newlyCompletedCollectibles.forEach((id) => {
      const entry = DAYS_GONE_COLLECTIBLE_BY_ID.get(id);
      if (!entry) return;
      addCounterDelta(state, entry.counterKey, 1);
      if (collectibleCounterKeys.has(entry.counterKey)) {
        addCounterDelta(state, "routecollectibles", 1);
      }
    });

    newlyCompletedTrophies.forEach(() => addCounterDelta(state, "trophies", 1));
    newlyCompletedCompletions.forEach(() => addCounterDelta(state, goal.counterKey, 1));
    syncTrophyCounterFromChecklist(state, completedTrophies);
    return state;
  });

  pruneDaysGoneMissedGoals(
    undefined,
    completedCollectibles,
    completedTrophies,
    completedCompletions
  );
  render();
}

function groupBySplit(items = []) {
  const groups = new Map();
  items.forEach((item) => {
    const key = `${Number(item.splitIndex || 0)}:${item.splitLabel || "Route"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        splitIndex: Number(item.splitIndex || 0),
        splitLabel: item.splitLabel || "Route",
        items: []
      });
    }
    groups.get(key).items.push(item);
  });
  return [...groups.values()].sort((a, b) => a.splitIndex - b.splitIndex);
}

function renderItem(item) {
  const goal = resolveDaysGoneOcrGoal(item) || item;
  const addedText = item.firstSeenElapsedMs ? `noticed at ${formatMs(item.firstSeenElapsedMs)}` : "noticed after split advance";
  const optionalText = goal.optional ? "optional" : "route goal";
  const kindText = goal.type === "trophy" ? "trophy" : goal.counterKey || "collectible";
  const isIpcaReminder = item.source === "nero-ipca-anchor-reminder";
  const locationHint = isIpcaReminder && item.bodyHint
    ? `<small>${escapeHtml(`Location hint: ${item.bodyHint}`)}</small>`
    : "";

  return `
    <article class="missedItem">
      <div>
        <strong>${escapeHtml(goal.label)}</strong>
        <small>${escapeHtml(`${kindText} - ${optionalText} - ${addedText}`)}</small>
        ${locationHint}
        <div class="missedItemMeta">
          <span class="missedMiniPill">${escapeHtml(goal.type || "goal")}</span>
          <span class="missedMiniPill">${escapeHtml(goal.counterKey || "")}</span>
        </div>
      </div>
      <button class="btn primary" type="button" data-complete-missed="${escapeHtml(item.key || `${goal.type}:${goal.id}`)}">
        ${isIpcaReminder ? "Confirm pickup" : "Complete"}
      </button>
    </article>
  `;
}

function getMissedItemKey(item = {}) {
  if (item.key) return String(item.key);
  const goal = resolveDaysGoneOcrGoal(item) || item;
  return `${goal.type || "goal"}:${goal.id || goal.label || ""}`;
}

function isCurrentGoalComplete(goal, completedCollectibles, completedTrophies, completedCompletions) {
  if (goal?.type === "trophy") return completedTrophies.has(goal.id);
  if (goal?.type === "collectible") return completedCollectibles.has(goal.id);
  return completedCompletions.has(goal.id);
}

function renderGoalIcon(counterKey, label) {
  const counter = gameData?.counters?.[counterKey] || {};
  return getObjectiveIconMarkup(counter.icon || counterKey || "default", label, "currentSplitGoalIcon");
}

function renderCurrentSplit(state, completedCollectibles, completedTrophies, completedCompletions) {
  if (!currentSplitTitleNode || !currentSplitGoalsNode || !completeCurrentSplitButton) return;

  const splitIndex = Number(state.splits?.currentIndex || 0);
  const split = state.splits?.items?.[splitIndex];
  if (!split) {
    currentSplitTitleNode.textContent = "Route complete";
    currentSplitGoalsNode.innerHTML = `<span class="currentSplitNoGoals">No remaining split goals.</span>`;
    completeCurrentSplitButton.disabled = true;
    if (undoCurrentSplitButton) {
      undoCurrentSplitButton.disabled = Number(state.splits?.completed?.length || 0) === 0;
    }
    return;
  }

  currentSplitTitleNode.textContent = `#${splitIndex + 1} ${split.label || `Split ${splitIndex + 1}`}`;
  completeCurrentSplitButton.disabled = false;
  if (undoCurrentSplitButton) {
    undoCurrentSplitButton.disabled = Number(state.splits?.currentIndex || 0) <= 0
      || Number(state.splits?.completed?.length || 0) <= 0;
  }

  const normalGoals = Object.entries(split.auto || {})
    .filter(([, amount]) => Number(amount || 0) !== 0)
    .map(([counterKey, amount]) => {
      const counter = gameData?.counters?.[counterKey] || {};
      const label = counter.shortLabel || counter.label || counterKey;
      return `
        <span class="currentSplitGoal normal" title="Normal split goal: ${escapeHtml(label)} +${Number(amount)}">
          ${renderGoalIcon(counterKey, label)}
          <span>${escapeHtml(label)}</span>
          <strong>+${Number(amount)}</strong>
        </span>
      `;
    });

  const ocrGoals = (Array.isArray(split.ocrGoals) ? split.ocrGoals : [])
    .map(resolveDaysGoneOcrGoal)
    .filter(Boolean)
    .map((goal) => {
      const done = isCurrentGoalComplete(
        goal,
        completedCollectibles,
        completedTrophies,
        completedCompletions
      );
      const counterKey = goal.counterKey || (goal.type === "trophy" ? "trophies" : "routecollectibles");
      return `
        <span class="currentSplitGoal ocr ${done ? "done" : "pending"}" title="${escapeHtml(goal.label)}">
          ${renderGoalIcon(counterKey, goal.label)}
          <span>${escapeHtml(goal.label)}</span>
          <strong>${done ? "Tracked" : "OCR"}</strong>
        </span>
      `;
    });

  const goals = [...normalGoals, ...ocrGoals];
  currentSplitGoalsNode.innerHTML = goals.length
    ? goals.join("")
    : `<span class="currentSplitNoGoals">No counter or OCR goals assigned to this split.</span>`;
}

function render() {
  if (!gameData || !listNode || !countNode || !runStateNode) return;

  const state = buildInitialState(getState(), gameData, GAME_ID, routeId);
  const completedCollectibles = loadDaysGoneCollectibleProgress();
  const completedTrophies = loadDaysGoneTrophyProgress();
  const completedCompletions = loadDaysGoneCompletionProgress();
  recordDaysGoneMissedGoalsFromState(state);
  const missed = pruneDaysGoneMissedGoals();
  const groups = groupBySplit(missed);

  renderCurrentSplit(state, completedCollectibles, completedTrophies, completedCompletions);

  countNode.textContent = `${missed.length} missed`;
  runStateNode.textContent = state.timer?.running
    ? `Timer running - ${formatMs(state.timer.elapsed)}`
    : `Timer idle - ${formatMs(state.timer?.elapsed || 0)}`;
  const listSignature = JSON.stringify(missed.map((item) => ({
    key: getMissedItemKey(item),
    splitIndex: Number(item.splitIndex || 0),
    splitLabel: item.splitLabel || "",
    label: item.label || "",
    source: item.source || "",
    bodyHint: item.bodyHint || ""
  })));
  if (listSignature !== lastMissedListSignature) {
    listNode.innerHTML = missed.length
      ? groups.map((group) => `
        <section class="missedGroup">
          <div class="missedGroupTitle">
            <span>#${group.splitIndex + 1} ${escapeHtml(group.splitLabel)}</span>
            <span>${group.items.length}</span>
          </div>
          ${group.items.map(renderItem).join("")}
        </section>
      `).join("")
      : `<div class="missedEmpty">Nothing missed from previous OCR-goal splits.</div>`;
    lastMissedListSignature = listSignature;
  }
}

async function boot() {
  gameData = await loadGameData(GAME_ID, routeId);
  render();
  window.setInterval(render, 1500);
}

refreshButton?.addEventListener("click", render);
completeCurrentSplitButton?.addEventListener("click", completeCurrentSplit);
undoCurrentSplitButton?.addEventListener("click", undoCurrentSplit);

listNode?.addEventListener("click", (event) => {
  const button = event.target instanceof HTMLElement
    ? event.target.closest("[data-complete-missed]")
    : null;
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const key = button.getAttribute("data-complete-missed") || "";
  const item = loadDaysGoneMissedGoals().find((entry) => getMissedItemKey(entry) === key);
  if (!item) {
    render();
    return;
  }
  button.disabled = true;
  button.textContent = "Completing...";
  completeMissedGoal(item);
});

window.addEventListener("storage", (event) => {
  if (!event.key || event.key.includes("days-gone") || event.key.includes("platinum-router-state")) {
    render();
  }
});

boot().catch((error) => {
  if (listNode) {
    listNode.innerHTML = `<div class="missedEmpty">Could not load dashboard: ${escapeHtml(error?.message || "unknown error")}</div>`;
  }
});
