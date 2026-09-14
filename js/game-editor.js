import { loadGamesManifest } from "./data-loader.js";

const DEFAULT_SUBTITLE =
  "Create a new game package with metadata, counters, and starter files.";

const DEFAULT_NOTES =
  "Create package metadata, build counters visually, and generate the scaffold JSON files.";

const GHOST_STARTER_COUNTERS = [
  { key: "trophies", label: "Trophies", icon: "TR", max: 52, act1: 0 },
  { key: "inari", label: "Inari Shrines", icon: "IN", max: 49, act1: 22 },
  { key: "hotsprings", label: "Hot Springs", icon: "HS", max: 18, act1: 9 },
  { key: "bamboo", label: "Bamboo Strikes", icon: "BS", max: 16, act1: 6 },
  { key: "haiku", label: "Haiku", icon: "HK", max: 19, act1: 8 },
  { key: "records", label: "Records", icon: "RC", max: 20, act1: 0 },
  { key: "artifacts", label: "Artifacts", icon: "AR", max: 20, act1: 0 },
  { key: "shrines", label: "Shinto Shrines", icon: "SS", max: 16, act1: 7 },
  { key: "lighthouses", label: "Lighthouses", icon: "LH", max: 8, act1: 3 },
  { key: "crickets", label: "Crickets", icon: "CR", max: 5, act1: 0 },
  { key: "hiddenaltars", label: "Hidden Altars", icon: "HA", max: 10, act1: 0 },
  { key: "duels", label: "Duels", icon: "DU", max: 25, act1: 0 },
  { key: "territories", label: "Mongol Territories", icon: "MT", max: 56, act1: 0 },
  { key: "mythictales", label: "Mythic Tales", icon: "MY", max: 7, act1: 0 },
  { key: "sidetales", label: "Side Tales", icon: "ST", max: 61, act1: 0 },
  { key: "monochrome", label: "Monochrome", icon: "MC", max: 2, act1: 0 },
  { key: "cooper", label: "Cooper", icon: "CP", max: 3, act1: 0 }
];

const DAYS_GONE_STARTER_COUNTERS = [
  { key: "routecollectibles", label: "Mapped Route Items", icon: "RT", max: 201, act1: 0 },
  { key: "encampmentjobs", label: "Encampment Jobs", icon: "JB", max: 34, act1: 0 },
  { key: "nerosites", label: "NERO Sites", icon: "NS", max: 30, act1: 0 },
  { key: "infestations", label: "Infestations", icon: "IF", max: 12, act1: 0 },
  { key: "ambushcamps", label: "Ambush Camps", icon: "AM", max: 15, act1: 0 },
  { key: "hordes", label: "Hordes", icon: "HD", max: 37, act1: 0 },
  { key: "nerointel", label: "NERO Intel", icon: "NI", max: 42, act1: 0 },
  { key: "historical", label: "Historical Markers", icon: "HM", max: 43, act1: 0 },
  { key: "charactercollectibles", label: "Character Collectibles", icon: "CC", max: 33, act1: 0 },
  { key: "tourism", label: "Tourism", icon: "TO", max: 28, act1: 0 },
  { key: "rippersermons", label: "Ripper Sermons", icon: "RP", max: 13, act1: 0 },
  { key: "herbology", label: "Herbology", icon: "HB", max: 33, act1: 0 },
  { key: "ipca", label: "IPCA Tech", icon: "IP", max: 18, act1: 0 },
  { key: "songs", label: "Songs", icon: "SG", max: 6, act1: 0 },
  { key: "cairns", label: "Anarchist Cairns", icon: "CA", max: 12, act1: 0 }
];

const OUTPUT_PLACEHOLDERS = {
  gamesJsonOutput: "// Generate the scaffold to preview the manifest update.",
  metaJsonOutput: "// Generate the scaffold to preview game metadata.",
  countersJsonOutput: "// Add counters to preview counters.json here.",
  phasesJsonOutput: "// Generate the scaffold to preview fallback phases.",
  quotasJsonOutput: "// Generate the scaffold to preview fallback quotas.",
  splitsJsonOutput: "// Generate the scaffold to preview default splits."
};

let workingCounters = [];
let initialCounters = [];
let currentPackage = null;
let existingManifest = {
  defaultGameId: "",
  games: []
};

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

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCounterKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function numberOrZero(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = value;
}

function getButton(id) {
  return document.getElementById(id);
}

function getInput(id) {
  return document.getElementById(id);
}

