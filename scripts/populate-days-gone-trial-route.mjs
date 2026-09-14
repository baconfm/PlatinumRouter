import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScreenTrackerOcrGoalOptions } from "../js/screen-tracker.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const routePath = path.join(rootDir, "data", "days-gone", "default-splits.json");
const completionPath = path.join(rootDir, "data", "days-gone", "completion-titles.json");
const ipcaPath = path.join(rootDir, "data", "days-gone", "nero-ipca-clusters.json");

const route = JSON.parse(fs.readFileSync(routePath, "utf8"));
const completionData = JSON.parse(fs.readFileSync(completionPath, "utf8"));
const ipcaData = JSON.parse(fs.readFileSync(ipcaPath, "utf8"));

const getSplitById = (id) => route.splits.find((split) => split.id === id);
const moveSplitAfter = (sourceId, targetId) => {
  const sourceIndex = route.splits.findIndex((split) => split.id === sourceId);
  if (sourceIndex < 0) throw new Error(`Unknown source split ${sourceId}.`);
  const [source] = route.splits.splice(sourceIndex, 1);
  const targetIndex = route.splits.findIndex((split) => split.id === targetId);
  if (targetIndex < 0) throw new Error(`Unknown target split ${targetId}.`);
  route.splits.splice(targetIndex + 1, 0, source);
};

// Clear the cemetery story jobs before returning to Logging Camp. When the
// infestation is completed during Boozer's mission the visible center title is
// Clear Out Those Nests, not Logging Camp Infestation.
moveSplitAfter("nero-injector-next-to-logging-camp", "tucker");

Object.assign(getSplitById("o-leary"), {
  label: "O'Leary + Peaceful Lake / Copeland Sweep",
  note: "Mandatory opening sweep: take the O'Leary herbs, then collect Copeland - Hunting Season, Copeland - The Right to Bear Arms, Manny - Happy Birthday, Stud and the nearby Peaceful Lake collectibles. Do not leave Copeland cleanup for endgame."
});
getSplitById("smoke-on-the-mountain").note =
  "Story mission. Its center completion advances directly into Horse Lake NERO/IPCA, Death Train, then Jefferson Rail Tunnel.";
getSplitById("horse-lake-early-cluster").note =
  "After Smoke on the Mountain: Horse Lake NERO Checkpoint → IPCA Tech → Field Recording - 1260 → Death Train Horde → Jefferson Rail Tunnel Ambush Camp/bunker map. Unlock smoke bombs early and avoid returning.";
getSplitById("tucker").note =
  "Shitlist, portrait, landmark next to hotel and guestbook. Finish Drugged Outta His Mind, then route directly to Logging Camp for Clear Out Those Nests.";
getSplitById("nero-injector-next-to-logging-camp").note =
  "Do after Drugged Outta His Mind while Clear Out Those Nests is active: finish Logging Camp infestation, recorder, injector and linked NERO/IPCA checks in one pass. Clear Out Those Nests or Logging Camp Infestation completes the same INF goal.";
getSplitById("split_1783756027263_66_8698").note =
  "Santiam Tunnel. Collect Flight Data Recording - 1377 and Flight Data Recording - 1787 back-to-back in the same pass; do not leave either for cleanup.";
getSplitById("iron-mike-3").note =
  "Keep the PB placement: collect Flight Data Recording - 2097 during this O'Brian / Iron Mike window, using the long call for the detour. Do not defer it to late game.";

const options = getScreenTrackerOcrGoalOptions("days-gone", {
  completionTitles: completionData.categories,
  neroIpcaClusters: ipcaData.clusters
});
const optionById = new Map(options.map((option) => [option.id, option]));
const optionByLabel = new Map(options.map((option) => [option.label, option]));

