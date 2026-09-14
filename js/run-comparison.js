const CONFIG_URL = "./data/days-gone/run-comparisons.json";

const CATEGORY_LABELS = {
  nerointel: "NERO Intel · story missions",
  charactercollectibles: "Character collectibles · story awards",
  radiofreeoregon: "Radio Free Oregon · story awards",
  colonelspeeches: "Colonel speeches · story awards",
  encampmentjobs: "Camp jobs",
  hordes: "Hordes",
  infestations: "Infestations",
  ambushcamps: "Ambush camps",
  nerosites: "NERO checkpoints",
  trophies: "Trophies",
  ipcatech: "IPCA Tech · pickup order"
};

const state = {
  runs: [],
  baselineId: "",
  comparisonId: "",
  category: "all",
  anchor: "recording-start",
  defaultAnchor: "recording-start",
  anchors: [],
  sort: "route",
  collectibleSort: "route",
  earliestCollectibleSort: "earliest"
};

const elements = {
  status: document.querySelector("#dataStatus"),
  dashboard: document.querySelector("#dashboard"),
  error: document.querySelector("#loadError"),
  baseline: document.querySelector("#baselineRun"),
  comparison: document.querySelector("#comparisonRun"),
  category: document.querySelector("#categoryFilter"),
  anchor: document.querySelector("#anchorSelect"),
  tableSort: document.querySelector("#tableSort"),
  collectibleTableSort: document.querySelector("#collectibleTableSort"),
  earliestCollectibleSort: document.querySelector("#earliestCollectibleSort"),
  summary: document.querySelector("#summaryMetrics"),
  scanHealth: document.querySelector("#scanHealth"),
  allRunLegend: document.querySelector("#allRunLegend"),
  allRunChart: document.querySelector("#allRunChart"),
  allRunCategoryBars: document.querySelector("#allRunCategoryBars"),
  legend: document.querySelector("#paceLegend"),
  chart: document.querySelector("#paceChart"),
  collectibleLegend: document.querySelector("#collectibleLegend"),
  collectibleChart: document.querySelector("#collectibleChart"),
  categoryBars: document.querySelector("#categoryBars"),
  baselineColumn: document.querySelector("#baselineColumn"),
  comparisonColumn: document.querySelector("#comparisonColumn"),
  rows: document.querySelector("#comparisonRows"),
  collectibleRunOneColumn: document.querySelector("#collectibleRunOneColumn"),
  collectibleRunTwoColumn: document.querySelector("#collectibleRunTwoColumn"),
  collectibleRunThreeColumn: document.querySelector("#collectibleRunThreeColumn"),
  collectibleRunTwoDeltaColumn: document.querySelector("#collectibleRunTwoDeltaColumn"),
  collectibleRunThreeDeltaColumn: document.querySelector("#collectibleRunThreeDeltaColumn"),
  collectibleSharedStatus: document.querySelector("#collectibleSharedStatus"),
  collectibleRows: document.querySelector("#collectibleComparisonRows"),
  earliestCollectibleSummary: document.querySelector("#earliestCollectibleSummary"),
  earliestCollectibleRows: document.querySelector("#earliestCollectibleRows"),
  collectiblePatternList: document.querySelector("#collectiblePatternList"),
  clusters: document.querySelector("#clusterComparison"),
  unique: document.querySelector("#uniqueEvents")
};

const chartZoomStates = new Map();

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mountZoomableChart(container, svg, key, width, height) {
  const zoom = chartZoomStates.get(key) || { scale: 1, x: 0, y: 0 };
  chartZoomStates.set(key, zoom);

  const viewport = document.createElement("div");
  viewport.className = "chartViewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Zoomable chart. Use the buttons or mouse wheel to zoom, then drag to pan.");

  const toolbar = document.createElement("div");
  toolbar.className = "chartZoomToolbar";
  toolbar.setAttribute("aria-label", "Chart zoom controls");

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "chartZoomButton";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "Zoom out");

  const zoomReadout = document.createElement("span");
  zoomReadout.className = "chartZoomReadout";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "chartZoomButton";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "chartZoomReset";
  reset.textContent = "Reset";

  const hint = document.createElement("span");
  hint.className = "chartZoomHint";
  hint.textContent = "Wheel to zoom · drag to pan";

  function applyViewBox() {
    const viewWidth = width / zoom.scale;
    const viewHeight = height / zoom.scale;
    zoom.x = clamp(zoom.x, 0, width - viewWidth);
    zoom.y = clamp(zoom.y, 0, height - viewHeight);
    svg.setAttribute("viewBox", `${zoom.x} ${zoom.y} ${viewWidth} ${viewHeight}`);
    zoomReadout.textContent = `${Math.round(zoom.scale * 100)}%`;
    zoomOut.disabled = zoom.scale <= 1;
    reset.disabled = zoom.scale <= 1;
    viewport.classList.toggle("isZoomed", zoom.scale > 1);
  }

  function setScale(nextScale, anchorX = width / 2, anchorY = height / 2) {
    const priorScale = zoom.scale;
    const priorWidth = width / priorScale;
    const priorHeight = height / priorScale;
    const next = clamp(nextScale, 1, 8);
    const ratioX = clamp((anchorX - zoom.x) / priorWidth, 0, 1);
    const ratioY = clamp((anchorY - zoom.y) / priorHeight, 0, 1);
    zoom.scale = next;
    zoom.x = anchorX - ratioX * (width / next);
    zoom.y = anchorY - ratioY * (height / next);
    applyViewBox();
  }

  function resetZoom() {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    applyViewBox();
  }

  zoomIn.addEventListener("click", () => setScale(zoom.scale * 1.5));
  zoomOut.addEventListener("click", () => setScale(zoom.scale / 1.5));
  reset.addEventListener("click", resetZoom);
  viewport.addEventListener("dblclick", resetZoom);
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    const viewWidth = width / zoom.scale;
    const viewHeight = height / zoom.scale;
    const anchorX = zoom.x + ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * viewWidth;
    const anchorY = zoom.y + ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * viewHeight;
    setScale(zoom.scale * (event.deltaY < 0 ? 1.25 : 0.8), anchorX, anchorY);
  }, { passive: false });

  let drag = null;
  viewport.addEventListener("pointerdown", (event) => {
    if (zoom.scale <= 1 || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, viewX: zoom.x, viewY: zoom.y };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("isPanning");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const bounds = viewport.getBoundingClientRect();
    zoom.x = drag.viewX - ((event.clientX - drag.x) / Math.max(1, bounds.width)) * (width / zoom.scale);
    zoom.y = drag.viewY - ((event.clientY - drag.y) / Math.max(1, bounds.height)) * (height / zoom.scale);
    applyViewBox();
  });
  const finishPan = () => {
    drag = null;
    viewport.classList.remove("isPanning");
  };
  viewport.addEventListener("pointerup", finishPan);
  viewport.addEventListener("pointercancel", finishPan);

  toolbar.append(zoomOut, zoomReadout, zoomIn, reset, hint);
  viewport.append(svg);
  container.replaceChildren(toolbar, viewport);
  applyViewBox();
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function formatDuration(seconds, includeSeconds = false) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  if (includeSeconds) return `${minutes}:${String(secs).padStart(2, "0")}`;
  return `${minutes}m`;
}

function formatAlignedTime(seconds) {
  const value = Math.round(Number(seconds) || 0);
  return `${value < 0 ? "−" : ""}${formatDuration(Math.abs(value), true)}`;
}

