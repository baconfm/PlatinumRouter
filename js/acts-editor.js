// js/acts-editor.js

import {
  NO_PHASE_CHAIN,
  getPhaseObjectiveResolution,
  getResolvedProgressFromPhaseId,
  normalizePhaseProgressFrom,
  getSplitPhaseId as getPhaseRoutingSplitPhaseId
} from "./phase-routing.js?v=20260426a";
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

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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

function normalizePhase(phaseId, phase = {}, counterDefs = {}) {
  const visibleCounters = Array.isArray(phase.visibleCounters)
    ? phase.visibleCounters
    : Array.isArray(phase.visible)
      ? phase.visible
      : Array.isArray(phase.objectives)
        ? phase.objectives
        : [];

  const filteredVisible = visibleCounters.filter((key) => counterDefs[key]);

  const rawTargetMinutes =
    phase?.targetMinutes ??
    phase?.paceTargetMinutes ??
    phase?.actTargetMinutes ??
    0;

  const targetMinutes = Number(rawTargetMinutes);

  return {
    id: phaseId || "",
    label: phase.label || phaseId || "",
    description: phase.description || "",
    note: phase.note || "",
    objectiveNote: phase.objectiveNote || phase.currentNote || "",
    progressFrom: normalizePhaseProgressFrom(phase?.progressFrom),
    visibleCounters: filteredVisible,
    targetMinutes: Number.isFinite(targetMinutes) && targetMinutes > 0 ? targetMinutes : 0
  };
}

function normalizeQuotas(quotas = {}, counterDefs = {}) {
  const result = {};

  Object.entries(safeObject(quotas)).forEach(([key, value]) => {
    const n = Number(value);
    if (!counterDefs[key]) return;
    if (!Number.isFinite(n) || n <= 0) return;
    result[key] = n;
  });

  return result;
}

function getPhaseIds(phases) {
  return Object.keys(safeObject(phases));
}

