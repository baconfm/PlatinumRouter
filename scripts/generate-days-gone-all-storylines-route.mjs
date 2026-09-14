import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const gameRoot = path.join(root, "data", "days-gone");
const routeRoot = path.join(gameRoot, "routes", "all-storylines");
const baseCatalog = JSON.parse(await readFile(path.join(gameRoot, "completion-titles.json"), "utf8"));

const regions = ["Cascade", "Belknap", "Lost Lake", "Iron Butte", "Crater Lake", "Highway 97", "Endgame"];
const missionGroups = {
  "Cascade": [
    "He Can't Be Far", "We'll Make It Quick", "I Say We Head North", "Bad Way to Go", "You Got a Death Wish",
    "Drifters on the Mountain", "Bugged the Hell Out", "No Starving Patriots", "Sounded Like Engines",
    "Smoke on the Mountain", "Out of Nowhere", "They're Not Sleeping", "Clear Out Those Nests",
    "It's a Rifle, Not a Gun", "We're Getting Low on Meat", "Making Contact", "I've Pulled Weeds Before",
    "Give Me a Couple Days", "No One Saw It Coming", "It Couldn't Be That Easy", "They Don't Like Visitors",
    "That's When I Knew", "It's a Long Story", "Riding the Open Road"
  ],
  "Belknap": [
    "Price on Your Head", "What Did You Do?", "Searching for Something", "What's a Nice Girl", "It's Not Safe Here",
    "Lots of Sick People", "It Was on Me", "Everyone Has to Work", "They Won't Let Me Leave", "The Rest of Our Drugs",
    "I Brought You Something", "What Have They Done", "No Beginning and No End"
  ],
  "Lost Lake": [
    "Not Gonna Kill Anyone", "No Place Else to Go", "Sherman's Camp Is Crawling", "I Need Your Help", "Searching for Lisa",
    "Now You See It", "Playing All Night", "With Other Men's Blood", "It's on a Mission", "A Goddamn War Zone",
    "Flow Like Buried Rivers", "You See What They Did", "Do You Have My Back?", "On Herod's Birthday", "I Could Use a Hand",
    "Seeds for the Spring", "I Got a Job for You", "Moments of Lucidity", "The Only One He's Got", "I Got Work to Do",
    "Some Kinda Freak Expert", "Lines Not Crossed", "We're Not Hiding", "That's His Mistake", "Drinking Himself to Death",
    "About Boozer's Arm", "Was This a Good Idea?", "You Twisted My Arm", "You Could Have Done More", "Not Like I Got a Choice",
    "Better to Light One Candle", "Outta the Darkness", "Something to Heal His Soul", "Have It Your Way",
    "Trying to Help the Camp", "Riders Sent to Find You", "They Will Never Stop", "Without Being Seen",
    "You Won't Be Needing This", "Now That's an Idea", "I Was Distracted", "Why Am I Here?", "Riding Nomad Again"
  ],
  "Iron Butte": [
    "Don't Get Caught", "They Don't Feel Pain", "It Was the Only Way", "I Kept My Name", "Should Have Seen It Coming",
    "That Never Gets Old", "Time for Some Payback", "I'm Good with That"
  ],
  "Crater Lake": [
    "Mayday! Mayday!", "Not From Around Here", "We're Fighting a War", "Prove It to Me", "Driven to Extinction",
    "Don't Give Me Orders", "A Target on Their Backs", "I Don't Have a Pic", "A War We Can Win",
    "Leave All That by the Door", "We Will Take Back This World", "Keeping Souvenirs", "I Know Things Are Strange",
    "I Know the Look", "We Do Not Discriminate", "I've Had Better Days", "Take Back What's Mine",
    "Afraid of a Little Competition?", "I Tried to Hit That Once", "You Got the Wrong Guy", "Just Another Requisition Form",
    "Can I Ask You Something?", "So Many of Them", "You Couldn't Stop Shaking", "Can't Be Replaced",
    "Didn't Want to Join Up?", "What Kept Me Going", "I Knew These People", "Expect the Worst",
    "We Couldn't Take the Risk", "This One's on Me", "I Don't Wanna Hang", "Still Breathing", "This Could Be It",
    "You Alone I Have Seen", "How Far We've Fallen", "You Don't Want to Know", "He's Not Big on Tunes",
    "I've Got a Plan", "What It Takes to Survive", "The Anarchist Spy", "Shadow of Death", "Ascending from the Underworld"
  ],
  "Highway 97": [],
  "Endgame": [
    "Keep Them Safe", "Copeland's Camp Has Been Attacked", "Nose Down, They Feed Ya", "The Last of 'Em",
    "Kill Every One of the Bastards", "Another Militia Attack", "I'll Save Some for You", "You Can't Do This Alone",
    "For an Outlaw Biker", "Where's My Damn Rings?", "For the Benefit of Others", "I'm Not a Ripper",
    "There's Nothing You Can Do"
  ]
};