function formatDelta(seconds) {
  const value = Math.round(Number(seconds) || 0);
  const sign = value < 0 ? "−" : "+";
  const absolute = Math.abs(value);
  if (absolute >= 3600) return `${sign}${Math.floor(absolute / 3600)}h ${Math.floor((absolute % 3600) / 60)}m`;
  if (absolute >= 60) return `${sign}${Math.floor(absolute / 60)}m ${absolute % 60}s`;
  return `${sign}${absolute}s`;
}

function flattenMatches(model) {
  return Object.entries(model.categories || {}).flatMap(([category, details]) =>
    (details.matches || []).map((match) => ({
      ...match,
      category,
      categoryLabel: CATEGORY_LABELS[category] || category
    }))
  ).sort((a, b) => a.timestamp - b.timestamp);
}

function centerCounterKey(row) {
  return {
    "camp-job": "encampmentjobs",
    horde: "hordes",
    infestation: "infestations",
    "ambush-camp": "ambushcamps",
    nero: "nerosites"
  }[row.category] || row.counterKey || "missions";
}

function normalizedEvidenceText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function repairCollectibleEvidence(rows, ocrEpisodes) {
  const titleEpisodes = (ocrEpisodes || [])
    .filter((episode) => String(episode.regionId || "").startsWith("topRight"))
    .map((episode) => ({
      ...episode,
      timestamp: Number(episode.timestamp),
      normalizedText: normalizedEvidenceText(episode.observedText)
    }))
    .filter((episode) => Number.isFinite(episode.timestamp) && episode.normalizedText)
    .sort((a, b) => a.timestamp - b.timestamp);

  return rows.map((row) => {
    const normalizedTitle = normalizedEvidenceText(row.title || row.canonicalTitle || row.label);
    const exactEpisode = normalizedTitle
      ? titleEpisodes.find((episode) => episode.normalizedText.includes(normalizedTitle))
      : null;
    if (!exactEpisode) {
      return { ...row, timestamp: Number(row.timestamp), evidence: row.evidence || "fuzzy-title" };
    }
    return {
      ...row,
      timestamp: exactEpisode.timestamp,
      observedText: exactEpisode.observedText,
      evidence: "exact-title",
      originalTimestamp: Number(row.timestamp)
    };
  });
}

