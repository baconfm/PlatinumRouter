const fs = require("fs");
const path = require("path");

const ROOTS = [
  __dirname,
  path.join(__dirname, "PlatinumRouter-main"),
].filter((dir, index, arr) => fs.existsSync(dir) && arr.indexOf(dir) === index);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "assets",
  "images",
  "screenshots",
  "debug-crops",
]);

const LOG_EXTS = new Set([".json", ".jsonl", ".log", ".txt", ".csv"]);
const LIKELY_NAME = /(days|gone|ocr|run|log|missed|dashboard|event|session|route|split)/i;
const CONTENT_HINT = /(days\s*gone|crowberry|herbology|nero|ocr|trophy|mobile medical|researcher|flight data|recording|old wagon|peter skene|ipca|injector|finders keepers|playing doctor|mission passed)/i;

const TARGETS = [
  "crowberry",
  "mayweed",
  "mountain sorrel",
  "black currant",
  "wood lily",
  "bitterroot",
  "bistort",
  "silverweed",
  "salmon berry",
  "old wagon motel",
  "peter skene",
  "fur trade warrior",
  "nero",
  "nero intel",
  "mobile medical",
  "researcher field note",
  "flight data",
  "field recording",
  "ipca",
  "injector",
  "trophy earned",
  "finders keepers",
  "playing doctor",
  "without a scratch",
  "mission passed",
  "horde",
  "ambush",
  "camp",
  "infestation",
];

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name.toLowerCase())) walk(full, out);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!LOG_EXTS.has(ext)) continue;
    if (!LIKELY_NAME.test(entry.name) && !full.toLowerCase().includes("log")) continue;

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size === 0 || stat.size > 80 * 1024 * 1024) continue;
    out.push({ file: full, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out;
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function flatten(value, pathLabel = "", out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push({ path: pathLabel, text: String(value) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${pathLabel}[${i}]`, out));
    return out;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const compact = {};
    for (const key of keys) {
      if (typeof value[key] === "string" || typeof value[key] === "number" || typeof value[key] === "boolean" || value[key] == null) {
        compact[key] = value[key];
      }
    }
    const compactText = Object.entries(compact)
      .map(([k, v]) => `${k}=${v}`)
      .join(" | ");
    if (compactText) out.push({ path: pathLabel || "object", text: compactText });
    for (const key of keys) flatten(value[key], pathLabel ? `${pathLabel}.${key}` : key, out);
  }
  return out;
}

function parseEntries(file, content) {
  const ext = path.extname(file).toLowerCase();
  const entries = [];

  if (ext === ".json") {
    try {
      const parsed = JSON.parse(content);
      return flatten(parsed).map((entry) => ({ ...entry, file }));
    } catch {
      // fall through to text mode
    }
  }

  if (ext === ".jsonl") {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        flatten(parsed, `line:${index + 1}`).forEach((entry) => entries.push({ ...entry, file }));
      } catch {
        entries.push({ path: `line:${index + 1}`, text: trimmed, file });
      }
    });
    return entries;
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed) entries.push({ path: `line:${index + 1}`, text: trimmed, file });
  });
  return entries;
}

function norm(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractTime(text) {
  const hhmmss = text.match(/\b(\d{1,2}):([0-5]\d):([0-5]\d)(?:\.\d+)?\b/);
  if (hhmmss) return hhmmss[0];
  const iso = text.match(/\b20\d\d-\d\d-\d\d[t ][0-2]\d:[0-5]\d:[0-5]\d/i);
  if (iso) return iso[0].replace("T", " ");
  const ms = text.match(/\b(?:elapsed|time|timer|runTime|timestamp|t|ms)=([0-9]{4,})\b/i);
  if (ms) return ms[1];
  return "";
}

function short(text, max = 220) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function bucketFiles() {
  const candidates = [];
  ROOTS.forEach((root) => walk(root, candidates));
  const unique = new Map();
  candidates.forEach((item) => unique.set(item.file.toLowerCase(), item));
  return [...unique.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const files = bucketFiles();
const considered = [];
const matchingEntries = [];
const allEntriesByFile = new Map();

for (const fileInfo of files) {
  const content = safeRead(fileInfo.file);
  if (!content || !CONTENT_HINT.test(content)) continue;

  const entries = parseEntries(fileInfo.file, content);
  const hits = entries.filter((entry) => CONTENT_HINT.test(entry.text));
  if (!hits.length) continue;

  considered.push(fileInfo);
  allEntriesByFile.set(fileInfo.file, entries);
  matchingEntries.push(...hits.map((entry) => ({ ...entry, time: extractTime(entry.text) })));
}

const targetHits = {};
for (const target of TARGETS) targetHits[target] = [];

for (const [file, entries] of allEntriesByFile.entries()) {
  for (const entry of entries) {
    const n = norm(entry.text);
    for (const target of TARGETS) {
      if (n.includes(norm(target))) {
        targetHits[target].push({ file, path: entry.path, time: extractTime(entry.text), text: short(entry.text) });
      }
    }
  }
}

const trophyTitleCounts = new Map();
const trophySamples = [];
for (const hit of targetHits["trophy earned"] || []) {
  const text = hit.text;
  let title = "";
  const titleMatch = text.match(/(?:title|name|label|matched|objective|target)=([^|]+)/i);
  if (titleMatch) title = titleMatch[1].trim();
  const near = text.match(/([A-Z][A-Za-z0-9' -]{3,40})\s+Trophy earned/i);
  if (!title && near) title = near[1].trim();
  if (!title) title = "trophy earned";
  const key = norm(title);
  trophyTitleCounts.set(key, (trophyTitleCounts.get(key) || 0) + 1);
  if (trophySamples.length < 24) trophySamples.push(hit);
}

const duplicateTrophies = [...trophyTitleCounts.entries()]
  .filter(([, count]) => count > 1)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);

const suspiciousOcr = matchingEntries
  .filter((entry) => {
    const t = entry.text;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    const odd = (t.match(/[~`@#$%^*_={}[\]\\|<>]/g) || []).length;
    return /ocr|text|raw|crop|recognized/i.test(t) && (odd >= 4 || letters < 12 || t.length > 180);
  })
  .slice(0, 40);

const recentFiles = considered.slice(0, 20).map((info) => {
  const date = new Date(info.mtimeMs).toISOString().replace("T", " ").slice(0, 19);
  return `- ${date} | ${(info.size / 1024).toFixed(1)} KB | ${path.relative(__dirname, info.file)}`;
});

function sectionForTarget(target) {
  const hits = targetHits[target] || [];
  const lines = [];
  lines.push(`### ${target}`);
  lines.push(`Hits: ${hits.length}`);
  hits.slice(0, 10).forEach((hit) => {
    lines.push(`- ${hit.time ? `${hit.time} | ` : ""}${path.relative(__dirname, hit.file)} | ${hit.path} | ${hit.text}`);
  });
  if (hits.length > 10) lines.push(`- ... ${hits.length - 10} more`);
  lines.push("");
  return lines.join("\n");
}

const likelyMisses = [
  "crowberry",
  "mayweed",
  "nero intel",
  "mobile medical",
  "researcher field note",
  "flight data",
  "peter skene",
  "old wagon motel",
].map((target) => ({ target, count: (targetHits[target] || []).length }));

const md = [];
md.push("# Days Gone Log Pass");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push(`Roots scanned: ${ROOTS.map((root) => `\`${root}\``).join(", ")}`);
md.push(`Candidate log files with Days Gone/OCR signals: ${considered.length}`);
md.push("");
md.push("## Most Recent Matching Files");
md.push(recentFiles.length ? recentFiles.join("\n") : "- No matching local log files found.");
md.push("");
md.push("## Quick Counts");
md.push("");
md.push("| Signal | Hits |");
md.push("|---|---:|");
likelyMisses.forEach(({ target, count }) => md.push(`| ${target} | ${count} |`));
md.push(`| trophy earned | ${(targetHits["trophy earned"] || []).length} |`);
md.push(`| mission passed | ${(targetHits["mission passed"] || []).length} |`);
md.push("");
md.push("## Duplicate Trophy-Like Signals");
if (duplicateTrophies.length) {
  duplicateTrophies.forEach(([title, count]) => md.push(`- ${title}: ${count}`));
} else {
  md.push("- No repeated trophy-title groups found in parsed text.");
}
md.push("");
md.push("## Trophy Samples");
if (trophySamples.length) {
  trophySamples.forEach((hit) => md.push(`- ${hit.time ? `${hit.time} | ` : ""}${path.relative(__dirname, hit.file)} | ${hit.text}`));
} else {
  md.push("- No trophy samples found.");
}
md.push("");
md.push("## Suspicious OCR / Noise Samples");
if (suspiciousOcr.length) {
  suspiciousOcr.forEach((hit) => md.push(`- ${hit.time ? `${hit.time} | ` : ""}${path.relative(__dirname, hit.file)} | ${hit.text}`));
} else {
  md.push("- No obvious gibberish OCR samples matched the simple noise detector.");
}
md.push("");
md.push("## Target Detail");
[
  "crowberry",
  "mayweed",
  "black currant",
  "mountain sorrel",
  "wood lily",
  "salmon berry",
  "nero",
  "nero intel",
  "mobile medical",
  "researcher field note",
  "flight data",
  "field recording",
  "ipca",
  "injector",
  "mission passed",
].forEach((target) => md.push(sectionForTarget(target)));

fs.writeFileSync(path.join(__dirname, "_codex_daysgone_log_summary.md"), md.join("\n"), "utf8");
fs.writeFileSync(
  path.join(__dirname, "_codex_daysgone_log_summary.json"),
  JSON.stringify({ considered, targetHits, duplicateTrophies, suspiciousOcr }, null, 2),
  "utf8"
);
fs.writeFileSync(
  path.join(__dirname, "_codex_daysgone_log_topline.txt"),
  [
    `files=${considered.length}`,
    `crowberry=${(targetHits.crowberry || []).length}`,
    `mayweed=${(targetHits.mayweed || []).length}`,
    `neroIntel=${(targetHits["nero intel"] || []).length}`,
    `mobileMedical=${(targetHits["mobile medical"] || []).length}`,
    `trophyEarned=${(targetHits["trophy earned"] || []).length}`,
    `missionPassed=${(targetHits["mission passed"] || []).length}`,
    `duplicateTrophyGroups=${duplicateTrophies.length}`,
  ].join("\n"),
  "utf8"
);
