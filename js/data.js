export const STORAGE_KEY = "got_platinum_router_v1";

export const COUNTER_DEFS = {
  trophies: { label: "Trophies", icon: "🏆", max: 52, act1: 0 },
  inari: { label: "Inari Shrines", icon: "🦊", max: 49, act1: 22 },
  hotsprings: { label: "Hot Springs", icon: "🍑", max: 18, act1: 9 },
  bamboo: { label: "Bamboo", icon: "🎍", max: 16, act1: 6 },
  haiku: { label: "Haiku", icon: "🎼", max: 19, act1: 8 },
  records: { label: "Records", icon: "📜", max: 20, act1: 0 },
  artifacts: { label: "Artifacts", icon: "🛡️", max: 20, act1: 0 },
  shrines: { label: "Shinto Shrines", icon: "⛩️", max: 16, act1: 7 },
  crickets: { label: "Crickets", icon: "🦗", max: 5, act1: 0 },
  hiddenaltars: { label: "Hidden Altars", icon: "🙏", max: 10, act1: 0 },
  duels: { label: "Duels", icon: "⚔️", max: 25, act1: 0 },
  territories: { label: "Mongol Territories", icon: "🏕️", max: 56, act1: 0 },
  mythictales: { label: "Mythic Tales", icon: "📘", max: 7, act1: 0 },
  sidetales: { label: "Side Tales", icon: "📝", max: 61, act1: 0 },
  monochrome: { label: "Monochrome", icon: "🎨", max: 2, act1: 0 },
  cooper: { label: "Cooper", icon: "🦝", max: 3, act1: 0 }
};

export const PHASES = {
  legacy_all: {
    label: "Legacy All",
    note: "Fallback for older split files with no phase markers.",
    visible: [
      "trophies",
      "inari",
      "hotsprings",
      "bamboo",
      "haiku",
      "shrines",
      "records",
      "artifacts",
      "crickets",
      "hiddenaltars",
      "monochrome",
      "dirge",
      "cooper",
      "sidetales",
      "duels",
      "territories",
      "mythictales"
    ]
  },
  any_act1: {
    label: "Any% Act 1",
    note: "Focus on Act 1 collectibles, records, artifacts, altars, and monochrome.",
    visible: [
      "trophies",
      "inari",
      "hotsprings",
      "bamboo",
      "haiku",
      "shrines",
      "records",
      "artifacts",
      "crickets",
      "hiddenaltars",
      "monochrome"
    ]
  },
  any_act2: {
    label: "Any% Act 2",
    note: "Act 2 keeps the same collectible focus and adds Dirge.",
    visible: [
      "trophies",
      "inari",
      "hotsprings",
      "bamboo",
      "haiku",
      "shrines",
      "records",
      "artifacts",
      "crickets",
      "hiddenaltars",
      "monochrome",
      "dirge"
    ]
  },
  any_act3: {
    label: "Any% Act 3",
    note: "Act 3 swaps monochrome/dirge focus out and brings Cooper in.",
    visible: [
      "trophies",
      "inari",
      "hotsprings",
      "bamboo",
      "haiku",
      "shrines",
      "records",
      "artifacts",
      "crickets",
      "hiddenaltars",
      "cooper"
    ]
  },
  ngp_act1: {
    label: "NG+ Act 1",
    note: "Focus on NG+ cleanup: side tales, duels, camps, mythic tales.",
    visible: ["trophies", "sidetales", "duels", "territories", "mythictales"]
  },
  ngp_act2: {
    label: "NG+ Act 2",
    note: "Continue NG+ cleanup objectives through Act 2.",
    visible: ["trophies", "sidetales", "duels", "territories", "mythictales"]
  },
  ngp_act3: {
    label: "NG+ Act 3",
    note: "Final NG+ cleanup focus.",
    visible: ["trophies", "sidetales", "duels", "territories", "mythictales"]
  }
};