function normalizeBufferedResult(result, completionCatalog = {}) {
  const catalogCounts = Object.fromEntries(
    Object.entries(completionCatalog.categories || {}).map(([key, value]) => [key, value.titles?.length || 0])
  );
  const categories = {};
  const add = (category, match) => {
    if (!categories[category]) categories[category] = { matches: [] };
    categories[category].matches.push(match);
  };

  const centerRows = result.center?.matches || result.center?.raw || [];
  const knownCenterRows = centerRows.filter((row) => row.canonicalTitle);
  for (const row of knownCenterRows) {
    const category = centerCounterKey(row);
    add(category, {
      id: row.id || `${category}-${row.timestamp}`,
      timestamp: Number(row.timestamp),
      observedText: row.observedText || row.text || row.canonicalTitle,
      canonicalTitle: row.canonicalTitle,
      counterKey: category,
      countsTowardCounter: true,
      score: Number(row.score || row.similarity || 0),
      image: row.image || "",
      source: "buffered-center-rescan"
    });
  }

  for (const [index, row] of (result.ipca?.matches || []).entries()) {
    add("ipcatech", {
      id: row.id || `ipca-${index + 1}`,
      timestamp: Number(row.timestamp),
      observedText: row.observedText || "+1 IPCA TECH",
      canonicalTitle: `IPCA Tech #${index + 1}`,
      counterKey: "ipcatech",
      countsTowardCounter: true,
      score: Number(row.score || 1),
      image: row.image || "",
      source: "buffered-ipca-rescan"
    });
  }

  const collectibleRows = repairCollectibleEvidence(
    result.collectibles?.matches || [],
    result.ocrEpisodes || []
  );
  for (const row of collectibleRows.filter((item) => item.counterKey === "trophies")) {
    add("trophies", {
      ...row,
      timestamp: Number(row.timestamp),
      canonicalTitle: row.canonicalTitle || row.label || row.observedText,
      source: "buffered-trophy-rescan"
    });
  }

  for (const [key, details] of Object.entries(categories)) {
    details.matches = dedupeMatches(details.matches);
    details.catalogTitles = Number(catalogCounts[key] || (key === "ipcatech" ? 18 : details.matches.length));
    details.distinctCatalogTitlesSeen = details.matches.length;
  }
  for (const [key, count] of Object.entries(catalogCounts)) {
    if (!categories[key]) categories[key] = { matches: [], catalogTitles: Number(count), distinctCatalogTitlesSeen: 0 };
  }

  const nonTrophyCollectibles = collectibleRows
    .filter((row) => row.counterKey !== "trophies")
    .map((row) => ({ ...row, timestamp: Number(row.timestamp) }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const durationSeconds = Number(result.scan?.durationSeconds || result.video?.durationSeconds || result.summary?.durationSeconds || 0);
  const trophyCount = collectibleRows.filter((row) => row.counterKey === "trophies").length;

  return {
    run: { totalDurationSeconds: durationSeconds, video: { durationSeconds }, confirmedEvents: [], candidateEvents: [] },
    model: { categories },
    collectibleProgress: {
      matches: nonTrophyCollectibles,
      catalogItems: Number(result.collectibles?.catalogItems || nonTrophyCollectibles.length),
      coveragePercent: Number(result.collectibles?.coveragePercent || 0),
      summary: { detectedCollectibles: nonTrophyCollectibles.length },
      scan: { method: "buffered-full-rescan-v2" },
      source: "buffered-full-rescan-v2"
    },
    scanHealth: {
      scannerVersion: result.scan?.scannerVersion || result.scannerVersion || result.summary?.scannerVersion || 2,
      createdAt: result.createdAt || result.summary?.createdAt || "",
      realtimeFactor: Number(result.scan?.realtimeFactor || result.summary?.realtimeFactor || result.realtimeFactor || 0),
      inspectedFrames: Number(result.scan?.framesInspected || result.summary?.frames || result.frames || 0),
      collectibleCount: nonTrophyCollectibles.length,
      trophyCount,
      ipcaCount: result.ipca?.matches?.length || 0,
      uniqueKnownTitles: new Set(knownCenterRows.map((row) => row.canonicalTitle)).size,
      knownTitleRows: knownCenterRows.length,
      rawCenterRows: centerRows.length,
      unresolvedCenterRows: centerRows.length - knownCenterRows.length,
      earlyExitRows: centerRows.filter((row) => row.earlyExit).length
    }
  };
}

function applyReviewedObjectives(model, scanHealth, reviewedRun, completionCatalog = {}) {
  if (!reviewedRun?.trustedAnchors) return { model, scanHealth };
  const reviewedKeys = new Set([
    "encampmentjobs",
    "hordes",
    "infestations",
    "ambushcamps",
    "nerosites",
    "nerointel",
    "charactercollectibles",
    "radiofreeoregon",
    "colonelspeeches"
  ]);
  const nonCountingStoryAwards = new Set(["charactercollectibles", "radiofreeoregon", "colonelspeeches"]);
  const catalogCounts = Object.fromEntries(
    Object.entries(completionCatalog.categories || {}).map(([key, value]) => [key, value.titles?.length || 0])
  );
  for (const key of reviewedKeys) {
    model.categories[key] = {
      matches: [],
      catalogTitles: Number(catalogCounts[key] || 0),
      distinctCatalogTitlesSeen: 0
    };
  }
  for (const anchor of reviewedRun.trustedAnchors) {
    const category = anchor.counterKey;
    if (!reviewedKeys.has(category)) continue;
    model.categories[category].matches.push({
      id: anchor.id,
      timestamp: Number(anchor.timestamp),
      observedText: anchor.primaryObservedText || anchor.canonicalTitle,
      canonicalTitle: anchor.canonicalTitle,
      counterKey: category,
      countsTowardCounter: !nonCountingStoryAwards.has(category),
      score: Number(anchor.primaryScore || 0),
      image: "",
      source: "reviewed-objective-rescan"
    });
  }
  for (const key of reviewedKeys) {
    model.categories[key].matches = dedupeMatches(model.categories[key].matches);
    model.categories[key].distinctCatalogTitlesSeen = model.categories[key].matches.length;
  }
  return {
    model,
    scanHealth: {
      ...(scanHealth || {}),
      rawObjectiveAnchors: Number(reviewedRun.summary?.rawAnchors || 0),
      trustedObjectiveTitles: Number(reviewedRun.summary?.trustedTitles || reviewedRun.trustedAnchors.length),
      rejectedObjectiveAnchors: Number(reviewedRun.summary?.rejectedAnchorRows || 0),
      objectiveFeed: "reviewed"
    }
  };
}

function configuredMilestoneMatches(runEntry, milestones = []) {
  return milestones.flatMap((milestone) => {
    const timestamp = Number(milestone.timestamps?.[runEntry.id]);
    if (!Number.isFinite(timestamp)) return [];
    const category = milestone.category || "milestones";
    return [{
      id: milestone.id,
      timestamp,
      observedText: milestone.label,
      canonicalTitle: milestone.label,
      counterKey: category,
      countsTowardCounter: false,
      score: 1,
      image: "",
      category,
      categoryLabel: milestone.categoryLabel || CATEGORY_LABELS[category] || category,
      note: milestone.note || "",
      source: "configured-milestone"
    }];
  });
}

function linkedCounterMatches(collectibleProgress, routeData) {
  if (!collectibleProgress || !routeData) return [];
  const detectedById = new Map((collectibleProgress.matches || []).map((match) => [match.id, match]));
  return (routeData.splits || []).flatMap((split) =>
    (split.ocrGoals || []).flatMap((goal) => {
      const detected = detectedById.get(goal.id);
      if (!detected) return [];
      return (goal.linkedCounters || []).flatMap((linked) => {
        if (linked.counterKey !== "nerosites" || Number(linked.delta) <= 0) return [];
        return [{
          id: `linked-${goal.id}-${linked.counterKey}`,
          timestamp: detected.timestamp,
          observedText: detected.observedText || goal.label,
          canonicalTitle: `NERO research site — ${split.label}`,
          counterKey: linked.counterKey,
          countsTowardCounter: true,
          score: detected.score,
          image: detected.image || "",
          category: linked.counterKey,
          categoryLabel: "NERO sites · recorder anchor",
          note: `${goal.label} confirms the injector/research-site visit.`,
          source: "linked-recorder-anchor"
        }];
      });
    })
  );
}

function dedupeMatches(matches) {
  const seen = new Map();
  for (const match of matches) {
    const prior = seen.get(match.canonicalTitle);
    if (!prior || Number(match.timestamp) < Number(prior.timestamp)) seen.set(match.canonicalTitle, match);
  }
  return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} while loading ${url}`);
  return response.json();
}

async function loadDashboard() {
  try {
    const config = await loadJson(CONFIG_URL);
    const routeData = config.routeUrl ? await loadJson(config.routeUrl).catch(() => null) : null;
    const completionCatalog = config.completionCatalogUrl
      ? await loadJson(config.completionCatalogUrl).catch(() => ({}))
      : {};
    const reviewedObjectives = config.reviewedObjectiveUrl
      ? await loadJson(config.reviewedObjectiveUrl).catch(() => null)
      : null;
    const runs = await Promise.all(config.runs.map(async (entry) => {
      let run;
      let model;
      let collectibleProgress;
      let scanHealth = null;
      if (entry.bufferedResultUrl) {
        const buffered = await loadJson(entry.bufferedResultUrl);
        ({ run, model, collectibleProgress, scanHealth } = normalizeBufferedResult(buffered, completionCatalog));
        const reviewedRun = reviewedObjectives?.runs?.[entry.reviewedObjectiveRunKey];
        if (reviewedRun) {
          ({ model, scanHealth } = applyReviewedObjectives(model, scanHealth, reviewedRun, completionCatalog));
        }
      } else {
        [run, model, collectibleProgress] = await Promise.all([
          loadJson(entry.runUrl),
          loadJson(entry.modelUrl),
          entry.collectibleProgressUrl ? loadJson(entry.collectibleProgressUrl).catch(() => null) : null
        ]);
      }
      return {
        ...entry,
        run,
        model,
        collectibleProgress,
        scanHealth,
        matches: dedupeMatches([
          ...flattenMatches(model),
          ...linkedCounterMatches(collectibleProgress, routeData),
          ...configuredMilestoneMatches(entry, config.milestones)
        ])
      };
    }));

    state.runs = runs;
    state.baselineId = config.defaultBaseline || runs[0]?.id;
    state.comparisonId = config.defaultComparison || runs[1]?.id;
    state.anchors = config.anchors || [];
    state.defaultAnchor = config.defaultAnchor || "recording-start";
    buildControls();
    refreshAnchors(true);
    render();
    const collectibleReady = runs.filter((run) => run.collectibleProgress).length;
    const linkedAnchors = runs.reduce(
      (total, run) => total + run.matches.filter((match) => match.source === "linked-recorder-anchor").length,
      0
    );
    const freshScans = runs.filter((run) => run.scanHealth).length;
    elements.status.textContent = `${runs.length} completion models loaded · ${collectibleReady}/${runs.length} collectible timelines ready`;
    elements.status.textContent = `${runs.length} completion models loaded · ${collectibleReady}/${runs.length} collectible timelines ready · ${linkedAnchors} recorder-linked NERO anchors`;
    elements.status.textContent = `${runs.length} runs loaded · ${freshScans} fresh full rescans · ${collectibleReady}/${runs.length} collectible timelines · ${linkedAnchors} recorder-linked NERO anchors`;
    elements.dashboard.hidden = false;
  } catch (error) {
    console.error(error);
    elements.status.textContent = "Run data unavailable";
    elements.error.hidden = false;
  }
}

function buildControls() {
  for (const run of state.runs) {
    elements.baseline.append(option(run.id, run.label));
    elements.comparison.append(option(run.id, run.label));
  }
  elements.baseline.value = state.baselineId;
  elements.comparison.value = state.comparisonId;

  elements.category.append(option("all", "All completion types"));
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) elements.category.append(option(key, label));

  elements.baseline.addEventListener("change", () => {
    state.baselineId = elements.baseline.value;
    if (state.baselineId === state.comparisonId) {
      state.comparisonId = state.runs.find((run) => run.id !== state.baselineId)?.id || state.comparisonId;
      elements.comparison.value = state.comparisonId;
    }
    refreshAnchors(false);
    render();
  });
  elements.comparison.addEventListener("change", () => {
    state.comparisonId = elements.comparison.value;
    if (state.comparisonId === state.baselineId) {
      state.baselineId = state.runs.find((run) => run.id !== state.comparisonId)?.id || state.baselineId;
      elements.baseline.value = state.baselineId;
    }
    refreshAnchors(false);
    render();
  });
  elements.category.addEventListener("change", () => {
    state.category = elements.category.value;
    render();
  });
  elements.anchor.addEventListener("change", () => {
    state.anchor = elements.anchor.value;
    render();
  });
  elements.tableSort.addEventListener("change", () => {
    state.sort = elements.tableSort.value;
    renderTable();
  });
  elements.collectibleTableSort.addEventListener("change", () => {
    state.collectibleSort = elements.collectibleTableSort.value;
    renderCollectibleTable();
  });
  elements.earliestCollectibleSort.addEventListener("change", () => {
    state.earliestCollectibleSort = elements.earliestCollectibleSort.value;
    renderEarliestCollectibles();
  });
}

function selectedRuns() {
  return {
    baseline: state.runs.find((run) => run.id === state.baselineId),
    comparison: state.runs.find((run) => run.id === state.comparisonId)
  };
}

function matchMap(run) {
  return new Map(run.matches.map((match) => [match.canonicalTitle, match]));
}

function sharedMatches(baseline, comparison) {
  const compareMap = matchMap(comparison);
  return baseline.matches
    .filter((match) => compareMap.has(match.canonicalTitle))
    .map((match) => ({ baseline: match, comparison: compareMap.get(match.canonicalTitle) }));
}

function refreshAnchors(initial) {
  const { baseline, comparison } = selectedRuns();
  const prior = state.anchor;
  const shared = sharedMatches(baseline, comparison).sort((a, b) => a.baseline.timestamp - b.baseline.timestamp);
  elements.anchor.replaceChildren(option("recording-start", "Recording start"));
  for (const anchor of state.anchors) {
    if (Number.isFinite(anchor.timestamps?.[baseline.id]) && Number.isFinite(anchor.timestamps?.[comparison.id])) {
      elements.anchor.append(option(anchor.id, anchor.label));
    }
  }
  for (const pair of shared) elements.anchor.append(option(pair.baseline.canonicalTitle, pair.baseline.canonicalTitle));

  const preferred = [...elements.anchor.options].some((item) => item.value === state.defaultAnchor)
    ? state.defaultAnchor
    : shared.find((pair) => pair.baseline.canonicalTitle.toLowerCase().includes("old pioneer cemetery nero"))?.baseline.canonicalTitle
    || shared[0]?.baseline.canonicalTitle
    || "recording-start";
  state.anchor = (!initial && [...elements.anchor.options].some((item) => item.value === prior)) ? prior : preferred;
  elements.anchor.value = state.anchor;
}

function filteredMatches(run) {
  if (state.category === "all") return run.matches;
  return run.matches.filter((match) => match.category === state.category);
}

function anchorTime(run) {
  if (state.anchor === "recording-start") return 0;
  const configured = state.anchors.find((anchor) => anchor.id === state.anchor);
  if (configured && Number.isFinite(configured.timestamps?.[run.id])) return configured.timestamps[run.id];
  return run.matches.find((match) => match.canonicalTitle === state.anchor)?.timestamp || 0;
}

function configuredAnchorTime(run, anchorId = state.defaultAnchor) {
  if (anchorId === "recording-start") return 0;
  const configured = state.anchors.find((anchor) => anchor.id === anchorId);
  if (configured && Number.isFinite(configured.timestamps?.[run.id])) return configured.timestamps[run.id];
  return run.matches.find((match) => match.canonicalTitle === anchorId)?.timestamp || 0;
}

function alignedMatches(run) {
  const offset = anchorTime(run);
  return filteredMatches(run).map((match) => ({ ...match, alignedTime: match.timestamp - offset }));
}

function metricCard(label, value, detail, tone = "") {
  const card = document.createElement("article");
  card.className = "card metricCard";
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = label;
  const metric = document.createElement("div");
  metric.className = `metricValue ${tone}`.trim();
  metric.textContent = value;
  const small = document.createElement("div");
  small.className = "metricDetail";
  small.textContent = detail;
  card.append(eyebrow, metric, small);
  return card;
}

function renderSummary() {
  const { baseline, comparison } = selectedRuns();
  const baseMatches = filteredMatches(baseline);
  const compareMatches = filteredMatches(comparison);
  const shared = sharedMatches(baseline, comparison).filter((pair) => state.category === "all" || pair.baseline.category === state.category);
  const runtimeDelta = comparison.run.totalDurationSeconds - baseline.run.totalDurationSeconds;
  const coverage = (run) => {
    const categories = state.category === "all"
      ? Object.values(run.model.categories || {})
      : [run.model.categories?.[state.category]].filter(Boolean);
    const seen = categories.reduce((sum, entry) => sum + (entry.distinctCatalogTitlesSeen || 0), 0);
    const total = categories.reduce((sum, entry) => sum + (entry.catalogTitles || 0), 0);
    return total ? Math.round((seen / total) * 100) : 0;
  };
  const rate = (run, matches) => (matches.length / (run.run.totalDurationSeconds / 3600)).toFixed(1);
  const runtimeTone = runtimeDelta <= 0 ? "metricDeltaAhead" : "metricDeltaBehind";

  elements.summary.replaceChildren(
    metricCard("Source runtime difference", formatDelta(runtimeDelta), `${comparison.shortLabel} ${runtimeDelta <= 0 ? "shorter" : "longer"} than ${baseline.shortLabel}`, runtimeTone),
    metricCard("Detected completions", `${baseMatches.length} vs ${compareMatches.length}`, `${baseline.shortLabel} vs ${comparison.shortLabel}`),
    metricCard("OCR catalog coverage", `${coverage(baseline)}% vs ${coverage(comparison)}%`, `${baseline.shortLabel} vs ${comparison.shortLabel}`),
    metricCard("Shared comparison points", String(shared.length), `${rate(baseline, baseMatches)} vs ${rate(comparison, compareMatches)} detections/hour`)
  );
}

function renderScanHealth() {
  if (!elements.scanHealth) return;
  elements.scanHealth.replaceChildren();
  for (const run of state.runs) {
    const health = run.scanHealth;
    const card = document.createElement("article");
    card.className = `scanHealthCard${health ? " scanHealthFresh" : ""}`;
    const title = document.createElement("div");
    title.className = "scanHealthTitle";
    title.textContent = run.label;
    const badge = document.createElement("span");
    badge.className = `scanHealthBadge ${health ? "isFresh" : "isHistorical"}`;
    badge.textContent = health ? `Full rescan v${health.scannerVersion}` : "Historical OCR";
    const rows = document.createElement("div");
    rows.className = "scanHealthRows";
    const details = health
      ? [
        ["Runtime", formatDuration(run.run.totalDurationSeconds, true)],
        ["Collectibles", String(health.collectibleCount)],
        ["IPCA", `${health.ipcaCount}/18`],
        ["Known center titles", `${health.uniqueKnownTitles} unique · ${health.knownTitleRows} hits`],
        ["Unresolved center queue", String(health.unresolvedCenterRows)],
        ["Replay throughput", health.realtimeFactor ? `${health.realtimeFactor.toFixed(2)}× realtime` : "—"]
      ]
      : [
        ["Runtime", formatDuration(run.run.totalDurationSeconds, true)],
        ["Collectibles", String(run.collectibleProgress?.summary?.detectedCollectibles || 0)],
        ["Source", "Saved historical OCR timeline"],
        ["Center flurry data", "Legacy scan"]
      ];
    for (const [label, value] of details) {
      const row = document.createElement("div");
      const key = document.createElement("span");
      key.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      row.append(key, strong);
      rows.append(row);
    }
    card.append(title, badge, rows);
    elements.scanHealth.append(card);
  }
}

function stepPath(points, xScale, yScale) {
  if (!points.length) return "";
  let path = `M ${xScale(points[0].x)} ${yScale(points[0].y)}`;
  for (let index = 1; index < points.length; index += 1) {
    path += ` H ${xScale(points[index].x)} V ${yScale(points[index].y)}`;
  }
  return path;
}

function renderLegend() {
  const { baseline, comparison } = selectedRuns();
  elements.legend.replaceChildren();
  for (const [run, className] of [[baseline, "seriesBaseline"], [comparison, "seriesComparison"]]) {
    const item = document.createElement("span");
    item.className = "legendItem";
    const swatch = document.createElement("span");
    swatch.className = `legendSwatch ${className}`;
    const label = document.createElement("span");
    label.textContent = run.label;
    item.append(swatch, label);
    elements.legend.append(item);
  }
}

function renderSeriesLegend(container) {
  const { baseline, comparison } = selectedRuns();
  container.replaceChildren();
  for (const [run, className] of [[baseline, "seriesBaseline"], [comparison, "seriesComparison"]]) {
    const item = document.createElement("span");
    item.className = "legendItem";
    const swatch = document.createElement("span");
    swatch.className = `legendSwatch ${className}`;
    const label = document.createElement("span");
    const count = run.collectibleProgress?.summary?.detectedCollectibles;
    label.textContent = Number.isFinite(count) ? `${run.label} · ${count} detected` : run.label;
    item.append(swatch, label);
    container.append(item);
  }
}

function renderCollectibleLegend(runs) {
  const classes = ["seriesBaseline", "seriesComparison", "seriesTertiary"];
  elements.collectibleLegend.replaceChildren();
  for (const [index, run] of runs.entries()) {
    const item = document.createElement("span");
    item.className = `legendItem${run.collectibleProgress ? "" : " legendPending"}`;
    const swatch = document.createElement("span");
    swatch.className = `legendSwatch ${classes[index % classes.length]}`;
    const label = document.createElement("span");
    const count = run.collectibleProgress?.summary?.detectedCollectibles;
    const method = run.collectibleProgress?.scan?.method;
    const source = method === "confirmed-historical-ocr" ? "historical OCR" : method === "buffered-full-rescan-v2" ? "full rescan" : "scanned";
    label.textContent = Number.isFinite(count) ? `${run.label} · ${count} · ${source}` : `${run.label} · scanning`;
    item.append(swatch, label);
    elements.collectibleLegend.append(item);
  }
}

function renderAllRunLegend() {
  const classes = ["seriesBaseline", "seriesComparison", "seriesTertiary"];
  elements.allRunLegend.replaceChildren();
  state.runs.forEach((run, index) => {
    const item = document.createElement("span");
    item.className = "legendItem";
    const swatch = document.createElement("span");
    swatch.className = `legendSwatch ${classes[index % classes.length]}`;
    const label = document.createElement("span");
    label.textContent = `${run.label} · ${run.matches.length}`;
    item.append(swatch, label);
    elements.allRunLegend.append(item);
  });
}

function renderAllRunChart() {
  renderAllRunLegend();
  const width = 1000;
  const height = 330;
  const left = 58;
  const right = 24;
  const top = 28;
  const bottom = 48;
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Scaled detected completion progression for ${state.runs.map((run) => run.label).join(", ")}`);
  const series = state.runs.map((run) => {
    const start = configuredAnchorTime(run);
    const finish = Math.max(start + 1, Number(run.run.totalDurationSeconds) || start + 1);
    return run.matches
      .filter((match) => match.timestamp >= start)
      .map((match, index) => ({ x: ((match.timestamp - start) / (finish - start)) * 100, y: index + 1 }));
  });
  const maxCount = Math.max(1, ...series.map((points) => points.length));
  const xScale = (value) => left + (value / 100) * (width - left - right);
  const yScale = (value) => height - bottom - (value / maxCount) * (height - top - bottom);

  for (let index = 0; index <= 4; index += 1) {
    const value = Math.round((maxCount / 4) * index);
    const y = yScale(value);
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", left);
    line.setAttribute("x2", width - right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chartGridLine");
    svg.append(line);
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", left - 12);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "chartAxisLabel");
    label.textContent = String(value);
    svg.append(label);
  }
  for (let index = 0; index <= 5; index += 1) {
    const value = index * 20;
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", xScale(value));
    label.setAttribute("y", height - 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "chartAxisLabel");
    label.textContent = `${value}%`;
    svg.append(label);
  }
  const lineClasses = ["chartLineBaseline", "chartLineComparison", "chartLineTertiary"];
  const pointClasses = ["chartPointBaseline", "chartPointComparison", "chartPointTertiary"];
  series.forEach((points, seriesIndex) => {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", stepPath([{ x: 0, y: 0 }, ...points], xScale, yScale));
    path.setAttribute("class", lineClasses[seriesIndex % lineClasses.length]);
    svg.append(path);
    for (const point of points) {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", xScale(point.x));
      circle.setAttribute("cy", yScale(point.y));
      circle.setAttribute("r", "2.8");
      circle.setAttribute("class", pointClasses[seriesIndex % pointClasses.length]);
      svg.append(circle);
    }
  });
  mountZoomableChart(elements.allRunChart, svg, "all-runs", width, height);
}

function renderAllRunCategories() {
  const classes = ["seriesBaseline", "seriesComparison", "seriesTertiary"];
  elements.allRunCategoryBars.replaceChildren();
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const catalog = Math.max(1, ...state.runs.map((run) => run.model.categories?.[key]?.catalogTitles || 0));
    const group = document.createElement("div");
    group.className = "categoryBarGroup allRunCategoryGroup";
    const header = document.createElement("div");
    header.className = "categoryBarHeader";
    header.innerHTML = `<span>${label}</span><span class="categoryBarNumbers">catalog ${catalog}</span>`;
    group.append(header);
    state.runs.forEach((run, index) => {
      const count = categoryCount(run, key);
      const row = document.createElement("div");
      row.className = "allRunBarRow";
      const name = document.createElement("span");
      name.className = "allRunBarLabel";
      name.textContent = run.shortLabel;
      const track = document.createElement("div");
      track.className = "barTrack";
      track.setAttribute("aria-label", `${run.label}: ${count} of ${catalog}`);
      const fill = document.createElement("span");
      fill.className = `barFill ${classes[index % classes.length]}`;
      fill.style.width = `${Math.min(100, (count / catalog) * 100)}%`;
      track.append(fill);
      const value = document.createElement("span");
      value.className = "allRunBarValue";
      value.textContent = String(count);
      row.append(name, track, value);
      group.append(row);
    });
    elements.allRunCategoryBars.append(group);
  }
}