function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn("Copy failed", error);
    return false;
  }
}

function normalizeCounterRow(row = {}, index = 0) {
  const key = normalizeCounterKey(row.key || `counter${index + 1}`);
  const max = numberOrZero(row.max);
  const act1 = Math.min(max, numberOrZero(row.act1));

  return {
    key,
    label: String(row.label || key || `Counter ${index + 1}`).trim(),
    icon: String(row.icon || "").trim(),
    max,
    act1
  };
}

function getFormValues() {
  const rawGameId = getInput("gameIdInput")?.value || "";
  const gameId = normalizeId(rawGameId);
  const title = String(getInput("gameTitleInput")?.value || "").trim();
  const subtitle = String(getInput("gameSubtitleInput")?.value || "").trim();
  const difficulty = String(getInput("gameDifficultyInput")?.value || "").trim();
  const defaultPhaseId = normalizeId(getInput("defaultPhaseIdInput")?.value || "legacy_all");
  const defaultPhaseLabel =
    String(getInput("defaultPhaseLabelInput")?.value || "").trim() || "Legacy All";

  return {
    gameId,
    title,
    subtitle,
    difficulty,
    defaultPhaseId,
    defaultPhaseLabel
  };
}

function getGridEl() {
  return document.getElementById("counterBuilderGrid");
}

function getManifestStatus(gameId) {
  const games = safeArray(existingManifest?.games);
  const existingGame = games.find((game) => game?.id === gameId);

  if (!gameId) {
    return {
      text: "Enter a game ID",
      notes: DEFAULT_NOTES,
      summary: DEFAULT_SUBTITLE
    };
  }

  if (existingGame) {
    return {
      text: `Updates existing entry: ${existingGame.title || gameId}`,
      notes: `Editing a scaffold for ${existingGame.title || gameId}. Generating will replace that manifest entry in the preview.`,
      summary: `Update the ${existingGame.title || gameId} package with cleaner counters and scaffold files.`
    };
  }

  return {
    text: `Adds new entry: ${gameId}`,
    notes: `Generating will add a new ${gameId} entry to the manifest preview.`,
    summary: `Create a new selectable game package for ${gameId}.`
  };
}

function buildCounterMeta(row) {
  const keyText = row.key || "missing-key";
  const actText = row.act1 > 0 ? ` - Act 1 ${row.act1}` : "";
  return `${keyText} - Max ${row.max}${actText}`;
}

function buildCounterRowHtml(row, index) {
  const item = normalizeCounterRow(row, index);
  const rowTitle = item.label || item.key || `Counter ${index + 1}`;

  return `
    <div class="editorCard" data-counter-row="${index}">
      <div class="row between" style="margin-bottom:12px;gap:8px;align-items:flex-start">
        <div>
          <div class="eyebrow">Counter ${index + 1}</div>
          <div class="mid">${escapeHtml(rowTitle)}</div>
          <div class="subtitle" data-counter-meta style="margin-top:6px">${escapeHtml(buildCounterMeta(item))}</div>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" data-row-action="move-up">Up</button>
          <button type="button" class="btn" data-row-action="move-down">Down</button>
          <button type="button" class="btn danger" data-row-action="delete">Delete</button>
        </div>
      </div>

      <div class="fields">
        <label class="field">
          <span>Key</span>
          <input type="text" data-field="key" value="${escapeHtml(item.key)}" placeholder="trophies" />
        </label>

        <label class="field">
          <span>Label</span>
          <input type="text" data-field="label" value="${escapeHtml(item.label)}" placeholder="Trophies" />
        </label>
      </div>

      <div class="fields">
        <label class="field">
          <span>Icon</span>
          <input type="text" data-field="icon" value="${escapeHtml(item.icon)}" placeholder="TR" />
        </label>

        <label class="field">
          <span>Max</span>
          <input type="number" min="0" step="1" data-field="max" value="${item.max}" />
        </label>

        <label class="field">
          <span>Act 1</span>
          <input type="number" min="0" step="1" data-field="act1" value="${item.act1}" />
        </label>
      </div>
    </div>
  `;
}

