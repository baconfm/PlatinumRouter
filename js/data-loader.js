// js/data-loader.js

const BASE_PATH = "./data";
let manifestPromise = null;

function normalizeId(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "";
}

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });

    if (!response.ok) {
      console.warn(`Failed to load ${path}: ${response.status}`);
      return clone(fallback);
    }

    return await response.json();
  } catch (error) {
    console.warn(`Failed to fetch ${path}`, error);
    return clone(fallback);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRoute(route = {}, index = 0) {
  const rawData = route?.data && typeof route.data === "object" ? route.data : {};
  const rawDefaultTimerElapsedMs = Number(route?.defaultTimerElapsedMs);

  return {
    id: normalizeId(route?.id) || `route_${index}`,
    title: route?.title || route?.label || route?.id || `Route ${index + 1}`,
    shortTitle:
      route?.shortTitle ||
      route?.badgeLabel ||
      route?.title ||
      route?.label ||
      route?.id ||
      `Route ${index + 1}`,
    badgeLabel:
      route?.badgeLabel ||
      route?.shortTitle ||
      route?.title ||
      route?.label ||
      route?.id ||
      `Route ${index + 1}`,
    overlayTitle: route?.overlayTitle || "",
    subtitle: route?.subtitle || "",
    difficulty: route?.difficulty || route?.defaultDifficulty || "",
    defaultDifficulty: route?.defaultDifficulty || route?.difficulty || "",
    appendDifficultyToTitle: route?.appendDifficultyToTitle,
    supportsDirge: route?.supportsDirge,
    collectibleTotal: route?.collectibleTotal,
    collectibleCounterKeys: Array.isArray(route?.collectibleCounterKeys)
      ? route.collectibleCounterKeys.filter((key) => typeof key === "string" && key.trim())
      : undefined,
    splitAutoCounterKeys: Array.isArray(route?.splitAutoCounterKeys)
      ? route.splitAutoCounterKeys.filter((key) => typeof key === "string" && key.trim())
      : undefined,
    collectibleLabel: route?.collectibleLabel,
    collectibleShortLabel: route?.collectibleShortLabel,
    collectibleDescription: route?.collectibleDescription,
    defaultTimerElapsedMs: Number.isFinite(rawDefaultTimerElapsedMs) && rawDefaultTimerElapsedMs > 0
      ? rawDefaultTimerElapsedMs
      : undefined,
    hiddenCounters:
      route?.hiddenCounters && typeof route.hiddenCounters === "object"
        ? clone(route.hiddenCounters)
        : undefined,
    overallCounterKeys: Array.isArray(route?.overallCounterKeys)
      ? route.overallCounterKeys.filter((key) => typeof key === "string" && key.trim())
      : undefined,
    data: {
      counters: rawData?.counters || "",
      defaultSplits: rawData?.defaultSplits || "",
      phases: rawData?.phases || "",
      quotas: rawData?.quotas || "",
      completionTitles: rawData?.completionTitles || "",
      neroIpcaClusters: rawData?.neroIpcaClusters || "",
      paceBenchmark: rawData?.paceBenchmark || ""
    }
  };
}

function normalizeMeta(meta = {}) {
  const rawDefaultTimerElapsedMs = Number(meta?.defaultTimerElapsedMs);
  const rawPaceTargetMs = Number(meta?.paceTargetMs);
  const rawHiddenCounters =
    meta?.hiddenCounters && typeof meta.hiddenCounters === "object"
      ? meta.hiddenCounters
      : {};

  const hiddenCounters = {};

  Object.entries(rawHiddenCounters).forEach(([surface, keys]) => {
    hiddenCounters[surface] = Array.isArray(keys)
      ? keys.filter((key) => typeof key === "string" && key.trim())
      : [];
  });

  const routes = Array.isArray(meta?.routes)
    ? meta.routes.map((route, index) => normalizeRoute(route, index))
    : [];

  const defaultRouteId =
    normalizeId(meta?.defaultRouteId) ||
    normalizeId(routes[0]?.id) ||
    "";

  return {
    id: meta.id || "",
    title: meta.title || "Untitled Game",
    overlayTitle: meta.overlayTitle || meta.title || "Run Controller",
    subtitle: meta.subtitle || "Speedrun Controller",
    difficulty: meta.difficulty || meta.defaultDifficulty || "",
    defaultDifficulty: meta.defaultDifficulty || meta.difficulty || "",
    appendDifficultyToTitle: meta.appendDifficultyToTitle ?? true,
    supportsDirge: !!meta.supportsDirge,
    collectibleTotal: Number(meta.collectibleTotal || 0),
    collectibleCounterKeys: Array.isArray(meta.collectibleCounterKeys)
      ? meta.collectibleCounterKeys.filter((key) => typeof key === "string" && key.trim())
      : [],
    splitAutoCounterKeys: Array.isArray(meta.splitAutoCounterKeys)
      ? meta.splitAutoCounterKeys.filter((key) => typeof key === "string" && key.trim())
      : [],
    completionTitleRules: Array.isArray(meta.completionTitleRules)
      ? meta.completionTitleRules
          .map((rule) => ({
            title: String(rule?.title || "").trim(),
            counterKey: String(rule?.counterKey || "").trim(),
            label: String(rule?.label || "").trim()
          }))
          .filter((rule) => rule.title && rule.counterKey)
      : [],
    collectibleLabel: meta.collectibleLabel || "Collectibles",
    collectibleShortLabel: meta.collectibleShortLabel || "",
    collectibleDescription:
      meta.collectibleDescription ||
      "Combined progress across the collectible categories tracked for this route.",
    defaultTimerElapsedMs:
      Number.isFinite(rawDefaultTimerElapsedMs) && rawDefaultTimerElapsedMs > 0
        ? rawDefaultTimerElapsedMs
        : 0,
    paceTargetMs:
      Number.isFinite(rawPaceTargetMs) && rawPaceTargetMs > 0
        ? rawPaceTargetMs
        : 0,
    paceTargetLabel: meta.paceTargetLabel || "",
    hiddenCounters,
    overallCounterKeys: Array.isArray(meta.overallCounterKeys)
      ? meta.overallCounterKeys.filter((key) => typeof key === "string" && key.trim())
      : [],
    defaultRouteId,
    routes,
    activeRouteId: normalizeId(meta?.activeRouteId),
    activeRouteTitle: meta?.activeRouteTitle || "",
    activeRouteShortTitle: meta?.activeRouteShortTitle || "",
    activeRouteBadge: meta?.activeRouteBadge || ""
  };
}

function normalizeCounters(counters = {}) {
  const result = {};

  Object.entries(counters || {}).forEach(([key, def]) => {
    result[key] = {
      label: def?.label || key,
      shortLabel: def?.shortLabel || def?.queueLabel || def?.label || key,
      queueLabel: def?.queueLabel || def?.shortLabel || def?.label || key,
      overlayLabel: def?.overlayLabel || "",
      icon: def?.icon || "",
      accent: def?.accent || "",
      description: def?.description || "",
      requirement: def?.requirement || def?.description || "",
      max: Number(def?.max || 0),
      displayMode: def?.displayMode || "",
      nonProgress: !!def?.nonProgress,
      paceWeight: Number.isFinite(Number(def?.paceWeight)) ? Number(def.paceWeight) : 0
    };
  });

  return result;
}

function normalizeAuto(auto = {}) {
  const result = {};

  Object.entries(auto || {}).forEach(([key, value]) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return;
    result[key] = n;
  });

  return result;
}