function renderChart() {
  const { baseline, comparison } = selectedRuns();
  const series = [alignedMatches(baseline), alignedMatches(comparison)];
  const allTimes = series.flat().map((match) => match.alignedTime);
  const minTime = Math.min(0, ...allTimes);
  const maxTime = Math.max(1, ...allTimes);
  const maxCount = Math.max(1, ...series.map((matches) => matches.length));
  const width = 1000;
  const height = 330;
  const left = 56;
  const right = 22;
  const top = 24;
  const bottom = 44;
  const xScale = (value) => left + ((value - minTime) / (maxTime - minTime || 1)) * (width - left - right);
  const yScale = (value) => height - bottom - (value / maxCount) * (height - top - bottom);
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Cumulative detected completions for ${baseline.label} and ${comparison.label}`);

  for (let index = 0; index <= 4; index += 1) {
    const yValue = Math.round((maxCount / 4) * index);
    const y = yScale(yValue);
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", left);
    line.setAttribute("x2", width - right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chartGridLine");
    svg.append(line);
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", left - 12);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "chartAxisLabel");
    label.textContent = String(yValue);
    svg.append(label);
  }

  for (let index = 0; index <= 5; index += 1) {
    const value = minTime + ((maxTime - minTime) / 5) * index;
    const x = xScale(value);
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", height - 14);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "chartAxisLabel");
    const hours = value / 3600;
    label.textContent = `${hours < 0 ? "−" : ""}${Math.abs(hours).toFixed(1)}h`;
    svg.append(label);
  }

  if (minTime < 0 && maxTime > 0) {
    const zero = document.createElementNS(svgNs, "line");
    zero.setAttribute("x1", xScale(0));
    zero.setAttribute("x2", xScale(0));
    zero.setAttribute("y1", top);
    zero.setAttribute("y2", height - bottom);
    zero.setAttribute("class", "chartZeroLine");
    svg.append(zero);
  }

  series.forEach((matches, seriesIndex) => {
    const sorted = [...matches].sort((a, b) => a.alignedTime - b.alignedTime);
    const points = [{ x: minTime, y: 0 }, ...sorted.map((match, index) => ({ x: match.alignedTime, y: index + 1 }))];
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", stepPath(points, xScale, yScale));
    path.setAttribute("class", seriesIndex === 0 ? "chartLineBaseline" : "chartLineComparison");
    svg.append(path);
    for (const point of points.slice(1)) {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", xScale(point.x));
      circle.setAttribute("cy", yScale(point.y));
      circle.setAttribute("r", "3.2");
      circle.setAttribute("class", seriesIndex === 0 ? "chartPointBaseline" : "chartPointComparison");
      svg.append(circle);
    }
  });

  mountZoomableChart(elements.chart, svg, "completion-pace", width, height);
}

function renderCollectibleChart() {
  const runs = state.runs.filter((run) => run.collectibleProgress);
  renderCollectibleLegend(state.runs);
  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "collectibleChartEmpty";
    const heading = document.createElement("strong");
    heading.textContent = "Collectible timelines have not been scanned yet.";
    const copy = document.createElement("span");
    copy.textContent = "Run run-days-gone-collectible-progress-scan.bat, then refresh this page.";
    empty.append(heading, copy);
    elements.collectibleChart.replaceChildren(empty);
    return;
  }

  const width = 1000;
  const height = 310;
  const left = 58;
  const right = 24;
  const top = 28;
  const bottom = 48;
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Scaled collectible progression for ${runs.map((run) => run.label).join(", ")}`);
  const series = runs.map((run) => {
    const start = anchorTime(run);
    const finish = Math.max(start + 1, Number(run.run.totalDurationSeconds) || start + 1);
    return (run.collectibleProgress.matches || [])
      .filter((match) => match.timestamp >= start)
      .map((match, index) => ({
        x: ((match.timestamp - start) / (finish - start)) * 100,
        y: index + 1,
        title: match.title
      }));
  });
  const maxCount = Math.max(1, ...series.map((points) => points.length));
  const xScale = (value) => left + (value / 100) * (width - left - right);
  const yScale = (value) => height - bottom - (value / maxCount) * (height - top - bottom);

  for (let index = 0; index <= 4; index += 1) {
    const value = Math.round((maxCount / 4) * index);
    const y = yScale(value);
    const line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", left);
    line.setAttribute("x2", width - right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "chartGridLine");
    svg.append(line);
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", left - 12);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "chartAxisLabel");
    label.textContent = String(value);
    svg.append(label);
  }

  for (let index = 0; index <= 5; index += 1) {
    const value = index * 20;
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", xScale(value));
    label.setAttribute("y", height - 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "chartAxisLabel");
    label.textContent = `${value}%`;
    svg.append(label);
  }

  series.forEach((points, seriesIndex) => {
    const lineClasses = ["chartLineBaseline", "chartLineComparison", "chartLineTertiary"];
    const pointClasses = ["chartPointBaseline", "chartPointComparison", "chartPointTertiary"];
    const pathPoints = [{x: 0, y: 0}, ...points];
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", stepPath(pathPoints, xScale, yScale));
    path.setAttribute("class", lineClasses[seriesIndex % lineClasses.length]);
    svg.append(path);
    for (const point of points) {
      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", xScale(point.x));
      circle.setAttribute("cy", yScale(point.y));
      circle.setAttribute("r", "2.8");
      circle.setAttribute("class", pointClasses[seriesIndex % pointClasses.length]);
      svg.append(circle);
    }
  });
  mountZoomableChart(elements.collectibleChart, svg, "collectibles", width, height);
}