function summarizeText(value, maxLength = 96) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function getCounterEntries(counterDefs) {
  return Object.entries(safeObject(counterDefs))
    .map(([key, def]) => ({
      key,
      def: def || {},
      label: def?.label || key,
      shortLabel: def?.shortLabel || def?.queueLabel || def?.label || key
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getPhaseStats(phase = {}, quotas = {}, resolution = null) {
  return {
    visibleCount: Array.isArray(resolution?.effectiveVisibleKeys)
      ? resolution.effectiveVisibleKeys.length
      : safeArray(phase.visibleCounters).length,
    hiddenCompletedCount: Array.isArray(resolution?.hiddenCompletedKeys)
      ? resolution.hiddenCompletedKeys.length
      : 0,
    quotaCount: Object.keys(safeObject(quotas)).length,
    targetMinutes: Number(phase.targetMinutes || 0)
  };
}

function buildPhaseUsageMap(splits = [], activePhaseId = "", phases = {}) {
  const usage = {};

  safeArray(splits).forEach((split, index) => {
    const phaseId = getPhaseRoutingSplitPhaseId(split, phases);
    if (!phaseId) return;

    if (!usage[phaseId]) {
      usage[phaseId] = {
        count: 0,
        firstIndex: index,
        lastIndex: index,
        isActive: false
      };
    }

    usage[phaseId].count += 1;
    usage[phaseId].lastIndex = index;
  });

  const resolvedActivePhaseId =
    String(activePhaseId || "").trim() && phases?.[activePhaseId]
      ? activePhaseId
      : Object.keys(phases || {}).find((phaseId) => phases?.[phaseId]?.label === activePhaseId) || "";

  if (resolvedActivePhaseId) {
    if (!usage[resolvedActivePhaseId]) {
      usage[resolvedActivePhaseId] = {
        count: 0,
        firstIndex: -1,
        lastIndex: -1,
        isActive: true
      };
    } else {
      usage[resolvedActivePhaseId].isActive = true;
    }
  }

  return usage;
}

function buildValidationMessages(phaseId, phase, quotas, phaseUsage, resolution = null) {
  const messages = [];
  const quotaKeys = Object.keys(safeObject(quotas));
  const visibleSet = new Set(safeArray(phase?.visibleCounters));
  const hiddenQuotaKeys = quotaKeys.filter((key) => !visibleSet.has(key));
  const usage = phaseUsage?.[phaseId];

  if (!usage?.count) {
    messages.push("No splits currently point at this phase.");
  }

  if (hiddenQuotaKeys.length) {
    messages.push(
      `${hiddenQuotaKeys.length} quota target${hiddenQuotaKeys.length === 1 ? "" : "s"} will not appear in visible objectives.`
    );
  }

  if (usage?.isActive) {
    messages.push("This is the current live phase in the controller state.");
  }

  if (Array.isArray(resolution?.hiddenCompletedKeys) && resolution.hiddenCompletedKeys.length) {
    messages.push(
      `${resolution.hiddenCompletedKeys.length} objective${resolution.hiddenCompletedKeys.length === 1 ? "" : "s"} are hidden here because the route chain completes them earlier.`
    );
  }

  return messages;
}

function buildMetricPill(label, value, tone = "") {
  return `
    <span class="phaseMetaPill ${tone}">
      <span class="phaseMetaPillLabel">${escapeHtml(label)}</span>
      <span class="phaseMetaPillValue">${escapeHtml(value)}</span>
    </span>
  `;
}

function buildPhaseListHtml(
  phases,
  quotas,
  selectedPhaseId,
  search = "",
  phaseUsage = {},
  showUnused = false,
  phaseObjectiveResolutions = {}
) {
  const phaseIds = getPhaseIds(phases);
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const hasUnusedPhases = phaseIds.some((phaseId) => {
    return !(phaseUsage?.[phaseId]?.count > 0 || phaseUsage?.[phaseId]?.isActive);
  });
  const toggleLabel = hasUnusedPhases
    ? showUnused
      ? "Route Only"
      : "Show Unused"
    : "No Unused";

  const filteredIds = phaseIds.filter((phaseId) => {
    if (!showUnused && !(phaseUsage?.[phaseId]?.count > 0 || phaseUsage?.[phaseId]?.isActive)) {
      return false;
    }

    if (!normalizedSearch) return true;

    const phase = phases[phaseId] || {};
    const haystack = [
      phaseId,
      phase.label || "",
      phase.description || "",
      phase.note || "",
      phase.objectiveNote || ""
    ].join(" ").toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  const bodyMarkup = !phaseIds.length
    ? `
      <div class="phaseSidebarEmpty">
        <div class="mid">No phases yet.</div>
        <div class="subtitle">Add a phase to begin.</div>
      </div>
    `
    : !filteredIds.length
      ? `
        <div class="phaseSidebarEmpty">
          <div class="mid">No matching phases.</div>
          <div class="subtitle">Try a broader search.</div>
        </div>
      `
      : filteredIds.map((phaseId) => {
        const phase = phases[phaseId] || {};
        const phaseQuotas = quotas[phaseId] || {};
        const resolution = phaseObjectiveResolutions?.[phaseId] || null;
        const stats = getPhaseStats(phase, phaseQuotas, resolution);
        const usage = phaseUsage?.[phaseId] || null;
        const preview =
          summarizeText(phase.objectiveNote || phase.note || phase.description || "", 92) ||
          "No notes yet.";
        const coverageText = usage?.count
          ? `Splits ${usage.firstIndex + 1}-${usage.lastIndex + 1} | ${usage.count} assigned`
          : "Unused in current route";

        return `
          <button
            type="button"
            class="phaseListCard ${phaseId === selectedPhaseId ? "is-active" : ""}"
            data-phase-id="${escapeHtml(phaseId)}"
          >
            <div class="phaseListCardTop">
              <div>
                <div class="phaseListLabel">${escapeHtml(phase.label || phaseId)}</div>
                <div class="phaseListId">${escapeHtml(phaseId)}</div>
              </div>
              <span class="phaseListChevron">Edit</span>
            </div>

            <div class="phaseListMetrics">
              ${buildMetricPill("Objectives", String(stats.visibleCount))}
              ${buildMetricPill("Quotas", String(stats.quotaCount))}
              ${buildMetricPill("Pace", stats.targetMinutes > 0 ? `${stats.targetMinutes}m` : "Off")}
              ${buildMetricPill("Coverage", usage?.count ? String(usage.count) : "0", usage?.isActive ? "tone-accent" : "")}
              ${stats.hiddenCompletedCount > 0 ? buildMetricPill("Done Before", String(stats.hiddenCompletedCount)) : ""}
            </div>

            <div class="phaseListPreview">${escapeHtml(preview)}</div>
            <div class="phaseListCoverage">${escapeHtml(coverageText)}</div>
          </button>
        `;
      }).join("");

  return `
    <div class="phaseSidebarShell">
      <div class="phaseSidebarHeader">
        <div>
          <div class="eyebrow">Phases</div>
          <div class="mid">${showUnused ? phaseIds.length : filteredIds.length} visible</div>
        </div>
        <div class="phaseSidebarHeaderActions">
          <div class="pill">${filteredIds.length}/${phaseIds.length}</div>
          <button type="button" class="btn" id="toggleUnusedPhasesBtn" ${hasUnusedPhases ? "" : "disabled"}>
            ${toggleLabel}
          </button>
        </div>
      </div>

      <label class="field phaseSidebarSearchField">
        <span>Search</span>
        <input
          type="search"
          id="phaseListSearchInput"
          placeholder="Find a phase"
          value="${escapeHtml(search)}"
        />
      </label>

      <div class="phaseSidebarList">
        ${bodyMarkup}
      </div>
    </div>
  `;
}

function buildObjectiveChip(counterKey, def, extraClass = "") {
  const label = def?.label || counterKey;
  const icon = def?.icon
    ? `<span class="phaseInlineIconWrap">${getObjectiveIconMarkup(def.icon, label, "phaseInlineIcon")}</span>`
    : "";

  return `
    <div class="phaseObjectiveChip ${extraClass}" data-visible-chip="${escapeHtml(counterKey)}">
      <span class="phaseObjectiveChipLabel">${icon}${escapeHtml(label)}</span>
      <button
        type="button"
        class="phaseObjectiveChipRemove"
        data-editor-action="remove-visible"
        data-counter-key="${escapeHtml(counterKey)}"
        aria-label="Remove ${escapeHtml(label)} from visible objectives"
      >x</button>
    </div>
  `;
}

function buildCounterPickerOptions(counterDefs, selectedKeys = [], search = "") {
  const selectedSet = new Set(safeArray(selectedKeys));
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const allEntries = getCounterEntries(counterDefs).filter(({ key }) => !selectedSet.has(key));

  const entries = allEntries.filter(({ key, label, shortLabel }) => {
    if (!normalizedSearch) return true;

    const haystack = `${key} ${label} ${shortLabel}`.toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  if (!entries.length) {
    const emptyLabel = allEntries.length
      ? "No counters match this search."
      : "All counters are already in this section.";
    return `<div class="phasePickerEmpty">${emptyLabel}</div>`;
  }

  return entries.map(({ key, def, label }) => {
    const icon = def?.icon
      ? `<span class="phaseInlineIconWrap">${getObjectiveIconMarkup(def.icon, label, "phaseInlineIcon")}</span>`
      : "";

    return `
      <button
        type="button"
        class="phasePickerOption"
        data-counter-key="${escapeHtml(key)}"
      >
        ${icon}${escapeHtml(label)}
      </button>
    `;
  }).join("");
}

function buildQuotaSlate(counterKey, value, counterDefs = {}) {
  const def = counterDefs[counterKey] || {};
  const label = def?.label || counterKey;
  const icon = def?.icon
    ? `<span class="phaseInlineIconWrap">${getObjectiveIconMarkup(def.icon, label, "phaseInlineIcon")}</span>`
    : "";
  const max = Number(def?.max || 0);
  const context = max > 0 ? `Phase target | ${value}/${max} overall` : "Phase target";

  return `
    <div class="phaseQuotaSlate" data-quota-slate="${escapeHtml(counterKey)}">
      <button
        type="button"
        class="btn phaseQuotaEdge phaseQuotaEdge-left"
        data-editor-action="decrement-quota"
        data-counter-key="${escapeHtml(counterKey)}"
        aria-label="Decrease ${escapeHtml(label)} quota"
      >-</button>

      <div class="phaseQuotaBody">
        <div class="phaseQuotaTopLine">
          <div class="phaseQuotaLabel">${icon}${escapeHtml(label)}</div>
          <input
            type="number"
            min="0"
            step="1"
            class="phaseQuotaInput"
            data-quota-input="${escapeHtml(counterKey)}"
            value="${Number(value || 0)}"
            aria-label="${escapeHtml(label)} quota"
          />
        </div>
        <div class="phaseQuotaContext">${escapeHtml(context)}</div>
      </div>

      <button
        type="button"
        class="btn phaseQuotaEdge phaseQuotaEdge-right"
        data-editor-action="increment-quota"
        data-counter-key="${escapeHtml(counterKey)}"
        aria-label="Increase ${escapeHtml(label)} quota"
      >+</button>
    </div>
  `;
}

function buildProgressFromOptionsMarkup(phaseId, phases, splits, storedProgressFrom) {
  const options = [
    `<option value="">Auto previous routed phase</option>`,
    `<option value="${NO_PHASE_CHAIN}" ${storedProgressFrom === NO_PHASE_CHAIN ? "selected" : ""}>No chained progress</option>`
  ];

  Object.entries(safeObject(phases))
    .filter(([candidateId]) => candidateId !== phaseId)
    .forEach(([candidateId, candidatePhase]) => {
      const isSelected = storedProgressFrom === candidateId ? "selected" : "";
      options.push(
        `<option value="${escapeHtml(candidateId)}" ${isSelected}>${escapeHtml(candidatePhase?.label || candidateId)}</option>`
      );
    });

  const resolvedProgressFrom = getResolvedProgressFromPhaseId(phaseId, phases, splits);
  const resolvedLabel = resolvedProgressFrom
    ? phases?.[resolvedProgressFrom]?.label || resolvedProgressFrom
    : "None";

  return {
    options: options.join(""),
    resolvedLabel
  };
}

function buildFormHtml(
  phaseId,
  phase,
  quotas,
  counterDefs,
  uiState,
  phaseUsage = {},
  phases = {},
  splits = [],
  objectiveResolution = null
) {
  if (!phaseId) {
    return `
      <div class="phaseInspectorEmpty">
        <div class="mid">No phase selected.</div>
        <div class="subtitle">Add or select a phase to edit it.</div>
      </div>
    `;
  }

  const configuredVisibleCounters = safeArray(phase.visibleCounters);
  const visibleCounters = Array.isArray(objectiveResolution?.effectiveVisibleKeys)
    ? objectiveResolution.effectiveVisibleKeys
    : configuredVisibleCounters;
  const hiddenCompletedKeys = Array.isArray(objectiveResolution?.hiddenCompletedKeys)
    ? objectiveResolution.hiddenCompletedKeys
    : [];
  const quotaEntries = Object.entries(safeObject(quotas)).sort(([a], [b]) => {
    const aLabel = counterDefs?.[a]?.label || a;
    const bLabel = counterDefs?.[b]?.label || b;
    return aLabel.localeCompare(bLabel);
  });
  const stats = getPhaseStats(phase, quotas, objectiveResolution);
  const visibleChipsMarkup = visibleCounters.length
    ? visibleCounters
      .map((key) => buildObjectiveChip(key, counterDefs[key]))
      .join("")
    : `<div class="phaseEmptyState">No visible objectives selected for this phase.</div>`;
  const completedEarlierMarkup = hiddenCompletedKeys.length
    ? `
      <div class="phaseCompletedEarlierBlock">
        <div class="subtitle">Completed earlier in the chain</div>
        <div class="phaseObjectiveChipList phaseObjectiveChipList-muted">
          ${hiddenCompletedKeys.map((key) => buildObjectiveChip(key, counterDefs[key], "phaseObjectiveChip-muted")).join("")}
        </div>
      </div>
    `
    : "";
  const quotaSlateMarkup = quotaEntries.length
    ? quotaEntries.map(([key, value]) => buildQuotaSlate(key, value, counterDefs)).join("")
    : `<div class="phaseEmptyState">No quota targets set for this phase.</div>`;
  const objectivePickerMarkup = uiState.objectivePickerOpen
    ? `
      <div class="phasePicker" data-picker-root="visible">
        <input
          type="search"
          class="phasePickerSearch"
          data-picker-search="visible"
          value="${escapeHtml(uiState.objectiveSearch || "")}"
          placeholder="Search objectives"
        />
        <div class="phasePickerOptions">
          ${buildCounterPickerOptions(counterDefs, configuredVisibleCounters, uiState.objectiveSearch)}
        </div>
      </div>
    `
    : "";
  const quotaPickerMarkup = uiState.quotaPickerOpen
    ? `
      <div class="phasePicker" data-picker-root="quota">
        <input
          type="search"
          class="phasePickerSearch"
          data-picker-search="quota"
          value="${escapeHtml(uiState.quotaSearch || "")}"
          placeholder="Search quota counters"
        />
        <div class="phasePickerOptions">
          ${buildCounterPickerOptions(counterDefs, Object.keys(safeObject(quotas)), uiState.quotaSearch)}
        </div>
      </div>
    `
    : "";
  const usage = phaseUsage?.[phaseId] || null;
  const validationMessages = buildValidationMessages(phaseId, phase, quotas, phaseUsage, objectiveResolution);
  const usageMarkup = usage?.count
    ? `${usage.count} split${usage.count === 1 ? "" : "s"} assigned | ${usage.firstIndex + 1}-${usage.lastIndex + 1}${usage.isActive ? " | Live" : ""}`
    : "Unused in current route";
  const validationMarkup = validationMessages.length
    ? `
      <div class="phaseValidationList">
        ${validationMessages.map((message) => `<div class="phaseValidationItem">${escapeHtml(message)}</div>`).join("")}
      </div>
    `
    : "";
  const progressFromMarkup = buildProgressFromOptionsMarkup(
    phaseId,
    phases,
    splits,
    phase?.progressFrom || ""
  );

  return `
    <div class="phaseInspectorShell">
      <div class="phaseInspectorHeader">
        <div>
          <div class="eyebrow">Selected Phase</div>
          <div class="phaseInspectorName">${escapeHtml(phase.label || phaseId)}</div>
          <div class="phaseInspectorId">${escapeHtml(phaseId)}</div>
        </div>

        <div class="phaseInspectorHeaderActions">
          <button type="button" class="btn danger" id="deletePhaseBtn">Delete Phase</button>
        </div>
      </div>

      <div class="phaseStatsRow">
        ${buildMetricPill("Visible Objectives", String(stats.visibleCount), "tone-accent")}
        ${buildMetricPill("Quota Targets", String(stats.quotaCount), "tone-accent")}
        ${buildMetricPill("Target Minutes", stats.targetMinutes > 0 ? `${stats.targetMinutes}m` : "Off", "tone-accent")}
        ${buildMetricPill("Route Coverage", usage?.count ? `${usage.count}` : "0", usage?.isActive ? "tone-accent" : "")}
      </div>

      <div class="phaseInspectorSummary">${escapeHtml(usageMarkup)}</div>
      ${validationMarkup}

      <section class="editorCard phaseSection">
        <div class="phaseSectionHeader">
          <div>
            <div class="eyebrow">Basics</div>
            <div class="subtitle">Keep phase identity and pacing readable here.</div>
          </div>
        </div>

        <div class="fields phaseBasicsGrid">
          <label class="field">
            <span>Phase ID</span>
            <input type="text" id="phaseIdInput" value="${escapeHtml(phaseId)}" />
          </label>

          <label class="field">
            <span>Label</span>
            <input type="text" id="phaseLabelInput" value="${escapeHtml(phase.label || "")}" />
          </label>

          <label class="field">
            <span>Target Minutes</span>
            <input
              type="number"
              min="0"
              step="1"
              id="phaseTargetMinutesInput"
              value="${Number(phase.targetMinutes || 0)}"
            />
          </label>

          <label class="field">
            <span>Progress Carries From</span>
            <select id="phaseProgressFromInput">
              ${progressFromMarkup.options}
            </select>
          </label>
        </div>

        <div class="phaseInspectorSummary">Resolved previous phase: ${escapeHtml(progressFromMarkup.resolvedLabel)}</div>
      </section>

      <section class="editorCard phaseSection">
        <div class="phaseSectionHeader">
          <div>
            <div class="eyebrow">Notes</div>
            <div class="subtitle">Separate structural notes from what the controller should call out live.</div>
          </div>
        </div>

        <div class="fields phaseNoteGrid">
          <label class="field phaseFullField">
            <span>Description</span>
            <textarea id="phaseDescriptionInput" rows="3">${escapeHtml(phase.description || "")}</textarea>
          </label>

          <label class="field phaseFullField">
            <span>Phase Note</span>
            <textarea id="phaseNoteInput" rows="3">${escapeHtml(phase.note || "")}</textarea>
          </label>

          <label class="field phaseFullField">
            <span>Current Objective Note</span>
            <textarea id="phaseObjectiveNoteInput" rows="3">${escapeHtml(phase.objectiveNote || "")}</textarea>
          </label>
        </div>
      </section>

      <section class="editorCard phaseSection">
        <div class="phaseSectionHeader">
          <div>
            <div class="eyebrow">Visible Objectives</div>
            <div class="subtitle">Only counters in this list are surfaced during the phase.</div>
          </div>

          <div class="phaseSectionActions">
            <button type="button" class="btn" data-editor-action="toggle-visible-picker">
              ${uiState.objectivePickerOpen ? "Close Picker" : "Add Objective"}
            </button>
          </div>
        </div>

        ${objectivePickerMarkup}

        <div class="phaseObjectiveChipList">
          ${visibleChipsMarkup}
        </div>
        ${completedEarlierMarkup}
      </section>

      <section class="editorCard phaseSection">
        <div class="phaseSectionHeader">
          <div>
            <div class="eyebrow">Quota Targets</div>
            <div class="subtitle">Track only the counters this phase is supposed to finish or advance.</div>
          </div>

          <div class="phaseSectionActions">
            <button type="button" class="btn" data-editor-action="toggle-quota-picker">
              ${uiState.quotaPickerOpen ? "Close Picker" : "Add Quota"}
            </button>
          </div>
        </div>

        ${quotaPickerMarkup}

        <div class="phaseQuotaSlateList">
          ${quotaSlateMarkup}
        </div>
      </section>
    </div>
  `;
}

function filterPicker(root, search) {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  const options = Array.from(root.querySelectorAll(".phasePickerOption"));
  const emptyState = root.querySelector(".phasePickerEmpty");
  let visibleCount = 0;

  options.forEach((option) => {
    const label = option.textContent?.trim().toLowerCase() || "";
    const visible = !normalizedSearch || label.includes(normalizedSearch);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  if (emptyState) {
    emptyState.hidden = visibleCount > 0;
  }
}

function applyPhaseRenamesToSplits(splits = [], renameMap = new Map()) {
  if (!(renameMap instanceof Map) || !renameMap.size) {
    return clone(splits);
  }

  return safeArray(splits).map((split) => {
    const next = { ...(split || {}) };
    const nextPhase =
      renameMap.get(String(split?.phase || "")) ||
      renameMap.get(String(split?.phaseId || "")) ||
      renameMap.get(String(split?.act || "")) ||
      "";

    if (nextPhase) {
      if ("phase" in next) next.phase = nextPhase;
      if ("phaseId" in next) next.phaseId = nextPhase;
      if ("act" in next) next.act = nextPhase;
    }

    return next;
  });
}

export function createActsEditor({
  overlayEl = null,
  phaseListEl,
  formEl,
  addBtn = null,
  closeBtn = null,
  saveBtn = null,
  resetBtn = null,
  exportBtn = null,
  importInput = null,
  copyBtn = null,
  getPhases,
  getQuotas,
  getCounterDefs,
  getSplits = null,
  getPreferredPhaseId = null,
  setPhases,
  setQuotas,
  setSplits = null,
  onAfterSave = null
}) {
  if (!phaseListEl || !formEl) {
    throw new Error("createActsEditor: phaseListEl and formEl are required");
  }

  let workingPhases = {};
  let workingQuotas = {};
  let initialPhases = {};
  let initialQuotas = {};
  let selectedPhaseId = "";
  let phaseSearch = "";
  let showUnusedPhases = false;
  const phaseUiState = new Map();
  let phaseRenameMap = new Map();

  function getCounterDefsSafe() {
    return safeObject(getCounterDefs?.());
  }

  function getPhaseUiState(phaseId) {
    const key = String(phaseId || "");

    if (!phaseUiState.has(key)) {
      phaseUiState.set(key, {
        objectivePickerOpen: false,
        quotaPickerOpen: false,
        objectiveSearch: "",
        quotaSearch: ""
      });
    }

    return phaseUiState.get(key);
  }

  function readSource() {
    const counterDefs = getCounterDefsSafe();
    const sourcePhases = safeObject(getPhases?.());
    const sourceQuotas = safeObject(getQuotas?.());

    const phases = {};
    Object.entries(sourcePhases).forEach(([phaseId, phase]) => {
      phases[phaseId] = normalizePhase(phaseId, phase, counterDefs);
    });

    const quotas = {};
    Object.entries(sourceQuotas).forEach(([phaseId, value]) => {
      quotas[phaseId] = normalizeQuotas(value, counterDefs);
    });

    return { phases, quotas };
  }

  function getRouteSplitsPreview() {
    const sourceSplits = typeof getSplits === "function" ? getSplits() : [];
    return applyPhaseRenamesToSplits(sourceSplits, phaseRenameMap);
  }

  function getPhaseUsage() {
    return buildPhaseUsageMap(
      getRouteSplitsPreview(),
      typeof getPreferredPhaseId === "function" ? getPreferredPhaseId() : "",
      workingPhases
    );
  }

  function getPhaseObjectiveResolutions() {
    const routeSplits = getRouteSplitsPreview();
    const counterDefs = getCounterDefsSafe();

    return Object.fromEntries(
      getPhaseIds(workingPhases).map((phaseId) => {
        return [
          phaseId,
          getPhaseObjectiveResolution({
            phaseId,
            phase: workingPhases[phaseId],
            phases: workingPhases,
            quotas: workingQuotas,
            splits: routeSplits,
            counterDefs
          })
        ];
      })
    );
  }

  function getVisiblePhaseIds(phaseUsage = getPhaseUsage()) {
    return getPhaseIds(workingPhases).filter((phaseId) => {
      if (showUnusedPhases) return true;
      return !!phaseUsage?.[phaseId]?.count || !!phaseUsage?.[phaseId]?.isActive;
    });
  }

  function ensureSelectedPhase() {
    const phaseIds = getPhaseIds(workingPhases);
    const phaseUsage = getPhaseUsage();
    const visiblePhaseIds = getVisiblePhaseIds(phaseUsage);
    const preferredPhaseId =
      typeof getPreferredPhaseId === "function"
        ? String(getPreferredPhaseId() || "").trim()
        : "";

    if (!phaseIds.length) {
      selectedPhaseId = "";
      return;
    }

    if (!selectedPhaseId || !workingPhases[selectedPhaseId] || !visiblePhaseIds.includes(selectedPhaseId)) {
      if (
        preferredPhaseId &&
        workingPhases[preferredPhaseId] &&
        visiblePhaseIds.includes(preferredPhaseId)
      ) {
        selectedPhaseId = preferredPhaseId;
        return;
      }

      selectedPhaseId = visiblePhaseIds[0] || phaseIds[0];
    }
  }

  function resolveUniquePhaseId(requestedId, currentId) {
    const baseId = String(requestedId || "").trim() || currentId || "new_phase";

    if (baseId === currentId || !workingPhases[baseId]) {
      return baseId;
    }

    let counter = 2;
    let candidate = `${baseId}_${counter}`;

    while (workingPhases[candidate] && candidate !== currentId) {
      counter += 1;
      candidate = `${baseId}_${counter}`;
    }

    return candidate;
  }

  function recordPhaseRename(previousId, nextId) {
    if (!previousId || !nextId || previousId === nextId) return;

    const nextMap = new Map();

    phaseRenameMap.forEach((value, key) => {
      nextMap.set(key, value === previousId ? nextId : value);
    });

    if (initialPhases[previousId] && !nextMap.has(previousId)) {
      nextMap.set(previousId, nextId);
    }

    Array.from(nextMap.entries()).forEach(([key, value]) => {
      if (key === value) {
        nextMap.delete(key);
      }
    });

    phaseRenameMap = nextMap;
  }

  function movePhaseUiState(previousId, nextId) {
    if (!previousId || !nextId || previousId === nextId) return;
    if (!phaseUiState.has(previousId)) return;

    const state = phaseUiState.get(previousId);
    phaseUiState.delete(previousId);
    phaseUiState.set(nextId, state);
  }

  function render() {
    ensureSelectedPhase();
    const phaseUsage = getPhaseUsage();
    const phaseObjectiveResolutions = getPhaseObjectiveResolutions();

    phaseListEl.innerHTML = buildPhaseListHtml(
      workingPhases,
      workingQuotas,
      selectedPhaseId,
      phaseSearch,
      phaseUsage,
      showUnusedPhases,
      phaseObjectiveResolutions
    );

    const phase = selectedPhaseId ? workingPhases[selectedPhaseId] : null;
    const quotas = selectedPhaseId ? workingQuotas[selectedPhaseId] || {} : {};
    const counterDefs = getCounterDefsSafe();
    const uiState = getPhaseUiState(selectedPhaseId);

    formEl.innerHTML = buildFormHtml(
      selectedPhaseId,
      phase || {},
      quotas,
      counterDefs,
      uiState,
      phaseUsage,
      workingPhases,
      getRouteSplitsPreview(),
      phaseObjectiveResolutions?.[selectedPhaseId] || null
    );
  }

  function syncFromSource() {
    const { phases, quotas } = readSource();

    initialPhases = clone(phases);
    initialQuotas = clone(quotas);
    workingPhases = clone(phases);
    workingQuotas = clone(quotas);
    phaseRenameMap = new Map();
    phaseUiState.clear();
    showUnusedPhases = false;

    ensureSelectedPhase();
    render();
  }

  function collectCurrentFormIntoState() {
    if (!selectedPhaseId || !workingPhases[selectedPhaseId]) return;

    const counterDefs = getCounterDefsSafe();

    const phaseIdInput = formEl.querySelector("#phaseIdInput");
    const phaseLabelInput = formEl.querySelector("#phaseLabelInput");
    const phaseTargetMinutesInput = formEl.querySelector("#phaseTargetMinutesInput");
    const phaseProgressFromInput = formEl.querySelector("#phaseProgressFromInput");
    const phaseDescriptionInput = formEl.querySelector("#phaseDescriptionInput");
    const phaseNoteInput = formEl.querySelector("#phaseNoteInput");
    const phaseObjectiveNoteInput = formEl.querySelector("#phaseObjectiveNoteInput");

    const requestedPhaseId = phaseIdInput?.value?.trim() || selectedPhaseId;
    const nextPhaseId = resolveUniquePhaseId(requestedPhaseId, selectedPhaseId);
    const nextLabel = phaseLabelInput?.value?.trim() || nextPhaseId;
    const nextDescription = phaseDescriptionInput?.value || "";
    const nextNote = phaseNoteInput?.value || "";
    const nextObjectiveNote = phaseObjectiveNoteInput?.value || "";

    const rawTargetMinutes = Number(phaseTargetMinutesInput?.value || 0);
    const nextTargetMinutes =
      Number.isFinite(rawTargetMinutes) && rawTargetMinutes > 0
        ? rawTargetMinutes
        : 0;
    const nextProgressFrom = normalizePhaseProgressFrom(phaseProgressFromInput?.value || "");

    const visibleCounters = [];
    formEl.querySelectorAll("[data-visible-chip]").forEach((chip) => {
      const key = chip.dataset.visibleChip;
      if (!key || !counterDefs[key]) return;
      visibleCounters.push(key);
    });

    const nextQuotas = {};
    formEl.querySelectorAll("[data-quota-input]").forEach((input) => {
      const key = input.dataset.quotaInput;
      const n = Number(input.value || 0);
      if (!key || !counterDefs[key]) return;
      if (!Number.isFinite(n) || n <= 0) return;
      nextQuotas[key] = n;
    });

    const nextPhase = normalizePhase(nextPhaseId, {
      label: nextLabel,
      description: nextDescription,
      note: nextNote,
      objectiveNote: nextObjectiveNote,
      progressFrom: nextProgressFrom,
      visibleCounters,
      targetMinutes: nextTargetMinutes
    }, counterDefs);

    if (nextPhaseId !== selectedPhaseId) {
      const previousId = selectedPhaseId;
      Object.values(workingPhases).forEach((candidatePhase) => {
        if (candidatePhase?.progressFrom === previousId) {
          candidatePhase.progressFrom = nextPhaseId;
        }
      });
      delete workingPhases[previousId];
      delete workingQuotas[previousId];
      movePhaseUiState(previousId, nextPhaseId);
      recordPhaseRename(previousId, nextPhaseId);
      selectedPhaseId = nextPhaseId;
    }

    workingPhases[selectedPhaseId] = nextPhase;
    workingQuotas[selectedPhaseId] = nextQuotas;
  }

  function addPhase() {
    collectCurrentFormIntoState();

    const baseId = "new_phase";
    let nextId = baseId;
    let counter = 1;

    while (workingPhases[nextId]) {
      counter += 1;
      nextId = `${baseId}_${counter}`;
    }

    workingPhases[nextId] = normalizePhase(nextId, {
      label: `New Phase ${counter}`,
      description: "",
      note: "",
      objectiveNote: "",
      visibleCounters: [],
      targetMinutes: 0
    }, getCounterDefsSafe());

    workingQuotas[nextId] = {};
    selectedPhaseId = nextId;
    phaseSearch = "";
    showUnusedPhases = true;
    getPhaseUiState(nextId);
    render();
  }

  function deleteSelectedPhase() {
    if (!selectedPhaseId || !workingPhases[selectedPhaseId]) return;

    delete workingPhases[selectedPhaseId];
    delete workingQuotas[selectedPhaseId];
    phaseUiState.delete(selectedPhaseId);

    const remaining = getPhaseIds(workingPhases);
    selectedPhaseId = remaining[0] || "";
    render();
  }

  function reset() {
    workingPhases = clone(initialPhases);
    workingQuotas = clone(initialQuotas);
    phaseRenameMap = new Map();
    showUnusedPhases = false;
    ensureSelectedPhase();
    render();
  }

  function buildExportPayload() {
    collectCurrentFormIntoState();

    const phases = {};
    Object.entries(workingPhases).forEach(([phaseId, phase]) => {
      phases[phaseId] = {
        label: phase.label,
        description: phase.description,
        note: phase.note,
        objectiveNote: phase.objectiveNote,
        visible: safeArray(phase.visibleCounters),
        targetMinutes: Number(phase.targetMinutes || 0)
      };

      if (phase.progressFrom === NO_PHASE_CHAIN) {
        phases[phaseId].progressFrom = null;
      } else if (phase.progressFrom) {
        phases[phaseId].progressFrom = phase.progressFrom;
      }
    });

    const quotas = {};
    Object.entries(workingQuotas).forEach(([phaseId, targets]) => {
      quotas[phaseId] = {
        label: workingPhases[phaseId]?.label || phaseId,
        targets: clone(targets || {})
      };
    });

    return {
      phases,
      quotas,
      exportedAt: new Date().toISOString()
    };
  }

  function save() {
    collectCurrentFormIntoState();

    const nextPhases = {};
    Object.entries(workingPhases).forEach(([phaseId, phase]) => {
      nextPhases[phaseId] = {
        label: phase.label,
        description: phase.description,
        note: phase.note,
        objectiveNote: phase.objectiveNote,
        visibleCounters: safeArray(phase.visibleCounters),
        objectives: safeArray(phase.visibleCounters),
        targetMinutes: Number(phase.targetMinutes || 0)
      };

      if (phase.progressFrom === NO_PHASE_CHAIN) {
        nextPhases[phaseId].progressFrom = null;
      } else if (phase.progressFrom) {
        nextPhases[phaseId].progressFrom = phase.progressFrom;
      }
    });

    const nextQuotas = {};
    Object.entries(workingQuotas).forEach(([phaseId, targets]) => {
      nextQuotas[phaseId] = clone(targets || {});
    });

    setPhases?.(nextPhases);
    setQuotas?.(nextQuotas);

    if (typeof setSplits === "function" && typeof getSplits === "function" && phaseRenameMap.size) {
      const nextSplits = applyPhaseRenamesToSplits(getSplits(), phaseRenameMap);
      setSplits(nextSplits);
    }

    initialPhases = clone(workingPhases);
    initialQuotas = clone(workingQuotas);
    phaseRenameMap = new Map();

    render();
    onAfterSave?.();
  }

  function exportJson() {
    downloadJson("phases-backup.json", buildExportPayload());
  }

  async function copyJson() {
    const ok = await copyText(JSON.stringify(buildExportPayload(), null, 2));
    if (!ok) {
      console.warn("Could not copy phase backup");
    }
  }

  async function importJson(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const counterDefs = getCounterDefsSafe();

      const parsedPhases =
        parsed && typeof parsed === "object" && parsed.phases && typeof parsed.phases === "object"
          ? parsed.phases
          : {};

      const parsedQuotas =
        parsed && typeof parsed === "object" && parsed.quotas && typeof parsed.quotas === "object"
          ? parsed.quotas
          : {};

      const nextPhases = {};
      Object.entries(parsedPhases).forEach(([phaseId, phase]) => {
        nextPhases[phaseId] = normalizePhase(phaseId, phase, counterDefs);
      });

      const nextQuotas = {};
      Object.entries(parsedQuotas).forEach(([phaseId, value]) => {
        const targets =
          value && typeof value === "object" && value.targets && typeof value.targets === "object"
            ? value.targets
            : value;
        nextQuotas[phaseId] = normalizeQuotas(targets, counterDefs);
      });

      workingPhases = nextPhases;
      workingQuotas = nextQuotas;
      phaseRenameMap = new Map();
      phaseUiState.clear();
      showUnusedPhases = false;
      ensureSelectedPhase();
      render();
    } catch (error) {
      console.error("Failed to import phases JSON", error);
      alert("Could not import phases JSON");
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

  function removeVisibleCounter(counterKey) {
    collectCurrentFormIntoState();
    if (!selectedPhaseId || !workingPhases[selectedPhaseId]) return;

    workingPhases[selectedPhaseId].visibleCounters =
      safeArray(workingPhases[selectedPhaseId].visibleCounters).filter((key) => key !== counterKey);
    render();
  }

  function toggleVisiblePicker() {
    const uiState = getPhaseUiState(selectedPhaseId);
    uiState.objectivePickerOpen = !uiState.objectivePickerOpen;
    if (!uiState.objectivePickerOpen) {
      uiState.objectiveSearch = "";
    }
    render();
  }

  function toggleQuotaPicker() {
    const uiState = getPhaseUiState(selectedPhaseId);
    uiState.quotaPickerOpen = !uiState.quotaPickerOpen;
    if (!uiState.quotaPickerOpen) {
      uiState.quotaSearch = "";
    }
    render();
  }

  function toggleUnusedPhases() {
    collectCurrentFormIntoState();
    showUnusedPhases = !showUnusedPhases;
    render();
  }

  function addVisibleCounter(counterKey) {
    collectCurrentFormIntoState();
    if (!selectedPhaseId || !workingPhases[selectedPhaseId] || !counterKey) return;

    const current = new Set(safeArray(workingPhases[selectedPhaseId].visibleCounters));
    current.add(counterKey);
    workingPhases[selectedPhaseId].visibleCounters = Array.from(current);

    const uiState = getPhaseUiState(selectedPhaseId);
    uiState.objectivePickerOpen = false;
    uiState.objectiveSearch = "";
    render();
  }

  function addQuotaCounter(counterKey) {
    collectCurrentFormIntoState();
    if (!selectedPhaseId || !workingQuotas[selectedPhaseId] || !counterKey) return;

    workingQuotas[selectedPhaseId][counterKey] = Number(workingQuotas[selectedPhaseId][counterKey] || 1);

    const visible = new Set(safeArray(workingPhases[selectedPhaseId].visibleCounters));
    visible.add(counterKey);
    workingPhases[selectedPhaseId].visibleCounters = Array.from(visible);

    const uiState = getPhaseUiState(selectedPhaseId);
    uiState.quotaPickerOpen = false;
    uiState.quotaSearch = "";
    render();
  }

  function adjustQuota(counterKey, delta) {
    collectCurrentFormIntoState();
    if (!selectedPhaseId || !workingQuotas[selectedPhaseId] || !counterKey) return;

    const current = Number(workingQuotas[selectedPhaseId][counterKey] || 0);
    const next = current + Number(delta || 0);

    if (!Number.isFinite(next) || next <= 0) {
      delete workingQuotas[selectedPhaseId][counterKey];
    } else {
      workingQuotas[selectedPhaseId][counterKey] = next;
    }

    render();
  }

  function setQuotaValue(counterKey, rawValue) {
    collectCurrentFormIntoState();
    if (!selectedPhaseId || !workingQuotas[selectedPhaseId] || !counterKey) return;

    const next = Number(rawValue || 0);

    if (!Number.isFinite(next) || next <= 0) {
      delete workingQuotas[selectedPhaseId][counterKey];
    } else {
      workingQuotas[selectedPhaseId][counterKey] = next;
    }

    render();
  }

  addBtn?.addEventListener("click", addPhase);
  closeBtn?.addEventListener("click", close);
  saveBtn?.addEventListener("click", save);
  resetBtn?.addEventListener("click", reset);
  exportBtn?.addEventListener("click", exportJson);
  copyBtn?.addEventListener("click", copyJson);

  importInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await importJson(file);
    }
    event.target.value = "";
  });

  overlayEl?.addEventListener("click", (event) => {
    if (event.target === overlayEl) {
      close();
    }
  });

  phaseListEl.addEventListener("input", (event) => {
    if (event.target.id !== "phaseListSearchInput") return;
    collectCurrentFormIntoState();
    phaseSearch = event.target.value || "";
    render();
  });

  phaseListEl.addEventListener("click", (event) => {
    if (event.target.closest("#toggleUnusedPhasesBtn")) {
      toggleUnusedPhases();
      return;
    }

    const button = event.target.closest("[data-phase-id]");
    if (!button) return;

    collectCurrentFormIntoState();
    selectedPhaseId = button.dataset.phaseId || "";
    render();
  });

  formEl.addEventListener("input", (event) => {
    if (event.target.matches('[data-picker-search="visible"]')) {
      const uiState = getPhaseUiState(selectedPhaseId);
      uiState.objectiveSearch = event.target.value || "";
      const pickerRoot = event.target.closest('[data-picker-root="visible"]');
      if (pickerRoot) {
        filterPicker(pickerRoot, uiState.objectiveSearch);
      }
      return;
    }

    if (event.target.matches('[data-picker-search="quota"]')) {
      const uiState = getPhaseUiState(selectedPhaseId);
      uiState.quotaSearch = event.target.value || "";
      const pickerRoot = event.target.closest('[data-picker-root="quota"]');
      if (pickerRoot) {
        filterPicker(pickerRoot, uiState.quotaSearch);
      }
      return;
    }

    if (event.target.id === "phaseLabelInput") {
      const title = formEl.querySelector(".phaseInspectorName");
      if (title) {
        title.textContent = event.target.value.trim() || selectedPhaseId || "Phase";
      }
      return;
    }

    if (event.target.id === "phaseIdInput") {
      const idEl = formEl.querySelector(".phaseInspectorId");
      if (idEl) {
        idEl.textContent = event.target.value.trim() || selectedPhaseId || "";
      }
    }
  });

  formEl.addEventListener("change", (event) => {
    if (event.target.matches("[data-quota-input]")) {
      setQuotaValue(event.target.dataset.quotaInput, event.target.value);
    }
  });

  formEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-editor-action], .phasePickerOption, #deletePhaseBtn");
    if (!button) return;

    if (button.id === "deletePhaseBtn") {
      collectCurrentFormIntoState();
      deleteSelectedPhase();
      return;
    }

    const action = button.dataset.editorAction || "";
    const counterKey = button.dataset.counterKey || "";

    if (button.classList.contains("phasePickerOption")) {
      const pickerRoot = button.closest("[data-picker-root]");
      const pickerType = pickerRoot?.dataset.pickerRoot || "";

      if (pickerType === "visible") addVisibleCounter(counterKey);
      if (pickerType === "quota") addQuotaCounter(counterKey);
      return;
    }

    if (action === "toggle-visible-picker") {
      collectCurrentFormIntoState();
      toggleVisiblePicker();
    }

    if (action === "toggle-quota-picker") {
      collectCurrentFormIntoState();
      toggleQuotaPicker();
    }

    if (action === "remove-visible") {
      removeVisibleCounter(counterKey);
    }

    if (action === "increment-quota") {
      adjustQuota(counterKey, 1);
    }

    if (action === "decrement-quota") {
      adjustQuota(counterKey, -1);
    }
  });

  syncFromSource();

  return {
    open,
    close,
    save,
    reset,
    addPhase,
    exportJson,
    copyJson
  };
}
