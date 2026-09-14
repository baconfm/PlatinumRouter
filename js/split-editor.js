import { getActivePhaseId } from "./split-logic.js?v=20260724d";
import { getObjectiveIconMarkup } from "./objective-icons.js?v=20260712c";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeAuto(auto) {
  const result = {};

  Object.entries(safeObject(auto)).forEach(([key, value]) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return;
    result[key] = n;
  });

  return result;
}

function normalizeOcrGoals(goals) {
  if (!Array.isArray(goals)) return [];

  return goals
    .map((goal) => {
      if (typeof goal === "string") {
        return {
          id: goal.trim(),
          type: "",
          label: "",
          counterKey: "",
          optional: false
        };
      }

      if (!goal || typeof goal !== "object") return null;

      return {
        id: String(goal.id || "").trim(),
        type: String(goal.type || "").trim(),
        label: String(goal.label || "").trim(),
        counterKey: String(goal.counterKey || "").trim(),
        optional: !!goal.optional,
        linkedCounters: Array.isArray(goal.linkedCounters)
          ? goal.linkedCounters
            .map((entry) => ({
              counterKey: String(entry?.counterKey || "").trim(),
              delta: Number(entry?.delta || 0)
            }))
            .filter((entry) => entry.counterKey && Number.isFinite(entry.delta) && entry.delta > 0)
          : []
      };
    })
    .filter((goal) => goal?.id || goal?.label);
}

function normalizeSplit(split = {}, index = 0) {
  return {
    ...split,
    id: split.id || `split_${index}`,
    label: split.label || `Split ${index + 1}`,
    phase: split.phase || split.phaseId || split.act || "",
    note: split.note || "",
    auto: normalizeAuto(split.auto || {}),
    ocrGoals: normalizeOcrGoals(split.ocrGoals || []),
    ...(normalizeOcrCompletion(split.ocrCompletion)
      ? { ocrCompletion: normalizeOcrCompletion(split.ocrCompletion) }
      : {})
  };
}

function normalizeOcrCompletion(completion = null) {
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) return null;

  const mode = String(completion.mode || "").trim();
  const groups = Array.isArray(completion.groups)
    ? completion.groups
        .map((group) => Array.isArray(group)
          ? group.map((id) => String(id || "").trim()).filter(Boolean)
          : [])
        .filter((group) => group.length > 0)
    : [];

  if (!mode && !groups.length) return null;

  return {
    mode,
    groups
  };
}

function normalizeQuotas(rawQuotas = {}) {
  const result = {};

  Object.entries(safeObject(rawQuotas)).forEach(([phaseId, value]) => {
    const source =
      value && typeof value === "object" && value.targets && typeof value.targets === "object"
        ? value.targets
        : safeObject(value);

    const normalized = {};

    Object.entries(source).forEach(([key, rawValue]) => {
      const n = Number(rawValue);
      if (!Number.isFinite(n) || n <= 0) return;
      normalized[key] = n;
    });

    result[phaseId] = normalized;
  });

  return result;
}