function collectibleKey(match) {
  return match.id || match.title;
}

function collectibleComparisonData() {
  const runs = state.runs;
  if (runs.length < 2 || runs.some((run) => !run.collectibleProgress)) return [];
  const maps = runs.map((run) => new Map((run.collectibleProgress.matches || []).map((match) => [collectibleKey(match), match])));
  const anchors = runs.map((run) => configuredAnchorTime(run));
  const shared = [...maps[0].entries()]
    .filter(([key]) => maps.slice(1).every((map) => map.has(key)))
    .map(([key, first]) => {
      const matches = [first, ...maps.slice(1).map((map) => map.get(key))];
      const aligned = matches.map((match, index) => match.timestamp - anchors[index]);
      return { key, matches, aligned };
    });
  const ranks = runs.map((run, runIndex) => new Map([...shared]
    .sort((a, b) => a.aligned[runIndex] - b.aligned[runIndex])
    .map((item, index) => [item.key, index + 1])));
  return shared.map((item) => ({
    ...item,
    deltas: item.aligned.map((value) => value - item.aligned[0]),
    orderShifts: ranks.map((rank, index) => index === 0 ? 0 : rank.get(item.key) - ranks[0].get(item.key)),
    spread: Math.max(...item.aligned) - Math.min(...item.aligned)
  }));
}