const completionAssignments = {
  9: ["Pioneer Cemetery Infestation"],
  10: ["Horse Creek Ambush Camp"],
  11: ["Iron Butte Pass NERO Checkpoint"],
  12: ["Drugged Outta His Mind"],
  13: ["Logging Camp Infestation"],
  16: ["Black Crater Ambush Camp", "Belknap Caves Ambush Camp"],
  17: ["Lava Arch Horde", "Twin Craters Horde"],
  19: ["The Rest of Our Drugs", "Everyone Has to Work"],
  28: ["Rogue Camp Infestation"],
  31: ["Hear About a Ripper Camp?"],
  32: [
    "A Score to Settle",
    "Berley Lake Horde",
    "Old Sawmill NERO Checkpoint"
  ],
  34: ["Little Bear Lake Horde"],
  36: ["Sherman's Camp Infestation"],
  38: [
    "Bear Creek Hot Springs Horde",
    "Belknap Crater Horde",
    "Shadow Lake Horde"
  ],
  40: [
    "Coming Into Town",
    "Drifters at Eden Hill",
    "River Flow Farms Horde",
    "Wapinitia Road Horde",
    "Westfir Horde"
  ],
  43: ["Deerborn Ambush Camp", "Berley Lake Ambush Camp"],
  45: ["Horse Lake Horde"],
  46: ["Rippers, Rest in Hell", "Cascade Highway Horde"],
  49: ["How Many Bodies?"],
  50: ["Redwood RV Park Ambush Camp"],
  51: ["Part of the Family"],
  54: ["Didn't Want to Join Up"],
  56: [
    "Never Give Up Hope",
    "Spruce Lake NERO Checkpoint",
    "Spruce Lake Ambush Camp",
    "Cascade Lakes Railway Ambush Camp"
  ],
  58: [
    "Volcanic Legacy Scenic Byway NERO Checkpoint",
    "What It Takes to Survive"
  ],
  59: ["Tumblebug River Infestation", "Rimview Ranch Infestation"],
  60: ["How Do I Get Them?", "You Don't Want to Know"],
  62: ["He's Feeding the Freaks", "Chemult Community College Horde"],
  65: ["Chemult Station Horde"],
  67: [
    "Cascade Lakes Rail Line Infestation",
    "South Oregon Crier Infestation",
    "Beasley Lake Horde",
    "Aspen Butte Ambush Camp"
  ],
  68: [
    "He's Just a Kid",
    "On Tonight's Menu",
    "McLeod Ridge Horde",
    "Rimview Ranch Horde"
  ],
  69: ["Santiam Tunnel NERO Checkpoint"],
  70: ["Iron Butte Ranch Horde"],
  73: ["Old Sawmill Horde"],
  75: [
    "Friendship Ridge Horde",
    "Groose Gardens Horde",
    "Rum Rye Gulch Horde",
    "Sagebrush Point Horde",
    "Solomon Hill Horde"
  ]
};

const ipcaAssignments = {
  9: [2],
  11: [3],
  15: [5],
  18: [6, 15],
  29: [8],
  32: [14],
  48: [9],
  50: [16],
  56: [10, 17],
  57: [7],
  58: [12, 18],
  62: [11],
  69: [13]
};

const collectibleAssignments = {
  15: ["nerointel-15"],
  22: ["herbology-10"],
  45: ["radiofreeoregon-03"],
  48: ["charactercollectibles-32", "rippersermons-04", "nerointel-13"],
  54: ["charactercollectibles-23"],
  55: [
    "colonelspeeches-01",
    "colonelspeeches-02",
    "colonelspeeches-03",
    "colonelspeeches-04",
    "colonelspeeches-05",
    "colonelspeeches-06"
  ],
  56: ["radiofreeoregon-10"],
  57: ["historical-38", "sarahlabnotes-01"],
  64: ["sarahlabnotes-06"]
};

const trophyAssignments = {
  27: ["lost-and-found"],
  55: ["best-friends-forever"],
  77: [
    "one-percenter",
    "farewell-drift",
    "variety-is-the-spice-of-life",
    "best-friends-forever-for-life"
  ]
};

const toGoal = (option) => ({
  id: option.id,
  type: option.type,
  label: option.label,
  counterKey: option.counterKey,
  optional: false
});

const getSplit = (splitNumber) => {
  const split = route.splits[Number(splitNumber) - 1];
  if (!split) throw new Error(`Unknown split number ${splitNumber}.`);
  split.ocrGoals = Array.isArray(split.ocrGoals) ? split.ocrGoals : [];
  return split;
};

const removeGoalEverywhere = (goalId) => {
  route.splits.forEach((split) => {
    split.ocrGoals = (Array.isArray(split.ocrGoals) ? split.ocrGoals : [])
      .filter((goal) => goal.id !== goalId);
    if (Array.isArray(split.ocrCompletion?.groups)) {
      split.ocrCompletion.groups = split.ocrCompletion.groups
        .map((group) => group.filter((id) => id !== goalId))
        .filter((group) => group.length);
    }
  });
};

// Santiam belonged with Shadow of Death in the captured route, not the earlier
// It's On a Mission cluster.
removeGoalEverywhere("completion-nerosites-santiam-tunnel-nero-checkpoint");
// Researcher Field Note - 2104 is awarded automatically by this story mission.
// Track the visible mission title instead of waiting for a collectible popup.
removeGoalEverywhere("nerointel-43");
removeGoalEverywhere("completion-storymissions-what-it-takes-to-survive");