function normalizeOcrGoals(goals = []) {
  if (!Array.isArray(goals)) return [];

  return goals
    .map((goal) => {
      if (typeof goal === "string") {
        return { id: goal.trim(), type: "" };
      }

      if (!goal || typeof goal !== "object") return null;

      return {
        id: String(goal.id || "").trim(),
        type: String(goal.type || "").trim(),
        label: String(goal.label || "").trim(),
        counterKey: String(goal.counterKey || "").trim(),
        optional: !!goal.optional,
        phrases: Array.isArray(goal.phrases)
          ? goal.phrases.map((phrase) => String(phrase || "").trim()).filter(Boolean)
          : [],
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

function normalizeDefaultSplitsFile(raw) {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.splits)
      ? raw.splits
      : [];

  return source.map((split, index) => ({
    id: split?.id || `split_${index}`,
    label: split?.label || `Split ${index + 1}`,
    phase: split?.phase || split?.phaseId || split?.act || null,
    note: split?.note || "",
    auto: normalizeAuto(split?.auto || {}),
    ocrGoals: normalizeOcrGoals(split?.ocrGoals || []),
    ...(normalizeOcrCompletion(split?.ocrCompletion)
      ? { ocrCompletion: normalizeOcrCompletion(split.ocrCompletion) }
      : {}),
    paceTargetMs: Number.isFinite(Number(split?.paceTargetMs))
      ? Math.max(0, Number(split.paceTargetMs))
      : undefined,
    pbCumulativeMs: Number.isFinite(Number(split?.pbCumulativeMs))
      ? Math.max(0, Number(split.pbCumulativeMs))
      : undefined,
    paceBaseWeight: Number.isFinite(Number(split?.paceBaseWeight))
      ? Math.max(0, Number(split.paceBaseWeight))
      : undefined
  }));
}

function normalizePhasesFile(raw) {
  const source =
    raw && typeof raw === "object" && raw.phases && typeof raw.phases === "object"
      ? raw.phases
      : raw && typeof raw === "object"
        ? raw
        : {};

  const result = {};

  Object.entries(source).forEach(([phaseId, def]) => {
    const rawTargetMinutes =
      def?.targetMinutes ??
      def?.paceTargetMinutes ??
      def?.actTargetMinutes ??
      0;

    const targetMinutes = Number(rawTargetMinutes);

    result[phaseId] = {
      id: phaseId,
      label: def?.label || phaseId,
      description: def?.description || "",
      note: def?.note || "",
      objectiveNote: def?.objectiveNote || def?.currentNote || def?.note || "",
      progressFrom:
        def?.progressFrom === null
          ? null
          : typeof def?.progressFrom === "string"
            ? def.progressFrom
            : "",
      visibleCounters: Array.isArray(def?.visibleCounters)
        ? def.visibleCounters
        : Array.isArray(def?.visible)
          ? def.visible
          : Array.isArray(def?.objectives)
            ? def.objectives
            : [],
      objectives: Array.isArray(def?.objectives)
        ? def.objectives
        : Array.isArray(def?.visible)
          ? def.visible
          : [],
      targetMinutes: Number.isFinite(targetMinutes) && targetMinutes > 0 ? targetMinutes : 0
    };
  });

  return result;
}

function normalizeQuotasFile(raw) {
  const source =
    raw && typeof raw === "object" && raw.quotas && typeof raw.quotas === "object"
      ? raw.quotas
      : raw && typeof raw === "object"
        ? raw
        : {};

  const result = {};

  Object.entries(source).forEach(([phaseId, value]) => {
    const targets =
      value && typeof value === "object" && value.targets && typeof value.targets === "object"
        ? value.targets
        : value && typeof value === "object"
          ? value
          : {};

    const normalized = {};

    Object.entries(targets).forEach(([key, rawValue]) => {
      const n = Number(rawValue);
      if (!Number.isFinite(n) || n <= 0) return;
      normalized[key] = n;
    });

    result[phaseId] = normalized;
  });

  return result;
}

function normalizeCompletionTitlesFile(raw) {
  const source = raw?.categories && typeof raw.categories === "object"
    ? raw.categories
    : {};
  const result = {};

  Object.entries(source).forEach(([counterKey, category]) => {
    const titles = Array.isArray(category?.titles) ? category.titles : [];
    result[counterKey] = {
      label: String(category?.label || counterKey),
      titles: titles
        .map((entry) => ({
          title: String(entry?.title || "").trim(),
          aliases: Array.isArray(entry?.aliases)
            ? entry.aliases.map((alias) => String(alias || "").trim()).filter(Boolean)
            : [],
          region: String(entry?.region || "").trim(),
          camp: String(entry?.camp || "").trim(),
          countsTowardCounter: entry?.countsTowardCounter !== false
        }))
        .filter((entry) => entry.title)
    };
  });

  return result;
}

function normalizeNeroIpcaClustersFile(raw) {
  const clusters = Array.isArray(raw?.clusters) ? raw.clusters : [];
  return clusters
    .map((cluster) => ({
      ipcaIndex: Number(cluster?.ipcaIndex || 0),
      region: String(cluster?.region || "").trim(),
      siteType: String(cluster?.siteType || "").trim(),
      siteName: String(cluster?.siteName || "").trim(),
      bodyHint: String(cluster?.bodyHint || "").trim(),
      neroIntel: (Array.isArray(cluster?.neroIntel) ? cluster.neroIntel : [])
        .map((entry) => ({
          id: String(entry?.id || "").trim(),
          title: String(entry?.title || "").trim(),
          proximity: String(entry?.proximity || "").trim()
        }))
        .filter((entry) => entry.id || entry.title)
    }))
    .filter((cluster) => cluster.ipcaIndex > 0 && cluster.siteName);
}

function normalizePaceBenchmarkFile(raw) {
  if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.finishMs))) {
    return null;
  }

  const counters = {};
  Object.entries(raw.counters || {}).forEach(([counterKey, entry]) => {
    const max = Math.max(0, Number(entry?.max || 0));
    const weight = Math.max(0, Number(entry?.weight || 0));
    const timestampsMs = (Array.isArray(entry?.timestampsMs) ? entry.timestampsMs : [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    if (!max || !weight || !timestampsMs.length) return;

    counters[counterKey] = {
      max,
      weight,
      sourceCount: Math.max(1, Number(entry?.sourceCount || timestampsMs.length)),
      coverage: Math.max(0, Math.min(1, Number(entry?.coverage || timestampsMs.length / max))),
      timestampsMs
    };
  });

  return {
    baselineId: String(raw.baselineId || ""),
    label: String(raw.label || "PB"),
    finishMs: Math.max(0, Number(raw.finishMs || 0)),
    method: String(raw.method || ""),
    counters
  };
}

function normalizeResolvedPath(pathValue, gameId) {
  if (typeof pathValue !== "string" || !pathValue.trim()) {
    return `${BASE_PATH}/${gameId}`;
  }

  let path = pathValue.trim();

  if (path.startsWith("./")) {
    path = path.slice(2);
  }

  return `./${path}`;
}

function resolveDataFilePath(root, fallbackFileName, overridePath = "") {
  if (typeof overridePath !== "string" || !overridePath.trim()) {
    return `${root}/${fallbackFileName}`;
  }

  let path = overridePath.trim();

  if (path.startsWith("./")) {
    path = path.slice(2);
  }

  if (path.startsWith("/")) {
    return `.${path}`;
  }

  return `${root}/${path}`;
}

function mergeHiddenCounters(baseHiddenCounters = {}, routeHiddenCounters = {}) {
  const surfaces = new Set([
    ...Object.keys(baseHiddenCounters || {}),
    ...Object.keys(routeHiddenCounters || {})
  ]);

  const result = {};

  surfaces.forEach((surface) => {
    const routeKeys = routeHiddenCounters?.[surface];
    const baseKeys = baseHiddenCounters?.[surface];

    if (Array.isArray(routeKeys)) {
      result[surface] = routeKeys.filter((key) => typeof key === "string" && key.trim());
      return;
    }

    result[surface] = Array.isArray(baseKeys)
      ? baseKeys.filter((key) => typeof key === "string" && key.trim())
      : [];
  });

  return result;
}

function mergeMetaWithRoute(baseMeta = {}, routeEntry = null) {
  if (!routeEntry) {
    return clone(baseMeta);
  }

  const merged = clone(baseMeta);
  const overrideKeys = [
    "overlayTitle",
    "subtitle",
    "difficulty",
    "defaultDifficulty",
    "appendDifficultyToTitle",
    "supportsDirge",
    "collectibleTotal",
    "collectibleCounterKeys",
    "splitAutoCounterKeys",
    "collectibleLabel",
    "collectibleShortLabel",
    "collectibleDescription",
    "defaultTimerElapsedMs",
    "overallCounterKeys"
  ];

  overrideKeys.forEach((key) => {
    if (routeEntry[key] !== undefined) {
      merged[key] = clone(routeEntry[key]);
    }
  });

  merged.hiddenCounters = mergeHiddenCounters(baseMeta?.hiddenCounters, routeEntry?.hiddenCounters);

  return merged;
}

function getRouteEntryFromMeta(meta = {}, routeId = "") {
  const routes = Array.isArray(meta?.routes) ? meta.routes : [];
  const fallbackRouteId =
    normalizeId(meta?.defaultRouteId) ||
    normalizeId(routes[0]?.id) ||
    "";
  const requestedRouteId = normalizeId(routeId) || fallbackRouteId;

  return (
    routes.find((route) => normalizeId(route?.id) === requestedRouteId) ||
    routes.find((route) => normalizeId(route?.id) === fallbackRouteId) ||
    null
  );
}

async function resolveGameFolder(gameId) {
  const manifest = await loadGamesManifest();

  const games = Array.isArray(manifest?.games) ? manifest.games : [];

  const match =
    games.find((game) => game?.id === gameId) ||
    games.find((game) => game?.id === manifest?.defaultGameId);

  if (!match) {
    return `${BASE_PATH}/${gameId}`;
  }

  return normalizeResolvedPath(match.path, match.id || gameId);
}

export async function resolveGameDataFiles(gameId, routeId = "") {
  const root = await resolveGameFolder(gameId);
  const baseMetaRaw = await fetchJson(`${root}/meta.json`, {});
  const baseMeta = normalizeMeta(baseMetaRaw);
  const routeEntry = getRouteEntryFromMeta(baseMeta, routeId);

  return {
    root,
    routeId: routeEntry?.id || "",
    countersPath: resolveDataFilePath(root, "counters.json", routeEntry?.data?.counters),
    defaultSplitsPath: resolveDataFilePath(root, "default-splits.json", routeEntry?.data?.defaultSplits),
    phasesPath: resolveDataFilePath(root, "phases.json", routeEntry?.data?.phases),
    quotasPath: resolveDataFilePath(root, "quotas.json", routeEntry?.data?.quotas),
    completionTitlesPath: resolveDataFilePath(root, "completion-titles.json", routeEntry?.data?.completionTitles),
    neroIpcaClustersPath: resolveDataFilePath(root, "nero-ipca-clusters.json", routeEntry?.data?.neroIpcaClusters),
    paceBenchmarkPath: resolveDataFilePath(root, "pb-pace-benchmark.json", routeEntry?.data?.paceBenchmark)
  };
}

export async function loadGamesManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJson(`${BASE_PATH}/games.json`, {
      defaultGameId: "",
      games: []
    });
  }

  const manifest = await manifestPromise;
  const games = Array.isArray(manifest?.games) ? manifest.games : [];

  return {
    defaultGameId: manifest?.defaultGameId || "",
    games: games.map((game, index) => ({
      id: game?.id || `game_${index}`,
      title: game?.title || game?.id || `Game ${index + 1}`,
      path: game?.path || `${BASE_PATH}/${game?.id || `game_${index}`}`
    }))
  };
}

