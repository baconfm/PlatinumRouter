import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function resolve(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function newestDirectory(root) {
  if (!fs.existsSync(root)) return "";
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(root, entry.name);
      return { fullPath, changed: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.changed - a.changed)[0]?.fullPath || "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
}

const runDirectory = resolve(arg("--run-dir"));
const outputJson = resolve(arg("--output-json", path.join(runDirectory, "preflight-report.json")));
const outputText = resolve(arg("--output-text", path.join(runDirectory, "PRE-FLIGHT-REPORT.txt")));
const collectible = readJson(path.join(runDirectory, "collectible-progress.json"));
const ipca = readJson(path.join(runDirectory, "ipca-progress.json"));
const run = readJson(path.join(runDirectory, "run.json"));
const trackerSource = fs.readFileSync(path.join(ROOT, "js", "screen-tracker.js"), "utf8");
const recording = run.parts?.[0]?.file || "";
const groundTruthName = `${path.parse(recording).name}.json`;
const groundTruthFile = path.join(runDirectory, "manual-ground-truth", groundTruthName);
const manualGroundTruth = fs.existsSync(groundTruthFile) ? readJson(groundTruthFile) : null;

const disabledBlock = trackerSource.match(/const DAYS_GONE_LIVE_DISABLED_REGION_IDS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
const centerAnchorDisabled = disabledBlock.includes('"days_gone_completion_anchor"');
const centerTitleDisabled = disabledBlock.includes('"days_gone_completion_title"');
const centerOcrDisabled = centerAnchorDisabled && centerTitleDisabled;

const liveLogRoot = path.join(ROOT, "outputs", "ocr-run-logs", "days-gone", "default");
const latestLiveSession = newestDirectory(liveLogRoot);
const liveConfirmed = latestLiveSession
  ? readJsonLines(path.join(latestLiveSession, "confirmed.jsonl"))
  : [];
const collectibleCatalogIds = new Set([
  ...(collectible.matches || []).map((match) => match.id),
  ...(collectible.missingCatalogItems || []).map((item) => item.id)
]);
const liveChecklistIds = unique(liveConfirmed.flatMap((event) =>
  (event.applied || []).flatMap((applied) => applied.matchedChecklistIds || [])
)).filter((id) => collectibleCatalogIds.has(id));
const offlineIds = new Set((collectible.matches || []).map((match) => match.id));
const rediscoveredIds = liveChecklistIds.filter((id) => offlineIds.has(id));
const replayRecallPercent = liveChecklistIds.length
  ? Math.round(rediscoveredIds.length / liveChecklistIds.length * 1000) / 10
  : null;
const collectibleCount = Number(collectible.summary?.detectedCollectibles || 0);
const ipcaCount = Number(ipca.summary?.detectedPickupPopups || 0);
const unmatchedCount = Number(collectible.summary?.unmatchedCandidates || 0);
const manualCollectibleCount = Number(manualGroundTruth?.hudSnapshot?.routeCollectibles || 0);
const manualIpcaCount = Number(manualGroundTruth?.hudSnapshot?.ipcaTech || 0);
const trustedOfflineIds = liveChecklistIds.length
  ? (collectible.matches || []).filter((match) => liveChecklistIds.includes(match.id))
  : (collectible.matches || []);
const uncorroboratedOfflineMatches = Math.max(0, collectibleCount - trustedOfflineIds.length);

const candidateTexts = [
  ...(collectible.ocrCandidates || []),
  ...(ipca.ocrCandidates || [])
].map((row) => String(row.observedText || ""));
const dangerousTutorialPatterns = [
  /horde strategy/i,
  /freaker infestations/i,
  /mmu fuse panels/i
];
const dangerousTutorialHits = candidateTexts.filter((text) =>
  dangerousTutorialPatterns.some((pattern) => pattern.test(text))
);

const warnings = [];
const failures = [];
if (!centerOcrDisabled) failures.push("Center completion OCR is not fully disabled in the live configuration.");
if (collectibleCount === 0) failures.push("No named collectible popup was detected.");
if (manualCollectibleCount > 0 && replayRecallPercent !== null && replayRecallPercent < 50) {
  failures.push(`Pickup replay recall was only ${replayRecallPercent}% against the live checklist.`);
}
if (manualIpcaCount > 0 && ipcaCount === 0) {
  failures.push(`No IPCA Tech pickup was detected even though the session ended at ${manualIpcaCount}/18.`);
} else if (ipcaCount === 0) {
  warnings.push("No IPCA Tech pickup popup was detected; review whether this recording contained one.");
}
if (replayRecallPercent !== null && replayRecallPercent < 65) {
  warnings.push(`Replay rediscovered only ${replayRecallPercent}% of exact checklist items from the latest live log.`);
}
if (unmatchedCount > Math.max(500, collectibleCount * 20)) {
  warnings.push("The top-right scanner produced a high unmatched-candidate volume; inspect its candidate ledger.");
}
if (dangerousTutorialHits.length) {
  warnings.push("Tutorial text appeared in pickup-only crops. It was not counted, but should be reviewed.");
}
if (!latestLiveSession) warnings.push("No live OCR log was available for replay recall comparison.");

const status = failures.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
const payload = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  status,
  recording,
  durationSeconds: Number(run.testDurationSeconds || run.totalDurationSeconds || 0),
  recordingDurationSeconds: Number(run.totalDurationSeconds || 0),
  limitedDuration: Boolean(run.limitedDuration),
  liveConfiguration: {
    centerOcrDisabled,
    completionAnchorDisabled: centerAnchorDisabled,
    completionTitleDisabled: centerTitleDisabled,
    activeReplayRegions: ["top-right collectibles/trophies", "lower-left IPCA Tech"]
  },
  collectibles: {
    detected: collectibleCount,
    catalogItems: Number(collectible.summary?.catalogItems || 0),
    coveragePercent: Number(collectible.summary?.coveragePercent || 0),
    perCounter: collectible.summary?.perCounter || {},
    unmatchedCandidates: unmatchedCount,
    duplicateSightings: Number(collectible.summary?.duplicateSightings || 0)
  },
  ipca: {
    detected: ipcaCount,
    expectedFullRunTotal: 18,
    ocrAttempts: Number(ipca.scan?.ocrAttempts || 0)
  },
  liveReplayComparison: {
    liveSession: latestLiveSession,
    exactChecklistItemsInLiveLog: liveChecklistIds.length,
    rediscoveredByOfflineReplay: rediscoveredIds.length,
    replayRecallPercent,
    manualRouteCollectiblesAtEnd: manualCollectibleCount || null,
    trustedOfflineMatches: trustedOfflineIds.length,
    uncorroboratedOfflineMatches,
    liveItemsNotRediscovered: liveChecklistIds.filter((id) => !offlineIds.has(id))
  },
  safety: {
    dangerousTutorialHits: dangerousTutorialHits.length,
    centerCompletionEventsProcessed: 0
  },
  manualGroundTruth,
  failures,
  warnings
};

const lines = [
  "DAYS GONE - TOMORROW PICKUP OCR PRE-FLIGHT",
  "==========================================",
  "",
  `FINAL RESULT: ${status}`,
  `Recording: ${payload.recording}`,
  `Recording duration: ${formatDuration(payload.recordingDurationSeconds)}`,
  `Tested duration: ${formatDuration(payload.durationSeconds)}${payload.limitedDuration ? " (first hour only)" : ""}`,
  "",
  "LIVE CONFIGURATION",
  `  Center mission/completion OCR: ${centerOcrDisabled ? "OFF (correct)" : "ON (unsafe)"}`,
  "  Top-right collectibles/trophies: ON",
  "  Lower-left IPCA Tech pickups: ON",
  "  Center completion events processed by this test: 0",
  "",
  "REPLAY RESULTS",
  `  Named collectibles/trophies found: ${collectibleCount}`,
  `  Full catalog coverage represented: ${payload.collectibles.coveragePercent}%`,
  `  IPCA Tech pickup popups found: ${ipcaCount}`,
  `  Duplicate sightings safely ignored: ${payload.collectibles.duplicateSightings}`,
  `  Unmatched top-right candidates retained for review: ${unmatchedCount}`,
  "",
  "LATEST LIVE-LOG CROSS-CHECK",
  `  Exact live checklist items: ${liveChecklistIds.length}`,
  `  Rediscovered in recording: ${rediscoveredIds.length}`,
  `  Replay recall: ${replayRecallPercent === null ? "not available" : `${replayRecallPercent}%`}`,
  `  Corroborated replay matches: ${trustedOfflineIds.length}`,
  `  Uncorroborated replay matches: ${uncorroboratedOfflineMatches}`,
  "",
  "COUNTERS FOUND",
  ...Object.entries(payload.collectibles.perCounter).map(([key, value]) => `  ${key}: ${value}`),
  "",
  "MANUAL SESSION GROUND TRUTH",
  ...(manualGroundTruth ? [
    `  Stealth kills accumulated: ${manualGroundTruth.metrics?.stealthKillsAccumulated ?? "unknown"}`,
    `  Melee kills accumulated: ${manualGroundTruth.metrics?.meleeKillsAccumulated ?? "unknown"}`,
    `  Old Reliable qualifying kills: ${manualGroundTruth.metrics?.oldReliableQualifyingCraftedWeaponKills ?? "unknown"}/${manualGroundTruth.metrics?.oldReliableRequiredKills ?? 200}`,
    `  Bike-repair scrap applied: ${manualGroundTruth.metrics?.bikeRepairScrapApplied ?? "unknown"}`,
    "  Source: supplied manually by the runner; not inferred by OCR."
  ] : ["  No manual session totals were supplied for this recording."]),
  "",
  "FAILURES",
  ...(failures.length ? failures.map((item) => `  - ${item}`) : ["  None"]),
  "",
  "WARNINGS",
  ...(warnings.length ? warnings.map((item) => `  - ${item}`) : ["  None"]),
  "",
  status === "FAIL"
    ? "Do not trust automatic pickup OCR tomorrow; use the missed panel until a corrected regression passes."
    : status === "WARN"
      ? "Usable for tomorrow with the missed panel as the manual safety net."
      : "Pickup OCR is ready for tomorrow; keep the missed panel available as the safety net.",
  ""
];

fs.mkdirSync(path.dirname(outputJson), { recursive: true });
fs.writeFileSync(outputJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.writeFileSync(outputText, `${lines.join("\r\n")}\r\n`, "utf8");
console.log(JSON.stringify({ outputJson, outputText, status, collectibles: collectibleCount, ipca: ipcaCount }, null, 2));