function makeSplitId(index) {
  return `split_${Date.now()}_${index}_${Math.floor(Math.random() * 10000)}`;
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function buildPhaseOptions(phases, selected) {
  const phaseEntries = Object.entries(safeObject(phases));

  return `
    <option value="">No phase</option>
    ${phaseEntries.map(([key, def]) => {
      const label = def?.label || key;
      const isSelected = String(selected || "") === String(key) ? "selected" : "";
      return `<option value="${escapeHtml(key)}" ${isSelected}>${escapeHtml(label)}</option>`;
    }).join("")}
  `;
}

function getSplitPhaseLabel(split, phases) {
  const phaseId = split?.phase || split?.phaseId || split?.act || "";
  return phases?.[phaseId]?.label || phaseId || "No phase";
}

function getSplitPhaseId(split) {
  return String(split?.phase || split?.phaseId || split?.act || "").trim();
}

function buildPhaseFilterOptions(splits, phases, selected) {
  const seen = new Set();
  const options = [
    `<option value="">All phases</option>`
  ];

  safeArray(splits).forEach((split) => {
    const phaseId = String(split?.phase || split?.phaseId || split?.act || "").trim();
    if (!phaseId || seen.has(phaseId)) return;
    seen.add(phaseId);

    const label = phases?.[phaseId]?.label || phaseId;
    const isSelected = selected === phaseId ? "selected" : "";
    options.push(`<option value="${escapeHtml(phaseId)}" ${isSelected}>${escapeHtml(label)}</option>`);
  });

  return options.join("");
}

function matchesSplitFilter(split, phases, search, phaseFilter) {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const normalizedPhase = String(phaseFilter || "").trim();
  const splitPhase = String(split?.phase || split?.phaseId || split?.act || "").trim();

  if (normalizedPhase && splitPhase !== normalizedPhase) {
    return false;
  }

  if (!normalizedSearch) {
    return true;
  }

  const haystack = [
    split?.label || "",
    split?.note || "",
    splitPhase,
    getSplitPhaseLabel(split, phases)
  ].join(" ").toLowerCase();

  return haystack.includes(normalizedSearch);
}

function buildAutoSummaryChips(split, counterDefs) {
  const auto = normalizeAuto(split?.auto || {});
  const entries = Object.entries(auto);

  if (!entries.length) {
    return `<span class="autoSummaryEmpty">No auto progress</span>`;
  }

  return entries
    .map(([key, value]) => {
      const label =
        counterDefs?.[key]?.shortLabel ||
        counterDefs?.[key]?.queueLabel ||
        counterDefs?.[key]?.label ||
        key;

      return `
        <span class="autoSummaryChip">
          <span class="autoSummaryLabel">${escapeHtml(label)}</span>
          <span class="autoSummaryValue">+${value}</span>
        </span>
      `;
    })
    .join("");
}

function buildCompactObjectiveMarks(split, counterDefs, limit = 6) {
  const entries = Object.entries(normalizeAuto(split?.auto || {}));

  if (!entries.length) {
    return `<span class="splitSummaryEmpty">No auto</span>`;
  }

  const visibleEntries = entries.slice(0, limit);
  const hiddenCount = Math.max(0, entries.length - visibleEntries.length);

  return `
    ${visibleEntries
      .map(([key, value]) => {
        const def = counterDefs?.[key] || {};
        const label = def?.shortLabel || def?.queueLabel || def?.label || key;
        const icon = getObjectiveIconMarkup(def?.icon || key, label, "splitSummaryIcon");

        return `
          <span class="splitObjectiveMark" title="${escapeHtml(value)} ${escapeHtml(label)}">
            <span class="splitObjectiveAmount">${escapeHtml(value)}</span>
            ${icon}
          </span>
        `;
      })
      .join("")}
    ${hiddenCount ? `<span class="splitObjectiveMore">+${hiddenCount}</span>` : ""}
  `;
}

function getRouteAutoTotals(splits) {
  const totals = {};

  safeArray(splits).forEach((split) => {
    Object.entries(normalizeAuto(split?.auto || {})).forEach(([key, value]) => {
      totals[key] = Number(totals[key] || 0) + Number(value || 0);
    });
  });

  return totals;
}

function getRouteOcrTotals(splits, goalOptions) {
  const totals = {};
  const seen = new Set();

  safeArray(splits).forEach((split) => {
    normalizeOcrGoals(split?.ocrGoals || []).forEach((goal) => {
      const resolved = resolveOcrGoal(goal, goalOptions);
      const goalId = String(resolved?.id || "").trim();
      const counterKey = String(resolved?.counterKey || "").trim();

      if (!goalId || seen.has(goalId) || !counterKey) return;
      seen.add(goalId);
      if (resolved?.type === "completion" && resolved?.countsTowardCounter === false) return;

      totals[counterKey] = Number(totals[counterKey] || 0) + 1;
      safeArray(resolved?.linkedCounters).forEach((entry) => {
        const linkedKey = String(entry?.counterKey || "").trim();
        const delta = Number(entry?.delta || 0);
        if (!linkedKey || !Number.isFinite(delta) || delta <= 0) return;
        totals[linkedKey] = Number(totals[linkedKey] || 0) + delta;
      });
    });
  });

  return totals;
}

function buildRouteBalanceHtml(splits, counterDefs, goalOptions) {
  const autoTotals = getRouteAutoTotals(splits);
  const ocrTotals = getRouteOcrTotals(splits, goalOptions);
  const entries = Object.entries(safeObject(counterDefs))
    .map(([key, def]) => {
      const max = Number(def?.max || 0);
      const automatic = Number(autoTotals[key] || 0);
      const ocr = Number(ocrTotals[key] || 0);
      const planned = automatic + ocr;
      const remaining = Math.max(0, max - planned);
      const over = max > 0 ? Math.max(0, planned - max) : 0;
      const label = def?.shortLabel || def?.queueLabel || def?.label || key;
      const fullLabel = def?.label || label;

      if (max <= 0 && planned <= 0) return null;

      return {
        key,
        label,
        fullLabel,
        icon: def?.icon || key,
        planned,
        automatic,
        ocr,
        max,
        remaining,
        over
      };
    })
    .filter(Boolean);

  const missing = entries
    .filter((entry) => entry.max > 0 && entry.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining || a.fullLabel.localeCompare(b.fullLabel));
  const overplanned = entries
    .filter((entry) => entry.over > 0)
    .sort((a, b) => b.over - a.over || a.fullLabel.localeCompare(b.fullLabel));
  const complete = entries
    .filter((entry) => entry.max > 0 && entry.remaining === 0 && entry.over === 0)
    .sort((a, b) => a.fullLabel.localeCompare(b.fullLabel));
  const targetTotal = entries.reduce((sum, entry) => sum + Math.max(0, entry.max), 0);
  const coveredTotal = entries.reduce(
    (sum, entry) => sum + Math.min(Math.max(0, entry.planned), Math.max(0, entry.max)),
    0
  );
  const coveragePercent = targetTotal > 0
    ? Math.round((coveredTotal / targetTotal) * 100)
    : 100;
  const ocrTotal = entries.reduce((sum, entry) => sum + entry.ocr, 0);
  const automaticTotal = entries.reduce((sum, entry) => sum + entry.automatic, 0);

  const buildBalanceChip = (entry, tone = "missing") => {
    const icon = getObjectiveIconMarkup(entry.icon, entry.fullLabel, "routeBalanceIcon");
    const statusText = tone === "over"
      ? `${entry.over} over`
      : tone === "complete"
        ? "covered"
        : `${entry.remaining} left`;
    const progress = entry.max > 0
      ? Math.min(100, Math.max(0, Math.round((entry.planned / entry.max) * 100)))
      : 0;

    return `
      <span class="routeBalanceChip routeBalanceChip-${tone}" title="${escapeHtml(entry.fullLabel)}">
        <span class="routeBalanceChipIcon">${icon}</span>
        <span class="routeBalanceChipMain">
          <span class="routeBalanceChipLabel">${escapeHtml(entry.label)}</span>
          <span class="routeBalanceChipValue">${entry.planned}/${entry.max || "?"}</span>
          <span class="routeBalanceChipSources">${entry.ocr} OCR · ${entry.automatic} auto</span>
          <span class="routeBalanceProgress" aria-hidden="true">
            <span style="width:${progress}%"></span>
          </span>
        </span>
        <span class="routeBalanceChipStatus">${escapeHtml(statusText)}</span>
      </span>
    `;
  };

  const missingMarkup = missing.length
    ? missing.map((entry) => buildBalanceChip(entry, "missing")).join("")
    : `<span class="routeBalanceDone">Every configured counter target is covered by named OCR or automatic progress.</span>`;
  const completeMarkup = complete.length
    ? `
      <div class="routeBalanceCovered">
        <div class="routeBalanceSubhead">Covered in route</div>
        <div class="routeBalanceChips">${complete.map((entry) => buildBalanceChip(entry, "complete")).join("")}</div>
      </div>
    `
    : "";
  const overMarkup = overplanned.length
    ? `
      <div class="routeBalanceOver">
        <div class="routeBalanceSubhead">Overplanned</div>
        <div class="routeBalanceChips">${overplanned.map((entry) => buildBalanceChip(entry, "over")).join("")}</div>
      </div>
    `
    : "";

  return `
    <div class="editorCard routeBalanceCard" data-route-balance>
      <div class="routeBalanceHeader">
        <div>
          <div class="eyebrow">After Last Split</div>
          <div class="mid">Remaining Counter Deck</div>
          <div class="routeBalanceSubtitle">Named OCR targets and automatic fallbacks combined.</div>
        </div>
        <div class="routeBalanceScore" title="${coveredTotal} of ${targetTotal} configured counter points covered">
          <strong>${coveragePercent}%</strong>
          <span>route coverage</span>
        </div>
        <div class="routeBalanceStats">
          <span class="pill">${missing.length} remaining</span>
          <span class="pill">${complete.length} covered</span>
          <span class="pill">${ocrTotal} OCR</span>
          <span class="pill">${automaticTotal} auto</span>
          ${overplanned.length ? `<span class="pill">${overplanned.length} overplanned</span>` : ""}
        </div>
      </div>
      ${missing.length ? `<div class="routeBalanceSubhead">Still unassigned</div>` : ""}
      <div class="routeBalanceChips">
        ${missingMarkup}
      </div>
      ${completeMarkup}
      ${overMarkup}
    </div>
  `;
}

function getCumulativeAutoBeforeIndex(splits, index) {
  const totals = {};

  for (let i = 0; i < index; i += 1) {
    const auto = normalizeAuto(splits?.[i]?.auto || {});

    Object.entries(auto).forEach(([key, value]) => {
      totals[key] = Number(totals[key] || 0) + Number(value || 0);
    });
  }

  return totals;
}

function getCounterTargetForSplit({ key, index, splits, phases, quotas, counterDefs }) {
  const activePhaseId = getActivePhaseId(safeArray(splits), index, safeObject(phases));
  const phaseTarget = Number(quotas?.[activePhaseId]?.[key] || 0);

  if (phaseTarget > 0) {
    return {
      phaseId: activePhaseId,
      target: phaseTarget,
      source: "phase"
    };
  }

  return {
    phaseId: activePhaseId,
    target: Number(counterDefs?.[key]?.max || 0),
    source: "global"
  };
}

function buildCounterChipData({ split, index, splits, phases, quotas, counterDefs, showAll = false }) {
  const defs = safeObject(counterDefs);
  const cumulativeBefore = getCumulativeAutoBeforeIndex(splits, index);
  const currentAuto = normalizeAuto(split?.auto || {});

  return Object.keys(defs)
    .map((key) => {
      const def = defs[key] || {};
      const currentValue = Number(currentAuto[key] || 0);
      const beforeValue = Number(cumulativeBefore[key] || 0);
      const targetInfo = getCounterTargetForSplit({
        key,
        index,
        splits,
        phases,
        quotas,
        counterDefs: defs
      });

      const target = Number(targetInfo.target || 0);
      const remainingBefore = Math.max(0, target - beforeValue);
      const completeBefore = target > 0 && beforeValue >= target;
      const visible = showAll || currentValue > 0;

      return {
        key,
        label: def?.label || key,
        shortLabel: def?.shortLabel || def?.queueLabel || def?.label || key,
        currentValue,
        beforeValue,
        target,
        remainingBefore,
        completeBefore,
        visible,
        icon: def?.icon || key,
        source: targetInfo.source,
        phaseId: targetInfo.phaseId
      };
    })
    .filter((entry) => entry.visible)
    .sort((a, b) => {
      const aCurrent = a.currentValue > 0 ? 1 : 0;
      const bCurrent = b.currentValue > 0 ? 1 : 0;

      if (aCurrent !== bCurrent) {
        return bCurrent - aCurrent;
      }

      if (a.remainingBefore !== b.remainingBefore) {
        return a.remainingBefore - b.remainingBefore;
      }

      return a.label.localeCompare(b.label);
    });
}

function buildCounterChipMarkup(entry) {
  const afterValue = Math.max(0, Number(entry.beforeValue || 0) + Number(entry.currentValue || 0));
  const totalText = entry.target > 0
    ? `${entry.beforeValue} -> ${afterValue} / ${entry.target}`
    : `${entry.beforeValue} -> ${afterValue}`;
  const icon = getObjectiveIconMarkup(entry.icon || entry.key, entry.label, "autoCounterIcon");

  return `
    <div class="autoCounterChip" data-counter-chip="${escapeHtml(entry.key)}">
      <button
        type="button"
        class="btn autoCounterEdge autoCounterEdge-left"
        data-chip-action="decrement"
        data-counter-key="${escapeHtml(entry.key)}"
        aria-label="Decrease ${escapeHtml(entry.label)}"
      >-</button>

      <div class="autoCounterBody">
        <div class="autoCounterTopLine">
          <div class="autoCounterName">
            ${icon}
            <span class="autoCounterLabel">${escapeHtml(entry.shortLabel || entry.label)}</span>
          </div>
          <input
            type="number"
            step="1"
            min="0"
            class="autoCounterInput"
            data-chip-input="${escapeHtml(entry.key)}"
            value="${entry.currentValue}"
            aria-label="${escapeHtml(entry.label)} amount"
          />
        </div>
        <div class="autoCounterContext">${escapeHtml(totalText)}</div>
      </div>

      <button
        type="button"
        class="btn autoCounterEdge autoCounterEdge-right"
        data-chip-action="increment"
        data-counter-key="${escapeHtml(entry.key)}"
        aria-label="Increase ${escapeHtml(entry.label)}"
      >+</button>
    </div>
  `;
}

function buildCounterPickerMarkup(split, counterDefs, pickerSearch) {
  const currentAuto = normalizeAuto(split?.auto || {});
  const search = String(pickerSearch || "").trim().toLowerCase();

  const entries = Object.entries(safeObject(counterDefs))
    .filter(([key]) => currentAuto[key] == null)
    .map(([key, def]) => ({
      key,
      label: def?.label || key,
      searchValue: `${def?.label || key} ${def?.shortLabel || ""} ${key}`.toLowerCase()
    }))
    .filter((entry) => !search || entry.searchValue.includes(search))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!entries.length) {
    return `<div class="autoPickerEmpty">No counters match this search.</div>`;
  }

  return entries
    .map((entry) => {
      return `
        <button
          type="button"
          class="autoPickerOption"
          data-row-action="add-counter"
          data-counter-key="${escapeHtml(entry.key)}"
          data-search-value="${escapeHtml(entry.searchValue)}"
        >
          ${escapeHtml(entry.label)}
        </button>
      `;
    })
    .join("");
}

