import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputDir = path.resolve(ROOT, process.argv[2] || "outputs/training/days-gone/20260718/center-popup-chunks");
const outputFile = path.resolve(ROOT, process.argv[3] || "outputs/training/days-gone/20260718/center-popup-scan.json");
const chunkFiles = fs.existsSync(inputDir)
  ? fs.readdirSync(inputDir).filter((name) => /^chunk-\d+\.json$/i.test(name)).sort().map((name) => path.join(inputDir, name))
  : [];
if (!chunkFiles.length) throw new Error(`No completed center-popup chunks found in ${inputDir}`);

const chunks = chunkFiles.map((file) => ({
  ...JSON.parse(fs.readFileSync(file, "utf8")),
  __chunkFile: file
}));
function usefulPopup(popup) {
  const text = String(popup?.text || "");
  const letters = text.replace(/[^A-Za-z]/g, "");
  return text.length <= 90 && letters.length >= 5 && letters.length <= 70 && !/\bcontinue\b/i.test(text);
}

const popups = chunks.flatMap((chunk) => (chunk.episodes || []).flatMap((episode) => (episode.popups || []).map((popup) => ({
  ...popup,
  image: popup.image
    ? path.relative(path.dirname(outputFile), path.resolve(path.dirname(chunk.__chunkFile), popup.image)).replaceAll("\\", "/")
    : ""
}))))
  .filter(usefulPopup)
  .sort((left, right) => left.timestamp - right.timestamp);
const gap = 25;
const episodes = [];
for (const popup of popups) {
  let episode = episodes.at(-1);
  if (!episode || popup.timestamp - episode.lastTimestamp > gap) {
    episode = { id: `center-popup-${String(episodes.length + 1).padStart(4, "0")}`, firstTimestamp: popup.timestamp,
      lastTimestamp: popup.timestamp, primaryTitle: popup.text, popups: [] };
    episodes.push(episode);
  }
  episode.lastTimestamp = popup.timestamp;
  episode.popups.push(popup);
}
const recognizedCategoryPopups = {};
for (const episode of episodes) {
  const categories = new Set(episode.popups.map((popup) => popup.category).filter((category) => category !== "unclassified"));
  for (const category of categories) recognizedCategoryPopups[category] = (recognizedCategoryPopups[category] || 0) + 1;
}
const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  source: chunks[0].source,
  scan: { chunks: chunks.length, frames: chunks.reduce((sum, chunk) => sum + Number(chunk.scan?.frames || 0), 0),
    ocrCandidates: popups.length, episodes: episodes.length },
  expectedLedger: chunks[0].expectedLedger,
  recognizedCategoryPopups,
  episodes
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputFile, ...result.scan, recognizedCategoryPopups }, null, 2));