function collectibleCategoryLabel(match) {
  const labels = {
    charactercollectibles: "Characters",
    tourism: "Tourism",
    herbology: "Herbology",
    historical: "Historical",
    nerointel: "NERO intel",
    radiofreeoregon: "Radio Free Oregon",
    rippersermons: "Ripper sermons",
    songs: "Songs",
    sarahlabnotes: "Sarah lab notes"
  };
  return labels[match.counterKey] || match.counterKey || "Collectible";
}

function renderCollectibleTable() {
  const runs = state.runs;
  const [first, second, third = { shortLabel: "" }] = runs;
  const hasThird = runs.length > 2;
  elements.collectibleRunOneColumn.textContent = first?.shortLabel || "Run 1";
  elements.collectibleRunTwoColumn.textContent = second?.shortLabel || "Run 2";
  elements.collectibleRunThreeColumn.textContent = third?.shortLabel || "Run 3";
  elements.collectibleRunTwoDeltaColumn.textContent = `${second?.shortLabel || "Run 2"} difference`;
  elements.collectibleRunThreeDeltaColumn.textContent = `${third?.shortLabel || "Run 3"} difference`;
  elements.collectibleRunThreeColumn.hidden = !hasThird;
  elements.collectibleRunThreeDeltaColumn.hidden = !hasThird;
  let rows = collectibleComparisonData();
  if (state.collectibleSort === "difference") {
    rows.sort((a, b) => b.spread - a.spread);
  } else if (state.collectibleSort === "earliest") {
    rows.sort((a, b) => Math.min(...a.aligned) - Math.min(...b.aligned) || a.aligned[0] - b.aligned[0]);
  } else {
    rows.sort((a, b) => a.aligned[0] - b.aligned[0]);
  }
  const orderNote = state.collectibleSort === "earliest"
    ? " Ordered by the earliest aligned pickup observed in either recording."
    : "";
  elements.collectibleSharedStatus.textContent = `${rows.length} collectibles were detected in both recordings.${orderNote} Times are aligned from Leon / Finders Keepers; one-run-only detections remain OCR review candidates.`;
  elements.collectibleRows.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = hasThird ? 7 : 5;
    cell.className = "collectibleTableEmpty";
    cell.textContent = "Collectible scan data is not available for both selected recordings.";
    row.append(cell);
    elements.collectibleRows.append(row);
    return;
  }
  for (const item of rows) {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    title.className = "comparisonTitleCell";
    title.textContent = item.matches[0].title;
    const category = document.createElement("span");
    category.className = "categoryTag";
    category.textContent = collectibleCategoryLabel(item.matches[0]);
    title.append(category);
    const times = item.aligned.map((value) => {
      const cell = document.createElement("td");
      cell.textContent = formatAlignedTime(value);
      return cell;
    });
    const deltas = runs.slice(1).map((run, offset) => {
      const runIndex = offset + 1;
      const delta = item.deltas[runIndex];
      const cell = document.createElement("td");
      cell.className = delta <= 0 ? "deltaAhead" : "deltaBehind";
      cell.textContent = `${formatDelta(delta)} ${delta <= 0 ? runs[runIndex].shortLabel : first.shortLabel}`;
      return cell;
    });
    const order = document.createElement("td");
    const shiftText = (value) => value === 0 ? "same" : `${value > 0 ? "+" : ""}${value}`;
    order.textContent = runs.slice(1).map((run, offset) => `${run.shortLabel} ${shiftText(item.orderShifts[offset + 1])}`).join(" · ");
    order.textContent = `${second.shortLabel} ${shiftText(item.orderShifts[1])} · ${third.shortLabel} ${shiftText(item.orderShifts[2])}`;
    order.textContent = runs.slice(1).map((run, offset) => `${run.shortLabel} ${shiftText(item.orderShifts[offset + 1])}`).join(" · ");
    row.append(title, ...times, ...deltas, order);
    elements.collectibleRows.append(row);
  }
}