function getOcrGoalKey(goal) {
  return `${goal?.type || ""}:${goal?.id || goal?.label || ""}`;
}

function dedupeOcrGoalsAcrossSplits(splits = []) {
  const seen = new Set();

  return safeArray(splits).map((split) => {
    const goals = [];

    normalizeOcrGoals(split?.ocrGoals || []).forEach((goal) => {
      const key = getOcrGoalKey(goal);
      if (!key || seen.has(key)) return;
      seen.add(key);
      goals.push(goal);
    });

    return {
      ...split,
      ocrGoals: goals
    };
  });
}

function getPriorOcrGoalKeys(splits = [], index = 0) {
  const keys = new Set();
  const maxIndex = Math.max(0, Number(index || 0));

  safeArray(splits).slice(0, maxIndex).forEach((split) => {
    normalizeOcrGoals(split?.ocrGoals || []).forEach((goal) => {
      const key = getOcrGoalKey(goal);
      if (key) keys.add(key);
    });
  });

  return keys;
}

function getPriorOcrGoalMap(splits = [], index = 0) {
  const map = new Map();
  const maxIndex = Math.max(0, Number(index || 0));

  safeArray(splits).slice(0, maxIndex).forEach((split, splitIndex) => {
    normalizeOcrGoals(split?.ocrGoals || []).forEach((goal) => {
      const key = getOcrGoalKey(goal);
      if (!key || map.has(key)) return;
      map.set(key, {
        splitIndex,
        splitLabel: split?.label || `Split ${splitIndex + 1}`
      });
    });
  });

  return map;
}

