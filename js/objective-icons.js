import { DAYS_GONE_TRACED_ICON_BODIES } from "./days-gone-traced-icons.js?v=20260712c";

const BASE_SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';

const ICON_BODIES = {
  trophy: `
    <path d="M8 4.5h8v3.2c0 3.1-1.6 5.3-4 6.2-2.4-.9-4-3.1-4-6.2z"/>
    <path d="M8 6H5.5v1.4A3.1 3.1 0 0 0 8.8 10"/>
    <path d="M16 6h2.5v1.4a3.1 3.1 0 0 1-3.3 2.6"/>
    <path d="M12 13.9V18"/>
    <path d="M8.5 20h7"/>
    <path d="M10 18h4"/>
  `,
  route: `
    <path d="M3 5.5 8.8 4l6.1 2.4L21 4.8v13.7L14.9 20l-6.1-2.4L3 19.2z"/>
    <path d="M8.8 4v13.6M14.9 6.4V20"/>
    <path d="m16.5 9.2 3 3m0-3-3 3"/>
  `,
  camp: `
    <path d="M3 21h18M5 21V7h14v14M3.5 7h17"/>
    <path d="M7 7V3l3 1.2L7 5.4M17 7V2.5l3 1.2L17 5"/>
    <path d="M7.5 21 12 10l4.5 11M8.8 17h6.4"/>
    <path d="M5 11h3M16 11h3"/>
  `,
  checkpoint: `
    <path d="M12 20V4"/>
    <path d="M7 20h10"/>
    <path d="M8.5 16.5h7"/>
    <path d="M5 7.5h14l-2.2 3L19 13.5H5z"/>
    <path d="M8.5 10.5h7"/>
  `,
  infestation: `
    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="3.7"/>
    <path d="M10.2 8.7C8.2 5.2 9.6 2.8 12 2.8s3.8 2.4 1.8 5.9"/>
    <path d="M15.8 11.4c4-.1 5.3 2.4 4.1 4.5-1.2 2-4 2-6-.9"/>
    <path d="M10.1 15c-2 2.9-4.8 2.9-6 .9-1.2-2.1.1-4.6 4.1-4.5"/>
    <path d="M12 15.7V21M9.5 21h5"/>
  `,
  ambush: `
    <path d="M6 20 18 14M18 20 6 14"/>
    <path d="M12 15.5c-3.1 0-5.2-2-5.2-4.7 0-2.3 1.5-4.1 3.3-5.8.1 2 1 3.1 2.1 3.7.7-2.5 2-4.3 3.6-5.7.1 2.4 1.4 4 1.4 6.6 0 3.4-2.1 5.9-5.2 5.9Z"/>
    <path d="M9.5 12.5c.5 1.2 1.3 1.8 2.5 1.8s2-.7 2.5-2"/>
  `,
  horde: `
    <path fill="currentColor" stroke="none" d="M12 3.2c-4.2 0-6.8 2.7-6.8 6.4 0 2.4 1.1 4.3 3.1 5.4v3.1h2.2v-2h3v2h2.2V15c2-1.1 3.1-3 3.1-5.4 0-3.7-2.6-6.4-6.8-6.4Z"/>
    <path fill="rgba(0,0,0,.78)" stroke="none" d="m7.8 9.2 2.8-.9-.7 3-2.3-.5Zm8.4 0-2.8-.9.7 3 2.3-.5ZM11 12.6h2l-1 1.6Z"/>
    <path d="M4.8 5.2 2.7 8.6l2.1.2-2 3.5 2.5.1-1.4 3.2M19.2 5.2l2.1 3.4-2.1.2 2 3.5-2.5.1 1.4 3.2"/>
    <path d="M8.8 19.7 6.2 22M15.2 19.7l2.6 2.3"/>
  `,
  research: `
    <path d="m14.5 3.5 6 6M17.2 6.2l2.3-2.3"/>
    <path d="m15.8 8.2-8.9 8.9a2.4 2.4 0 0 0 0 3.4 2.4 2.4 0 0 0 3.4 0l8.9-8.9"/>
    <path d="m6 16 4 4M9.2 13.8l2.8 2.8M12 11l2.8 2.8"/>
    <path d="M4.2 21.8 6 20"/>
  `,
  intel: `
    <rect x="5" y="4" width="14" height="16" rx="1.4"/>
    <path d="M8.5 8h7"/>
    <path d="M8.5 11.5h7"/>
    <path d="M8.5 15h4.5"/>
    <path d="M16 4v16"/>
  `,
  radio: `
    <path d="M5 8.5h14a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2Z"/>
    <path d="m8 8.5 8-4"/>
    <circle cx="9" cy="14" r="2"/>
    <path d="M14 12.5h4"/>
    <path d="M14 15.5h4"/>
  `,
  speech: `
    <path d="M5.5 5.5h8.5v8.5H5.5z"/>
    <path d="M9.8 8v3.5"/>
    <path d="M8.2 9.8h3.2"/>
    <path d="M16.2 7.2a5.4 5.4 0 0 1 0 5.6"/>
    <path d="M18.7 5a8.8 8.8 0 0 1 0 10"/>
  `,
  historical: `
    <path d="M5 19V8l7-3 7 3v11"/>
    <path d="M3.5 19h17"/>
    <path d="M8.2 19v-5.2h7.6V19"/>
    <path d="M9.2 10.5h5.6"/>
    <path d="M12 5v4"/>
  `,
  character: `
    <path d="M4.8 6.2 12 4l7.2 2.2-2.4 3.4H7.2z"/>
    <path d="M8.2 9.6c.4 3 1.6 5 3.8 6.3 2.2-1.3 3.4-3.3 3.8-6.3"/>
    <path d="M7 20c1-2.1 2.6-3.2 5-3.2s4 1.1 5 3.2"/>
  `,
  tourism: `
    <path d="M5 17.5c3-1.7 5-1.7 7 0 2-1.7 4-1.7 7 0"/>
    <path d="M6 8.5c2.8 1 4.7 1 6 0 1.3 1 3.2 1 6 0"/>
    <path d="M5 17.5 7 8.5"/>
    <path d="M19 17.5 17 8.5"/>
    <path d="M12 8.5v9"/>
  `,
  sermon: `
    <path d="M6 5h12v15H6z"/>
    <path d="M9 9h6"/>
    <path d="M9 12h6"/>
    <path d="M12 7v10"/>
    <path d="M10.4 15.5h3.2"/>
  `,
  herb: `
    <path d="M12 20V6"/>
    <path d="M12 13c-3.2-.4-5.4-2.2-6.5-5.5 3.6.1 5.8 1.9 6.5 5.5z"/>
    <path d="M12 14c3.3-.6 5.5-2.7 6.5-6.2-3.8.2-6 2.3-6.5 6.2z"/>
    <path d="M8.5 20h7"/>
  `,
  ipca: `
    <rect x="5" y="5" width="14" height="14" rx="1.5"/>
    <path d="M8 2v3M12 2v3M16 2v3M8 19v3M12 19v3M16 19v3M2 8h3M2 12h3M2 16h3M19 8h3M19 12h3M19 16h3"/>
    <path d="m12 7.5 4.5 4.5-4.5 4.5L7.5 12z"/>
    <path d="m12 10 2 2-2 2-2-2z"/>
  `,
  song: `
    <path d="M9 18 18 9"/>
    <path d="M6.5 15.5 8.5 17.5"/>
    <path d="M16.5 5.5 18.5 7.5"/>
    <path d="M5 18.5 18.5 5"/>
    <circle cx="6.5" cy="17.5" r="1.7"/>
    <circle cx="17.5" cy="6.5" r="1.7"/>
  `,
  cairn: `
    <path fill="currentColor" stroke="none" d="M9.7 6.6c0-1.7.9-3 2.3-3s2.3 1.3 2.3 3c0 1.2-.8 1.8-2.3 1.8s-2.3-.6-2.3-1.8Z"/>
    <path fill="currentColor" stroke="none" d="M7.5 11.5c0-2 1.7-3.1 4.5-3.1s4.5 1.1 4.5 3.1c0 1.4-1.2 2.1-4.5 2.1s-4.5-.7-4.5-2.1Z"/>
    <path fill="currentColor" stroke="none" d="M5.4 16.3c0-1.9 2.4-2.8 6.6-2.8s6.6.9 6.6 2.8c0 1.5-1.9 2.2-6.6 2.2s-6.6-.7-6.6-2.2Z"/>
    <path fill="currentColor" stroke="none" d="m4 21 1.4-2.6h13.2L20 21Z"/>
  `,
  death: `
    <path d="M8.4 19.5v-2.2a6.2 6.2 0 1 1 7.2 0v2.2"/>
    <circle cx="9.4" cy="11.2" r="1"/>
    <circle cx="14.6" cy="11.2" r="1"/>
    <path d="M10 15h4"/>
    <path d="M8.4 19.5h7.2"/>
  `,
  default: `
    <circle cx="12" cy="12" r="7"/>
    <path d="M12 8v4"/>
    <path d="M12 16h.01"/>
  `
};

