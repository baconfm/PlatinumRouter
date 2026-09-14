import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bucketOcrLogEntries,
  buildOcrLogTimestamps,
  classifyOcrLogEvent,
  isLikelyOcrGibberish
} from "../js/ocr-log.js";
import {
  normalizedApproximatelyIncludesPhrase,
  resolveDaysGoneOcrGoal
} from "../js/screen-tracker.js";
import {
  classifyDaysGoneCompletion,
  isDaysGoneMissionCompleteAnchor,
  matchDaysGoneCompletionTitle
} from "../js/days-gone-completion.js";

assert.equal(classifyOcrLogEvent({ applied: [{}] }), "confirmed");
assert.equal(classifyOcrLogEvent({ matches: [{}] }), "candidate");
assert.equal(classifyOcrLogEvent({ errors: [{}] }), "error");
assert.equal(classifyOcrLogEvent({ status: "video-start" }), "control");
assert.equal(classifyOcrLogEvent({ regionTexts: [{ text: "Mayweed" }] }), "raw");
assert.equal(classifyOcrLogEvent({ regionTexts: [{ text: "\u00e2\u20ac\u201d_\n;\n7" }] }), "gibberish");
assert.equal(classifyOcrLogEvent({ regionTexts: [{ text: "" }] }), null);
assert.equal(isLikelyOcrGibberish("Crowberry"), false);
assert.deepEqual(resolveDaysGoneOcrGoal({
  id: "nerointel-28",
  type: "collectible",
  linkedCounters: [{ counterKey: "nerosites", delta: 1 }]
})?.linkedCounters, [{ counterKey: "nerosites", delta: 1 }]);
assert.deepEqual(resolveDaysGoneOcrGoal({
  id: "nerointel-13",
  type: "collectible",
  linkedCounters: [{ counterKey: "nerosites", delta: 1 }]
})?.linkedCounters, [{ counterKey: "nerosites", delta: 1 }]);

const timestamps = buildOcrLogTimestamps(Date.UTC(2026, 6, 20), 1234, "gibberish");
assert.equal(timestamps.runElapsedMs, 1234);
assert.equal(timestamps.rawTextElapsedMs, 1234);
assert.equal(timestamps.gibberishElapsedMs, 1234);

const buckets = bucketOcrLogEntries([
  { eventBucket: "confirmed", id: 1 },
  { eventBucket: "raw", id: 2 },
  { status: "auto-applied", id: 3 }
]);
assert.equal(buckets.confirmed.length, 2);
assert.equal(buckets.raw.length, 1);

assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "VOLCANIC LEGACY SCENIC BYWAY\nNERO CHECKPOINT"
})?.counterKey, "nerosites");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "RIMVIEW RANCH INFESTATION"
})?.counterKey, "infestations");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "WHAT IT TAKES TO SURVIVE",
  completionTitles: {
    nerointel: {
      label: "Story Mission",
      titles: [{ title: "What It Takes to Survive", countsTowardCounter: false }]
    }
  }
})?.action, "route-goal");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "WHAT IT TAKES TO SURVIVE",
  completionTitles: {
    nerointel: {
      label: "Story Mission",
      titles: [{
        title: "What It Takes to Survive",
        countsTowardCounter: false,
        linkedCollectible: "nerointel-43"
      }]
    }
  }
})?.linkedCollectibleId, "nerointel-43");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "NICE AND BLOODY",
  currentSplit: { label: "Tucker", auto: { encampmentjobs: 1 } }
})?.counterKey, "encampmentjobs");
const completionTitles = {
  encampmentjobs: {
    label: "Camp Job",
    titles: [{ title: "You Don't Want to Know", aliases: [], countsTowardCounter: true }]
  },
  hordes: {
    label: "Horde",
    titles: [
      { title: "Bear Creek Hot Springs Horde", aliases: [], countsTowardCounter: true },
      { title: "Old Sawmill Horde", aliases: [], countsTowardCounter: false }
    ]
  },
  ambushcamps: {
    label: "Ambush Camp",
    titles: [
      { title: "Cascade Radio Tower Ambush Camp", aliases: ["No Starving Patriots"], countsTowardCounter: true }
    ]
  }
};