function resolveOcrGoal(goal, goalOptions) {
  const normalized = normalizeOcrGoals([goal])[0];
  if (!normalized) return null;

  const match = safeArray(goalOptions).find((option) => {
    const optionKey = getOcrGoalKey(option);
    return optionKey === getOcrGoalKey(normalized)
      || (option?.id && option.id === normalized.id);
  });

  return {
    ...normalized,
    label: normalized.label || match?.label || normalized.id,
    counterKey: normalized.counterKey || match?.counterKey || "",
    type: normalized.type || match?.type || "",
    countsTowardCounter: match?.countsTowardCounter !== false,
    group: match?.group || "",
    no: match?.no || null
  };
}

function buildOcrGoalChipMarkup(goal, goalOptions) {
  const resolved = resolveOcrGoal(goal, goalOptions);
  if (!resolved) return "";

  const key = getOcrGoalKey(resolved);
  const meta = [
    resolved.group,
    resolved.counterKey,
    ...safeArray(resolved.linkedCounters).map((entry) => `also ${entry.counterKey} +${entry.delta}`),
    resolved.optional ? "optional" : ""
  ].filter(Boolean).join(" | ");

  return `
    <div class="ocrGoalChip" data-ocr-goal-chip>
      <input type="hidden" data-ocr-goal-field="id" value="${escapeHtml(resolved.id || "")}" />
      <input type="hidden" data-ocr-goal-field="type" value="${escapeHtml(resolved.type || "")}" />
      <input type="hidden" data-ocr-goal-field="label" value="${escapeHtml(resolved.label || "")}" />
      <input type="hidden" data-ocr-goal-field="counterKey" value="${escapeHtml(resolved.counterKey || "")}" />
      <input type="hidden" data-ocr-goal-field="linkedCounters" value="${escapeHtml(JSON.stringify(resolved.linkedCounters || []))}" />
      <div class="ocrGoalText">
        <strong>${escapeHtml(resolved.label || resolved.id)}</strong>
        <span>${escapeHtml(meta || "OCR goal")}</span>
      </div>
      <label class="ocrGoalOptional">
        <input type="checkbox" data-ocr-goal-field="optional" ${resolved.optional ? "checked" : ""} />
        Optional
      </label>
      <button
        type="button"
        class="btn danger ocrGoalRemove"
        data-row-action="remove-ocr-goal"
        data-goal-key="${escapeHtml(key)}"
        title="Remove OCR goal"
      >Remove</button>
    </div>
  `;
}

function buildOcrGoalPickerMarkup(split, goalOptions, pickerSearch, priorGoalMap = new Map()) {
  const currentKeys = new Set(normalizeOcrGoals(split?.ocrGoals || []).map(getOcrGoalKey));
  const priorGoalKeys = priorGoalMap instanceof Map ? new Set(priorGoalMap.keys()) : priorGoalMap;
  const search = String(pickerSearch || "").trim().toLowerCase();
  const entries = safeArray(goalOptions)
    .filter((goal) => !currentKeys.has(getOcrGoalKey(goal)))
    .filter((goal) => !priorGoalKeys.has(getOcrGoalKey(goal)))
    .map((goal) => ({
      ...goal,
      searchValue: `${goal.label || ""} ${goal.group || ""} ${goal.counterKey || ""} ${goal.id || ""}`.toLowerCase()
    }))
    .filter((goal) => !search || goal.searchValue.includes(search))
    .sort((a, b) => String(a.group || "").localeCompare(String(b.group || "")) || String(a.label || "").localeCompare(String(b.label || "")));

  if (!entries.length) {
    const blockedGoal = safeArray(goalOptions)
      .map((goal) => ({
        ...goal,
        key: getOcrGoalKey(goal),
        searchValue: `${goal.label || ""} ${goal.group || ""} ${goal.counterKey || ""} ${goal.id || ""}`.toLowerCase()
      }))
      .filter((goal) => !search || goal.searchValue.includes(search))
      .find((goal) => currentKeys.has(goal.key) || priorGoalKeys.has(goal.key));

    if (blockedGoal) {
      const prior = priorGoalMap instanceof Map ? priorGoalMap.get(blockedGoal.key) : null;
      const location = currentKeys.has(blockedGoal.key)
        ? "this split"
        : prior
          ? `#${Number(prior.splitIndex || 0) + 1} ${prior.splitLabel}`
          : "an earlier split";
      return `<div class="autoPickerEmpty">${escapeHtml(blockedGoal.label || blockedGoal.id)} is already tracked in ${escapeHtml(location)}.</div>`;
    }

    return `<div class="autoPickerEmpty">No OCR goals match this search.</div>`;
  }

  return entries.map((goal) => `
    <button
      type="button"
      class="autoPickerOption"
      data-row-action="add-ocr-goal"
      data-goal-id="${escapeHtml(goal.id || "")}"
      data-goal-type="${escapeHtml(goal.type || "")}"
      data-search-value="${escapeHtml(goal.searchValue)}"
    >
      ${escapeHtml(goal.label || goal.id)}
      ${goal.group ? `<span>${escapeHtml(goal.group)}</span>` : ""}
    </button>
  `).join("");
}