Object.assign(ICON_BODIES, {
  route: DAYS_GONE_TRACED_ICON_BODIES.collectibles,
  research: DAYS_GONE_TRACED_ICON_BODIES.injector,
  cairn: DAYS_GONE_TRACED_ICON_BODIES.cairn,
  horde: DAYS_GONE_TRACED_ICON_BODIES.horde,
  camp: DAYS_GONE_TRACED_ICON_BODIES.camp,
  ambush: DAYS_GONE_TRACED_ICON_BODIES.ambush,
  ipca: DAYS_GONE_TRACED_ICON_BODIES.ipca,
  infestation: DAYS_GONE_TRACED_ICON_BODIES.infestation,
});

const ICON_ALIASES = {
  "\u{1F3C6}": "trophy",
  trophies: "trophy",
  trophy: "trophy",
  "\u{1F98A}": "inari",
  fox: "inari",
  inari: "inari",
  inarishrines: "inari",
  "\u2668\uFE0F": "spring",
  hotsprings: "spring",
  spring: "spring",
  "\u{1F38B}": "bamboo",
  bamboo: "bamboo",
  bamboostrikes: "bamboo",
  "\u{1F4DD}": "haiku",
  haiku: "haiku",
  "\u{1F4DC}": "record",
  records: "record",
  record: "record",
  "\u{1F3FA}": "artifact",
  artifacts: "artifact",
  artifact: "artifact",
  "\u26E9\uFE0F": "shrine",
  shrines: "shrine",
  shintoshrines: "shrine",
  shrine: "shrine",
  "\u{1F5FC}\uFE0F": "lighthouse",
  lighthouses: "lighthouse",
  lighthouse: "lighthouse",
  "\u{1F997}": "cricket",
  crickets: "cricket",
  cricket: "cricket",
  "\u{1F56F}\uFE0F": "altar",
  hiddenaltars: "altar",
  hiddenaltar: "altar",
  altar: "altar",
  "\u2694\uFE0F": "duel",
  duels: "duel",
  duel: "duel",
  "\u{1F3D5}\uFE0F": "territory",
  territories: "territory",
  mongolterritories: "territory",
  territory: "territory",
  "\u{1F329}\uFE0F": "mythic",
  mythictales: "mythic",
  mythic: "mythic",
  "\u{1F4D6}": "tale",
  sidetales: "tale",
  tale: "tale",
  "\u{1F3A8}": "monochrome",
  monochrome: "monochrome",
  "\u{1F99D}": "trader",
  cooper: "trader",
  trader: "trader",
  "\u{1F480}": "death",
  deaths: "death",
  death: "death"
};