function earliestCollectibleData() {
  const runs = state.runs;
  const catalog = new Map();
  runs.forEach((run) => {
    const progress = run.collectibleProgress;
    for (const item of [...(progress?.matches || []), ...(progress?.missingCatalogItems || [])]) {
      if (!item.id) continue;
      const prior = catalog.get(item.id) || {
        id: item.id,
        title: item.title,
        counterKey: item.counterKey,
        observations: []
      };
      prior.title ||= item.title;
      prior.counterKey ||= item.counterKey;
      catalog.set(item.id, prior);
    }
    for (const match of progress?.matches || []) {
      const item = catalog.get(match.id);
      item.observations.push({
        run,
        match,
        alignedTime: match.timestamp - configuredAnchorTime(run)
      });
    }
  });
  return [...catalog.values()].map((item) => {
    item.observations.sort((a, b) => a.alignedTime - b.alignedTime);
    item.earliest = item.observations[0] || null;
    item.spread = item.observations.length > 1
      ? item.observations.at(-1).alignedTime - item.observations[0].alignedTime
      : 0;
    return item;
  });
}

function earliestWinnerClusters(rows) {
  const runs = state.runs;
  const shared = rows.filter((item) => item.observations.length === runs.length);
  const wrId = runs[0]?.id;
  const ordered = [...shared].sort((a, b) => {
    const aTime = a.observations.find((observation) => observation.run.id === wrId)?.alignedTime ?? Infinity;
    const bTime = b.observations.find((observation) => observation.run.id === wrId)?.alignedTime ?? Infinity;
    return aTime - bTime;
  });
  const clusters = [];
  for (const item of ordered) {
    const winner = item.earliest.run;
    const prior = clusters.at(-1);
    if (!prior || prior.run.id !== winner.id) clusters.push({ run: winner, items: [item] });
    else prior.items.push(item);
  }
  return clusters.filter((cluster) => cluster.items.length >= 4).sort((a, b) => b.items.length - a.items.length);
}

function renderEarliestCollectibleSummary(rows) {
  const runs = state.runs;
  const detected = rows.filter((item) => item.earliest);
  const shared = rows.filter((item) => item.observations.length === runs.length);
  const wins = new Map(runs.map((run) => [run.id, 0]));
  shared.forEach((item) => wins.set(item.earliest.run.id, (wins.get(item.earliest.run.id) || 0) + 1));
  const missing = rows.filter((item) => !item.earliest).map((item) => item.title);
  const largest = [...shared].sort((a, b) => b.spread - a.spread)[0];
  elements.earliestCollectibleSummary.replaceChildren(
    metricCard("Catalog coverage", `${detected.length}/${rows.length}`, missing.length ? `Missing from all scans: ${missing.join(", ")}` : "Every catalog item has an observation"),
    metricCard("Earliest wins on shared items", runs.map((run) => `${run.shortLabel} ${wins.get(run.id) || 0}`).join(" · "), `${shared.length} collectibles detected in both runs`),
    metricCard("Largest route-order spread", largest ? formatDuration(largest.spread, true) : "—", largest?.title || "No shared observations")
  );
}

function renderCollectiblePatterns(rows) {
  const clusters = earliestWinnerClusters(rows).slice(0, 6);
  elements.collectiblePatternList.replaceChildren();
  for (const cluster of clusters) {
    const card = document.createElement("div");
    card.className = "collectiblePattern";
    const heading = document.createElement("strong");
    heading.textContent = `${cluster.run.shortLabel} · ${cluster.items.length} consecutive earliest points`;
    const range = document.createElement("span");
    range.textContent = `${cluster.items[0].title} → ${cluster.items.at(-1).title}`;
    card.append(heading, range);
    elements.collectiblePatternList.append(card);
  }
}

function renderEarliestCollectibles() {
  let rows = earliestCollectibleData();
  renderEarliestCollectibleSummary(rows);
  renderCollectiblePatterns(rows);
  if (state.earliestCollectibleSort === "spread") {
    rows.sort((a, b) => b.spread - a.spread || a.title.localeCompare(b.title));
  } else if (state.earliestCollectibleSort === "name") {
    rows.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    rows.sort((a, b) => (a.earliest?.alignedTime ?? Infinity) - (b.earliest?.alignedTime ?? Infinity));
  }
  elements.earliestCollectibleRows.replaceChildren();
  for (const item of rows) {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    title.className = "comparisonTitleCell";
    title.textContent = item.title;
    const category = document.createElement("span");
    category.className = "categoryTag";
    category.textContent = collectibleCategoryLabel(item);
    title.append(category);
    const time = document.createElement("td");
    time.textContent = item.earliest ? formatAlignedTime(item.earliest.alignedTime) : "Not detected";
    const run = document.createElement("td");
    run.textContent = item.earliest?.run.shortLabel || "—";
    const coverage = document.createElement("td");
    coverage.textContent = `${item.observations.length}/3`;
    const spread = document.createElement("td");
    spread.textContent = item.observations.length > 1 ? formatDuration(item.spread, true) : "—";
    row.append(title, time, run, coverage, spread);
    elements.earliestCollectibleRows.append(row);
  }
}

function categoryCount(run, key) {
  return run.matches.filter((match) => match.category === key).length;
}