function buildRowHtml(split, index, phases, quotas, counterDefs, goalOptions, uiState) {
  const normalized = normalizeSplit(split, index);
  const compactSummaryMarkup = buildCompactObjectiveMarks(normalized, counterDefs);
  const counterChipData = buildCounterChipData({
    split: normalized,
    index,
    splits: uiState.allSplits,
    phases,
    quotas,
    counterDefs,
    showAll: !!uiState.showAll
  });
  const pickerOpen = !!uiState.pickerOpen;
  const ocrPickerOpen = !!uiState.ocrPickerOpen;
  const rowExpanded = !!uiState.expanded;
  const phaseId = getSplitPhaseId(normalized);
  const previousPhaseId = getSplitPhaseId(uiState.allSplits?.[index - 1]);
  const phaseChanged = !!phaseId && phaseId !== previousPhaseId;
  const activePhaseLabel = phaseId ? phases?.[phaseId]?.label || phaseId : "";
  const chipMarkup = counterChipData.length
    ? counterChipData.map((entry) => buildCounterChipMarkup(entry)).join("")
    : `
      <div class="autoCountersEmpty">
        ${uiState.showAll
          ? "No counters are available for this split."
          : "No planned auto-progress here yet. Use Add Counter when this split should tick something up."}
      </div>
    `;
  const pickerMarkup = pickerOpen
    ? `
      <div class="autoPicker" data-auto-picker>
        <input
          type="search"
          class="autoPickerSearch"
          data-picker-search
          value="${escapeHtml(uiState.search || "")}"
          placeholder="Search counters"
        />
        <div class="autoPickerOptions">
          ${buildCounterPickerMarkup(normalized, counterDefs, uiState.search)}
        </div>
      </div>
    `
    : "";
  const ocrGoalMarkup = normalized.ocrGoals.length
    ? normalized.ocrGoals.map((goal) => buildOcrGoalChipMarkup(goal, goalOptions)).join("")
    : `<div class="autoCountersEmpty">No OCR goals here yet.</div>`;
  const ocrPickerMarkup = ocrPickerOpen
    ? `
      <div class="autoPicker ocrGoalPicker" data-ocr-picker>
        <input
          type="search"
          class="autoPickerSearch"
          data-ocr-picker-search
          value="${escapeHtml(uiState.ocrSearch || "")}"
          placeholder="Search OCR goals"
        />
        <div class="autoPickerOptions">
          ${buildOcrGoalPickerMarkup(normalized, goalOptions, uiState.ocrSearch, getPriorOcrGoalMap(uiState.allSplits, index))}
        </div>
      </div>
    `
    : "";
  const splitMainMarkup = rowExpanded
    ? `
      <div class="splitSlateMain splitSlateEditorMain">
        <label class="field splitLabelField">
          <span>Split name</span>
          <input type="text" data-field="label" value="${escapeHtml(normalized.label)}" />
        </label>

        <label class="field splitPhaseField">
          <span>Phase</span>
          <select data-field="phase">
            ${buildPhaseOptions(phases, normalized.phase)}
          </select>
        </label>
      </div>
    `
    : `
      <button
        type="button"
        class="splitSlateMain"
        data-row-action="toggle-expanded"
        aria-expanded="false"
      >
        <span class="splitSlateTopLine">
          <span class="splitSlateTitle" data-split-title>${escapeHtml(normalized.label || `Split ${index + 1}`)}</span>
          <span class="splitSlateInlineObjectives" aria-label="Planned auto progress">
            ${compactSummaryMarkup}
          </span>
        </span>
        ${phaseChanged ? `<span class="splitSlateMeta">${escapeHtml(activePhaseLabel)}</span>` : ""}
      </button>
    `;

  return `
    <div class="editorCard splitEditorCard ${rowExpanded ? "is-expanded" : "is-collapsed"}" data-split-row="${index}" data-split-id="${escapeHtml(normalized.id)}">
      <div class="splitSlate">
        <button
          type="button"
          class="splitDragHandle"
          draggable="true"
          data-drag-handle
          aria-label="Drag split ${index + 1} to reorder"
          title="Drag to reorder"
        >${index + 1}</button>

        ${splitMainMarkup}

        <button
          type="button"
          class="btn splitSlateToggle"
          data-row-action="toggle-expanded"
          aria-expanded="${rowExpanded ? "true" : "false"}"
        >${rowExpanded ? "Collapse" : "Edit"}</button>
      </div>

      <div class="splitEditorBody" ${rowExpanded ? "" : "hidden"}>
        <div class="row between splitExpandedBar">
          <div class="row splitRowActions">
            <button type="button" class="btn" data-row-action="insert-above" title="Insert split above">+ Above</button>
            <button type="button" class="btn" data-row-action="insert-below" title="Insert split below">+ Below</button>
            <button type="button" class="btn" data-row-action="move-up" title="Move up">Up</button>
            <button type="button" class="btn" data-row-action="move-down" title="Move down">Down</button>
            <button type="button" class="btn danger" data-row-action="delete">Delete</button>
          </div>
        </div>

        <div class="splitEditLine">
          <label class="field splitNoteField">
            <span>Note</span>
            <textarea data-field="note" rows="2">${escapeHtml(normalized.note)}</textarea>
          </label>
        </div>

        <div class="splitAutoDetails">
          <div class="splitAutoPanel">
            <div class="row between splitAutoToolbar">
              <div class="row splitAutoToolbarActions">
                <button type="button" class="btn" data-row-action="toggle-picker">${pickerOpen ? "Close Picker" : "Add Counter"}</button>
                <button type="button" class="btn" data-row-action="toggle-show-all">${uiState.showAll ? "Relevant Only" : "Show All"}</button>
              </div>
            </div>

            ${pickerMarkup}

            <div class="autoCounterChipList">
              ${chipMarkup}
            </div>

            <div class="splitOcrGoalPanel">
              <div class="row between splitAutoToolbar">
                <div class="row splitAutoToolbarActions">
                  <button type="button" class="btn" data-row-action="toggle-ocr-picker">${ocrPickerOpen ? "Close OCR Goals" : "Add OCR Goal"}</button>
                </div>
              </div>

              ${ocrPickerMarkup}

              <div class="ocrGoalChipList">
                ${ocrGoalMarkup}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function filterCounterPicker(row, search) {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const picker = row.querySelector("[data-auto-picker]") || row;
  const options = Array.from(picker.querySelectorAll(".autoPickerOption"));
  const emptyState = picker.querySelector(".autoPickerEmpty");

  let visibleCount = 0;

  options.forEach((option) => {
    const label = option.dataset.searchValue || option.textContent?.trim().toLowerCase() || "";
    const visible = !normalizedSearch || label.includes(normalizedSearch);
    option.hidden = !visible;
    option.style.display = visible ? "" : "none";
    if (visible) visibleCount += 1;
  });

  if (emptyState) {
    emptyState.hidden = visibleCount > 0;
  }
}

function filterOcrGoalPicker(row, search) {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const picker = row.querySelector("[data-ocr-picker]") || row;
  const options = Array.from(picker.querySelectorAll(".autoPickerOption"));
  const emptyState = picker.querySelector(".autoPickerEmpty");

  let visibleCount = 0;

  options.forEach((option) => {
    const label = option.dataset.searchValue || option.textContent?.trim().toLowerCase() || "";
    const visible = !normalizedSearch || label.includes(normalizedSearch);
    option.hidden = !visible;
    option.style.display = visible ? "" : "none";
    if (visible) visibleCount += 1;
  });

  if (emptyState) {
    emptyState.hidden = visibleCount > 0;
  }
}

export function createSplitEditor({
  overlayEl = null,
  gridEl,
  addBtn = null,
  resetBtn = null,
  closeBtn = null,
  saveBtn = null,
  downloadBtn = null,
  copyBtn = null,
  getSplits,
  setSplits,
  getPhases,
  getQuotas,
  getCounterDefs,
  getOcrGoalOptions,
  searchInputEl = null,
  phaseFilterEl = null,
  filterResultPillEl = null,
  filterSummaryPillEl = null,
  expandAllBtn = null,
  collapseAllBtn = null,
  onAfterSave = null
}) {
  if (!gridEl) {
    throw new Error("createSplitEditor: gridEl is required");
  }

  let workingSplits = [];
  let initialSplits = [];
  let draggedSplitIndex = null;
  const rowUiState = new Map();
  const filterState = {
    search: "",
    phase: ""
  };

  function readSourceSplits() {
    const splits = safeArray(getSplits?.());
    const counterDefs = getCounterDefsSafe();
    return dedupeOcrGoalsAcrossSplits(
      splits.map((split, index) => sanitizeSplitAuto(normalizeSplit(split, index), counterDefs))
    );
  }

  function getPhasesSafe() {
    return safeObject(getPhases?.());
  }

  function getQuotasSafe() {
    return normalizeQuotas(getQuotas?.());
  }

  function getCounterDefsSafe() {
    return safeObject(getCounterDefs?.());
  }

  function getOcrGoalOptionsSafe() {
    return safeArray(getOcrGoalOptions?.());
  }

  function sanitizeSplitAuto(split, counterDefs = getCounterDefsSafe()) {
    const allowed = new Set(Object.keys(safeObject(counterDefs)));
    const auto = {};

    Object.entries(normalizeAuto(split?.auto || {})).forEach(([key, value]) => {
      if (!allowed.has(key)) return;
      auto[key] = value;
    });

    return {
      ...split,
      auto
    };
  }

  function getRowState(splitId) {
    const key = String(splitId || "");

    if (!rowUiState.has(key)) {
      rowUiState.set(key, {
        expanded: false,
        autoOpen: false,
        showAll: false,
        pickerOpen: false,
        search: "",
        ocrPickerOpen: false,
        ocrSearch: ""
      });
    }

    return rowUiState.get(key);
  }

  function refreshHeaderTitles() {
    gridEl.querySelectorAll("[data-split-row]").forEach((row, index) => {
      const eyebrow = row.querySelector("[data-split-eyebrow]");
      const titles = row.querySelectorAll("[data-split-title]");
      const labelInput = row.querySelector('[data-field="label"]');
      const fallbackLabel = workingSplits[index]?.label || `Split ${index + 1}`;
      const displayLabel = labelInput?.value?.trim() || fallbackLabel;

      if (eyebrow) eyebrow.textContent = `Split ${index + 1}`;
      titles.forEach((title) => {
        title.textContent = displayLabel;
      });
      row.dataset.splitRow = String(index);

      const dragHandle = row.querySelector("[data-drag-handle]");
      if (dragHandle) {
        dragHandle.textContent = String(index + 1);
        dragHandle.setAttribute("aria-label", `Drag split ${index + 1} to reorder`);
      }
    });
  }

  function syncFilterControls(phases) {
    if (phaseFilterEl) {
      const currentValue = phaseFilterEl.value || filterState.phase || "";
      phaseFilterEl.innerHTML = buildPhaseFilterOptions(workingSplits, phases, currentValue);
      filterState.phase = phaseFilterEl.value || currentValue || "";
    }

    if (searchInputEl && searchInputEl.value !== filterState.search) {
      searchInputEl.value = filterState.search;
    }
  }

  function updateFilterMeta(phases) {
    const total = workingSplits.length;
    const visible = workingSplits.filter((split) =>
      matchesSplitFilter(split, phases, filterState.search, filterState.phase)
    ).length;
    const phaseCount = new Set(
      workingSplits
        .map((split) => String(split?.phase || split?.phaseId || split?.act || "").trim())
        .filter(Boolean)
    ).size;

    if (filterResultPillEl) {
      filterResultPillEl.textContent = `${visible}/${total} shown`;
    }

    if (filterSummaryPillEl) {
      filterSummaryPillEl.textContent = `${phaseCount} phases in route`;
    }
  }

  function applyRowVisibility(phases) {
    gridEl.querySelectorAll("[data-split-row]").forEach((row) => {
      const index = Number(row.dataset.splitRow || 0);
      const split = workingSplits[index];
      const visible = matchesSplitFilter(split, phases, filterState.search, filterState.phase);
      row.classList.toggle("is-filter-hidden", !visible);
    });

    updateFilterMeta(phases);
  }

  function render() {
    const phases = getPhasesSafe();
    const quotas = getQuotasSafe();
    const counterDefs = getCounterDefsSafe();
    const goalOptions = getOcrGoalOptionsSafe();

    workingSplits = dedupeOcrGoalsAcrossSplits(workingSplits);

    if (!workingSplits.length) {
      gridEl.innerHTML = `
        <div class="editorCard">
          <div class="mid">No splits yet.</div>
          <div class="subtitle" style="margin-top:8px">Add a split to begin.</div>
        </div>
      `;
      return;
    }

    gridEl.innerHTML = workingSplits
      .map((split, index) => {
        const uiState = {
          ...getRowState(split.id),
          allSplits: workingSplits
        };

        return buildRowHtml(split, index, phases, quotas, counterDefs, goalOptions, uiState);
      })
      .join("") +
      buildRouteBalanceHtml(workingSplits, counterDefs, goalOptions);

    refreshHeaderTitles();
    syncFilterControls(phases);
    applyRowVisibility(phases);
  }

  function syncFromSource() {
    initialSplits = readSourceSplits();
    workingSplits = clone(initialSplits);
    render();
  }

  function collectFromDom() {
    const rows = Array.from(gridEl.querySelectorAll("[data-split-row]"));

    workingSplits = dedupeOcrGoalsAcrossSplits(rows.map((row, index) => {
      const existing = workingSplits[index] || {};
      const labelField = row.querySelector('[data-field="label"]');
      const phaseField = row.querySelector('[data-field="phase"]');
      const noteField = row.querySelector('[data-field="note"]');
      const counterInputs = Array.from(row.querySelectorAll("[data-chip-input]"));
      const goalChips = Array.from(row.querySelectorAll("[data-ocr-goal-chip]"));

      const label = labelField
        ? labelField.value?.trim() || `Split ${index + 1}`
        : existing.label || `Split ${index + 1}`;
      const phase = phaseField
        ? phaseField.value?.trim() || ""
        : getSplitPhaseId(existing);
      const note = noteField
        ? noteField.value || ""
        : existing.note || "";

      const counterDefs = getCounterDefsSafe();
      const auto = counterInputs.length ? {} : sanitizeSplitAuto(existing, counterDefs).auto;

      counterInputs.forEach((input) => {
        const key = input.dataset.chipInput;
        const n = Number(input.value || 0);

        if (!counterDefs[key]) return;
        if (!key || !Number.isFinite(n) || n === 0) return;
        auto[key] = n;
      });

      const ocrGoals = goalChips.length
        ? goalChips.map((chip) => {
          const read = (field) => chip.querySelector(`[data-ocr-goal-field="${field}"]`);
          return {
            id: read("id")?.value || "",
            type: read("type")?.value || "",
            label: read("label")?.value || "",
            counterKey: read("counterKey")?.value || "",
            optional: !!read("optional")?.checked,
            linkedCounters: (() => {
              try {
                return JSON.parse(read("linkedCounters")?.value || "[]");
              } catch {
                return [];
              }
            })()
          };
        })
        : normalizeOcrGoals(existing.ocrGoals || []);

      return sanitizeSplitAuto(normalizeSplit({
        id: workingSplits[index]?.id || row.dataset.splitId || `split_${index}`,
        label,
        phase,
        note,
        auto,
        ocrGoals,
        ...(existing.ocrCompletion ? { ocrCompletion: clone(existing.ocrCompletion) } : {})
      }, index), counterDefs);
    }));

    return clone(workingSplits);
  }

  function buildEmptySplit(index) {
    return sanitizeSplitAuto(normalizeSplit({
      id: makeSplitId(index),
      label: `Split ${index + 1}`,
      phase: "",
      note: "",
      auto: {},
      ocrGoals: []
    }, index));
  }

  function addEmptyRow() {
    collectFromDom();
    workingSplits.push(buildEmptySplit(workingSplits.length));
    render();
  }

  function insertRowAt(index) {
    collectFromDom();

    const insertIndex = Math.max(0, Math.min(index, workingSplits.length));
    const next = [...workingSplits];
    const newSplit = buildEmptySplit(insertIndex);

    next.splice(insertIndex, 0, newSplit);

    workingSplits = next.map((split, i) => sanitizeSplitAuto(normalizeSplit({
      ...split,
      id: split.id || makeSplitId(i)
    }, i)));

    getRowState(newSplit.id).autoOpen = true;
    render();
  }

  function reset() {
    workingSplits = clone(initialSplits);
    render();
  }

  async function save() {
    const nextSplits = collectFromDom();
    setSplits?.(nextSplits);
    initialSplits = clone(nextSplits);
    render();
    await onAfterSave?.(nextSplits);
  }

  function downloadBackup() {
    const payload = {
      splits: collectFromDom(),
      exportedAt: new Date().toISOString()
    };

    downloadJson("splits-backup.json", payload);
  }

  async function copyBackup() {
    const text = JSON.stringify({
      splits: collectFromDom(),
      exportedAt: new Date().toISOString()
    }, null, 2);

    const ok = await copyText(text);
    if (!ok) {
      console.warn("Could not copy split backup");
    }
  }

  function open() {
    syncFromSource();
    if (overlayEl) {
      overlayEl.classList.add("open");
      overlayEl.style.display = "block";
    }
  }

  function close() {
    if (overlayEl) {
      overlayEl.classList.remove("open");
      overlayEl.style.display = "none";
    }
  }

  function moveRow(index, direction) {
    collectFromDom();

    const target = index + direction;
    if (target < 0 || target >= workingSplits.length) return;

    const next = [...workingSplits];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;

    workingSplits = next.map((split, i) => sanitizeSplitAuto(normalizeSplit(split, i)));
    render();
  }

  function moveRowTo(fromIndex, toIndex, placement = "before") {
    collectFromDom();

    if (fromIndex < 0 || fromIndex >= workingSplits.length) return;
    if (toIndex < 0 || toIndex >= workingSplits.length) return;

    let insertIndex = placement === "after" ? toIndex + 1 : toIndex;

    if (fromIndex === toIndex || fromIndex + 1 === insertIndex) {
      render();
      return;
    }

    const next = [...workingSplits];
    const [moved] = next.splice(fromIndex, 1);

    if (fromIndex < insertIndex) {
      insertIndex -= 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, next.length));
    next.splice(insertIndex, 0, moved);

    workingSplits = next.map((split, i) => sanitizeSplitAuto(normalizeSplit(split, i)));
    render();
  }

  function deleteRow(index) {
    collectFromDom();

    const splitId = workingSplits[index]?.id;
    if (splitId) {
      rowUiState.delete(String(splitId));
    }

    workingSplits = workingSplits
      .filter((_, i) => i !== index)
      .map((split, i) => sanitizeSplitAuto(normalizeSplit(split, i)));

    render();
  }

  function adjustCounter(index, key, delta) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split || !getCounterDefsSafe()[key]) return;

    const current = Number(split.auto?.[key] || 0);
    const next = current + Number(delta || 0);

    if (next <= 0) {
      delete split.auto[key];
    } else {
      split.auto[key] = next;
    }

    render();
  }

  function setCounterValue(index, key, rawValue) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split || !getCounterDefsSafe()[key]) return;

    const next = Number(rawValue || 0);

    if (!Number.isFinite(next) || next <= 0) {
      delete split.auto[key];
    } else {
      split.auto[key] = next;
    }

    render();
  }

  function addCounter(index, key) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split || !key || !getCounterDefsSafe()[key]) return;

    split.auto[key] = Number(split.auto?.[key] || 1);

    const uiState = getRowState(split.id);
    uiState.pickerOpen = false;
    uiState.search = "";
    uiState.autoOpen = true;

    render();
  }

  function addOcrGoal(index, goalId, goalType) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split || !goalId) return;

    const option = getOcrGoalOptionsSafe().find((goal) =>
      String(goal.id || "") === String(goalId)
      && String(goal.type || "") === String(goalType || "")
    );
    if (!option) return;

    const existingKeys = new Set(normalizeOcrGoals(split.ocrGoals || []).map(getOcrGoalKey));
    const goal = normalizeOcrGoals([{
      id: option.id,
      type: option.type,
      label: option.label,
      counterKey: option.counterKey,
      linkedCounters: option.linkedCounters || []
    }])[0];
    if (!goal || existingKeys.has(getOcrGoalKey(goal))) return;

    split.ocrGoals = [...normalizeOcrGoals(split.ocrGoals || []), goal];

    const uiState = getRowState(split.id);
    uiState.ocrPickerOpen = false;
    uiState.ocrSearch = "";

    render();
  }

  function removeOcrGoal(index, goalKey) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split || !goalKey) return;

    split.ocrGoals = normalizeOcrGoals(split.ocrGoals || [])
      .filter((goal) => getOcrGoalKey(goal) !== goalKey);

    render();
  }

  function toggleShowAll(index) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split) return;

    const uiState = getRowState(split.id);
    uiState.showAll = !uiState.showAll;
    uiState.autoOpen = true;
    render();
  }

  function togglePicker(index) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split) return;

    const uiState = getRowState(split.id);
    uiState.pickerOpen = !uiState.pickerOpen;
    uiState.autoOpen = true;

    if (!uiState.pickerOpen) {
      uiState.search = "";
    }

    render();
  }

  function toggleOcrPicker(index) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split) return;

    const uiState = getRowState(split.id);
    uiState.ocrPickerOpen = !uiState.ocrPickerOpen;

    if (!uiState.ocrPickerOpen) {
      uiState.ocrSearch = "";
    }

    render();
  }

  function toggleExpanded(index) {
    collectFromDom();

    const split = workingSplits[index];
    if (!split) return;

    const uiState = getRowState(split.id);
    uiState.expanded = !uiState.expanded;
    render();
  }

  function setAllAutoOpen(isOpen) {
    collectFromDom();

    workingSplits.forEach((split) => {
      const uiState = getRowState(split.id);
      uiState.expanded = isOpen;
      if (!isOpen) {
        uiState.autoOpen = false;
      }
    });
    render();
  }

  addBtn?.addEventListener("click", addEmptyRow);
  resetBtn?.addEventListener("click", reset);
  saveBtn?.addEventListener("click", () => {
    save().catch((error) => {
      console.error("Split save failed", error);
    });
  });
  downloadBtn?.addEventListener("click", downloadBackup);
  copyBtn?.addEventListener("click", copyBackup);
  closeBtn?.addEventListener("click", close);
  expandAllBtn?.addEventListener("click", () => setAllAutoOpen(true));
  collapseAllBtn?.addEventListener("click", () => setAllAutoOpen(false));

  searchInputEl?.addEventListener("input", (event) => {
    filterState.search = event.target.value || "";
    applyRowVisibility(getPhasesSafe());
  });

  phaseFilterEl?.addEventListener("change", (event) => {
    filterState.phase = event.target.value || "";
    applyRowVisibility(getPhasesSafe());
  });

  overlayEl?.addEventListener("click", (event) => {
    if (event.target === overlayEl) {
      close();
    }
  });

  gridEl.addEventListener("input", (event) => {
    if (event.target.matches('[data-field="label"]')) {
      const row = event.target.closest("[data-split-row]");
      if (!row) return;

      const index = Number(row.dataset.splitRow || 0);
      row.querySelectorAll("[data-split-title]").forEach((title) => {
        title.textContent = event.target.value.trim() || `Split ${index + 1}`;
      });

      return;
    }

    if (event.target.matches("[data-picker-search]")) {
      const row = event.target.closest("[data-split-row]");
      if (!row) return;

      const splitId = row.dataset.splitId;
      const uiState = getRowState(splitId);
      uiState.search = event.target.value || "";
      filterCounterPicker(row, uiState.search);
    }

    if (event.target.matches("[data-ocr-picker-search]")) {
      const row = event.target.closest("[data-split-row]");
      if (!row) return;

      const splitId = row.dataset.splitId;
      const uiState = getRowState(splitId);
      uiState.ocrSearch = event.target.value || "";
      filterOcrGoalPicker(row, uiState.ocrSearch);
    }
  });

  gridEl.addEventListener("change", (event) => {
    if (event.target.matches('[data-field="phase"]')) {
      collectFromDom();
      render();
      return;
    }

    if (event.target.matches("[data-chip-input]")) {
      const row = event.target.closest("[data-split-row]");
      if (!row) return;

      const index = Number(row.dataset.splitRow || 0);
      const key = event.target.dataset.chipInput;
      setCounterValue(index, key, event.target.value);
    }
  });

  gridEl.addEventListener("toggle", (event) => {
    const details = event.target.closest(".splitAutoDetails");
    if (!details) return;

    const row = details.closest("[data-split-row]");
    if (!row) return;

    const splitId = row.dataset.splitId;
    const uiState = getRowState(splitId);
    uiState.autoOpen = details.open;
  }, true);

  gridEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-row-action], [data-chip-action]");
    if (!button) return;

    const row = button.closest("[data-split-row]");
    if (!row) return;

    const index = Number(row.dataset.splitRow || 0);
    const action = button.dataset.rowAction || button.dataset.chipAction;
    const counterKey = button.dataset.counterKey;
    const goalId = button.dataset.goalId;
    const goalType = button.dataset.goalType;
    const goalKey = button.dataset.goalKey;

    if (action === "toggle-expanded") toggleExpanded(index);
    if (action === "insert-above") insertRowAt(index);
    if (action === "insert-below") insertRowAt(index + 1);
    if (action === "move-up") moveRow(index, -1);
    if (action === "move-down") moveRow(index, 1);
    if (action === "delete") deleteRow(index);
    if (action === "toggle-picker") togglePicker(index);
    if (action === "toggle-ocr-picker") toggleOcrPicker(index);
    if (action === "toggle-show-all") toggleShowAll(index);
    if (action === "add-counter") addCounter(index, counterKey);
    if (action === "add-ocr-goal") addOcrGoal(index, goalId, goalType);
    if (action === "remove-ocr-goal") removeOcrGoal(index, goalKey);
    if (action === "increment") adjustCounter(index, counterKey, 1);
    if (action === "decrement") adjustCounter(index, counterKey, -1);
  });

  gridEl.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-drag-handle]");
    if (!handle) return;

    const row = handle.closest("[data-split-row]");
    if (!row) return;

    collectFromDom();

    draggedSplitIndex = Number(row.dataset.splitRow || 0);
    row.classList.add("is-dragging");

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(draggedSplitIndex));
  });

  gridEl.addEventListener("dragover", (event) => {
    const row = event.target.closest("[data-split-row]");
    if (!row || draggedSplitIndex == null) return;

    event.preventDefault();

    const rect = row.getBoundingClientRect();
    const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";

    gridEl.querySelectorAll(".is-drag-over-before, .is-drag-over-after").forEach((target) => {
      target.classList.remove("is-drag-over-before", "is-drag-over-after");
    });

    row.classList.add(placement === "after" ? "is-drag-over-after" : "is-drag-over-before");
    event.dataTransfer.dropEffect = "move";
  });

  gridEl.addEventListener("drop", (event) => {
    const row = event.target.closest("[data-split-row]");
    if (!row) return;

    event.preventDefault();

    const rect = row.getBoundingClientRect();
    const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    const fromIndex = draggedSplitIndex ?? Number(event.dataTransfer.getData("text/plain"));
    const toIndex = Number(row.dataset.splitRow || 0);

    draggedSplitIndex = null;
    gridEl.querySelectorAll(".is-dragging, .is-drag-over-before, .is-drag-over-after").forEach((target) => {
      target.classList.remove("is-dragging", "is-drag-over-before", "is-drag-over-after");
    });

    moveRowTo(fromIndex, toIndex, placement);
  });

  gridEl.addEventListener("dragend", () => {
    draggedSplitIndex = null;
    gridEl.querySelectorAll(".is-dragging, .is-drag-over-before, .is-drag-over-after").forEach((target) => {
      target.classList.remove("is-dragging", "is-drag-over-before", "is-drag-over-after");
    });
  });

  syncFromSource();

  return {
    open,
    close,
    save,
    reset,
    addEmptyRow,
    downloadBackup,
    copyBackup
  };
}
