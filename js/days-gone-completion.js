function normalize(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distance(left = "", right = "") {
  const a = String(left);
  const b = String(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous = above;
    }
  }
  return row[b.length];
}

function similarity(left = "", right = "") {
  const longest = Math.max(String(left).length, String(right).length);
  return longest ? 1 - (distance(left, right) / longest) : 0;
}

function titleOnly(value = "") {
  return normalize(value)
    .replace(/\bmission complete\b/g, " ")
    .replace(/\b\d[\d ]*(?:xp|trust|credits?)\b.*$/g, " ")
    .replace(/\b\d+\s*%.*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseScore(candidate = "", expected = "") {
  const observed = titleOnly(candidate);
  const target = titleOnly(expected);
  if (!observed || !target) return 0;
  if (observed === target || observed.startsWith(`${target} `) || observed.includes(` ${target} `)) return 1;

  const targetWords = target.split(" ");
  const observedWords = observed.split(" ");
  const windows = [observed];
  const minWords = Math.max(1, targetWords.length - 1);
  const maxWords = Math.min(observedWords.length, targetWords.length + 1);
  for (let size = minWords; size <= maxWords; size += 1) {
    for (let start = 0; start + size <= observedWords.length; start += 1) {
      windows.push(observedWords.slice(start, start + size).join(" "));
    }
  }

  return Math.max(...windows.map((window) => similarity(window, target)));
}

function requiredCatalogScore(expected = "") {
  const length = titleOnly(expected).replace(/\s/g, "").length;
  if (length < 10) return 0.9;
  if (length < 16) return 0.82;
  if (length < 24) return 0.76;
  return 0.72;
}

export function matchDaysGoneCompletionTitle(titleText = "", completionTitles = {}) {
  let best = null;
  Object.entries(completionTitles || {}).forEach(([counterKey, category]) => {
    (Array.isArray(category?.titles) ? category.titles : []).forEach((entry) => {
      const phrases = [entry?.title, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])].filter(Boolean);
      phrases.forEach((phrase) => {
        const score = phraseScore(titleText, phrase);
        if (score < requiredCatalogScore(phrase) || (best && score <= best.score)) return;
        best = {
          counterKey,
          label: String(category?.label || counterKey),
          canonicalTitle: String(entry.title),
          countsTowardCounter: entry?.countsTowardCounter !== false,
          linkedCollectibleId: String(entry?.linkedCollectible || "").trim(),
          score
        };
      });
    });
  });
  return best;
}

export function isDaysGoneMissionCompleteAnchor(value = "") {
  const words = normalize(value).split(" ").filter(Boolean);
  return words.some((word) => distance(word, "mission") <= 2)
    && words.some((word) => distance(word, "complete") <= 2);
}

export function classifyDaysGoneCompletion({
  anchorText = "",
  titleText = "",
  currentSplit = null,
  completionTitleRules = [],
  completionTitles = {}
} = {}) {
  const title = normalize(titleText);
  const anchorSeen = isDaysGoneMissionCompleteAnchor(anchorText);
  if (!title) return null;

  const learnedRule = (Array.isArray(completionTitleRules) ? completionTitleRules : []).find((rule) => {
    const expected = normalize(rule?.title || "");
    return expected && (title === expected || title.startsWith(`${expected} `));
  });
  if (learnedRule?.counterKey) {
    return {
      action: "counter",
      counterKey: String(learnedRule.counterKey),
      label: String(learnedRule.label || learnedRule.title || learnedRule.counterKey),
      matchedPhrase: titleText,
      confidence: anchorSeen ? "learned completion title with anchor" : "learned centered completion title"
    };
  }

  const catalogMatch = matchDaysGoneCompletionTitle(titleText, completionTitles);
  if (catalogMatch?.countsTowardCounter) {
    return {
      action: "counter",
      counterKey: catalogMatch.counterKey,
      label: catalogMatch.label,
      canonicalTitle: catalogMatch.canonicalTitle,
      linkedCollectibleId: catalogMatch.linkedCollectibleId,
      matchedPhrase: titleText,
      matchScore: catalogMatch.score,
      confidence: anchorSeen ? "catalog completion title with anchor" : "catalog centered completion title"
    };
  }
  if (catalogMatch) {
    return {
      action: "route-goal",
      counterKey: catalogMatch.counterKey,
      label: catalogMatch.label,
      canonicalTitle: catalogMatch.canonicalTitle,
      linkedCollectibleId: catalogMatch.linkedCollectibleId,
      matchedPhrase: titleText,
      matchScore: catalogMatch.score,
      confidence: anchorSeen
        ? "non-counting catalog completion title with anchor"
        : "non-counting centered completion title"
    };
  }

  const exactCounters = [
    { phrase: "nero checkpoint", counterKey: "nerosites", label: "NERO Site" },
    { phrase: "infestation", counterKey: "infestations", label: "Infestation Zone" },
    { phrase: "ambush camp", counterKey: "ambushcamps", label: "Ambush Camp" },
    { phrase: "horde", counterKey: "hordes", label: "Horde" }
  ];
  const exact = !catalogMatch && exactCounters.find((entry) => title.includes(entry.phrase));
  if (exact) {
    return {
      action: "counter",
      ...exact,
      matchedPhrase: titleText,
      confidence: anchorSeen ? "exact completion title with anchor" : "exact centered completion title"
    };
  }

  const splitLabel = normalize(currentSplit?.label || "");
  if (splitLabel.length >= 8 && (title.includes(splitLabel) || splitLabel.includes(title))) {
    return {
      action: "complete-current-split",
      counterKey: "",
      label: currentSplit?.label || titleText,
      matchedPhrase: titleText,
      confidence: anchorSeen ? "exact current-split mission title with anchor" : "exact centered current-split title"
    };
  }

  const currentAuto = currentSplit?.auto && typeof currentSplit.auto === "object"
    ? currentSplit.auto
    : {};
  if (anchorSeen && Number(currentAuto.encampmentjobs || 0) > 0) {
    return {
      action: "counter",
      counterKey: "encampmentjobs",
      label: "Camp Job",
      matchedPhrase: titleText,
      confidence: "anchored route-expected camp job completion"
    };
  }

  return null;
}