const categoryKeys = ["encampmentjobs", "nerosites", "ambushcamps", "infestations", "hordes"];
const activityCategories = Object.fromEntries(categoryKeys.map((key) => [key, baseCatalog.categories[key]]));
const titleKey = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const campTitles = new Set(activityCategories.encampmentjobs.titles.map((entry) => titleKey(entry.title)));
const activityAliases = new Set(categoryKeys.flatMap((key) => activityCategories[key].titles.flatMap((entry) => [entry.title, ...(entry.aliases || [])])).map(titleKey));

const allMissions = regions.flatMap((region) => missionGroups[region].map((title) => ({ title, region })));
const missions = allMissions
  .filter((entry) => !campTitles.has(titleKey(entry.title)))
  .filter((entry) => !activityAliases.has(titleKey(entry.title)));
const mergedMissionKeys = new Set(allMissions.filter((entry) => !missions.some((mission) => titleKey(mission.title) === titleKey(entry.title))).map((entry) => titleKey(entry.title)));

const checkpointRegions = new Map([
  ["Horse Lake NERO Checkpoint", "Cascade"], ["Little Bear Lake NERO Checkpoint", "Cascade"],
  ["Old Pioneer Cemetery NERO Checkpoint", "Cascade"], ["Marion Forks Tunnel NERO Checkpoint", "Belknap"],
  ["Old Sawmill NERO Checkpoint", "Lost Lake"], ["Rogue Tunnel NERO Checkpoint", "Lost Lake"],
  ["Iron Butte Pass NERO Checkpoint", "Iron Butte"], ["Spruce Lake NERO Checkpoint", "Crater Lake"],
  ["Volcanic Legacy Scenic Byway NERO Checkpoint", "Crater Lake"], ["Chemult Community College NERO Checkpoint", "Highway 97"],
  ["Pillette Bridge NERO Checkpoint", "Highway 97"], ["Santiam Tunnel NERO Checkpoint", "Highway 97"]
]);

activityCategories.nerosites.titles = activityCategories.nerosites.titles.map((entry) => ({ ...entry, region: checkpointRegions.get(entry.title) || entry.region || "Endgame" }));

const categories = {
  storymissions: { label: "Story Missions", titles: missions },
  ...activityCategories
};

const counterDefinitions = {
  storymissions: ["Story Missions", "STORY", "route", "#f6c453", allMissions.length, 8],
  encampmentjobs: ["Camp Jobs", "CAMP", "camp", "#84cc16", 34, 5],
  nerosites: ["NERO Checkpoints", "NERO", "research", "#22d3ee", 12, 5],
  ambushcamps: ["Ambush Camps", "AMB", "ambush", "#ef4444", 14, 8],
  infestations: ["Infestation Zones", "INF", "infestation", "#f97316", 12, 7],
  hordes: ["Hordes", "HORDE", "horde", "#dc2626", 40, 11]
};