const ICON_EMOJI = {
  trophy: "\u{1F3C6}",
  inari: "\u{1F98A}",
  spring: "\u2668\uFE0F",
  bamboo: "\u{1F38B}",
  haiku: "\u{1F4DD}",
  record: "\u{1F4DC}",
  artifact: "\u{1F3FA}",
  shrine: "\u26E9\uFE0F",
  lighthouse: "\u{1F5FC}\uFE0F",
  cricket: "\u{1F997}",
  altar: "\u{1F56F}\uFE0F",
  duel: "\u2694\uFE0F",
  territory: "\u{1F3D5}\uFE0F",
  mythic: "\u{1F329}\uFE0F",
  tale: "\u{1F4D6}",
  monochrome: "\u{1F3A8}",
  trader: "\u{1F99D}",
  route: "\u{1F5FA}\uFE0F",
  camp: "\u26FA",
  checkpoint: "\u{1F4CD}",
  infestation: "\u{1F525}",
  ambush: "\u{1F3AF}",
  horde: "\u{1F465}",
  research: "\u{1F9EA}",
  intel: "\u{1F4FC}",
  radio: "\u{1F4FB}",
  speech: "\u{1F4E3}",
  historical: "\u{1F3DB}\uFE0F",
  character: "\u{1F464}",
  tourism: "\u{1F4F7}",
  sermon: "\u{1F4D8}",
  herb: "\u{1F33F}",
  ipca: "\u{1F9E9}",
  song: "\u{1F3B5}",
  cairn: "\u{1FAA8}",
  death: "\u{1F480}"
};