export const DEFAULT_SPLITS = [
  { id: "prologue", label: "Prologue", note: "", phaseId: "any_act1", isPhaseStart: true, auto: { trophies: 1, haiku: 1 } },
  { id: "yuna", label: "Yuna", note: "", phaseId: "", isPhaseStart: false, auto: { inari: 1, records: 1, artifacts: 1 } },
  { id: "ishikawa", label: "Ishikawa", note: "", phaseId: "", isPhaseStart: false, auto: { inari: 3, hotsprings: 2, bamboo: 1, shrines: 1, records: 1, artifacts: 1 } },
  { id: "masako", label: "Masako", note: "", phaseId: "", isPhaseStart: false, auto: { hotsprings: 1, shrines: 1 } },
  { id: "taka", label: "Taka", note: "", phaseId: "", isPhaseStart: false, auto: { inari: 1, hotsprings: 2, bamboo: 1 } },
  { id: "ronin", label: "Ronin", note: "", phaseId: "", isPhaseStart: false, auto: { inari: 1, haiku: 1, records: 1 } },
  { id: "ronin2", label: "Ronin 2", note: "", phaseId: "", isPhaseStart: false, auto: { inari: 1 } },
  { id: "komatsu", label: "Komatsu", note: "", phaseId: "", isPhaseStart: false, auto: { inari: 1, bamboo: 1, haiku: 1 } },
  { id: "hook", label: "Hook", note: "", phaseId: "", isPhaseStart: false, auto: {} },
  { id: "act1finale", label: "Act 1 Finale", note: "", phaseId: "any_act2", isPhaseStart: true, auto: { trophies: 1 } },
  { id: "act2", label: "Act 2", note: "", phaseId: "", isPhaseStart: false, auto: {} }
];

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function formatMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function buildDefaultCounters() {
  const out = {};
  Object.entries(COUNTER_DEFS).forEach(([key, def]) => {
    out[key] = { ...def, value: 0, manualDelta: 0 };
  });
  return out;
}

export function normalizeSplit(split) {
  return {
    id: "",
    label: "",
    note: "",
    phaseId: "",
    isPhaseStart: false,
    auto: {},
    ...split
  };
}

export function normalizeSplits(splits, fallback = DEFAULT_SPLITS) {
  const source = Array.isArray(splits) && splits.length ? splits : fallback;
  return source.map(normalizeSplit);
}

export function computeOverallPercent(counters, miscChecks = { dirge: false }) {
  const keys = Object.keys(COUNTER_DEFS);
  const total = keys.reduce((sum, key) => sum + counters[key].value, 0) + (miscChecks.dirge ? 1 : 0);
  const max = keys.reduce((sum, key) => sum + COUNTER_DEFS[key].max, 0) + 1;
  return max ? Math.round((total / max) * 100) : 0;
}

export function computeAct1Percent(counters) {
  const keys = Object.keys(COUNTER_DEFS).filter((key) => COUNTER_DEFS[key].act1 > 0);
  const done = keys.reduce((sum, key) => sum + Math.min(counters[key].value, COUNTER_DEFS[key].act1), 0);
  const max = keys.reduce((sum, key) => sum + COUNTER_DEFS[key].act1, 0);
  return max ? Math.round((done / max) * 100) : 0;
}

export function getAct1QuotaText(counters) {
  return ["inari", "hotsprings", "bamboo", "haiku", "shrines"]
    .map((key) => `${Math.min(counters[key].value, COUNTER_DEFS[key].act1)}/${COUNTER_DEFS[key].act1} ${COUNTER_DEFS[key].icon}`)
    .join(" · ");
}

export function getActivePhaseId(splits, currentSplitIndex) {
  let active = "legacy_all";
  for (let i = 0; i <= currentSplitIndex && i < splits.length; i += 1) {
    const split = splits[i];
    if (split && split.isPhaseStart && split.phaseId && PHASES[split.phaseId]) {
      active = split.phaseId;
    }
  }
  return active;
}

export function applyAutoProgress(counters, deltaMap, direction) {
  const next = clone(counters);
  Object.entries(deltaMap || {}).forEach(([key, value]) => {
    next[key].value = clamp(next[key].value + value * direction, 0, next[key].max);
  });
  return next;
}

export function exportJson(data, prefix = "got-controller") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}