const daysGoneCompletionTitles = JSON.parse(
  await readFile(new URL("../data/days-gone/completion-titles.json", import.meta.url), "utf8")
).categories;
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "DRINKING HIMSELF TO DEATH",
  completionTitles: daysGoneCompletionTitles
})?.linkedCollectibleId, "radiofreeoregon-04");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "WE MUST FILL THE ARK",
  completionTitles: daysGoneCompletionTitles
})?.linkedCollectibleId, "colonelspeeches-02");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "I DON'T HAVE A PIC",
  completionTitles: daysGoneCompletionTitles
})?.linkedCollectibleId, "charactercollectibles-23");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "THEY WILL NEVER STOP",
  completionTitles: daysGoneCompletionTitles
})?.linkedCollectibleId, "charactercollectibles-32");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "NO STARVING PATRIOTS",
  completionTitles: daysGoneCompletionTitles
})?.linkedCollectibleId, "radiofreeoregon-05");
assert.equal(classifyDaysGoneCompletion({
  titleText: "YOU DONT WANT T0 KN0W 5 000XP",
  completionTitles
})?.counterKey, "encampmentjobs");
assert.equal(matchDaysGoneCompletionTitle(
  "BEAR CREEK H0T SPRINGS H0RDE",
  completionTitles
)?.canonicalTitle, "Bear Creek Hot Springs Horde");
assert.equal(matchDaysGoneCompletionTitle("MISSION COMPLETE", completionTitles), null);
assert.equal(matchDaysGoneCompletionTitle(
  "CLEAR OUT THOSE NESTS",
  {
    infestations: {
      label: "Infestation Zone",
      titles: [{
        title: "Logging Camp Infestation",
        aliases: ["Logging Camp", "Clear Out Those Nests"],
        countsTowardCounter: true
      }]
    }
  }
)?.canonicalTitle, "Logging Camp Infestation");
assert.equal(matchDaysGoneCompletionTitle(
  "NO STARVING PATRIOTS",
  completionTitles
)?.canonicalTitle, "Cascade Radio Tower Ambush Camp");
const oldSawmillResult = classifyDaysGoneCompletion({
  titleText: "OLD SAWMILL HORDE",
  completionTitles
});
assert.equal(oldSawmillResult?.action, "route-goal");
assert.equal(oldSawmillResult?.counterKey, "hordes");
assert.equal(classifyDaysGoneCompletion({
  anchorText: "MISSION COMPLETE",
  titleText: "SHADOW OF DEATH",
  currentSplit: { label: "Shadow of Death", auto: {} }
})?.action, "complete-current-split");
assert.equal(classifyDaysGoneCompletion({
  titleText: "RIMVIEW RANCH INFESTATION"
})?.counterKey, "infestations");
assert.equal(classifyDaysGoneCompletion({
  titleText: "SHADOW OF DEATH",
  currentSplit: { label: "Shadow of Death", auto: {} }
})?.action, "complete-current-split");
assert.equal(classifyDaysGoneCompletion({
  titleText: "NICE AND BLOODY",
  currentSplit: { label: "Tucker", auto: { encampmentjobs: 1 } }
}), null);
assert.equal(classifyDaysGoneCompletion({
  titleText: "NICE AND BLOODY 3 000XP",
  completionTitleRules: [{ title: "Nice and Bloody", counterKey: "encampmentjobs", label: "Camp Job" }]
})?.counterKey, "encampmentjobs");
assert.equal(isDaysGoneMissionCompleteAnchor("MISSIUN COMPLETE"), true);
assert.equal(isDaysGoneMissionCompleteAnchor("MISSION COMP1ETE"), true);

assert.equal(
  normalizedApproximatelyIncludesPhrase("BPS RONTIERMOTERERGEHURES jos", "Frontier Motel Brochures"),
  true
);
assert.equal(normalizedApproximatelyIncludesPhrase("MAYWEEO", "Mayweed"), true);
assert.equal(normalizedApproximatelyIncludesPhrase("CROWBERRY", "Mayweed"), false);
assert.equal(normalizedApproximatelyIncludesPhrase("os ose SM rior SSeS Eri ens", "Mirrors"), false);
assert.equal(normalizedApproximatelyIncludesPhrase("PCA TECH", "IPCA Tech"), true);
assert.equal(normalizedApproximatelyIncludesPhrase("1PCA TECH", "IPCA Tech"), true);

console.log("OCR log classification checks passed.");