const seen = new Set();
route.splits.forEach((split) => {
  split.ocrGoals = (Array.isArray(split.ocrGoals) ? split.ocrGoals : [])
    .filter((goal) => {
      if (!goal?.id || seen.has(goal.id)) return false;
      seen.add(goal.id);
      return true;
    });
});

let added = 0;
const addOption = (splitNumber, option) => {
  if (!option) throw new Error(`Missing OCR option for split ${splitNumber}.`);
  if (seen.has(option.id)) return false;
  getSplit(splitNumber).ocrGoals.push(toGoal(option));
  seen.add(option.id);
  added += 1;
  return true;
};

Object.entries(completionAssignments).forEach(([splitNumber, labels]) => {
  labels.forEach((label) => addOption(splitNumber, optionByLabel.get(label)));
});

Object.entries(ipcaAssignments).forEach(([splitNumber, indexes]) => {
  indexes.forEach((index) => {
    const cluster = ipcaData.clusters.find((entry) => Number(entry.ipcaIndex) === Number(index));
    addOption(splitNumber, optionByLabel.get(`IPCA Tech - ${cluster?.siteName || ""}`));
  });
});

Object.entries(collectibleAssignments).forEach(([splitNumber, ids]) => {
  ids.forEach((id) => addOption(splitNumber, optionById.get(id)));
});

Object.entries(trophyAssignments).forEach(([splitNumber, ids]) => {
  ids.forEach((id) => addOption(splitNumber, optionById.get(id)));
});

// The 18 NERO research-site injector crates do not show a NERO checkpoint
// completion card. Each site has one nearby NERO Intel item, which is the
// stable OCR anchor for that site's NERO increment.
const recorderLinkedNeroAssignments = {
  9: ["nerointel-25"],
  13: ["nerointel-28"],
  15: ["nerointel-21"],
  22: ["nerointel-26"],
  43: ["nerointel-32"],
  45: ["nerointel-05"],
  46: ["nerointel-09", "nerointel-33"],
  48: ["nerointel-13"],
  51: ["nerointel-10"],
  56: ["nerointel-34"],
  57: ["nerointel-06"],
  61: ["nerointel-40"],
  64: ["nerointel-30"],
  68: ["nerointel-35", "nerointel-39"],
  69: ["nerointel-07", "nerointel-08"]
};
route.splits.forEach((split) => {
  split.ocrGoals.forEach((goal) => delete goal.linkedCounters);
});
Object.entries(recorderLinkedNeroAssignments).forEach(([splitNumber, recorderIds]) => {
  const split = getSplit(splitNumber);
  recorderIds.forEach((recorderId) => {
    const recorder = split.ocrGoals.find((goal) => goal.id === recorderId);
    if (!recorder) throw new Error(`Missing recorder ${recorderId} on split ${splitNumber}.`);
    recorder.linkedCounters = [{ counterKey: "nerosites", delta: 1 }];
  });
});

const whatItTakesGoal = getSplit(58).ocrGoals.find(
  (goal) => goal.label === "What It Takes to Survive"
);
if (!whatItTakesGoal) throw new Error("Missing What It Takes to Survive on split 58.");
whatItTakesGoal.linkedCounters = [{ counterKey: "nerointel", delta: 1 }];

// Explicit completion cards replace the old generic automatic increments.
const removeAuto = {
  9: ["infestations", "nerosites"],
  10: ["ambushcamps"],
  11: ["nerosites"],
  12: ["encampmentjobs"],
  13: ["infestations", "nerosites"],
  17: ["hordes"],
  34: ["encampmentjobs", "hordes"],
  43: ["ambushcamps"],
  45: ["nerosites"],
  50: ["nerosites"],
  51: ["nerosites"],
  56: ["nerosites"],
  58: ["nerosites"],
  61: ["nerosites"],
  64: ["nerosites"],
  65: ["hordes"],
  67: ["infestations", "hordes"],
  70: ["hordes"],
  72: ["infestations", "hordes"],
  73: ["hordes"]
};
Object.entries(removeAuto).forEach(([splitNumber, counterKeys]) => {
  const split = getSplit(splitNumber);
  split.auto = split.auto && typeof split.auto === "object" ? split.auto : {};
  counterKeys.forEach((counterKey) => delete split.auto[counterKey]);
});

const backupDir = path.join(rootDir, "outputs", "route-backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, "days-gone-default-splits.pre-20260724-trial.json");
if (!fs.existsSync(backupPath)) fs.copyFileSync(routePath, backupPath);
fs.writeFileSync(routePath, `${JSON.stringify(route, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  routePath,
  backupPath,
  added,
  splitCount: route.splits.length,
  goalCount: route.splits.reduce((sum, split) => sum + (split.ocrGoals?.length || 0), 0)
}, null, 2));
