import fs from "node:fs";
import path from "node:path";

const [outputArg, ...inputArgs] = process.argv.slice(2);
if (!outputArg || inputArgs.length < 2) {
  console.error("Usage: node scripts/merge-days-gone-center-scan-files.mjs <output.json> <scan-a.json> <scan-b.json> [...]");
  process.exit(1);
}

const outputFile = path.resolve(outputArg);
const inputFiles = inputArgs.map((item) => path.resolve(item));
const scans = inputFiles.map((file) => ({ file, data: JSON.parse(fs.readFileSync(file, "utf8")) }));
const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const rawPopups = scans.flatMap(({ file, data }) =>
  (data.episodes || []).flatMap((episode) => (episode.popups || []).map((popup) => ({
    ...popup,
    image: popup.image
      ? path.relative(path.dirname(outputFile), path.resolve(path.dirname(file), popup.image)).replaceAll("\\", "/")
      : ""
  })))
).sort((left, right) => Number(left.timestamp) - Number(right.timestamp));

const popups = [];
for (const popup of rawPopups) {
  const duplicate = popups.slice(-12).some((previous) =>
    Math.abs(Number(previous.timestamp) - Number(popup.timestamp)) <= 2
    && normalize(previous.text) === normalize(popup.text)
  );
  if (!duplicate) popups.push(popup);
}

const episodes = [];
for (const popup of popups) {
  let episode = episodes.at(-1);
  if (!episode || Number(popup.timestamp) - Number(episode.lastTimestamp) > 25) {
    episode = {
      id: `center-popup-${String(episodes.length + 1).padStart(4, "0")}`,
      firstTimestamp: popup.timestamp,
      lastTimestamp: popup.timestamp,
      primaryTitle: popup.text,
      popups: []
    };
    episodes.push(episode);
  }
  episode.lastTimestamp = popup.timestamp;
  episode.popups.push(popup);
}

const recognizedCategoryPopups = {};
for (const episode of episodes) {
  const categories = new Set(episode.popups.map((popup) => popup.category).filter((value) => value && value !== "unclassified"));
  for (const category of categories) recognizedCategoryPopups[category] = (recognizedCategoryPopups[category] || 0) + 1;
}

const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  source: scans[0].data.source,
  scan: {
    mergedScans: inputFiles.length,
    inputFiles,
    ocrCandidates: popups.length,
    episodes: episodes.length
  },
  expectedLedger: scans[0].data.expectedLedger,
  recognizedCategoryPopups,
  episodes
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputFile, ...result.scan, recognizedCategoryPopups }, null, 2));
