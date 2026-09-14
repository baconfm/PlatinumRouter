import { getObjectiveIconMarkup } from "./objective-icons.js?v=20260712c";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMs(ms) {
  const totalSeconds = Math.floor((ms || 0) / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percent(value, max) {
  if (!max || max <= 0) return 0;
  return clamp(Math.floor((Number(value || 0) / Number(max)) * 100), 0, 100);
}

function hexToRgb(hex) {
  const raw = String(hex || "").trim().replace("#", "");
  const normalized =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function withAlpha(hex, alpha, fallback = `rgba(119, 168, 255, ${alpha})`) {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function buildToneStyles(def = {}) {
  const accent = def?.accent || "#77a8ff";
  return [
    `--accent:${accent}`,
    `--accent-soft:${withAlpha(accent, 0.14)}`,
    `--accent-mid:${withAlpha(accent, 0.24)}`,
    `--accent-strong:${withAlpha(accent, 0.42)}`
  ].join(";");
}

function getCounterTitle(def, fallback) {
  return def?.requirement || def?.description || fallback;
}

function getCurrentSplit(splits, currentSplitIndex) {
  if (!Array.isArray(splits)) return null;
  if (currentSplitIndex < 0 || currentSplitIndex >= splits.length) return null;
  return splits[currentSplitIndex];
}

function getSplitStatus(index, currentSplitIndex) {
  if (index < currentSplitIndex) return "done";
  if (index === currentSplitIndex) return "current";
  return "upcoming";
}

function getVisibleCounterKeysForPhase(activePhaseId, phases, counters) {
  const phase = phases?.[activePhaseId];

  if (!phase) {
    return Object.keys(counters || {});
  }

  if (Array.isArray(phase.visibleCounters) && phase.visibleCounters.length > 0) {
    return phase.visibleCounters;
  }

  if (Array.isArray(phase.objectives) && phase.objectives.length > 0) {
    return phase.objectives;
  }

  return Object.keys(counters || {});
}

function getPhaseInfoFromCurrentSplit(splits, currentSplitIndex, phases, explicitPhaseId) {
  const currentSplit = getCurrentSplit(splits, currentSplitIndex);

  const phaseId =
    explicitPhaseId ||
    currentSplit?.phase ||
    currentSplit?.phaseId ||
    currentSplit?.act ||
    "legacy_all";

  return {
    activePhaseId: phaseId,
    activePhase: phases?.[phaseId] || null
  };
}

function getOverallProgress(counters, overallCounterKeys = []) {
  const entries =
    Array.isArray(overallCounterKeys) && overallCounterKeys.length > 0
      ? overallCounterKeys
        .map((key) => counters?.[key])
        .filter((item, index) => {
          const key = overallCounterKeys[index];
          return key !== "deaths" && item && !item?.nonProgress;
        })
      : Object.entries(counters || {})
        .filter(([key, item]) => key !== "deaths" && !item?.nonProgress)
        .map(([, item]) => item);

  if (!entries.length) return 0;

  const current = entries.reduce((sum, item) => sum + Number(item?.value || 0), 0);
  const total = entries.reduce((sum, item) => sum + Number(item?.max || 0), 0);

  return percent(current, total);
}

function getHiddenCounterKeys(meta, surface) {
  const keys = meta?.hiddenCounters?.[surface];
  const hidden = new Set(Array.isArray(keys) ? keys : []);

  if (!meta?.showDeathCounter) {
    hidden.add("deaths");
  }

  return hidden;
}

function isCollectibleKey(meta, key) {
  return Array.isArray(meta?.collectibleCounterKeys) && meta.collectibleCounterKeys.includes(key);
}

function buildBaseCounterEntry(key, counters, counterDefs) {
  if (!counters?.[key] && !counterDefs?.[key]) {
    return null;
  }

  const def = counterDefs?.[key] || {};
  const counter = counters?.[key] || {};

  return {
    key,
    label: def.label || key,
    shortLabel: def.shortLabel || def.queueLabel || def.label || key,
    queueLabel: def.queueLabel || def.shortLabel || def.label || key,
    icon: def.icon || "",
    accent: def.accent || "",
    description: def.description || "",
    requirement: def.requirement || def.description || "",
    value: Number(counter?.value || 0),
    max: Number(counter?.max || def?.max || 0),
    manualDelta: Number(counter?.manualDelta || 0),
    displayMode: def.displayMode || "",
    nonProgress: !!def.nonProgress,
    readOnly: false
  };
}

function buildCollectibleAggregate(meta, counters) {
  const sourceKeys = Array.isArray(meta?.collectibleCounterKeys) ? meta.collectibleCounterKeys : [];
  const total = Number(meta?.collectibleTotal || 0);

  if (!sourceKeys.length || total <= 0) {
    return null;
  }

  const value = sourceKeys.reduce((sum, key) => {
    return sum + Number(counters?.[key]?.value || 0);
  }, 0);

  return {
    key: "__collectibles__",
    label: meta?.collectibleLabel || "Collectibles",
    shortLabel: meta?.collectibleLabel || "Collectibles",
    queueLabel: meta?.collectibleLabel || "Collectibles",
    icon: "route",
    accent: "#f6c453",
    description:
      meta?.collectibleDescription ||
      "Combined progress across the collectible categories tracked for this route.",
    requirement:
      meta?.collectibleDescription ||
      "Combined progress across the collectible categories tracked for this route.",
    value: clamp(value, 0, total),
    max: total,
    manualDelta: 0,
    readOnly: true
  };
}

function getDisplayCounterEntries({
  keys,
  counters,
  counterDefs,
  meta,
  surface = "default",
  collapseCollectibles = false
}) {
  const hiddenKeys = getHiddenCounterKeys(meta, surface);
  const sourceKeys = Array.isArray(keys) ? keys : Object.keys(counters || {});
  const entries = [];
  const seen = new Set();
  let addedCollectibles = false;

  sourceKeys.forEach((key) => {
    if (hiddenKeys.has(key) || seen.has(key)) {
      return;
    }

    if (collapseCollectibles && isCollectibleKey(meta, key)) {
      if (addedCollectibles) {
        return;
      }

      const aggregate = buildCollectibleAggregate(meta, counters);
      if (aggregate) {
        entries.push(aggregate);
        seen.add(aggregate.key);
        addedCollectibles = true;
      }
      return;
    }

    const entry = buildBaseCounterEntry(key, counters, counterDefs);
    if (!entry) {
      return;
    }

    entries.push(entry);
    seen.add(key);
  });

  return entries;
}

function getEntriesProgress(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    return 0;
  }

  const progressEntries = entries.filter((entry) => !entry?.nonProgress && entry?.key !== "deaths");
  const current = progressEntries.reduce((sum, entry) => sum + Number(entry?.value || 0), 0);
  const total = progressEntries.reduce((sum, entry) => sum + Number(entry?.max || 0), 0);
  return percent(current, total);
}

function filterCompletedEntries(entries = []) {
  return entries.filter((entry) => {
    const max = Number(entry?.max || 0);
    if (max <= 0) return true;
    return Number(entry?.value || 0) < max;
  });
}

function getQuotaDisplayEntries(activePhaseId, quotas, counters, counterDefs, meta) {
  const hiddenKeys = getHiddenCounterKeys(meta, "quota");
  const quotaEntries = Object.entries(quotas?.[activePhaseId] || {});
  const entries = [];
  let collectibleCurrent = 0;
  let collectibleTarget = 0;

  quotaEntries.forEach(([key, rawTarget]) => {
    const target = Number(rawTarget || 0);
    if (target <= 0 || hiddenKeys.has(key) || key === "deaths" || counterDefs?.[key]?.nonProgress) {
      return;
    }

    if (isCollectibleKey(meta, key)) {
      collectibleTarget += target;
      collectibleCurrent += Math.min(Number(counters?.[key]?.value || 0), target);
      return;
    }

    const base = buildBaseCounterEntry(key, counters, counterDefs);
    if (!base) {
      return;
    }

    entries.push({
      ...base,
      current: Math.min(Number(counters?.[key]?.value || 0), target),
      target
    });
  });

  if (collectibleTarget > 0) {
    entries.unshift({
      ...(buildCollectibleAggregate(meta, counters) || {
        key: "__collectibles__",
        label: meta?.collectibleLabel || "Collectibles",
        shortLabel: meta?.collectibleLabel || "Collectibles",
        queueLabel: meta?.collectibleLabel || "Collectibles",
        icon: "route",
        accent: "#f6c453",
        description: meta?.collectibleDescription || "",
        requirement: meta?.collectibleDescription || "",
        readOnly: true
      }),
      current: collectibleCurrent,
      target: collectibleTarget
    });
  }

  return entries;
}

function getQuotaDisplayProgress(activePhaseId, quotas, counters, counterDefs, meta) {
  const entries = getQuotaDisplayEntries(activePhaseId, quotas, counters, counterDefs, meta);
  if (!entries.length) {
    return null;
  }

  const current = entries.reduce((sum, entry) => sum + Number(entry?.current || 0), 0);
  const total = entries.reduce((sum, entry) => sum + Number(entry?.target || 0), 0);
  return percent(current, total);
}

function getSplitAutoSummary(split, counterDefs, meta) {
  const auto = split?.auto || {};
  const parts = [];
  let collectibleCount = 0;
  let routeOnlyCount = 0;

  Object.entries(auto).forEach(([key, amount]) => {
    const n = Number(amount || 0);
    if (!n) return;

    if (key === "routecollectibles") {
      routeOnlyCount += n;
      return;
    }

    if (isCollectibleKey(meta, key)) {
      collectibleCount += n;
      return;
    }

    const label =
      counterDefs?.[key]?.shortLabel ||
      counterDefs?.[key]?.queueLabel ||
      counterDefs?.[key]?.label ||
      key;

    parts.push(`${n} ${label.toLowerCase()}`);
  });

  if (collectibleCount > 0) {
    parts.unshift(`${collectibleCount} collectibles`);
  }

  if (!parts.length && routeOnlyCount > 0) {
    return routeOnlyCount === 1 ? "1 route item" : `${routeOnlyCount} route items`;
  }

  return parts.join(" | ");
}

function buildCurrentSplitMarkerMarkup(split, counterDefs, meta, counters = {}) {
  const hiddenKeys = getHiddenCounterKeys(meta, "focus");
  const collectibleKeys = new Set(Array.isArray(meta?.collectibleCounterKeys) ? meta.collectibleCounterKeys : []);
  const auto = split?.auto || {};
  const hasRouteCollectibleChip =
    Number(auto.routecollectibles || 0) !== 0 &&
    !hiddenKeys.has("routecollectibles");
  const entries = [];
  let groupedCollectibleAmount = 0;

  Object.entries(auto).forEach(([key, rawAmount]) => {
    const amount = Number(rawAmount || 0);
    const def = counterDefs?.[key] || {};
    if (!amount || hiddenKeys.has(key)) return;

    if (collectibleKeys.has(key)) {
      if (!hasRouteCollectibleChip) {
        groupedCollectibleAmount += amount;
      }
      return;
    }

    entries.push({
      key,
      amount,
      icon: def.icon || key,
      label: def.shortLabel || def.queueLabel || def.label || key,
      accent: def.accent || "",
      value: Number(counters?.[key]?.value || 0),
      max: Number(counters?.[key]?.max || def?.max || 0)
    });
  });

  if (groupedCollectibleAmount) {
    const sourceKeys = Array.isArray(meta?.collectibleCounterKeys) ? meta.collectibleCounterKeys : [];
    const value = sourceKeys.reduce((sum, key) => sum + Number(counters?.[key]?.value || 0), 0);
    const max = Number(meta?.collectibleTotal || 0);

    entries.push({
      key: "__collectibles__",
      amount: groupedCollectibleAmount,
      icon: "route",
      label: meta?.collectibleLabel || "Collectibles",
      accent: "#f6c453",
      value,
      max
    });
  }

  if (!entries.length) {
    return "";
  }

  return entries
    .map((entry) => {
      const sign = entry.amount > 0 ? "+" : "";
      const nextValue = entry.max > 0
        ? clamp(entry.value + entry.amount, 0, entry.max)
        : Math.max(0, entry.value + entry.amount);
      const targetText = entry.max > 0 ? `${nextValue}/${entry.max}` : String(nextValue);
      const title = `${entry.label} ${sign}${entry.amount}; after split ${targetText}`;

      return `
        <span class="currentSplitMarker" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
          <span class="currentSplitMarkerIcon">${getObjectiveIconMarkup(entry.icon, entry.label, "objectiveIconSvg")}</span>
          <span class="currentSplitMarkerValue">${escapeHtml(`${sign}${entry.amount}`)}</span>
          <span class="currentSplitMarkerTarget">${escapeHtml(targetText)}</span>
        </span>
      `;
    })
    .join("");
}

function formatManualAppliedSummary(manualApplied = {}, counterDefs = {}) {
  const parts = Object.entries(manualApplied || {})
    .filter(([, amount]) => Number(amount || 0) !== 0)
    .map(([key, amount]) => {
      const label =
        counterDefs?.[key]?.shortLabel ||
        counterDefs?.[key]?.queueLabel ||
        counterDefs?.[key]?.label ||
        key;
      const prefix = Number(amount || 0) > 0 ? "+" : "";
      return `${label} ${prefix}${Number(amount || 0)}`;
    });

  return parts.join(" | ");
}

function buildHistoryDeltaEntries(deltaMap = {}, counterDefs = {}, meta = {}, source = "auto") {
  const entries = [];

  Object.entries(deltaMap || {}).forEach(([key, rawAmount]) => {
    const amount = Number(rawAmount || 0);
    if (!amount) return;

    if (key === "routecollectibles") {
      return;
    }

    const def = counterDefs?.[key] || {};
    entries.push({
      key,
      amount,
      icon: def.icon || "",
      label: def.shortLabel || def.queueLabel || def.label || key,
      accent: def.accent || "",
      source
    });
  });

  return entries;
}

function renderHistoryDeltaChips(entries = []) {
  return entries
    .map((entry) => {
      const sign = Number(entry.amount || 0) > 0 ? "+" : "";
      const title = `${entry.label} ${sign}${Number(entry.amount || 0)}`;
      const sourceClass = entry.source === "manual" ? "historyChip-manual" : "historyChip-auto";

      return `
        <span
          class="historyChip ${sourceClass}"
          style="${buildToneStyles({ accent: entry.accent || "#77a8ff" })}"
          title="${escapeHtml(title)}"
        >
          <span class="historyChipIcon">${getObjectiveIconMarkup(entry.icon, entry.label, "objectiveIconSvg")}</span>
          <span class="historyChipValue">${sign}${Number(entry.amount || 0)}</span>
        </span>
      `;
    })
    .join("");
}

function renderHistoryProgress(entry, counterDefs = {}, meta = {}) {
  const autoEntries = buildHistoryDeltaEntries(entry?.autoApplied || {}, counterDefs, meta, "auto");
  const manualEntries = buildHistoryDeltaEntries(entry?.manualApplied || {}, counterDefs, meta, "manual");

  if (!autoEntries.length && !manualEntries.length) {
    return "";
  }

  return `
    <div class="historyProgressGroup">
      ${
        autoEntries.length
          ? `<div class="historyProgressRow">
              <span class="historyProgressLabel">Auto</span>
              <div class="historyChipRow">${renderHistoryDeltaChips(autoEntries)}</div>
            </div>`
          : ""
      }
      ${
        manualEntries.length
          ? `<div class="historyProgressRow">
              <span class="historyProgressLabel">Manual</span>
              <div class="historyChipRow">${renderHistoryDeltaChips(manualEntries)}</div>
            </div>`
          : ""
      }
    </div>
  `;
}

function buildCounterCardMarkup(entry) {
  const label = entry?.label || entry?.key || "Counter";
  const value = Number(entry?.value || 0);
  const max = Number(entry?.max || 0);
  const progress = percent(value, max);
  const title = getCounterTitle(entry, label);
  const actionAriaBase = escapeHtml(label);
  const canDecrease = value > 0;
  const canIncrease = max <= 0 || value < max;
  const isCountOnly = entry?.displayMode === "count" || entry?.nonProgress;
  const mainValueText = isCountOnly ? String(value) : `${value}/${max}`;
  const progressText = isCountOnly ? "" : `${progress}%`;

  if (entry?.readOnly) {
    return `
      <div class="card totalCard counterWidget counterWidget-readOnly" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
        <div class="counterDock">
          <span class="counterAction counterAction-readOnly" aria-hidden="true">-</span>
          <div class="counterCore">
            <div class="counterTitleRow">
              <span class="totalCardIcon">${getObjectiveIconMarkup(entry.icon, label, "objectiveIconSvg")}</span>
              <span class="counterLabel">${escapeHtml(label)}</span>
            </div>
            <div class="counterValueRow">
              <span class="counterMainValue">${escapeHtml(mainValueText)}</span>
              ${progressText ? `<span class="counterPercentValue">${escapeHtml(progressText)}</span>` : ""}
            </div>
          </div>
          <span class="counterAction counterAction-readOnly" aria-hidden="true">+</span>
        </div>
        <div class="subtitle focusCounterNote">
          Updates automatically from the tracked collectible categories.
        </div>
      </div>
    `;
  }

  return `
    <div class="card totalCard counterWidget" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
      <div class="counterDock">
        <button
          class="counterAction"
          data-counter-key="${escapeHtml(entry.key)}"
          data-delta="-1"
          type="button"
          aria-label="Decrease ${actionAriaBase}"
          ${canDecrease ? "" : "disabled"}
        >-</button>

        <div class="counterCore">
          <div class="counterTitleRow">
            <span class="totalCardIcon">${getObjectiveIconMarkup(entry.icon, label, "objectiveIconSvg")}</span>
            <span class="counterLabel">${escapeHtml(label)}</span>
          </div>
          <div class="counterValueRow">
            <span class="counterMainValue">${escapeHtml(mainValueText)}</span>
            ${progressText ? `<span class="counterPercentValue">${escapeHtml(progressText)}</span>` : ""}
          </div>
        </div>

        <button
          class="counterAction"
          data-counter-key="${escapeHtml(entry.key)}"
          data-delta="1"
          type="button"
          aria-label="Increase ${actionAriaBase}"
          ${canIncrease ? "" : "disabled"}
        >+</button>
      </div>
    </div>
  `;
}

function buildCounterTokenMarkup(entry) {
  const label = entry?.shortLabel || entry?.queueLabel || entry?.label || entry?.key || "Counter";
  const fullLabel = entry?.label || label;
  const value = Number(entry?.value || 0);
  const max = Number(entry?.max || 0);
  const title = getCounterTitle(entry, fullLabel);
  const actionAriaBase = escapeHtml(fullLabel);
  const canDecrease = value > 0;
  const canIncrease = max <= 0 || value < max;
  const valueText = entry?.displayMode === "count" || entry?.nonProgress
    ? String(value)
    : max > 0
      ? `${value}/${max}`
      : String(value);

  if (entry?.readOnly) {
    return `
      <span class="counterToken counterToken-readOnly" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
        <span class="counterTokenCore">
          <span class="counterTokenIcon">${getObjectiveIconMarkup(entry.icon, fullLabel, "objectiveIconSvg")}</span>
          <span class="counterTokenValue">${escapeHtml(valueText)}</span>
        </span>
      </span>
    `;
  }

  return `
    <span class="counterToken" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
      <button
        class="counterTokenAction"
        data-counter-key="${escapeHtml(entry.key)}"
        data-delta="-1"
        type="button"
        aria-label="Decrease ${actionAriaBase}"
        ${canDecrease ? "" : "disabled"}
      >-</button>
      <span class="counterTokenCore">
        <span class="counterTokenIcon">${getObjectiveIconMarkup(entry.icon, fullLabel, "objectiveIconSvg")}</span>
        <span class="counterTokenValue">${escapeHtml(valueText)}</span>
      </span>
      <button
        class="counterTokenAction"
        data-counter-key="${escapeHtml(entry.key)}"
        data-delta="1"
        type="button"
        aria-label="Increase ${actionAriaBase}"
        ${canIncrease ? "" : "disabled"}
      >+</button>
    </span>
  `;
}

function buildDirgeTokenMarkup(isDone) {
  return `
    <span
      class="counterToken miscToken ${isDone ? "miscToken-done" : ""}"
      aria-pressed="${isDone ? "true" : "false"}"
      data-misc-key="dirge"
      title="Dirge of the Fallen"
    >
      <button
        class="counterTokenAction"
        data-misc-action="set-dirge"
        data-value="0"
        type="button"
        aria-label="Mark Dirge of the Fallen incomplete"
        ${isDone ? "" : "disabled"}
      >-</button>
      <span class="counterTokenCore">
        <span class="counterTokenIcon">${getObjectiveIconMarkup("song", "Dirge of the Fallen", "objectiveIconSvg")}</span>
        <span class="counterTokenValue">${isDone ? "1/1" : "0/1"}</span>
      </span>
      <button
        class="counterTokenAction"
        data-misc-action="set-dirge"
        data-value="1"
        type="button"
        aria-label="Mark Dirge of the Fallen complete"
        ${isDone ? "disabled" : ""}
      >+</button>
    </span>
  `;
}

function renderTimer(state) {
  const timerValue = document.getElementById("timer");
  if (timerValue) {
    timerValue.textContent = formatMs(state?.elapsedMs || 0);
  }
}

function renderCurrentSplit(state, counterDefs, meta) {
  const currentSplit = getCurrentSplit(state.splits, state.currentSplitIndex);
  const nextSplit = Array.isArray(state.splits)
    ? state.splits[state.currentSplitIndex + 1] || null
    : null;

  const currentSplitLabel = document.getElementById("currentSplitLabel");
  const currentSplitMarkers = document.getElementById("currentSplitMarkers");
  const historyCount = document.getElementById("historyCount");
  const modePill = document.getElementById("modePill");
  const queuePill = document.getElementById("queuePill");
  const currentObjectiveText = document.getElementById("currentObjectiveText");
  const nextSplitLabel = document.getElementById("nextSplitLabel");
  const nextSplitHint = document.getElementById("nextSplitHint");

  if (currentSplitLabel) {
    currentSplitLabel.textContent = currentSplit?.label || "Run complete";
  }

  if (currentSplitMarkers) {
    currentSplitMarkers.innerHTML = currentSplit
      ? buildCurrentSplitMarkerMarkup(currentSplit, counterDefs, meta, state.counters)
      : "";
    currentSplitMarkers.hidden = !currentSplitMarkers.innerHTML;
  }

  if (historyCount) {
    historyCount.textContent = `${(state.history || []).length} splits logged`;
  }

  if (modePill) {
    modePill.textContent = state.settings?.difficulty || "Route";
  }

  if (queuePill) {
    queuePill.textContent = `${state.splits.length} total splits`;
  }

  if (currentObjectiveText) {
    currentObjectiveText.textContent = currentSplit?.note || "No note for this split yet.";
  }

  if (nextSplitLabel) {
    nextSplitLabel.textContent = nextSplit?.label || "No next split";
  }

  if (nextSplitHint) {
    nextSplitHint.textContent =
      nextSplit?.note ||
      (nextSplit
        ? getSplitAutoSummary(nextSplit, counterDefs, meta) || "No note for the next split yet."
        : "You are at the end of the loaded route.");
  }
}

function renderPhasePanel(state, phases, counterDefs, quotas, meta) {
  const { activePhaseId, activePhase } = getPhaseInfoFromCurrentSplit(
    state.splits,
    state.currentSplitIndex,
    phases,
    state.activePhaseId
  );

  const visibleKeys = getVisibleCounterKeysForPhase(activePhaseId, phases, state.counters);
  const visibleEntries = getDisplayCounterEntries({
    keys: visibleKeys,
    counters: state.counters,
    counterDefs,
    meta,
    surface: "focus",
    collapseCollectibles: true
  });
  const unclutteredVisibleEntries = filterCompletedEntries(visibleEntries);
  const objectiveEntries = unclutteredVisibleEntries.slice(0, 6);
  const hiddenObjectiveCount = Math.max(0, unclutteredVisibleEntries.length - objectiveEntries.length);
  const deathEntry = meta?.showDeathCounter
    ? buildBaseCounterEntry("deaths", state.counters, counterDefs)
    : null;
  const focusLimit = deathEntry ? 5 : 6;
  const focusEntries = [
    ...(deathEntry ? [deathEntry] : []),
    ...unclutteredVisibleEntries
      .filter((entry) => entry.key !== "deaths")
      .slice(0, focusLimit)
  ];
  const quotaEntries = getQuotaDisplayEntries(activePhaseId, quotas, state.counters, counterDefs, meta);
  const phaseProgress =
    getQuotaDisplayProgress(activePhaseId, quotas, state.counters, counterDefs, meta) ??
    getEntriesProgress(visibleEntries);

  const activePhaseName = document.getElementById("activePhaseName");
  const activePhaseNote = document.getElementById("activePhaseNote");
  const visibleObjectives = document.getElementById("visibleObjectives");
  const focusGrid = document.getElementById("focusGrid");
  const counterDeskSummary = document.getElementById("counterDeskSummary");
  const focusCountPill = document.getElementById("focusCountPill");

  const act1QuotaLabel = document.getElementById("actQuotaLabel");
  const act1SummaryValue = document.getElementById("act1SummaryValue");
  const act1SummaryBar = document.getElementById("act1SummaryBar");
  const act1QuotaTitle = document.getElementById("act1QuotaTitle");
  const act1QuotaText = document.getElementById("act1QuotaText");

  if (activePhaseName) {
    activePhaseName.textContent = activePhase?.label || activePhaseId || "Legacy All";
  }

  if (activePhaseNote) {
    activePhaseNote.textContent =
      activePhase?.objectiveNote ||
      activePhase?.description ||
      activePhase?.note ||
      "No phase note.";
  }

  if (visibleObjectives) {
    visibleObjectives.innerHTML = objectiveEntries.length
      ? objectiveEntries
        .map((entry) => {
          const title = getCounterTitle(entry, entry.label);

          return `
            <span class="objectivePill" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
              <span class="objectivePillIcon">${getObjectiveIconMarkup(entry.icon, entry.label, "objectiveIconSvg")}</span>
              <span class="objectivePillLabel">${escapeHtml(entry.label)}</span>
            </span>
          `;
        })
        .join("") +
        (hiddenObjectiveCount
          ? `<span class="objectivePill objectivePill-secondary"><span class="objectivePillLabel">+${hiddenObjectiveCount} more</span></span>`
          : "")
      : `<span class="subtitle">No active counters for this phase.</span>`;
  }

  if (focusGrid) {
    const tokens = focusEntries.map((entry) => buildCounterTokenMarkup(entry));

    if (meta?.supportsDirge) {
      tokens.push(buildDirgeTokenMarkup(!!state?.miscChecks?.dirge));
    }

    focusGrid.innerHTML = tokens.length
      ? tokens.join("")
      : `<div class="subtitle">No quick counters for this phase.</div>`;
  }

  if (counterDeskSummary) {
    const miscCount = meta?.supportsDirge ? 1 : 0;
    const deskCount = getDisplayCounterEntries({
      keys: Object.keys(state.counters || {}),
      counters: state.counters,
      counterDefs,
      meta,
      surface: "totals",
      collapseCollectibles: false
    }).length;
    counterDeskSummary.textContent = `${focusEntries.length + miscCount} live | ${deskCount} in desk`;
  }

  if (focusCountPill) {
    const miscCount = meta?.supportsDirge ? 1 : 0;
    focusCountPill.textContent = focusEntries.length + miscCount
      ? `${focusEntries.length + miscCount} live controls`
      : "No live controls";
  }

  if (act1QuotaLabel) {
    act1QuotaLabel.textContent = activePhase?.label || activePhaseId || "Current Phase";
  }

  if (act1SummaryValue) {
    act1SummaryValue.textContent = `${phaseProgress}%`;
  }

  if (act1SummaryBar) {
    act1SummaryBar.style.width = `${phaseProgress}%`;
  }

  if (act1QuotaTitle) {
    act1QuotaTitle.textContent = `${activePhase?.label || activePhaseId || "Current Phase"} Checkpoints`;
  }

  if (act1QuotaText) {
    if (!quotaEntries.length) {
      act1QuotaText.textContent = "No checkpoint targets for this phase";
    } else {
      act1QuotaText.innerHTML = quotaEntries
        .map((entry) => {
          const label = entry.shortLabel || entry.queueLabel || entry.label || entry.key;
          const current = Number(entry.current || 0);
          const target = Number(entry.target || 0);
          const title = getCounterTitle(entry, label);

          return `
            <span class="inlineQuotaChip" style="${buildToneStyles(entry)}" title="${escapeHtml(title)}">
              <span class="objectivePillIcon inlineQuotaIcon">${getObjectiveIconMarkup(entry.icon, label, "objectiveIconSvg")}</span>
              <span class="inlineQuotaLabel">${escapeHtml(label)}</span>
              <span class="inlineQuotaValue">${current}/${target}</span>
            </span>
          `;
        })
        .join("");
    }
  }
}

function renderTotalsGrid(state, counterDefs, meta) {
  const progressGrid = document.getElementById("progressGrid");
  if (!progressGrid) return;

  const phaseMap = meta?.phases || {};
  const { activePhaseId } = getPhaseInfoFromCurrentSplit(
    state.splits,
    state.currentSplitIndex,
    phaseMap,
    state.activePhaseId
  );
  const visibleKeys = getVisibleCounterKeysForPhase(activePhaseId, phaseMap, state.counters);
  const visibleEntries = getDisplayCounterEntries({
    keys: visibleKeys,
    counters: state.counters,
    counterDefs,
    meta,
    surface: "focus",
    collapseCollectibles: true
  });
  const renderedFocusKeys = new Set(
    filterCompletedEntries(visibleEntries)
      .slice(0, 6)
      .map((entry) => entry.key)
  );
  if (meta?.showDeathCounter) {
    renderedFocusKeys.add("deaths");
  }

  const entries = [];
  const collectibles = buildCollectibleAggregate(meta, state.counters || {});

  if (collectibles) {
    entries.push(collectibles);
  }

  entries.push(
    ...getDisplayCounterEntries({
      keys: Object.keys(state.counters || {}),
      counters: state.counters,
      counterDefs,
      meta,
      surface: "totals",
      collapseCollectibles: false
    })
  );

  const secondaryEntries = entries.filter((entry) => {
    if (renderedFocusKeys.has(entry.key)) return false;
    return true;
  });

  progressGrid.innerHTML = secondaryEntries.length
    ? secondaryEntries.map((entry) => buildCounterTokenMarkup(entry)).join("")
    : `<span class="subtitle">All tracked counters are already in the live set.</span>`;
}

function renderOverallBoxes(state, phases, counterDefs, quotas, meta) {
  const overallProgress = getOverallProgress(state.counters, meta?.overallCounterKeys || []);
  const collectibles = buildCollectibleAggregate(meta, state.counters);

  const { activePhaseId } = getPhaseInfoFromCurrentSplit(
    state.splits,
    state.currentSplitIndex,
    phases,
    state.activePhaseId
  );

  const visibleKeys = getVisibleCounterKeysForPhase(activePhaseId, phases, state.counters);
  const phaseEntries = getDisplayCounterEntries({
    keys: visibleKeys,
    counters: state.counters,
    counterDefs,
    meta,
    surface: "focus",
    collapseCollectibles: true
  });
  const phaseProgress =
    getQuotaDisplayProgress(activePhaseId, quotas, state.counters, counterDefs, meta) ??
    getEntriesProgress(phaseEntries);

  const overallPercent = document.getElementById("overallPercent");
  const overallBar = document.getElementById("overallBar");
  const actPercent = document.getElementById("act1SummaryValue");
  const actBar = document.getElementById("act1SummaryBar");
  const collectiblesValue = document.getElementById("collectiblesValue");
  const collectiblesBar = document.getElementById("collectiblesBar");

  if (overallPercent) overallPercent.textContent = `${overallProgress}%`;
  if (overallBar) overallBar.style.width = `${overallProgress}%`;

  if (actPercent) actPercent.textContent = `${phaseProgress}%`;
  if (actBar) actBar.style.width = `${phaseProgress}%`;

  if (collectiblesValue) {
    collectiblesValue.textContent = collectibles
      ? `${collectibles.value}/${collectibles.max}`
      : "N/A";
  }

  if (collectiblesBar) {
    collectiblesBar.style.width = `${collectibles ? percent(collectibles.value, collectibles.max) : 0}%`;
  }
}

function renderRouteHealth(state) {
  const summary = document.getElementById("routeHealthSummary");
  const list = document.getElementById("routeHealthList");
  const card = document.getElementById("routeHealthCard");
  const issues = Array.isArray(state?.routeHealth?.issues) ? state.routeHealth.issues : [];
  const warningCount = issues.filter((issue) => issue.tone === "warn" || issue.tone === "error").length;

  if (card) {
    card.dataset.healthTone = warningCount ? "attention" : "ok";
  }

  if (summary) {
    summary.textContent = warningCount
      ? `${warningCount} item${warningCount === 1 ? "" : "s"} need attention`
      : "Route looks clean";
  }

  if (list) {
    list.innerHTML = issues.length
      ? issues
        .slice(0, 4)
        .map((issue) => `
          <div class="routeHealthItem routeHealthItem-${escapeHtml(issue.tone || "info")}">
            <strong>${escapeHtml(issue.title || "Route note")}</strong>
            <span>${escapeHtml(issue.detail || "")}</span>
          </div>
        `)
        .join("")
      : `<div class="routeHealthEmpty">No route drift detected.</div>`;
  }
}

function renderSplitQueue(state, counterDefs, meta) {
  const splitButtons = document.getElementById("splitButtons");
  const queueWindowPill = document.getElementById("queueWindowPill");
  const historySaved = document.getElementById("historySaved");
  const historyList = document.getElementById("historyList");

  if (!splitButtons) return;

  const currentIndex = Number(state.currentSplitIndex || 0);
  const visibleQueue = (state.splits || []).slice(currentIndex, currentIndex + 6);

  if (queueWindowPill) {
    queueWindowPill.textContent = visibleQueue.length
      ? `${visibleQueue.length} on deck`
      : "Route complete";
  }

  splitButtons.innerHTML = visibleQueue.length
    ? visibleQueue
      .map((split, offset) => {
        const index = currentIndex + offset;
        const status = getSplitStatus(index, currentIndex);
        const statusLabel =
          status === "current"
            ? "Live"
            : offset === 1
              ? "Next"
              : `+${offset}`;

        const cardMarkup = `
          <div class="queueCardTop">
            <div class="queueCardIndex">${index + 1}</div>
            <div class="queueCardBody">
              <div class="queueCardTitleRow">
                <div class="mid queueCardTitle">${escapeHtml(split.label || `Split ${index + 1}`)}</div>
                <div class="pill queueStatusPill queueStatusPill--${escapeHtml(status)}">${escapeHtml(statusLabel)}</div>
              </div>
              <div class="subtitle queueCardNote">
                ${escapeHtml(split.note || getSplitAutoSummary(split, counterDefs, meta) || "No tracked objective note")}
              </div>
            </div>
          </div>
        `;

        if (status === "current") {
          return `
            <button
              class="queueCard queueCard--current"
              type="button"
              data-split-index="${index}"
              aria-label="Open current split ${escapeHtml(split.label || `Split ${index + 1}`)}"
            >
              ${cardMarkup}
            </button>
          `;
        }

        return `
          <div class="queueCard queueCard--${escapeHtml(status)}" aria-disabled="true">
            ${cardMarkup}
          </div>
        `;
      })
      .join("")
    : `<div class="card"><div class="mid">Route complete</div><div class="subtitle" style="margin-top:6px;">No remaining splits in the queue.</div></div>`;

  if (historySaved) {
    historySaved.textContent = `${(state.history || []).length} saved`;
  }

  if (historyList) {
    const history = Array.isArray(state.history) ? state.history : [];

    historyList.innerHTML = history.length
      ? history
        .slice()
        .reverse()
        .map((entry) => {
          return `
            <div class="card">
              <div class="row between" style="gap:8px">
                <div class="mid">${escapeHtml(entry.label || "Split")}</div>
                <div class="pill">${formatMs(entry.segmentMs || 0)}</div>
              </div>
              <div class="subtitle" style="margin-top:6px">
                Total: ${formatMs(entry.cumulativeMs || 0)}
              </div>
              ${renderHistoryProgress(entry, counterDefs, meta)}
            </div>
          `;
        })
        .join("")
      : `<div class="subtitle">No completed splits yet.</div>`;
  }
}

function renderHiddenInputs() {}

function renderDifficultyPill(state) {
  const difficultyBadge = document.getElementById("difficultyBadge");
  if (!difficultyBadge) return;

  difficultyBadge.textContent = state.settings?.difficulty || "Route";
}

function renderTimerButtonState(isRunning) {
  const startPauseBtn = document.getElementById("startPauseBtn");
  if (!startPauseBtn) return;

  startPauseBtn.textContent = isRunning ? "Pause [Space]" : "Start [Space]";
}

export function renderUI({ state, counters, phases, meta, quotas }) {
  const safeState = {
    elapsedMs: Number(state?.elapsedMs || 0),
    counters: state?.counters || {},
    splits: Array.isArray(state?.splits) ? state.splits : [],
    currentSplitIndex: Number(state?.currentSplitIndex || 0),
    settings: state?.settings || {},
    miscChecks: state?.miscChecks || {},
    history: Array.isArray(state?.history) ? state.history : [],
    activePhaseId: state?.activePhaseId || null,
    routeHealth: state?.routeHealth || { ok: true, issues: [] }
  };

  renderTimer(safeState);
  renderDifficultyPill(safeState);
  renderCurrentSplit(safeState, counters || {}, meta || {});
  renderPhasePanel(safeState, phases || {}, counters || {}, quotas || {}, meta || {});
  renderTotalsGrid(safeState, counters || {}, { ...(meta || {}), phases: phases || {} });
  renderOverallBoxes(safeState, phases || {}, counters || {}, quotas || {}, meta || {});
  renderRouteHealth(safeState);
  renderSplitQueue(safeState, counters || {}, meta || {});
  renderHiddenInputs(safeState);
  renderTimerButtonState(!!safeState.settings?.__timerRunning);

  const subtitle = document.querySelector(".top .subtitle");
  if (subtitle) {
    subtitle.textContent =
      meta?.subtitle || "Main controller with phase-based objective visibility.";
  }
}