function refreshCounterHeaderTitles() {
  const gridEl = getGridEl();
  if (!gridEl) return;

  gridEl.querySelectorAll("[data-counter-row]").forEach((row, index) => {
    row.dataset.counterRow = String(index);

    const labelInput = row.querySelector('[data-field="label"]');
    const keyInput = row.querySelector('[data-field="key"]');
    const maxInput = row.querySelector('[data-field="max"]');
    const act1Input = row.querySelector('[data-field="act1"]');
    const eyebrow = row.querySelector(".eyebrow");
    const title = row.querySelector(".mid");
    const meta = row.querySelector("[data-counter-meta]");

    const normalizedRow = normalizeCounterRow(
      {
        key: keyInput?.value || "",
        label: labelInput?.value || "",
        max: maxInput?.value || 0,
        act1: act1Input?.value || 0
      },
      index
    );

    if (eyebrow) eyebrow.textContent = `Counter ${index + 1}`;
    if (title) {
      title.textContent =
        normalizedRow.label || normalizedRow.key || `Counter ${index + 1}`;
    }
    if (meta) {
      meta.textContent = buildCounterMeta(normalizedRow);
    }
  });
}

function collectCountersFromDom() {
  const gridEl = getGridEl();
  if (!gridEl) return clone(workingCounters);

  const rows = Array.from(gridEl.querySelectorAll("[data-counter-row]"));
  if (!rows.length) {
    return clone(workingCounters);
  }

  workingCounters = rows.map((row, index) =>
    normalizeCounterRow(
      {
        key: row.querySelector('[data-field="key"]')?.value || "",
        label: row.querySelector('[data-field="label"]')?.value || "",
        icon: row.querySelector('[data-field="icon"]')?.value || "",
        max: row.querySelector('[data-field="max"]')?.value || 0,
        act1: row.querySelector('[data-field="act1"]')?.value || 0
      },
      index
    )
  );

  return clone(workingCounters);
}

function buildCountersJson(rows) {
  const result = {};

  safeArray(rows).forEach((row, index) => {
    const item = normalizeCounterRow(row, index);
    if (!item.key) return;

    result[item.key] = {
      label: item.label || item.key,
      icon: item.icon || "",
      max: item.max,
      act1: item.act1
    };
  });

  return result;
}

function buildGamesJsonEntry(gameId, title) {
  return {
    id: gameId,
    title,
    path: `./data/${gameId}`
  };
}

function buildGamesJsonManifest(gameId, title) {
  const entry = buildGamesJsonEntry(gameId, title);
  const games = safeArray(existingManifest?.games);
  const nextGames = [];
  let replaced = false;

  games.forEach((game) => {
    if (game?.id === gameId) {
      nextGames.push(entry);
      replaced = true;
      return;
    }

    nextGames.push(game);
  });

  if (!replaced) {
    nextGames.push(entry);
  }

  return {
    defaultGameId: existingManifest?.defaultGameId || nextGames[0]?.id || gameId,
    games: nextGames
  };
}

function buildMetaJson(title, subtitle, difficulty) {
  const values = getFormValues();

  return {
    id: values.gameId,
    title: title || "Untitled Game",
    overlayTitle: title || "Untitled Game",
    subtitle: subtitle || "Speedrun Controller",
    defaultDifficulty: difficulty || "Route",
    appendDifficultyToTitle: false,
    overallCounterKeys: []
  };
}

function buildPhasesJson(defaultPhaseId, defaultPhaseLabel, counterKeys) {
  return {
    [defaultPhaseId]: {
      label: defaultPhaseLabel,
      note: "Fallback phase generated by game editor.",
      targetMinutes: 0,
      visible: counterKeys
    }
  };
}

function buildQuotasJson(defaultPhaseId, defaultPhaseLabel) {
  return {
    quotas: {
      [defaultPhaseId]: {
        label: defaultPhaseLabel,
        targets: {}
      }
    }
  };
}

function buildDefaultSplitsJson(defaultPhaseId) {
  return {
    splits: [
      {
        id: "start",
        label: "Start",
        phase: defaultPhaseId,
        note: "Generated starting split.",
        auto: {}
      }
    ]
  };
}

function buildPackage(metaValues, rows) {
  const countersJson = buildCountersJson(rows);
  const counterKeys = Object.keys(countersJson);
  const metaJson = buildMetaJson(metaValues.title, metaValues.subtitle, metaValues.difficulty);
  metaJson.overallCounterKeys = counterKeys;

  return {
    gamesJson: buildGamesJsonManifest(metaValues.gameId, metaValues.title),
    gameEntry: buildGamesJsonEntry(metaValues.gameId, metaValues.title),
    metaJson,
    countersJson,
    phasesJson: buildPhasesJson(metaValues.defaultPhaseId, metaValues.defaultPhaseLabel, counterKeys),
    quotasJson: buildQuotasJson(metaValues.defaultPhaseId, metaValues.defaultPhaseLabel),
    defaultSplitsJson: buildDefaultSplitsJson(metaValues.defaultPhaseId)
  };
}

