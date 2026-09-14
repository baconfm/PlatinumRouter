import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataRoot = path.join(root, "data");
const failures = [];

async function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(await readFile(fullPath, "utf8"));
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unwrapSplits(raw) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.splits) ? raw.splits : [];
}

function unwrapPhases(raw) {
  return raw && typeof raw === "object" && raw.phases && typeof raw.phases === "object"
    ? raw.phases
    : asObject(raw);
}

function unwrapQuotas(raw) {
  return raw && typeof raw === "object" && raw.quotas && typeof raw.quotas === "object"
    ? raw.quotas
    : asObject(raw);
}

function normalizeRoutePath(gamePath, override, fallbackFile) {
  const base = gamePath.replace(/^\.\//, "");
  return path.join(base, override || fallbackFile).replaceAll("\\", "/");
}

function note(message) {
  failures.push(message);
}

const manifest = await readJson("data/games.json");

if (!manifest) {
  process.exit(1);
}

const games = Array.isArray(manifest.games) ? manifest.games : [];
if (!games.length) note("data/games.json: games must be a non-empty array");

const gameIds = new Set();

for (const game of games) {
  const gameId = typeof game.id === "string" ? game.id.trim() : "";
  const gamePath = typeof game.path === "string" ? game.path.trim() : "";

  if (!gameId) {
    note("data/games.json: every game needs an id");
    continue;
  }

  if (gameIds.has(gameId)) note(`data/games.json: duplicate game id "${gameId}"`);
  gameIds.add(gameId);

  if (!gamePath) {
    note(`data/games.json:${gameId}: missing path`);
    continue;
  }

  const metaPath = normalizeRoutePath(gamePath, "", "meta.json");
  const countersPath = normalizeRoutePath(gamePath, "", "counters.json");
  const defaultSplitsPath = normalizeRoutePath(gamePath, "", "default-splits.json");
  const phasesPath = normalizeRoutePath(gamePath, "", "phases.json");
  const quotasPath = normalizeRoutePath(gamePath, "", "quotas.json");

  for (const required of [metaPath, countersPath, defaultSplitsPath, phasesPath, quotasPath]) {
    if (!(await exists(required))) note(`${gameId}: missing ${required}`);
  }

  const meta = await readJson(metaPath);
  const counters = asObject(await readJson(countersPath));
  const counterKeys = new Set(Object.keys(counters));
  const routes = Array.isArray(meta?.routes) ? meta.routes : [];
  const routeIds = new Set(routes.map((route) => route.id).filter(Boolean));

  if (meta?.id && meta.id !== gameId) {
    note(`${metaPath}: meta id "${meta.id}" does not match manifest id "${gameId}"`);
  }

  if (meta?.defaultRouteId && routes.length && !routeIds.has(meta.defaultRouteId)) {
    note(`${metaPath}: defaultRouteId "${meta.defaultRouteId}" is not listed in routes`);
  }

  const completionTitlesPath = normalizeRoutePath(gamePath, "", "completion-titles.json");
  if (await exists(completionTitlesPath)) {
    const completionTitles = asObject((await readJson(completionTitlesPath))?.categories);
    const expectedCounts = gameId === "days-gone"
      ? { encampmentjobs: 34, infestations: 12, hordes: 40, ambushcamps: 14, nerosites: 12 }
      : {};
    Object.entries(completionTitles).forEach(([counterKey, category]) => {
      if (!counterKeys.has(counterKey)) {
        note(`${completionTitlesPath}: unknown counter key "${counterKey}"`);
      }
      const titles = Array.isArray(category?.titles) ? category.titles : [];
      const countingTitles = titles.filter((entry) => entry?.countsTowardCounter !== false);
      const expectedTitles = counterKey === "infestations" ? countingTitles : titles;
      if (expectedCounts[counterKey] && expectedTitles.length !== expectedCounts[counterKey]) {
        note(`${completionTitlesPath}: ${counterKey} needs ${expectedCounts[counterKey]} titles, found ${expectedTitles.length}`);
      }
      titles.forEach((entry, index) => {
        if (typeof entry?.title !== "string" || !entry.title.trim()) {
          note(`${completionTitlesPath}: ${counterKey}[${index}] needs a title`);
        }
      });
    });
  }

  if (gameId === "days-gone") {
    const clustersPath = normalizeRoutePath(gamePath, "", "nero-ipca-clusters.json");
    if (!(await exists(clustersPath))) {
      note(`${gameId}: missing ${clustersPath}`);
    } else {
      const clustersFile = await readJson(clustersPath);
      const clusters = Array.isArray(clustersFile?.clusters) ? clustersFile.clusters : [];
      const indexes = new Set(clusters.map((cluster) => Number(cluster?.ipcaIndex || 0)));
      if (clusters.length !== 18 || indexes.size !== 18) {
        note(`${clustersPath}: needs 18 uniquely indexed IPCA clusters, found ${clusters.length}`);
      }
      clusters.forEach((cluster, index) => {
        if (!String(cluster?.siteName || "").trim()) {
          note(`${clustersPath}: clusters[${index}] needs a siteName`);
        }
        if (!Array.isArray(cluster?.neroIntel) || !cluster.neroIntel.length) {
          note(`${clustersPath}: clusters[${index}] needs at least one NERO Intel anchor`);
        }
      });
    }
  }

  const routeSpecs = routes.length ? routes : [{ id: "default", data: {} }];

  for (const route of routeSpecs) {
    const routeId = route.id || "default";
    const routeData = asObject(route.data);
    const routeCountersPath = normalizeRoutePath(gamePath, routeData.counters, "counters.json");
    const routeSplitsPath = normalizeRoutePath(gamePath, routeData.defaultSplits, "default-splits.json");
    const routePhasesPath = normalizeRoutePath(gamePath, routeData.phases, "phases.json");
    const routeQuotasPath = normalizeRoutePath(gamePath, routeData.quotas, "quotas.json");
    const routeCompletionTitlesPath = normalizeRoutePath(gamePath, routeData.completionTitles, "completion-titles.json");

    const routeCounters = asObject(await readJson(routeCountersPath));
    const routeCounterKeys = new Set(Object.keys(routeCounters));
    const splitsFile = await readJson(routeSplitsPath);
    const phasesFile = await readJson(routePhasesPath);
    const quotasFile = await readJson(routeQuotasPath);

    const splits = unwrapSplits(splitsFile);
    const phases = unwrapPhases(phasesFile);
    const quotas = unwrapQuotas(quotasFile);
    const phaseKeys = new Set(Object.keys(phases));
    const splitIds = new Set();

    if (!splits.length) note(`${routeSplitsPath}: route "${routeId}" has no splits`);
    if (!phaseKeys.size) note(`${routePhasesPath}: route "${routeId}" has no phases`);

    splits.forEach((split, index) => {
      const label = split?.id || split?.label || `split ${index + 1}`;

      if (split?.id) {
        if (splitIds.has(split.id)) note(`${routeSplitsPath}: duplicate split id "${split.id}"`);
        splitIds.add(split.id);
      }

      const phaseId = split?.phase || split?.phaseId || split?.act || "";
      if (phaseId && !phaseKeys.has(phaseId)) {
        note(`${routeSplitsPath}: ${label} references unknown phase "${phaseId}"`);
      }

      for (const key of Object.keys(asObject(split?.auto))) {
        if (!routeCounterKeys.has(key)) {
          note(`${routeSplitsPath}: ${label} auto references unknown counter "${key}"`);
        }
      }

      for (const goal of Array.isArray(split?.ocrGoals) ? split.ocrGoals : []) {
        if (goal?.counterKey && !routeCounterKeys.has(goal.counterKey)) {
          note(`${routeSplitsPath}: ${label} OCR goal references unknown counter "${goal.counterKey}"`);
        }
      }
    });

    for (const [phaseId, phase] of Object.entries(phases)) {
      const visible = Array.isArray(phase?.visibleCounters)
        ? phase.visibleCounters
        : Array.isArray(phase?.visible)
          ? phase.visible
          : [];
      const objectives = Array.isArray(phase?.objectives) ? phase.objectives : [];

      for (const key of [...visible, ...objectives]) {
        if (typeof key === "string" && key && !routeCounterKeys.has(key)) {
          note(`${routePhasesPath}: phase "${phaseId}" references unknown counter "${key}"`);
        }
      }
    }

    for (const [phaseId, quotaValue] of Object.entries(quotas)) {
      if (!phaseKeys.has(phaseId)) {
        note(`${routeQuotasPath}: quota references unknown phase "${phaseId}"`);
      }

      const targets = asObject(quotaValue?.targets) || asObject(quotaValue);
      for (const key of Object.keys(targets)) {
        if (!routeCounterKeys.has(key)) {
          note(`${routeQuotasPath}: phase "${phaseId}" quota references unknown counter "${key}"`);
        }
      }
    }

    if (await exists(routeCompletionTitlesPath)) {
      const routeCompletionTitles = asObject((await readJson(routeCompletionTitlesPath))?.categories);
      for (const [key, category] of Object.entries(routeCompletionTitles)) {
        if (!routeCounterKeys.has(key)) {
          note(`${routeCompletionTitlesPath}: unknown counter key "${key}"`);
        }
        for (const [index, entry] of (Array.isArray(category?.titles) ? category.titles : []).entries()) {
          if (!String(entry?.title || "").trim()) {
            note(`${routeCompletionTitlesPath}: ${key}[${index}] needs a title`);
          }
        }
      }
    }
  }
}

if (manifest.defaultGameId && !gameIds.has(manifest.defaultGameId)) {
  note(`data/games.json: defaultGameId "${manifest.defaultGameId}" is not listed in games`);
}

if (failures.length) {
  console.error("Data validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Data validation passed for ${games.length} games.`);
