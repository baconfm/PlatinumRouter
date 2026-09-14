import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const gameId = process.argv[2] || "days-gone";

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

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function normalizeRoutePath(gamePath, override, fallbackFile) {
  const base = gamePath.replace(/^\.\//, "");
  return path.join(base, override || fallbackFile).replaceAll("\\", "/");
}

function formatDiff(value) {
  return value > 0 ? `+${value}` : String(value);
}

function sumAutoSplits(splits, counterKeys) {
  const totals = Object.fromEntries(counterKeys.map((key) => [key, 0]));
  const byPhase = {};
  const phaseOrder = [];
  const splitStats = [];

  splits.forEach((split) => {
    const phaseId = split?.phase || split?.phaseId || split?.act || "legacy_all";
    if (!phaseOrder.includes(phaseId)) phaseOrder.push(phaseId);
    byPhase[phaseId] ||= Object.fromEntries(counterKeys.map((key) => [key, 0]));

    let chipCount = 0;
    Object.entries(asObject(split?.auto)).forEach(([key, rawValue]) => {
      const amount = Number(rawValue || 0);
      if (!amount) return;
      totals[key] = Number(totals[key] || 0) + amount;
      byPhase[phaseId][key] = Number(byPhase[phaseId][key] || 0) + amount;
      chipCount += 1;
    });

    splitStats.push({
      id: split?.id || "",
      label: split?.label || "",
      phaseId,
      chipCount,
      auto: asObject(split?.auto)
    });
  });

  return { totals, byPhase, phaseOrder, splitStats };
}

function buildCumulativeByPhase(phaseOrder, byPhase, counterKeys) {
  const running = Object.fromEntries(counterKeys.map((key) => [key, 0]));
  const result = {};

  phaseOrder.forEach((phaseId) => {
    Object.entries(byPhase[phaseId] || {}).forEach(([key, value]) => {
      running[key] = Number(running[key] || 0) + Number(value || 0);
    });
    result[phaseId] = { ...running };
  });

  return result;
}

function compileChipPlan({ meta, counters, splitStats, totals }) {
  const collectibleKeys = Array.isArray(meta?.collectibleCounterKeys)
    ? meta.collectibleCounterKeys
    : [];
  const routeCollectibleTotal = Number(totals.routecollectibles || 0);
  const trueCollectibleTotal = collectibleKeys.reduce((sum, key) => {
    return sum + Number(totals[key] || 0);
  }, 0);
  const trueCollectibleMax = collectibleKeys.reduce((sum, key) => {
    return sum + Number(counters[key]?.max || 0);
  }, 0);
  const categoryActivity = collectibleKeys
    .map((key) => ({
      key,
      label: counters[key]?.shortLabel || counters[key]?.label || key,
      route: Number(totals[key] || 0),
      max: Number(counters[key]?.max || 0),
      activeSplits: splitStats.filter((split) => Number(split.auto?.[key] || 0) !== 0).length
    }))
    .sort((a, b) => b.activeSplits - a.activeSplits || b.route - a.route);

  return {
    recommendedRunnerChips: [
      routeCollectibleTotal > 0 ? "routecollectibles" : "",
      trueCollectibleMax > 0 ? "__collectibles__" : ""
    ].filter(Boolean),
    recommendedViewerChips: [
      routeCollectibleTotal > 0 ? "routecollectibles" : "",
      trueCollectibleMax > 0 ? "__collectibles__" : ""
    ].filter(Boolean),
    routeCollectibleTotal,
    routeCollectibleMax: Number(counters.routecollectibles?.max || 0),
    trueCollectibleTotal,
    trueCollectibleMax,
    categoryActivity,
    cleanupOnlyCategories: categoryActivity.filter((entry) => entry.route === 0 && entry.max > 0),
    overPlannedCategories: categoryActivity.filter((entry) => entry.route > entry.max)
  };
}

function compileRoute({ routeId, routeTitle, meta, counters, phases, quotas, splits }) {
  const counterKeys = Object.keys(counters);
  const { totals, byPhase, phaseOrder, splitStats } = sumAutoSplits(splits, counterKeys);
  const cumulativeByPhase = buildCumulativeByPhase(phaseOrder, byPhase, counterKeys);
  const routeDiffs = counterKeys
    .map((key) => ({
      key,
      label: counters[key]?.label || key,
      planned: Number(totals[key] || 0),
      max: Number(counters[key]?.max || 0),
      diff: Number(totals[key] || 0) - Number(counters[key]?.max || 0)
    }))
    .filter((entry) => entry.diff !== 0);

  const quotaDiffs = [];
  phaseOrder.forEach((phaseId) => {
    const targets = asObject(quotas[phaseId]?.targets || quotas[phaseId]);
    Object.entries(targets).forEach(([key, rawTarget]) => {
      const target = Number(rawTarget || 0);
      const actual = Number(cumulativeByPhase[phaseId]?.[key] || 0);
      if (actual !== target) {
        quotaDiffs.push({ phaseId, key, actual, target, diff: actual - target });
      }
    });
  });

  const densestSplits = splitStats
    .slice()
    .sort((a, b) => b.chipCount - a.chipCount)
    .slice(0, 10);
  const emptySplits = splitStats.filter((split) => split.chipCount === 0);
  const chipPlan = compileChipPlan({ meta, counters, splitStats, totals });

  return {
    routeId,
    routeTitle,
    splitCount: splits.length,
    phaseCount: Object.keys(phases).length,
    phaseOrder,
    totals,
    routeDiffs,
    quotaDiffs,
    densestSplits,
    emptySplits,
    chipPlan
  };
}

async function loadGame(gameId) {
  const manifest = await readJson("data/games.json");
  const gameEntry = (manifest.games || []).find((game) => game.id === gameId);
  if (!gameEntry) throw new Error(`Unknown game "${gameId}"`);

  const gamePath = gameEntry.path.replace(/^\.\//, "");
  const meta = await readJson(normalizeRoutePath(gamePath, "", "meta.json"));
  const counters = await readJson(normalizeRoutePath(gamePath, "", "counters.json"));
  const routeEntries = Array.isArray(meta.routes) && meta.routes.length
    ? meta.routes
    : [{ id: "default", title: meta.title || gameId, data: {} }];

  const reports = [];
  for (const route of routeEntries) {
    const data = asObject(route.data);
    const splits = unwrapSplits(await readJson(normalizeRoutePath(gamePath, data.defaultSplits, "default-splits.json")));
    const phases = unwrapPhases(await readJson(normalizeRoutePath(gamePath, data.phases, "phases.json")));
    const quotas = unwrapQuotas(await readJson(normalizeRoutePath(gamePath, data.quotas, "quotas.json")));

    reports.push(compileRoute({
      routeId: route.id || "default",
      routeTitle: route.title || route.label || meta.title || gameId,
      meta,
      counters,
      phases,
      quotas,
      splits
    }));
  }

  return { gameId, title: meta.title || gameId, reports };
}

const compiled = await loadGame(gameId);

compiled.reports.forEach((report) => {
  console.log(`\n${compiled.title} / ${report.routeTitle}`);
  console.log(`${report.splitCount} splits across ${report.phaseOrder.length} active phases.`);
  console.log(`Route collectibles: ${report.chipPlan.routeCollectibleTotal}/${report.chipPlan.routeCollectibleMax}`);
  console.log(`True collectible categories: ${report.chipPlan.trueCollectibleTotal}/${report.chipPlan.trueCollectibleMax}`);
  console.log(`Recommended runner collectible chips: ${report.chipPlan.recommendedRunnerChips.join(", ") || "none"}`);

  if (report.routeDiffs.length) {
    console.log("\nCounter coverage:");
    report.routeDiffs.forEach((entry) => {
      console.log(`- ${entry.key}: ${entry.planned}/${entry.max} (${formatDiff(entry.diff)})`);
    });
  }

  if (report.quotaDiffs.length) {
    console.log("\nQuota mismatches:");
    report.quotaDiffs.slice(0, 40).forEach((entry) => {
      console.log(`- ${entry.phaseId}.${entry.key}: ${entry.actual}/${entry.target} (${formatDiff(entry.diff)})`);
    });
    if (report.quotaDiffs.length > 40) {
      console.log(`- ...${report.quotaDiffs.length - 40} more`);
    }
  }

  if (report.chipPlan.cleanupOnlyCategories.length) {
    console.log("\nCollectible categories with no split autos:");
    report.chipPlan.cleanupOnlyCategories.forEach((entry) => {
      console.log(`- ${entry.key}: 0/${entry.max}`);
    });
  }

  if (report.emptySplits.length) {
    console.log("\nSplits with no autos:");
    report.emptySplits.forEach((split) => {
      console.log(`- ${split.phaseId}: ${split.label}`);
    });
  }
});
