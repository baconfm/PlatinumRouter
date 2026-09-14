const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "PlatinumRouter-main");
const outFile = path.join(__dirname, "_codex_log_candidates.txt");
const skipDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  "cache",
  "assets",
  "debug-crops",
  "screenshots",
]);
const wantedExt = new Set([".json", ".jsonl", ".log", ".txt", ".csv"]);
const nameRx = /(days.?gone|ocr|run|screen.?tracker|missed|dashboard|event|log)/i;
const hits = [];

function walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!skipDirs.has(ent.name)) walk(full, depth + 1);
      continue;
    }

    const ext = path.extname(ent.name).toLowerCase();
    if (!wantedExt.has(ext) || !nameRx.test(full)) continue;

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size <= 0) continue;
    hits.push({ full, size: stat.size, mtime: stat.mtime });
  }
}

walk(root);
hits.sort((a, b) => b.mtime - a.mtime);

const lines = hits
  .slice(0, 200)
  .map((h) => `${h.mtime.toISOString()} | ${h.size} | ${h.full}`);

fs.writeFileSync(outFile, lines.join("\n"), "utf8");
console.log(`wrote ${Math.min(hits.length, 200)} of ${hits.length} candidates`);
