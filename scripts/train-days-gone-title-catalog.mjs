import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchDaysGoneCompletionTitle } from "../js/days-gone-completion.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(projectRoot, "data", "days-gone", "completion-titles.json");
const defaultScanPath = path.join(projectRoot, "outputs", "training", "days-gone", "20260718", "center-popup-scan.json");
const scanPath = path.resolve(process.argv[2] || defaultScanPath);
const outputPath = path.resolve(process.argv[3] || path.join(path.dirname(scanPath), "models", "completion-title-model.json"));

const [catalogRaw, scan] = await Promise.all([
  fs.readFile(catalogPath, "utf8").then(JSON.parse),
  fs.readFile(scanPath, "utf8").then(JSON.parse)
]);

const catalog = catalogRaw.categories || {};
const byCategory = Object.fromEntries(Object.keys(catalog).map((key) => [key, {
  episodes: 0,
  distinctTitles: new Set(),
  matches: []
}]));
const matchedEpisodes = [];
const unresolvedEpisodes = [];

for (const episode of Array.isArray(scan.episodes) ? scan.episodes : []) {
  let best = null;
  for (const popup of Array.isArray(episode.popups) ? episode.popups : []) {
    const match = matchDaysGoneCompletionTitle(popup.text, catalog);
    if (!match || (best && match.score <= best.match.score)) continue;
    best = { popup, match };
  }

  if (!best) {
    unresolvedEpisodes.push({
      id: episode.id,
      timestamp: episode.firstTimestamp,
      primaryTitle: episode.primaryTitle
    });
    continue;
  }

  const record = {
    id: episode.id,
    timestamp: best.popup.timestamp,
    observedText: best.popup.text,
    canonicalTitle: best.match.canonicalTitle,
    counterKey: best.match.counterKey,
    countsTowardCounter: best.match.countsTowardCounter,
    score: Number(best.match.score.toFixed(4)),
    image: best.popup.image || ""
  };
  matchedEpisodes.push(record);
  const bucket = byCategory[best.match.counterKey];
  bucket.episodes += 1;
  bucket.distinctTitles.add(best.match.canonicalTitle);
  bucket.matches.push(record);
}

const categories = Object.fromEntries(Object.entries(byCategory).map(([key, value]) => [key, {
  catalogTitles: catalog[key]?.titles?.filter((entry) => entry.countsTowardCounter !== false).length || 0,
  matchedEpisodes: value.episodes,
  distinctCatalogTitlesSeen: value.distinctTitles.size,
  titlesSeen: [...value.distinctTitles].sort(),
  matches: value.matches
}]));

const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourceScan: path.relative(projectRoot, scanPath).replaceAll("\\", "/"),
  catalog: path.relative(projectRoot, catalogPath).replaceAll("\\", "/"),
  summary: {
    episodes: Array.isArray(scan.episodes) ? scan.episodes.length : 0,
    matchedEpisodes: matchedEpisodes.length,
    unresolvedEpisodes: unresolvedEpisodes.length
  },
  categories,
  unresolvedEpisodes
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...result.summary, categories: Object.fromEntries(
  Object.entries(categories).map(([key, value]) => [key, {
    matchedEpisodes: value.matchedEpisodes,
    distinctCatalogTitlesSeen: value.distinctCatalogTitlesSeen,
    catalogTitles: value.catalogTitles
  }])
) }, null, 2));