function buildPackageText(pkg, gameId) {
  return [
    "// games.json",
    prettyJson(pkg.gamesJson),
    "",
    `// data/${gameId}/meta.json`,
    prettyJson(pkg.metaJson),
    "",
    `// data/${gameId}/counters.json`,
    prettyJson(pkg.countersJson),
    "",
    `// data/${gameId}/phases.json`,
    prettyJson(pkg.phasesJson),
    "",
    `// data/${gameId}/quotas.json`,
    prettyJson(pkg.quotasJson),
    "",
    `// data/${gameId}/default-splits.json`,
    prettyJson(pkg.defaultSplitsJson)
  ].join("\n");
}

function buildZiplessBundle(pkg, gameId) {
  return {
    "games.json": pkg.gamesJson,
    [`data/${gameId}/meta.json`]: pkg.metaJson,
    [`data/${gameId}/counters.json`]: pkg.countersJson,
    [`data/${gameId}/phases.json`]: pkg.phasesJson,
    [`data/${gameId}/quotas.json`]: pkg.quotasJson,
    [`data/${gameId}/default-splits.json`]: pkg.defaultSplitsJson
  };
}

function renderOutputPlaceholders() {
  Object.entries(OUTPUT_PLACEHOLDERS).forEach(([id, value]) => setText(id, value));
}

function renderLiveCountersPreview() {
  const rows = collectCountersFromDom();
  setText("countersJsonOutput", prettyJson(buildCountersJson(rows)));
}

function renderGeneratedOutputs(pkg) {
  if (!pkg) {
    renderOutputPlaceholders();
    renderLiveCountersPreview();
    return;
  }

  setText("gamesJsonOutput", prettyJson(pkg.gamesJson));
  setText("metaJsonOutput", prettyJson(pkg.metaJson));
  setText("countersJsonOutput", prettyJson(pkg.countersJson));
  setText("phasesJsonOutput", prettyJson(pkg.phasesJson));
  setText("quotasJsonOutput", prettyJson(pkg.quotasJson));
  setText("splitsJsonOutput", prettyJson(pkg.defaultSplitsJson));
}

function updateActionStates() {
  const hasPackage = Boolean(currentPackage);
  getButton("copyGamesBtn")?.toggleAttribute("disabled", !hasPackage);
  getButton("copyPackageBtn")?.toggleAttribute("disabled", !hasPackage);
  getButton("downloadPackageBtn")?.toggleAttribute("disabled", !hasPackage);
  getButton("resetCountersBtn")?.toggleAttribute("disabled", !workingCounters.length && !initialCounters.length);
}

function renderEditorSummary() {
  const rows = collectCountersFromDom();
  const counterCount = rows.length;
  const totalTracked = rows.reduce((sum, row) => sum + Number(row?.max || 0), 0);
  const values = getFormValues();
  const manifestStatus = getManifestStatus(values.gameId);
  const counterCountPill = document.getElementById("gameCounterCountPill");
  const totalTrackedPill = document.getElementById("gameTotalTrackedPill");
  const scaffoldStatusPill = document.getElementById("gameScaffoldStatusPill");
  const manifestStatusPill = document.getElementById("gameManifestStatusPill");
  const preview = document.getElementById("gameCounterPreview");
  const subtitle = document.getElementById("pageSubtitle");
  const notes = document.getElementById("gameEditorNotesText");

  if (counterCountPill) {
    counterCountPill.textContent = `${counterCount} counter${counterCount === 1 ? "" : "s"}`;
  }

  if (totalTrackedPill) {
    totalTrackedPill.textContent = `${totalTracked} total tracked`;
  }

  if (scaffoldStatusPill) {
    scaffoldStatusPill.textContent = currentPackage ? "Scaffold generated" : "Scaffold needs refresh";
  }

  if (manifestStatusPill) {
    manifestStatusPill.textContent = manifestStatus.text;
  }

  if (subtitle) {
    subtitle.textContent = manifestStatus.summary || DEFAULT_SUBTITLE;
  }

  if (notes) {
    if (!counterCount) {
      notes.textContent = manifestStatus.notes || DEFAULT_NOTES;
    } else if (currentPackage) {
      notes.textContent = `Scaffold ready for ${values.gameId || "this game"} with ${counterCount} counters and ${totalTracked} tracked total.`;
    } else {
      notes.textContent = `${counterCount} counters in progress. Generate the scaffold to refresh the output files.`;
    }
  }

  if (preview) {
    preview.innerHTML = rows.length
      ? rows
          .slice(0, 10)
          .map((row) => {
            const icon = row?.icon || row?.label?.slice(0, 2).toUpperCase() || "CT";
            return `
              <span class="gameCounterPreviewChip">
                <span class="gameCounterPreviewIcon">${escapeHtml(icon)}</span>
                <span>${escapeHtml(row.label || row.key || "Counter")}</span>
                <span class="subtitle">${Number(row.max || 0)}</span>
              </span>
            `;
          })
          .join("")
      : `<span class="subtitle">No counters yet. Load a preset or add your first counter.</span>`;
  }

  updateActionStates();
}

