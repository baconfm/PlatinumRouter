import { loadGameData } from "./data-loader.js?v=20260712f";
import { buildInitialState, formatMs } from "./controller-core.js?v=20260712h";
import {
  getState,
  setStorageContext,
  subscribe,
  updateState
} from "./storage.js";

const GAME_ID = "days-gone";
const ROUTE_ID = "";
const DEATH_KEY = "deaths";
const RUN_TITLE = "Days Gone — No Guns Speedrun";
const RUN_SUBTITLE = "0 Gun Kills Challenge";

let gameData = null;
let lastState = null;
let renderInterval = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getLiveElapsedMs(state) {
  const elapsed = Math.max(0, Number(state?.timer?.elapsed || 0));
  if (!state?.timer?.running) return elapsed;

  const startTime = Number(state?.timer?.startTime || 0);
  if (!Number.isFinite(startTime) || startTime <= 0) return elapsed;

  return Math.max(0, Date.now() - startTime);
}

function getDeathMax() {
  return Math.max(1, Number(gameData?.counters?.[DEATH_KEY]?.max || 999));
}

function getDeathValue(state) {
  return clamp(Number(state?.counters?.[DEATH_KEY]?.value || 0), 0, getDeathMax());
}

function getCurrentState() {
  return buildInitialState(getState(), gameData, GAME_ID, ROUTE_ID);
}

function setChallengeState(updater) {
  updateState((raw) => {
    const state = buildInitialState(raw, gameData, GAME_ID, ROUTE_ID);
    updater(state);
    state.gameId = GAME_ID;
    state.routeId = ROUTE_ID;
    return state;
  });
}

function startTimer() {
  setChallengeState((state) => {
    if (state.timer.running) return;

    state.timer.running = true;
    state.timer.startTime = Date.now() - getLiveElapsedMs(state);
  });
}

function pauseTimer() {
  setChallengeState((state) => {
    if (!state.timer.running) return;

    state.timer.elapsed = getLiveElapsedMs(state);
    state.timer.running = false;
    state.timer.startTime = null;
  });
}

function toggleTimer() {
  const state = getCurrentState();
  if (state.timer?.running) pauseTimer();
  else startTimer();
}

function resetTimer() {
  setChallengeState((state) => {
    state.timer.elapsed = 0;
    state.timer.running = false;
    state.timer.startTime = null;
  });
}

function setDeaths(value) {
  setChallengeState((state) => {
    if (!state.counters[DEATH_KEY]) {
      state.counters[DEATH_KEY] = { value: 0, manualDelta: 0 };
    }

    const next = clamp(Number(value || 0), 0, getDeathMax());
    const current = Number(state.counters[DEATH_KEY]?.value || 0);
    state.counters[DEATH_KEY].value = next;
    state.counters[DEATH_KEY].manualDelta =
      Number(state.counters[DEATH_KEY].manualDelta || 0) + (next - current);
  });
}

function adjustDeaths(delta) {
  const state = getCurrentState();
  setDeaths(getDeathValue(state) + Number(delta || 0));
}

function resetDeaths() {
  setDeaths(0);
}

function resetRun() {
  setChallengeState((state) => {
    state.timer.elapsed = 0;
    state.timer.running = false;
    state.timer.startTime = null;

    if (state.counters[DEATH_KEY]) {
      state.counters[DEATH_KEY].value = 0;
      state.counters[DEATH_KEY].manualDelta = 0;
    }
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function render(state = lastState) {
  if (!state) return;

  const elapsed = getLiveElapsedMs(state);
  const deaths = getDeathValue(state);
  const running = !!state?.timer?.running;

  setText("challengeTimer", formatMs(elapsed));
  setText("challengeDeaths", String(deaths));
  setText("challengeStatus", running ? "Running" : "Paused");

  const startPauseBtn = document.getElementById("challengeStartPauseBtn");
  if (startPauseBtn) {
    startPauseBtn.textContent = running ? "Pause" : elapsed > 0 ? "Resume" : "Start";
  }

  const status = document.getElementById("challengeStatus");
  if (status) {
    status.classList.toggle("running", running);
  }
}

function bindControls() {
  document.getElementById("challengeStartPauseBtn")?.addEventListener("click", toggleTimer);
  document.getElementById("challengeResetTimerBtn")?.addEventListener("click", resetTimer);
  document.getElementById("challengeDeathMinusBtn")?.addEventListener("click", () => adjustDeaths(-1));
  document.getElementById("challengeDeathPlusBtn")?.addEventListener("click", () => adjustDeaths(1));
  document.getElementById("challengeDeathResetBtn")?.addEventListener("click", resetDeaths);
  document.getElementById("challengeResetRunBtn")?.addEventListener("click", resetRun);

  const overlayLink = document.getElementById("challengeOverlayLink");
  if (overlayLink) {
    overlayLink.href = "./days-gone-noguns-overlay.html?bg=clear";
  }
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    !!target.closest("input, textarea, select, [contenteditable='true']")
  );
}

function bindKeyboard() {
  if (document.body.classList.contains("nogunsObsBody")) return;

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || isTypingTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    switch (event.code) {
      case "Space":
        event.preventDefault();
        toggleTimer();
        break;
      case "KeyR":
        event.preventDefault();
        resetTimer();
        break;
      case "KeyD":
        event.preventDefault();
        adjustDeaths(event.shiftKey ? -1 : 1);
        break;
      default:
        break;
    }
  });
}

function applyOverlayOptions() {
  const params = new URLSearchParams(window.location.search);
  const bg = params.get("bg");

  if (document.body.classList.contains("nogunsObsBody")) {
    document.body.dataset.bg = bg === "flat" || bg === "clear" ? bg : "clear";
  }
}

async function boot() {
  document.title = document.body.classList.contains("nogunsObsBody")
    ? RUN_TITLE
    : `${RUN_TITLE} Controls`;

  setStorageContext(GAME_ID, ROUTE_ID);
  gameData = await loadGameData(GAME_ID, ROUTE_ID);

  updateState((raw) => buildInitialState(raw, gameData, GAME_ID, ROUTE_ID));

  if (!document.body.classList.contains("nogunsObsBody")) {
    bindControls();
    bindKeyboard();
  }
  applyOverlayOptions();

  subscribe((raw) => {
    lastState = buildInitialState(raw, gameData, GAME_ID, ROUTE_ID);
    render(lastState);
  });

  renderInterval = window.setInterval(() => render(lastState), 250);
}

window.addEventListener("beforeunload", () => {
  if (renderInterval) window.clearInterval(renderInterval);
});

boot().catch((error) => {
  console.error("Days Gone No Guns overlay failed to boot", error);
  setText("challengeTimer", "00:00:00");
  setText("challengeDeaths", "0");
  setText("challengeStatus", "Error");
});