const counters = Object.fromEntries(Object.entries(counterDefinitions).map(([key, [label, overlayLabel, icon, accent, max, paceWeight]]) => [key, {
  label, shortLabel: label, queueLabel: label, overlayLabel, icon, accent,
  description: `All ${label.toLowerCase()} required by the All Storylines route.`,
  requirement: `Complete all ${max} ${label.toLowerCase()}.`, max, paceWeight
}]));

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const regionFor = (entry) => entry.region === "South Oregon" || entry.region === "Story" ? "Endgame" : entry.region || "Endgame";
const ordered = [];
for (const region of regions) {
  for (const mission of missions.filter((entry) => entry.region === region)) ordered.push({ counterKey: "storymissions", ...mission });
  for (const key of categoryKeys) {
    for (const entry of categories[key].titles.filter((item) => item.countsTowardCounter !== false && regionFor(item) === region)) {
      ordered.push({ counterKey: key, ...entry, region });
    }
  }
}

const phaseIds = Object.fromEntries(regions.map((region) => [region, slug(region)]));
const seenPhase = new Set();
const storyHordeMissions = new Set(["you alone i have seen", "keep them safe", "i ll save some for you"]);
function autoFor(entry) {
  const auto = {};
  const names = [entry.title, ...(entry.aliases || [])].map(titleKey);
  if (entry.counterKey !== "storymissions" && names.some((name) => mergedMissionKeys.has(name))) auto.storymissions = 1;
  if (entry.counterKey === "storymissions" && storyHordeMissions.has(titleKey(entry.title))) auto.hordes = 1;
  return auto;
}
const splits = ordered.map((entry) => {
  const phaseId = phaseIds[entry.region];
  const goalId = `completion-${entry.counterKey}-${slug(entry.title)}`;
  const split = {
    id: `${phaseId}-${slug(entry.title)}`,
    label: entry.title,
    note: `${counterDefinitions[entry.counterKey][0]} · ${entry.region}`,
    phaseId,
    isPhaseStart: !seenPhase.has(phaseId),
    auto: autoFor(entry),
    ocrGoals: [{ id: goalId, type: "completion", label: entry.title, counterKey: entry.counterKey, optional: false }],
    ocrCompletion: { mode: "allGoalGroups", groups: [[goalId]] }
  };
  seenPhase.add(phaseId);
  return split;
});

const visible = Object.keys(counterDefinitions);
const phases = Object.fromEntries(regions.map((region, index) => [phaseIds[region], {
  label: region,
  description: `${region} mission and activity completions only.`,
  note: "Collectibles, trophies, cairns, injectors, IPCA tech, and pickup counters are intentionally excluded.",
  objectiveNote: "Advance by mission and world-activity completion popups.",
  targetMinutes: [180, 360, 780, 900, 1200, 1320, 960][index],
  visible
}]));

const running = Object.fromEntries(visible.map((key) => [key, 0]));
const quotas = { quotas: {} };
for (const region of regions) {
  for (const entry of ordered.filter((item) => item.region === region)) {
    running[entry.counterKey] += 1;
    for (const [key, value] of Object.entries(autoFor(entry))) running[key] += value;
  }
  quotas.quotas[phaseIds[region]] = { label: region, targets: Object.fromEntries(Object.entries(running).filter(([, value]) => value > 0)) };
}

await mkdir(routeRoot, { recursive: true });
const save = (name, value) => writeFile(path.join(routeRoot, name), `${JSON.stringify(value, null, 2)}\n`);
await Promise.all([
  save("counters.json", counters),
  save("completion-titles.json", { categories }),
  save("default-splits.json", { splits }),
  save("phases.json", phases),
  save("quotas.json", quotas),
  save("nero-ipca-clusters.json", { clusters: [] }),
  save("pace-benchmark.json", {})
]);

console.log(`All Storylines route: ${allMissions.length} story missions, ${splits.length} unique objective splits.`);