function renderCategories() {
  const { baseline, comparison } = selectedRuns();
  elements.categoryBars.replaceChildren();
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const baseCount = categoryCount(baseline, key);
    const compareCount = categoryCount(comparison, key);
    const catalog = Math.max(baseline.model.categories?.[key]?.catalogTitles || 0, comparison.model.categories?.[key]?.catalogTitles || 0, 1);
    const group = document.createElement("div");
    group.className = "categoryBarGroup";
    const header = document.createElement("div");
    header.className = "categoryBarHeader";
    header.innerHTML = `<span>${label}</span><span class="categoryBarNumbers">${baseCount} / ${compareCount} of ${catalog}</span>`;
    const baseTrack = document.createElement("div");
    baseTrack.className = "barTrack";
    baseTrack.setAttribute("aria-label", `${baseline.label}: ${baseCount} of ${catalog}`);
    const baseFill = document.createElement("span");
    baseFill.className = "barFill seriesBaseline";
    baseFill.style.width = `${Math.min(100, (baseCount / catalog) * 100)}%`;
    baseTrack.append(baseFill);
    const compareTrack = document.createElement("div");
    compareTrack.className = "barTrack";
    compareTrack.setAttribute("aria-label", `${comparison.label}: ${compareCount} of ${catalog}`);
    const compareFill = document.createElement("span");
    compareFill.className = "barFill seriesComparison";
    compareFill.style.width = `${Math.min(100, (compareCount / catalog) * 100)}%`;
    compareTrack.append(compareFill);
    group.append(header, baseTrack, compareTrack);
    elements.categoryBars.append(group);
  }
}

function comparisonData() {
  const { baseline, comparison } = selectedRuns();
  const baselineAnchor = anchorTime(baseline);
  const comparisonAnchor = anchorTime(comparison);
  const shared = sharedMatches(baseline, comparison)
    .filter((pair) => state.category === "all" || pair.baseline.category === state.category)
    .map((pair) => ({
      ...pair,
      baselineAligned: pair.baseline.timestamp - baselineAnchor,
      comparisonAligned: pair.comparison.timestamp - comparisonAnchor,
      delta: (pair.comparison.timestamp - comparisonAnchor) - (pair.baseline.timestamp - baselineAnchor)
    }));
  const baseRanks = new Map([...shared].sort((a, b) => a.baselineAligned - b.baselineAligned).map((pair, index) => [pair.baseline.canonicalTitle, index + 1]));
  const compareRanks = new Map([...shared].sort((a, b) => a.comparisonAligned - b.comparisonAligned).map((pair, index) => [pair.baseline.canonicalTitle, index + 1]));
  return shared.map((pair) => ({
    ...pair,
    orderShift: compareRanks.get(pair.baseline.canonicalTitle) - baseRanks.get(pair.baseline.canonicalTitle)
  }));
}

function renderTable() {
  const { baseline, comparison } = selectedRuns();
  elements.baselineColumn.textContent = baseline.shortLabel;
  elements.comparisonColumn.textContent = comparison.shortLabel;
  let rows = comparisonData();
  rows = state.sort === "difference"
    ? rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    : rows.sort((a, b) => a.baselineAligned - b.baselineAligned);
  elements.rows.replaceChildren();
  for (const item of rows) {
    const row = document.createElement("tr");
    const title = document.createElement("td");
    title.className = "comparisonTitleCell";
    title.textContent = item.baseline.canonicalTitle;
    const category = document.createElement("span");
    category.className = "categoryTag";
    category.textContent = item.baseline.categoryLabel;
    title.append(category);
    const baseTime = document.createElement("td");
    baseTime.textContent = formatAlignedTime(item.baselineAligned);
    const compareTime = document.createElement("td");
    compareTime.textContent = formatAlignedTime(item.comparisonAligned);
    const delta = document.createElement("td");
    delta.className = item.delta <= 0 ? "deltaAhead" : "deltaBehind";
    delta.textContent = `${formatDelta(item.delta)} ${item.delta <= 0 ? comparison.shortLabel : baseline.shortLabel}`;
    const order = document.createElement("td");
    order.textContent = item.orderShift === 0 ? "Same" : `${item.orderShift > 0 ? "+" : ""}${item.orderShift} places`;
    row.append(title, baseTime, compareTime, delta, order);
    elements.rows.append(row);
  }
}

function bestCluster(run, windowSeconds = 1800) {
  const matches = filteredMatches(run);
  if (!matches.length) return { count: 0, start: 0, end: 0, titles: [] };
  let best = { count: 0, startIndex: 0, endIndex: 0 };
  let end = 0;
  for (let start = 0; start < matches.length; start += 1) {
    while (end < matches.length && matches[end].timestamp - matches[start].timestamp <= windowSeconds) end += 1;
    if (end - start > best.count) best = { count: end - start, startIndex: start, endIndex: end };
    if (end === start) end += 1;
  }
  const titles = matches.slice(best.startIndex, best.endIndex);
  return {
    count: best.count,
    start: titles[0]?.timestamp || 0,
    end: titles.at(-1)?.timestamp || 0,
    titles
  };
}

function renderClusters() {
  const { baseline, comparison } = selectedRuns();
  elements.clusters.replaceChildren();
  for (const run of [baseline, comparison]) {
    const cluster = bestCluster(run);
    const card = document.createElement("div");
    card.className = "clusterCard";
    const header = document.createElement("div");
    header.className = "clusterHeader";
    const name = document.createElement("strong");
    name.textContent = run.label;
    const count = document.createElement("span");
    count.className = "clusterCount";
    count.textContent = String(cluster.count);
    header.append(name, count);
    const range = document.createElement("div");
    range.className = "categoryTag";
    range.textContent = `${formatDuration(cluster.start, true)} to ${formatDuration(cluster.end, true)}`;
    const list = document.createElement("ul");
    list.className = "clusterTitles";
    for (const match of cluster.titles.slice(0, 6)) {
      const item = document.createElement("li");
      item.textContent = match.canonicalTitle;
      list.append(item);
    }
    card.append(header, range, list);
    elements.clusters.append(card);
  }
}

function renderUnique() {
  const { baseline, comparison } = selectedRuns();
  const baseMap = matchMap(baseline);
  const compareMap = matchMap(comparison);
  const groups = [
    { run: baseline, matches: filteredMatches(baseline).filter((match) => !compareMap.has(match.canonicalTitle)) },
    { run: comparison, matches: filteredMatches(comparison).filter((match) => !baseMap.has(match.canonicalTitle)) }
  ];
  elements.unique.replaceChildren();
  for (const group of groups) {
    const section = document.createElement("div");
    section.className = "uniqueGroup";
    const header = document.createElement("div");
    header.className = "uniqueHeader";
    header.innerHTML = `<strong>${group.run.label}</strong><span class="pill">${group.matches.length}</span>`;
    const list = document.createElement("ul");
    list.className = "uniqueList";
    for (const match of group.matches.slice(0, 8)) {
      const item = document.createElement("li");
      item.textContent = `${formatDuration(match.timestamp, true)} · ${match.canonicalTitle}`;
      list.append(item);
    }
    if (group.matches.length > 8) {
      const item = document.createElement("li");
      item.textContent = `…and ${group.matches.length - 8} more`;
      list.append(item);
    }
    section.append(header, list);
    elements.unique.append(section);
  }
}

function render() {
  renderSummary();
  renderScanHealth();
  renderAllRunChart();
  renderAllRunCategories();
  renderLegend();
  renderChart();
  renderCollectibleChart();
  renderCollectibleTable();
  renderEarliestCollectibles();
  renderCategories();
  renderTable();
  renderClusters();
  renderUnique();
}

loadDashboard();