function renderCounterBuilder() {
  const gridEl = getGridEl();
  if (!gridEl) return;

  if (!workingCounters.length) {
    gridEl.innerHTML = `
      <div class="editorCard">
        <div class="mid">No counters yet.</div>
        <div class="subtitle" style="margin-top:8px">Load a preset or add a counter to start the scaffold.</div>
      </div>
    `;
    renderGeneratedOutputs(currentPackage);
    renderEditorSummary();
    return;
  }

  gridEl.innerHTML = workingCounters
    .map((row, index) => buildCounterRowHtml(row, index))
    .join("");

  refreshCounterHeaderTitles();
  renderGeneratedOutputs(currentPackage);
  renderEditorSummary();
}

function validateInput(values, rows) {
  if (!values.gameId) {
    throw new Error("Game ID is required.");
  }

  if (!values.title) {
    throw new Error("Game title is required.");
  }

  if (!values.defaultPhaseId) {
    throw new Error("Default phase ID is required.");
  }

  if (!safeArray(rows).length) {
    throw new Error("Add at least one counter.");
  }

  const keys = rows
    .map((row, index) => normalizeCounterRow(row, index).key)
    .filter(Boolean);
  const unique = new Set(keys);

  if (keys.length !== unique.size) {
    throw new Error("Counter keys must be unique.");
  }
}

function invalidateGeneratedPackage(renderSummary = true) {
  currentPackage = null;
  renderGeneratedOutputs(null);
  if (renderSummary) {
    renderEditorSummary();
  } else {
    updateActionStates();
  }
}

function generate() {
  try {
    const values = getFormValues();
    const rows = collectCountersFromDom();

    validateInput(values, rows);
    currentPackage = buildPackage(values, rows);

    renderGeneratedOutputs(currentPackage);
    renderEditorSummary();
  } catch (error) {
    invalidateGeneratedPackage();
    alert(error.message || "Failed to generate scaffold.");
  }
}

function addCounter() {
  collectCountersFromDom();

  const nextIndex = workingCounters.length;
  workingCounters.push(
    normalizeCounterRow(
      {
        key: `counter${nextIndex + 1}`,
        label: `Counter ${nextIndex + 1}`,
        icon: "",
        max: 0,
        act1: 0
      },
      nextIndex
    )
  );

  invalidateGeneratedPackage(false);
  renderCounterBuilder();
}

function resetCounters() {
  workingCounters = clone(initialCounters);
  invalidateGeneratedPackage(false);
  renderCounterBuilder();
}

function moveCounterRow(index, direction) {
  collectCountersFromDom();

  const target = index + direction;
  if (target < 0 || target >= workingCounters.length) return;

  const next = [...workingCounters];
  const temp = next[index];
  next[index] = next[target];
  next[target] = temp;

  workingCounters = next.map((row, rowIndex) => normalizeCounterRow(row, rowIndex));
  invalidateGeneratedPackage(false);
  renderCounterBuilder();
}

function deleteCounterRow(index) {
  collectCountersFromDom();

  workingCounters = workingCounters
    .filter((_, rowIndex) => rowIndex !== index)
    .map((row, rowIndex) => normalizeCounterRow(row, rowIndex));

  invalidateGeneratedPackage(false);
  renderCounterBuilder();
}