function sanitizeClassName(value) {
  const text = String(value || "objectiveIconSvg")
    .replace(/[^a-zA-Z0-9_\- ]/g, " ")
    .trim();

  return text || "objectiveIconSvg";
}

function normalizeIconToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLookupToken(value) {
  return normalizeIconToken(value).replace(/[^a-z0-9]+/g, "");
}

function resolveIconKey(iconKey, label = "") {
  const normalizedIconKey = normalizeIconToken(iconKey);
  if (ICON_BODIES[normalizedIconKey] || ICON_EMOJI[normalizedIconKey]) {
    return normalizedIconKey;
  }

  const directAlias = ICON_ALIASES[iconKey] || ICON_ALIASES[normalizedIconKey];
  if (directAlias && (ICON_BODIES[directAlias] || ICON_EMOJI[directAlias])) {
    return directAlias;
  }

  const compactAlias = ICON_ALIASES[normalizeLookupToken(iconKey)];
  if (compactAlias && (ICON_BODIES[compactAlias] || ICON_EMOJI[compactAlias])) {
    return compactAlias;
  }

  const labelAlias = ICON_ALIASES[normalizeLookupToken(label)];
  if (labelAlias && (ICON_BODIES[labelAlias] || ICON_EMOJI[labelAlias])) {
    return labelAlias;
  }

  return "default";
}

export function getObjectiveIconMarkup(iconKey, label = "", className = "objectiveIconSvg") {
  const key = resolveIconKey(iconKey, label);
  const safeClass = sanitizeClassName(className);
  const body = ICON_BODIES[key] || ICON_BODIES.default;

  if (ICON_BODIES[key]) {
    return `<svg class="${safeClass}" ${BASE_SVG_ATTRS} aria-hidden="true" focusable="false">${body}</svg>`;
  }

  const emoji = ICON_EMOJI[key];
  if (emoji) {
    return `<span class="${safeClass} objectiveIconEmoji" aria-hidden="true">${emoji}</span>`;
  }

  return `<svg class="${safeClass}" ${BASE_SVG_ATTRS} aria-hidden="true" focusable="false">${body}</svg>`;
}
