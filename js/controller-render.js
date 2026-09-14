// js/controller-render.js

import { renderUI } from "./ui-render.js?v=20260711h";
import { computeDashboardPace, computeRouteHealth, formatMs, getActivePhase } from "./controller-core.js?v=20260725a";

function buildRuntimeMeta(gameData, state) {
  return {
    ...(gameData?.meta || {}),
    showDeathCounter: !!state?.settings?.showDeathCounter
  };
}

export function createRenderController({ gameData, debug, getCurrentState }) {
  let lastFullRenderKey = "";

  function buildCounterDefsForUi() {
    const result = {};

    Object.entries(gameData?.counters || {}).forEach(([key, def]) => {
      result[key] = {
        ...def,
        max: Number(gameData?.counters?.[key]?.max || 0)
      };
    });

    return result;
  }

  function buildUiCounters(state) {
    const result = {};

    Object.entries(gameData?.counters || {}).forEach(([key, def]) => {
      result[key] = {
        label: def.label,
        shortLabel: def.shortLabel,
        queueLabel: def.queueLabel,
        icon: def.icon,
        displayMode: def.displayMode || "",
        nonProgress: !!def.nonProgress,
        max: Number(state?.totals?.[key] || def.max || 0),
        value: Number(state?.counters?.[key]?.value || 0),
        manualDelta: Number(state?.counters?.[key]?.manualDelta || 0)
      };
    });

    return result;
  }

  function buildFullRenderKey(state) {
    return JSON.stringify({
      counters: state?.counters || {},
      totals: state?.totals || {},
      splits: {
        currentIndex: Number(state?.splits?.currentIndex || 0),
        completed: state?.splits?.completed || [],
        items: state?.splits?.items || []
      },
      phase: state?.phase || "legacy_all",
      settings: state?.settings || {},
      misc: state?.misc || {},
      ui: state?.ui || {}
    });
  }

  function updateFastUi(state) {
    const timerValue = document.getElementById("timer");
    if (timerValue) {
      timerValue.textContent = formatMs(Number(state?.timer?.elapsed || 0));
    }

    updatePaceUi(state);

    const startPauseBtn = document.getElementById("startPauseBtn");
    if (startPauseBtn) {
      startPauseBtn.textContent = state?.timer?.running ? "Pause [Space]" : "Start [Space]";
    }
  }

  function updatePaceUi(state) {
    const pace = computeDashboardPace(state, gameData);
    const paceCard = document.getElementById("paceCard");
    const pacePill = document.getElementById("pacePill");
    const paceSplitEstimate = document.getElementById("paceSplitEstimate");
    const paceRunEstimate = document.getElementById("paceRunEstimate");
    const paceDetail = document.getElementById("paceDetail");

    if (paceCard) {
      paceCard.dataset.paceTone = pace?.tone || "neutral";
    }

    if (pacePill) {
      pacePill.textContent = pace?.label || "No target";
    }

    if (paceSplitEstimate) {
      paceSplitEstimate.textContent = pace?.splitEstimate || "No split estimate";
    }

    if (paceRunEstimate) {
      paceRunEstimate.textContent = pace?.runEstimate || "No full-run estimate";
    }

    if (paceDetail) {
      paceDetail.textContent = pace?.detail || "No weighted estimate";
    }
  }

  function updateExtraUi(state) {
    const supportsDirge = !!gameData?.meta?.supportsDirge;
    const routeBadgeText =
      gameData?.meta?.activeRouteBadge ||
      gameData?.meta?.activeRouteShortTitle ||
      gameData?.meta?.activeRouteTitle ||
      "";
    const routeTitle =
      gameData?.meta?.overlayTitle ||
      gameData?.meta?.title ||
      "Platinum Router";
    const activeGameId = state?.gameId || gameData?.meta?.id || "";
    const activeRouteId = state?.routeId || gameData?.meta?.activeRouteId || "";

    const routeDifficulty =
      gameData?.meta?.difficulty ||
      gameData?.meta?.defaultDifficulty ||
      state?.settings?.difficulty ||
      "";

    const runTitle = document.getElementById("runTitle");
    if (runTitle) {
      const appendDifficulty = gameData?.meta?.appendDifficultyToTitle !== false;
      runTitle.textContent =
        routeDifficulty && appendDifficulty
          ? `${routeTitle} ${routeDifficulty}`
          : routeTitle;
    }

    document.title = routeTitle;

    const difficultyBadge = document.getElementById("difficultyBadge");
    if (difficultyBadge) {
      difficultyBadge.textContent = routeBadgeText || routeDifficulty || "Route";
      difficultyBadge.title = routeDifficulty || routeBadgeText || "Route";
      difficultyBadge.classList.toggle("lethal", routeDifficulty === "Lethal");
      difficultyBadge.hidden = !(routeBadgeText || routeDifficulty);
    }

    [
      ["obsOverlayLink", "./overlay.html"],
      ["obsMiniOverlayLink", "./minoverlay.html"]
    ].forEach(([id, href]) => {
      const link = document.getElementById(id);
      if (!link) return;

      const url = new URL(href, window.location.href);
      if (activeGameId) url.searchParams.set("gameId", activeGameId);
      if (activeRouteId) url.searchParams.set("routeId", activeRouteId);
      const theme = document.documentElement.dataset.theme || "";
      if (theme) url.searchParams.set("theme", theme);
      link.href = `${url.pathname}${url.search}${url.hash}`;
    });

    updatePaceUi(state);

    const collectiblesCard = document.getElementById("collectiblesCard");
    if (collectiblesCard) {
      const hasCollectibleAggregate =
        Number(gameData?.meta?.collectibleTotal || 0) > 0 &&
        Array.isArray(gameData?.meta?.collectibleCounterKeys) &&
        gameData.meta.collectibleCounterKeys.length > 0;

      collectiblesCard.hidden = !hasCollectibleAggregate;
      collectiblesCard.style.display = hasCollectibleAggregate ? "" : "none";
    }

    const startPauseBtn = document.getElementById("startPauseBtn");
    if (startPauseBtn) {
      startPauseBtn.textContent = state?.timer?.running ? "Pause [Space]" : "Start [Space]";
    }

    const settingsPanel = document.getElementById("settingsPanel");
    const settingsToggle = document.getElementById("settingsToggle");
    const settingsOpen = !!state?.ui?.settingsOpen;

    if (settingsPanel) {
      settingsPanel.classList.toggle("open", settingsOpen);
      settingsPanel.hidden = !settingsOpen;
      settingsPanel.style.display = settingsOpen ? "block" : "none";
    }

    if (settingsToggle) {
      settingsToggle.textContent = settingsOpen ? "Hide Settings [S]" : "Show Settings [S]";
      settingsToggle.setAttribute("aria-expanded", String(settingsOpen));
    }

    const showDeathCounterInput = document.getElementById("showDeathCounterInput");
    if (showDeathCounterInput) {
      const hasDeathCounter = !!gameData?.counters?.deaths;
      showDeathCounterInput.checked = !!state?.settings?.showDeathCounter && hasDeathCounter;
      showDeathCounterInput.disabled = !hasDeathCounter;
    }

    document.querySelectorAll('[data-misc-key="dirge"]').forEach((token) => {
      token.hidden = !supportsDirge;
      token.setAttribute("aria-pressed", String(!!state?.misc?.dirgeDone));
      token.classList.toggle("miscToken-done", !!state?.misc?.dirgeDone);
    });

    const currentSplitLabel = document.getElementById("currentSplitLabel");
    const currentSplit = state?.splits?.items?.[state?.splits?.currentIndex] || null;
    if (currentSplitLabel) {
      currentSplitLabel.textContent = currentSplit?.label || "Run complete";
    }

    const historyCount = document.getElementById("historyCount");
    if (historyCount) {
      historyCount.textContent = `${(state?.splits?.completed || []).length} splits logged`;
    }

    const modePill = document.getElementById("modePill");
    if (modePill) {
      modePill.textContent = routeDifficulty || routeBadgeText || "Route";
    }

    const queuePill = document.getElementById("queuePill");
    if (queuePill) {
      queuePill.textContent = `${(state?.splits?.items || []).length} total splits`;
    }

    const historySaved = document.getElementById("historySaved");
    if (historySaved) {
      historySaved.textContent = `${(state?.splits?.completed || []).length} saved`;
    }

    const advanceCurrentBtn = document.getElementById("advanceCurrentBtn");
    if (advanceCurrentBtn) {
      const hasCurrentSplit = !!currentSplit;
      advanceCurrentBtn.disabled = !hasCurrentSplit;
      advanceCurrentBtn.textContent = hasCurrentSplit
        ? "Complete Current Split [Enter]"
        : "Run Complete";
    }
  }

  function render() {
    const state = getCurrentState();
    const fullRenderKey = buildFullRenderKey(state);

    if (fullRenderKey !== lastFullRenderKey) {
      const uiState = {
        elapsedMs: Number(state?.timer?.elapsed || 0),
        counters: buildUiCounters(state),
        splits: state?.splits?.items || [],
        currentSplitIndex: Number(state?.splits?.currentIndex || 0),
        settings: {
          ...(state?.settings || {}),
          __timerRunning: !!state?.timer?.running
        },
        miscChecks: {
          dirge: !!state?.misc?.dirgeDone
        },
        history: state?.splits?.completed || [],
        activePhaseId: state?.phase || getActivePhase(state, gameData),
        routeHealth: computeRouteHealth(state, gameData)
      };

      renderUI({
        state: uiState,
        counters: buildCounterDefsForUi(),
        phases: gameData?.phases || {},
        meta: buildRuntimeMeta(gameData, state),
        quotas: gameData?.quotas || {}
      });

      updateExtraUi(state);
      lastFullRenderKey = fullRenderKey;
    } else {
      updateFastUi(state);
    }

    debug.setStatus("gameId", state?.gameId);
    debug.setStatus("routeId", state?.routeId || "");
    debug.setStatus("elapsedMs", state?.timer?.elapsed || 0);
    debug.setStatus("running", !!state?.timer?.running);
    debug.setStatus("currentSplitIndex", state?.splits?.currentIndex || 0);
    debug.setStatus("splitCount", (state?.splits?.items || []).length);
    debug.setStatus("activePhase", state?.phase || "legacy_all");
    debug.setStatus("settingsOpen", !!state?.ui?.settingsOpen);
    debug.setStatus("defaultSplitCount", (gameData?.defaultSplits || []).length);
    debug.setStatus("splitSource", state?.splits?.useSavedItems ? "imported/local" : "route-file");
    debug.setStatus("routeHealth", computeRouteHealth(state, gameData).ok ? "ok" : "attention");
  }

  return {
    render
  };
}