function seedForm(values) {
  if (getInput("gameIdInput")) getInput("gameIdInput").value = values.gameId || "";
  if (getInput("gameTitleInput")) getInput("gameTitleInput").value = values.title || "";
  if (getInput("gameSubtitleInput")) getInput("gameSubtitleInput").value = values.subtitle || "";
  if (getInput("gameDifficultyInput")) getInput("gameDifficultyInput").value = values.difficulty || "";
  if (getInput("defaultPhaseIdInput")) {
    getInput("defaultPhaseIdInput").value = values.defaultPhaseId || "";
  }
  if (getInput("defaultPhaseLabelInput")) {
    getInput("defaultPhaseLabelInput").value = values.defaultPhaseLabel || "";
  }
}

function loadExample() {
  seedForm({
    gameId: "ghost-of-tsushima",
    title: "Ghost of Tsushima",
    subtitle: "Speedrun Controller",
    difficulty: "Lethal",
    defaultPhaseId: "legacy_all",
    defaultPhaseLabel: "Legacy All"
  });

  workingCounters = GHOST_STARTER_COUNTERS.map((row, index) => normalizeCounterRow(row, index));
  initialCounters = clone(workingCounters);
  invalidateGeneratedPackage(false);
  renderCounterBuilder();
  generate();
}

function loadDaysGoneStarter() {
  seedForm({
    gameId: "days-gone",
    title: "Days Gone",
    subtitle: "Starter route scaffold from local notes",
    difficulty: "Route",
    defaultPhaseId: "legacy_all",
    defaultPhaseLabel: "Legacy All"
  });

  workingCounters = DAYS_GONE_STARTER_COUNTERS.map((row, index) => normalizeCounterRow(row, index));
  initialCounters = clone(workingCounters);
  invalidateGeneratedPackage(false);
  renderCounterBuilder();
  generate();
}

function syncNormalizedFormFields(target) {
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === "gameIdInput" || target.id === "defaultPhaseIdInput") {
    target.value = normalizeId(target.value);
  }
}

function setupEvents() {
  const addCounterBtn = getButton("addCounterBtn");
  const resetCountersBtn = getButton("resetCountersBtn");
  const loadExampleBtn = getButton("loadExampleBtn");
  const loadDaysGoneBtn = getButton("loadDaysGoneBtn");
  const generateBtn = getButton("generateBtn");
  const copyGamesBtn = getButton("copyGamesBtn");
  const copyPackageBtn = getButton("copyPackageBtn");
  const downloadPackageBtn = getButton("downloadPackageBtn");
  const gridEl = getGridEl();

  addCounterBtn?.addEventListener("click", addCounter);
  resetCountersBtn?.addEventListener("click", resetCounters);
  loadExampleBtn?.addEventListener("click", loadExample);
  loadDaysGoneBtn?.addEventListener("click", loadDaysGoneStarter);
  generateBtn?.addEventListener("click", generate);

  copyGamesBtn?.addEventListener("click", async () => {
    if (!currentPackage) return;
    await copyText(prettyJson(currentPackage.gamesJson));
  });

  copyPackageBtn?.addEventListener("click", async () => {
    if (!currentPackage) return;
    const values = getFormValues();
    await copyText(buildPackageText(currentPackage, values.gameId));
  });

  downloadPackageBtn?.addEventListener("click", () => {
    if (!currentPackage) return;
    const values = getFormValues();
    const bundle = buildZiplessBundle(currentPackage, values.gameId);
    downloadText(`${values.gameId}-package.json`, prettyJson(bundle));
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    syncNormalizedFormFields(target);

    if (target.closest("[data-counter-row]")) {
      if (target.dataset.field === "key") {
        target.value = normalizeCounterKey(target.value);
      }
      refreshCounterHeaderTitles();
    }

    invalidateGeneratedPackage();
  });

  gridEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-row-action]");
    if (!button) return;

    const row = button.closest("[data-counter-row]");
    if (!row) return;

    const index = Number(row.dataset.counterRow || 0);
    const action = button.dataset.rowAction;

    if (action === "move-up") moveCounterRow(index, -1);
    if (action === "move-down") moveCounterRow(index, 1);
    if (action === "delete") deleteCounterRow(index);
  });
}

async function boot() {
  workingCounters = [];
  initialCounters = [];
  currentPackage = null;

  try {
    existingManifest = await loadGamesManifest();
  } catch (error) {
    console.warn("Failed to load games manifest", error);
  }

  setupEvents();
  renderGeneratedOutputs(null);
  renderCounterBuilder();

  requestAnimationFrame(() => {
    renderEditorSummary();
  });
}

window.addEventListener("pageshow", () => {
  renderEditorSummary();
});

boot();