export async function loadGameMeta(gameId) {
  const root = await resolveGameFolder(gameId);
  const meta = await fetchJson(`${root}/meta.json`, {});
  return normalizeMeta(meta);
}

export async function loadGameData(gameId, routeId = "") {
  const files = await resolveGameDataFiles(gameId, routeId);
  const root = files.root;
  const baseMetaRaw = await fetchJson(`${root}/meta.json`, {});
  const baseMeta = normalizeMeta(baseMetaRaw);
  const routeEntry = getRouteEntryFromMeta(baseMeta, routeId);
  const mergedMetaRaw = mergeMetaWithRoute(baseMetaRaw, routeEntry);

  const [
    counters,
    defaultSplitsRaw,
    phasesRaw,
    quotasRaw,
    completionTitlesRaw,
    neroIpcaClustersRaw,
    paceBenchmarkRaw
  ] = await Promise.all([
    fetchJson(files.countersPath, {}),
    fetchJson(files.defaultSplitsPath, { splits: [] }),
    fetchJson(files.phasesPath, { phases: {} }),
    fetchJson(files.quotasPath, { quotas: {} }),
    gameId === "days-gone"
      ? fetchJson(files.completionTitlesPath, { categories: {} })
      : Promise.resolve({ categories: {} }),
    gameId === "days-gone"
      ? fetchJson(files.neroIpcaClustersPath, { clusters: [] })
      : Promise.resolve({ clusters: [] }),
    gameId === "days-gone"
      ? fetchJson(files.paceBenchmarkPath, null)
      : Promise.resolve(null)
  ]);

  const meta = normalizeMeta({
    ...mergedMetaRaw,
    defaultRouteId: baseMeta.defaultRouteId,
    routes: baseMeta.routes,
    activeRouteId: routeEntry?.id || "",
    activeRouteTitle: routeEntry?.title || "",
    activeRouteShortTitle: routeEntry?.shortTitle || routeEntry?.title || "",
    activeRouteBadge: routeEntry?.badgeLabel || routeEntry?.shortTitle || routeEntry?.title || ""
  });

  return {
    meta,
    files,
    counters: normalizeCounters(counters),
    defaultSplits: normalizeDefaultSplitsFile(defaultSplitsRaw),
    phases: normalizePhasesFile(phasesRaw),
    quotas: normalizeQuotasFile(quotasRaw),
    completionTitles: normalizeCompletionTitlesFile(completionTitlesRaw),
    neroIpcaClusters: normalizeNeroIpcaClustersFile(neroIpcaClustersRaw),
    paceBenchmark: normalizePaceBenchmarkFile(paceBenchmarkRaw)
  };
}
