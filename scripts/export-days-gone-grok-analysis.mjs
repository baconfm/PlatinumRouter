import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const projectRoot = path.resolve(import.meta.dirname, "..");
const configPath = path.join(projectRoot, "data", "days-gone", "run-comparisons.json");
const outputDir = path.join(
  projectRoot,
  "outputs",
  "analysis",
  "days-gone",
  "grok-analysis-package-20260724"
);

const categoryLabels = {
  charactercollectibles: "Character collectibles",
  tourism: "Tourism",
  herbology: "Herbology",
  nerointel: "NERO intel",
  radiofreeoregon: "Radio Free Oregon",
  rippersermons: "RIP sermons",
  historical: "Historical markers",
  songs: "Camp songs",
  sarahlabnotes: "Sarah lab notes",
  encampmentjobs: "Camp jobs",
  infestations: "Infestations",
  hordes: "Hordes",
  ambushcamps: "Ambush camps",
  nerosites: "NERO checkpoints"
};

function secondsToClock(value) {
  if (!Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const seconds = Math.round(Math.abs(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers, rows) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\r\n") + "\r\n";
}

function categoryLabel(key) {
  return categoryLabels[key] || key || "Unknown";
}

function relativeUrlToPath(url) {
  return path.join(projectRoot, url.replace(/^\.\//, "").replaceAll("/", path.sep));
}

function configuredAnchor(config, runId) {
  const anchor = config.anchors.find((item) => item.id === config.defaultAnchor);
  return Number(anchor?.timestamps?.[runId]) || 0;
}

function routeProgress(timestamp, anchor, duration) {
  if (!Number.isFinite(timestamp) || duration <= anchor) return null;
  return ((timestamp - anchor) / (duration - anchor)) * 100;
}

function runRankedMatches(progress, anchor) {
  return [...(progress.matches || [])]
    .filter((match) => Number(match.timestamp) >= anchor)
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .map((match, index) => ({ ...match, routeOrder: index + 1 }));
}

function activityMatches(model) {
  return Object.entries(model.categories || {}).flatMap(([categoryKey, category]) =>
    (category.matches || []).map((match) => ({ ...match, categoryKey }))
  );
}

function inferredEvidence(match, progress) {
  if (match.evidence) return match.evidence;
  if (progress.summary?.duplicateSightings === 0 && !progress.scan?.fps) return "historical OCR";
  return "scanned OCR";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeCsv(name, headers, rows) {
  const csv = toCsv(headers, rows);
  const target = path.join(outputDir, name);
  await fs.writeFile(target, csv, "utf8");

  // Import every finished CSV through artifact-tool so malformed quoting,
  // inconsistent row widths, or unreadable tables fail before delivery.
  const workbook = await Workbook.fromCSV(csv, { sheetName: "Data" });
  const inspected = await workbook.inspect({
    kind: "table",
    range: `Data!A1:${columnName(headers.length)}${Math.min(rows.length + 1, 8)}`,
    include: "values",
    tableMaxRows: 8,
    tableMaxCols: Math.min(headers.length, 30),
    maxChars: 3000
  });
  if (!inspected?.ndjson) throw new Error(`artifact-tool could not inspect ${name}`);
  return { name, rows: rows.length, columns: headers.length };
}

function columnName(count) {
  let value = count;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

await fs.mkdir(outputDir, { recursive: true });
const config = await readJson(configPath);
const runs = [];

for (const runConfig of config.runs) {
  const run = await readJson(relativeUrlToPath(runConfig.runUrl));
  const model = await readJson(relativeUrlToPath(runConfig.modelUrl));
  const collectibles = await readJson(relativeUrlToPath(runConfig.collectibleProgressUrl));
  const anchor = configuredAnchor(config, runConfig.id);
  const rankedCollectibles = runRankedMatches(collectibles, anchor);
  const rankedById = new Map(rankedCollectibles.map((match) => [match.id, match]));
  runs.push({
    ...runConfig,
    run,
    model,
    collectibles,
    anchor,
    rankedCollectibles,
    rankedById,
    activityMatches: activityMatches(model)
  });
}

const files = [];

files.push(await writeCsv(
  "00_grok_instructions.csv",
  ["step", "priority", "instruction"],
  [
    { step: 1, priority: "critical", instruction: "Treat timestamps as seconds from the start of the source recording. Use time_from_leon_s for fair comparisons because all runs are aligned at Leon / Finders Keepers." },
    { step: 2, priority: "critical", instruction: "Do not equate a missing OCR detection with an activity or collectible not being completed. Missing rows are scan-review targets." },
    { step: 3, priority: "critical", instruction: "Jul 18 uses historical OCR and has higher catalog coverage. Separate likely route advantages from scan-coverage advantages." },
    { step: 4, priority: "high", instruction: "Prefer comparisons supported by the same named item in at least two runs. Three-run shared items are the strongest timing evidence." },
    { step: 5, priority: "high", instruction: "Flag suspicious timestamps and order shifts instead of silently using them. Large isolated jumps can be OCR misidentification." },
    { step: 6, priority: "high", instruction: "Analyze route sections, clusters, and sustained trajectory changes. A single early pickup is not automatically a route improvement." },
    { step: 7, priority: "medium", instruction: "Use route_progress_pct for normalized trajectory charts, and time_from_leon_s for actual time-save calculations." },
    { step: 8, priority: "medium", instruction: "Cumulative trophies such as Old Reliable measure progress built over the whole run. Their popup time is not a standalone split." },
    { step: 9, priority: "medium", instruction: "Prioritize actionable routing findings: earlier clusters, avoidable revisits, late cleanup blocks, reordered activities, and collectible density between shared milestones." },
    { step: 10, priority: "output", instruction: "Return findings with item names, run names, timestamps, estimated time impact, confidence, and the exact CSV rows or columns used." }
  ]
));

files.push(await writeCsv(
  "01_run_summary.csv",
  [
    "run_id", "run_label", "run_kind", "duration_s", "duration_clock", "leon_anchor_s",
    "collectibles_detected", "collectible_catalog", "collectible_coverage_pct",
    "collectibles_after_leon", "activity_popups_matched", "activity_popups_unresolved",
    "source_parts", "collectible_scan_created_at", "activity_model_created_at"
  ],
  runs.map((item) => ({
    run_id: item.id,
    run_label: item.label,
    run_kind: item.kind,
    duration_s: item.run.totalDurationSeconds,
    duration_clock: secondsToClock(item.run.totalDurationSeconds),
    leon_anchor_s: item.anchor,
    collectibles_detected: item.collectibles.summary.detectedCollectibles,
    collectible_catalog: item.collectibles.summary.catalogItems,
    collectible_coverage_pct: item.collectibles.summary.coveragePercent,
    collectibles_after_leon: item.rankedCollectibles.length,
    activity_popups_matched: item.model.summary?.matchedEpisodes ?? item.activityMatches.length,
    activity_popups_unresolved: item.model.summary?.unresolvedEpisodes ?? item.model.unresolvedEpisodes?.length ?? 0,
    source_parts: item.run.parts?.length || 0,
    collectible_scan_created_at: item.collectibles.createdAt,
    activity_model_created_at: item.model.createdAt
  }))
));

const collectibleCatalog = new Map();
for (const item of runs) {
  for (const match of item.collectibles.matches || []) collectibleCatalog.set(match.id, match);
  for (const missing of item.collectibles.missingCatalogItems || []) {
    if (!collectibleCatalog.has(missing.id)) collectibleCatalog.set(missing.id, missing);
  }
}

const masterCollectibleRows = [...collectibleCatalog.values()]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((catalogItem) => {
    const row = {
      collectible_id: catalogItem.id,
      collectible_title: catalogItem.title,
      category_key: catalogItem.counterKey,
      category: categoryLabel(catalogItem.counterKey)
    };
    const detected = [];
    for (const item of runs) {
      const match = (item.collectibles.matches || []).find((candidate) => candidate.id === catalogItem.id);
      const ranked = item.rankedById.get(catalogItem.id);
      const prefix = item.id.replaceAll("-", "_");
      row[`${prefix}_detected`] = Boolean(match);
      row[`${prefix}_timestamp_s`] = match?.timestamp ?? "";
      row[`${prefix}_timestamp_clock`] = match ? secondsToClock(match.timestamp) : "";
      row[`${prefix}_time_from_leon_s`] = match ? Number(match.timestamp) - item.anchor : "";
      row[`${prefix}_time_from_leon_clock`] = match ? secondsToClock(Number(match.timestamp) - item.anchor) : "";
      row[`${prefix}_route_progress_pct`] = match
        ? Number(routeProgress(Number(match.timestamp), item.anchor, Number(item.run.totalDurationSeconds)).toFixed(4))
        : "";
      row[`${prefix}_route_order`] = ranked?.routeOrder ?? "";
      row[`${prefix}_score`] = match?.score ?? "";
      row[`${prefix}_evidence`] = match ? inferredEvidence(match, item.collectibles) : "missing from OCR";
      if (match) detected.push({ run: item.label, aligned: Number(match.timestamp) - item.anchor });
    }
    detected.sort((a, b) => a.aligned - b.aligned);
    row.detected_run_count = detected.length;
    row.earliest_run = detected[0]?.run || "";
    row.earliest_time_from_leon_s = detected[0]?.aligned ?? "";
    row.earliest_time_from_leon_clock = detected[0] ? secondsToClock(detected[0].aligned) : "";
    row.earliest_margin_to_second_s = detected.length > 1 ? detected[1].aligned - detected[0].aligned : "";
    return row;
  });

const masterCollectibleHeaders = [
  "collectible_id", "collectible_title", "category_key", "category",
  ...runs.flatMap((item) => {
    const prefix = item.id.replaceAll("-", "_");
    return [
      `${prefix}_detected`, `${prefix}_timestamp_s`, `${prefix}_timestamp_clock`,
      `${prefix}_time_from_leon_s`, `${prefix}_time_from_leon_clock`,
      `${prefix}_route_progress_pct`, `${prefix}_route_order`, `${prefix}_score`, `${prefix}_evidence`
    ];
  }),
  "detected_run_count", "earliest_run", "earliest_time_from_leon_s",
  "earliest_time_from_leon_clock", "earliest_margin_to_second_s"
];
files.push(await writeCsv("02_collectibles_master_comparison.csv", masterCollectibleHeaders, masterCollectibleRows));

const collectibleEventRows = runs.flatMap((item) =>
  [...(item.collectibles.matches || [])]
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .map((match, index) => ({
      run_id: item.id,
      run_label: item.label,
      collectible_id: match.id,
      collectible_title: match.title,
      category_key: match.counterKey,
      category: categoryLabel(match.counterKey),
      timestamp_s: match.timestamp,
      timestamp_clock: secondsToClock(match.timestamp),
      time_from_leon_s: Number(match.timestamp) - item.anchor,
      time_from_leon_clock: secondsToClock(Number(match.timestamp) - item.anchor),
      route_progress_pct: Number(routeProgress(Number(match.timestamp), item.anchor, Number(item.run.totalDurationSeconds)).toFixed(4)),
      chronological_order: index + 1,
      route_order_after_leon: item.rankedById.get(match.id)?.routeOrder ?? "",
      score: match.score ?? "",
      evidence: inferredEvidence(match, item.collectibles),
      detected_count: match.detectedCount ?? 1,
      observed_text: match.observedText || ""
    }))
);
files.push(await writeCsv(
  "03_collectible_events.csv",
  [
    "run_id", "run_label", "collectible_id", "collectible_title", "category_key", "category",
    "timestamp_s", "timestamp_clock", "time_from_leon_s", "time_from_leon_clock",
    "route_progress_pct", "chronological_order", "route_order_after_leon", "score",
    "evidence", "detected_count", "observed_text"
  ],
  collectibleEventRows
));

const categoryKeys = [...new Set(masterCollectibleRows.map((row) => row.category_key))].sort();
const categorySummaryRows = [];
for (const item of runs) {
  for (const key of categoryKeys) {
    const catalogCount = masterCollectibleRows.filter((row) => row.category_key === key).length;
    const detected = (item.collectibles.matches || []).filter((match) => match.counterKey === key).length;
    categorySummaryRows.push({
      run_id: item.id,
      run_label: item.label,
      category_key: key,
      category: categoryLabel(key),
      detected,
      catalog_count: catalogCount,
      coverage_pct: catalogCount ? Number(((detected / catalogCount) * 100).toFixed(2)) : 0,
      missing: catalogCount - detected
    });
  }
}
files.push(await writeCsv(
  "04_collectible_category_summary.csv",
  ["run_id", "run_label", "category_key", "category", "detected", "catalog_count", "coverage_pct", "missing"],
  categorySummaryRows
));

const progressionRows = [];
for (const pct of Array.from({ length: 21 }, (_, index) => index * 5)) {
  for (const item of runs) {
    const count = item.rankedCollectibles.filter((match) =>
      routeProgress(Number(match.timestamp), item.anchor, Number(item.run.totalDurationSeconds)) <= pct
    ).length;
    progressionRows.push({
      route_progress_pct: pct,
      run_id: item.id,
      run_label: item.label,
      collectibles_detected_by_point: count,
      share_of_run_detected_collectibles_pct: item.rankedCollectibles.length
        ? Number(((count / item.rankedCollectibles.length) * 100).toFixed(2))
        : 0
    });
  }
}
files.push(await writeCsv(
  "05_collectible_progression_curve.csv",
  [
    "route_progress_pct", "run_id", "run_label", "collectibles_detected_by_point",
    "share_of_run_detected_collectibles_pct"
  ],
  progressionRows
));

const missingRows = runs.flatMap((item) =>
  (item.collectibles.missingCatalogItems || []).map((missing) => ({
    run_id: item.id,
    run_label: item.label,
    collectible_id: missing.id,
    collectible_title: missing.title,
    category_key: missing.counterKey,
    category: categoryLabel(missing.counterKey),
    interpretation: "OCR did not confirm this item; do not assume the runner skipped it"
  }))
);
files.push(await writeCsv(
  "06_missing_collectible_detections.csv",
  ["run_id", "run_label", "collectible_id", "collectible_title", "category_key", "category", "interpretation"],
  missingRows
));

const duplicateRows = runs.flatMap((item) =>
  (item.collectibles.duplicateSightings || []).map((duplicate) => ({
    run_id: item.id,
    run_label: item.label,
    collectible_id: duplicate.id,
    collectible_title: duplicate.title,
    timestamp_s: duplicate.timestamp,
    timestamp_clock: secondsToClock(duplicate.timestamp),
    time_from_leon_s: Number(duplicate.timestamp) - item.anchor,
    score: duplicate.score ?? "",
    observed_text: duplicate.observedText || ""
  }))
);
files.push(await writeCsv(
  "07_duplicate_collectible_sightings.csv",
  [
    "run_id", "run_label", "collectible_id", "collectible_title", "timestamp_s",
    "timestamp_clock", "time_from_leon_s", "score", "observed_text"
  ],
  duplicateRows
));

const activityRows = runs.flatMap((item) =>
  [...item.activityMatches]
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    .map((match, index) => ({
      run_id: item.id,
      run_label: item.label,
      category_key: match.categoryKey,
      category: categoryLabel(match.categoryKey),
      canonical_title: match.canonicalTitle,
      timestamp_s: match.timestamp,
      timestamp_clock: secondsToClock(match.timestamp),
      time_from_leon_s: Number(match.timestamp) - item.anchor,
      time_from_leon_clock: secondsToClock(Number(match.timestamp) - item.anchor),
      route_progress_pct: Number(routeProgress(Number(match.timestamp), item.anchor, Number(item.run.totalDurationSeconds)).toFixed(4)),
      chronological_order: index + 1,
      score: match.score ?? "",
      counts_toward_counter: match.countsTowardCounter ?? "",
      observed_text: match.observedText || ""
    }))
);
files.push(await writeCsv(
  "08_activity_completion_events.csv",
  [
    "run_id", "run_label", "category_key", "category", "canonical_title", "timestamp_s",
    "timestamp_clock", "time_from_leon_s", "time_from_leon_clock", "route_progress_pct",
    "chronological_order", "score", "counts_toward_counter", "observed_text"
  ],
  activityRows
));

const activityKeys = new Map();
for (const item of runs) {
  for (const match of item.activityMatches) {
    activityKeys.set(`${match.categoryKey}\u0000${match.canonicalTitle}`, {
      categoryKey: match.categoryKey,
      title: match.canonicalTitle
    });
  }
}
const activityComparisonRows = [...activityKeys.values()]
  .sort((a, b) => a.categoryKey.localeCompare(b.categoryKey) || a.title.localeCompare(b.title))
  .map((activity) => {
    const row = {
      category_key: activity.categoryKey,
      category: categoryLabel(activity.categoryKey),
      canonical_title: activity.title
    };
    const detected = [];
    for (const item of runs) {
      const matches = item.activityMatches
        .filter((match) => match.categoryKey === activity.categoryKey && match.canonicalTitle === activity.title)
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
      const match = matches[0];
      const prefix = item.id.replaceAll("-", "_");
      row[`${prefix}_detected`] = Boolean(match);
      row[`${prefix}_timestamp_s`] = match?.timestamp ?? "";
      row[`${prefix}_timestamp_clock`] = match ? secondsToClock(match.timestamp) : "";
      row[`${prefix}_time_from_leon_s`] = match ? Number(match.timestamp) - item.anchor : "";
      row[`${prefix}_route_progress_pct`] = match
        ? Number(routeProgress(Number(match.timestamp), item.anchor, Number(item.run.totalDurationSeconds)).toFixed(4))
        : "";
      row[`${prefix}_score`] = match?.score ?? "";
      if (match) detected.push({ run: item.label, aligned: Number(match.timestamp) - item.anchor });
    }
    detected.sort((a, b) => a.aligned - b.aligned);
    row.detected_run_count = detected.length;
    row.earliest_run = detected[0]?.run || "";
    row.earliest_time_from_leon_s = detected[0]?.aligned ?? "";
    row.earliest_margin_to_second_s = detected.length > 1 ? detected[1].aligned - detected[0].aligned : "";
    return row;
  });
const activityComparisonHeaders = [
  "category_key", "category", "canonical_title",
  ...runs.flatMap((item) => {
    const prefix = item.id.replaceAll("-", "_");
    return [
      `${prefix}_detected`, `${prefix}_timestamp_s`, `${prefix}_timestamp_clock`,
      `${prefix}_time_from_leon_s`, `${prefix}_route_progress_pct`, `${prefix}_score`
    ];
  }),
  "detected_run_count", "earliest_run", "earliest_time_from_leon_s", "earliest_margin_to_second_s"
];
files.push(await writeCsv("09_activity_master_comparison.csv", activityComparisonHeaders, activityComparisonRows));

const unresolvedRows = runs.flatMap((item) =>
  (item.model.unresolvedEpisodes || []).map((episode) => ({
    run_id: item.id,
    run_label: item.label,
    episode_id: episode.id,
    timestamp_s: episode.timestamp,
    timestamp_clock: secondsToClock(episode.timestamp),
    time_from_leon_s: Number(episode.timestamp) - item.anchor,
    primary_title: episode.primaryTitle || "",
    interpretation: "Unresolved center-screen popup; possible missed mission/activity or visual false positive"
  }))
);
files.push(await writeCsv(
  "10_unresolved_activity_popups.csv",
  [
    "run_id", "run_label", "episode_id", "timestamp_s", "timestamp_clock",
    "time_from_leon_s", "primary_title", "interpretation"
  ],
  unresolvedRows
));

const trophyRows = [];
for (const item of runs) {
  for (const candidate of item.collectibles.ocrCandidates || []) {
    if (!/trophy earned|finders keepers|old reliable|ghost of farewell/i.test(candidate.observedText || "")) continue;
    trophyRows.push({
      run_id: item.id,
      run_label: item.label,
      timestamp_s: candidate.timestamp,
      timestamp_clock: secondsToClock(candidate.timestamp),
      time_from_leon_s: Number(candidate.timestamp) - item.anchor,
      observed_text: candidate.observedText || "",
      closest_collectible_id: candidate.closestId || "",
      closest_collectible_title: candidate.closestTitle || "",
      score: candidate.score ?? "",
      accepted_as_collectible: candidate.accepted ?? false,
      source: "collectible OCR candidate"
    });
  }
}
for (const milestone of config.milestones || []) {
  for (const item of runs) {
    const timestamp = milestone.timestamps?.[item.id];
    if (!Number.isFinite(timestamp)) continue;
    trophyRows.push({
      run_id: item.id,
      run_label: item.label,
      timestamp_s: timestamp,
      timestamp_clock: secondsToClock(timestamp),
      time_from_leon_s: timestamp - item.anchor,
      observed_text: milestone.label,
      closest_collectible_id: "",
      closest_collectible_title: "",
      score: "",
      accepted_as_collectible: false,
      source: `confirmed dashboard milestone; ${milestone.note || ""}`
    });
  }
}
trophyRows.sort((a, b) => a.run_id.localeCompare(b.run_id) || Number(a.timestamp_s) - Number(b.timestamp_s));
files.push(await writeCsv(
  "11_trophy_observations.csv",
  [
    "run_id", "run_label", "timestamp_s", "timestamp_clock", "time_from_leon_s",
    "observed_text", "closest_collectible_id", "closest_collectible_title", "score",
    "accepted_as_collectible", "source"
  ],
  trophyRows
));

const trophyNames = ["Finders Keepers", "Old Reliable", "Ghost of Farewell"];
const trophySummaryRows = [];
for (const item of runs) {
  for (const trophyName of trophyNames) {
    const sightings = trophyRows
      .filter((row) => row.run_id === item.id && new RegExp(trophyName, "i").test(row.observed_text))
      .sort((a, b) => Number(a.timestamp_s) - Number(b.timestamp_s));
    const sighting = sightings[0];
    trophySummaryRows.push({
      run_id: item.id,
      run_label: item.label,
      trophy_name: trophyName,
      detected: Boolean(sighting),
      earliest_timestamp_s: sighting?.timestamp_s ?? "",
      earliest_timestamp_clock: sighting ? secondsToClock(Number(sighting.timestamp_s)) : "",
      time_from_leon_s: sighting ? Number(sighting.timestamp_s) - item.anchor : "",
      supporting_sightings: sightings.length,
      source: sighting?.source || "",
      interpretation: trophyName === "Finders Keepers"
        ? "Shared alignment marker near the start of the run"
        : "Cumulative trophy marker; compare progression cautiously"
    });
  }
}
files.push(await writeCsv(
  "11a_trophy_summary.csv",
  [
    "run_id", "run_label", "trophy_name", "detected", "earliest_timestamp_s",
    "earliest_timestamp_clock", "time_from_leon_s", "supporting_sightings", "source", "interpretation"
  ],
  trophySummaryRows
));

const rawCandidateRows = runs.flatMap((item) =>
  (item.collectibles.ocrCandidates || []).map((candidate) => ({
    run_id: item.id,
    run_label: item.label,
    timestamp_s: candidate.timestamp,
    timestamp_clock: secondsToClock(candidate.timestamp),
    time_from_leon_s: Number(candidate.timestamp) - item.anchor,
    observed_text: candidate.observedText || "",
    closest_collectible_id: candidate.closestId || "",
    closest_collectible_title: candidate.closestTitle || "",
    score: candidate.score ?? "",
    accepted: candidate.accepted ?? false,
    gate_max_transitions: candidate.gate?.maxTransitions ?? "",
    gate_strong_rows: candidate.gate?.strongRows ?? "",
    gate_bright_ratio: candidate.gate?.brightRatio ?? "",
    gate_dark_ratio: candidate.gate?.darkRatio ?? ""
  }))
);
files.push(await writeCsv(
  "12_raw_collectible_ocr_candidates.csv",
  [
    "run_id", "run_label", "timestamp_s", "timestamp_clock", "time_from_leon_s",
    "observed_text", "closest_collectible_id", "closest_collectible_title", "score",
    "accepted", "gate_max_transitions", "gate_strong_rows", "gate_bright_ratio", "gate_dark_ratio"
  ],
  rawCandidateRows
));

const partRows = runs.flatMap((item) =>
  (item.run.parts || []).map((part) => ({
    run_id: item.id,
    run_label: item.label,
    part: part.part,
    source_file_name: path.basename(part.file || ""),
    duration_s: part.durationSeconds,
    duration_clock: secondsToClock(part.durationSeconds),
    timeline_offset_s: part.timelineOffsetSeconds,
    timeline_offset_clock: secondsToClock(part.timelineOffsetSeconds)
  }))
);
files.push(await writeCsv(
  "13_source_video_parts.csv",
  [
    "run_id", "run_label", "part", "source_file_name", "duration_s", "duration_clock",
    "timeline_offset_s", "timeline_offset_clock"
  ],
  partRows
));

files.push(await writeCsv(
  "14_analysis_questions.csv",
  ["question_id", "priority", "question"],
  [
    { question_id: "Q01", priority: 1, question: "Which sustained route sections give each run its largest collectible trajectory advantage after Leon / Finders Keepers?" },
    { question_id: "Q02", priority: 1, question: "Which collectible clusters are completed earlier in Jul 18 than both JamCar WR and Bacon PB, after controlling for OCR coverage?" },
    { question_id: "Q03", priority: 1, question: "Which JamCar activity order changes appear to save real time versus Bacon PB, and which should be adopted?" },
    { question_id: "Q04", priority: 1, question: "Identify likely OCR timestamp errors using isolated order jumps, low score, contradictory neighboring timestamps, or implausibly late early-game collectibles." },
    { question_id: "Q05", priority: 2, question: "Where do runs defer collectibles into late cleanup, and which of those pickups could be moved into an earlier nearby route section?" },
    { question_id: "Q06", priority: 2, question: "Compare camp jobs, hordes, infestations, ambush camps, and NERO checkpoint order. Find route sequences with fewer apparent revisits." },
    { question_id: "Q07", priority: 2, question: "Estimate plausible time saves for a hybrid route, but provide conservative and optimistic ranges and list the evidence behind each estimate." },
    { question_id: "Q08", priority: 2, question: "Find sections where Bacon PB is already best and should not be replaced by JamCar or Jul 18 routing." },
    { question_id: "Q09", priority: 3, question: "Assess whether earlier cumulative trophy progression is consistent with faster routing or merely different combat/collection choices." },
    { question_id: "Q10", priority: 3, question: "Produce a proposed hybrid route order and explicitly mark every recommendation that needs video review before adoption." }
  ]
));

files.push(await writeCsv(
  "15_data_dictionary.csv",
  ["file", "grain", "purpose", "important_cautions"],
  [
    { file: "01_run_summary.csv", grain: "one row per run", purpose: "Runtime, anchors, scan coverage and model totals", important_cautions: "Coverage differs between runs" },
    { file: "02_collectibles_master_comparison.csv", grain: "one row per catalog collectible", purpose: "Primary three-way timing, progress and order comparison", important_cautions: "Missing means not confirmed by OCR" },
    { file: "03_collectible_events.csv", grain: "one row per confirmed collectible detection", purpose: "Long-form event timeline for filtering and charts", important_cautions: "Use evidence and score columns" },
    { file: "04_collectible_category_summary.csv", grain: "one row per run and category", purpose: "Category-level coverage comparison", important_cautions: "Not a direct route-speed measure" },
    { file: "05_collectible_progression_curve.csv", grain: "one row per run per 5% route checkpoint", purpose: "Trajectory comparison", important_cautions: "Route progress is normalized by each recording duration" },
    { file: "06_missing_collectible_detections.csv", grain: "one row per run and missing catalog item", purpose: "Knowledge gaps and OCR review queue", important_cautions: "Do not label these as gameplay misses" },
    { file: "07_duplicate_collectible_sightings.csv", grain: "one row per duplicate OCR sighting", purpose: "Duplicate detection audit", important_cautions: "Not extra collectible pickups" },
    { file: "08_activity_completion_events.csv", grain: "one row per matched activity popup", purpose: "Missions, jobs, hordes, infestations, ambush camps and NERO event timeline", important_cautions: "Only recognized center popups" },
    { file: "09_activity_master_comparison.csv", grain: "one row per named activity", purpose: "Wide three-run completion comparison", important_cautions: "Use detected_run_count to judge evidence strength" },
    { file: "10_unresolved_activity_popups.csv", grain: "one row per unresolved center popup", purpose: "Potential missed activity titles and false positives", important_cautions: "Unconfirmed raw OCR" },
    { file: "11_trophy_observations.csv", grain: "one row per trophy-like OCR sighting or confirmed milestone", purpose: "Finders Keepers, Old Reliable, Ghost of Farewell and related evidence", important_cautions: "Cumulative trophies are progression markers, not standalone route splits" },
    { file: "11a_trophy_summary.csv", grain: "one row per run and selected trophy", purpose: "Deduplicated first sighting for Finders Keepers, Old Reliable and Ghost of Farewell", important_cautions: "Missing means no retained OCR evidence; cumulative trophies still need cautious interpretation" },
    { file: "12_raw_collectible_ocr_candidates.csv", grain: "one row per top-right OCR attempt retained by the scanner", purpose: "Full OCR audit and recovery work", important_cautions: "Large noisy file; analyze last" },
    { file: "13_source_video_parts.csv", grain: "one row per source recording part", purpose: "Translate global timestamps into recording parts", important_cautions: "File names only; local paths intentionally excluded" }
  ]
));

const manifestRows = files.map((file) => ({
  file: file.name,
  rows: file.rows,
  columns: file.columns,
  generated_at: new Date().toISOString()
}));
files.push(await writeCsv(
  "99_manifest.csv",
  ["file", "rows", "columns", "generated_at"],
  manifestRows
));

const readme = `DAYS GONE THREE-RUN ANALYSIS PACKAGE FOR GROK

Upload 00_grok_instructions.csv, 01_run_summary.csv, 02_collectibles_master_comparison.csv,
05_collectible_progression_curve.csv, 09_activity_master_comparison.csv, and
14_analysis_questions.csv first.

Add 03_collectible_events.csv and 08_activity_completion_events.csv when Grok needs
event-level evidence. Add missing, duplicate, unresolved, trophy, or raw OCR files only
when investigating uncertainty. The raw OCR file is intentionally last because it is noisy.

Suggested first prompt:

"Read 00_grok_instructions.csv and follow it as the analysis contract. Analyze all three
runs using 01, 02, 05, 09, and 14. Find sustained routing advantages, collectible-density
differences, order changes, and plausible time saves. Separate real route evidence from
OCR coverage differences. Cite exact item names, run labels, timestamps, and CSV columns.
Flag anything that needs video review rather than presenting it as fact."

The common timing anchor is Leon / Finders Keepers.
All *_time_from_leon_s fields are the preferred fair-comparison clock.
`;
await fs.writeFile(path.join(outputDir, "README_GROK_FIRST.txt"), readme, "utf8");

console.log(JSON.stringify({
  outputDir,
  files: [...files.map((file) => file.name), "README_GROK_FIRST.txt"],
  collectibleCatalogItems: masterCollectibleRows.length,
  collectibleEvents: collectibleEventRows.length,
  activityEvents: activityRows.length,
  rawOcrCandidates: rawCandidateRows.length
}, null, 2));
