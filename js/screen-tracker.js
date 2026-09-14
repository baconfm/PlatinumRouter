import {
  bucketOcrLogEntries,
  buildOcrLogTimestamps,
  classifyOcrLogEvent
} from "./ocr-log.js";
import {
  classifyDaysGoneCompletion,
  isDaysGoneMissionCompleteAnchor
} from "./days-gone-completion.js";

const SETTINGS_KEY = "platinum-router-screen-tracker";
const DEFAULT_OBS_URL = "ws://127.0.0.1:4455";
const DEFAULT_COOLDOWN_MS = 18000;
// Ask OBS for the next frame as soon as practical. videoCaptureBusy prevents
// overlapping screenshot requests, so this is a best-effort 60 FPS ceiling
// rather than a source of queued OBS calls.
const DEFAULT_VIDEO_SCAN_INTERVAL_MS = 17;
const DAYS_GONE_TEXT_GATE_FORCE_MS = 8000;
const DAYS_GONE_VIDEO_CAPTURE_WIDTH = 1920;
const DAYS_GONE_VIDEO_CAPTURE_JPEG_QUALITY = 82;
// Keep distinct popup episodes until OCR has time to consume them. The old queue
// held only one frame per region and expired ordinary pickups after two seconds,
// which allowed a later popup to erase an earlier one during a burst.
const DAYS_GONE_VIDEO_OCR_QUEUE_MAX = 256;
const DAYS_GONE_VIDEO_OCR_WORKER_MAX = 4;
const DAYS_GONE_VIDEO_OCR_FALLBACK_FRAME_MAX = 2;
const DAYS_GONE_VIDEO_OCR_EPISODE_WINDOW_MS = 3000;
const DAYS_GONE_CENTER_FLURRY_PRE_ROLL_MS = 3000;
const DAYS_GONE_CENTER_FLURRY_QUIET_MS = 1800;
const DAYS_GONE_CENTER_FLURRY_MAX_MS = 12000;
const DAYS_GONE_CENTER_FLURRY_SAMPLE_MS = 100;
const DAYS_GONE_CENTER_FLURRY_FRAME_MAX = 12;
// Deliberately strict: false duplicates are cheaper than merging two different
// back-to-back collectible names into one episode and losing the first.
const DAYS_GONE_VIDEO_OCR_EPISODE_FINGERPRINT_DIFFERENCE = 0.16;
const DAYS_GONE_VIDEO_OCR_CENTER_FINGERPRINT_DIFFERENCE = 0.08;
const DAYS_GONE_RECOVERY_OCR_INTERVAL_MS = 1200;
const DAYS_GONE_REGION_OCR_MIN_INTERVAL_MS = {
  days_gone_ipca_pickup: 350,
  days_gone_top_right_title: 200,
  days_gone_top_right_wide_title: 450,
  days_gone_top_right_toast: 350,
  days_gone_right_mid_toast: 700,
  days_gone_pickup_left: 350
};
const DAYS_GONE_PERIODIC_FAILSAFE_REGIONS = new Set([
  "days_gone_top_right_title",
  "days_gone_top_right_wide_title",
  "days_gone_top_right_toast"
]);
const DAYS_GONE_IPCA_ANCHOR_WINDOW_MS = 10 * 60 * 1000;
const OCR_ENDPOINT = "/.router-api/ocr";
const OCR_DEBUG_ENDPOINT = "/.router-api/ocr-debug";
const OCR_LOG_ENDPOINT = "/.router-api/ocr-log";

function createVideoQueueStats() {
  return {
    frames: 0,
    queued: 0,
    processed: 0,
    dropped: 0,
    replaced: 0,
    stale: 0,
    overflow: 0,
    weakerDiscarded: 0,
    episodeFramesMerged: 0,
    episodesQueued: 0,
    recoveryAttempts: 0,
    recoveryMatches: 0,
    fallbackAttempts: 0,
    fallbackMatches: 0,
    centerFlurries: 0,
    centerFramesCancelled: 0,
    centerEarlyMatches: 0,
    visualChangeBypasses: 0,
    maxDepth: 0,
    maxWorkers: 0
  };
}
const OCR_RUN_LOG_KEY = "platinum-router-ocr-run-log-v1";
const OCR_RUN_SESSION_KEY = "platinum-router-ocr-run-session-v1";
const OCR_RUN_LOG_FILE_QUEUE_KEY = "platinum-router-ocr-run-log-file-queue-v1";
const OCR_RUN_LOG_MAX_ENTRIES = 2000;
const OCR_RUN_LOG_FILE_QUEUE_MAX_ENTRIES = 1000;
const OCR_RUN_LOG_FILE_BATCH_SIZE = 50;
const HAIKU_PROGRESS_KEY = "platinum-router-ghost-haiku-progress";
const TROPHY_PROGRESS_KEY = "platinum-router-ghost-trophy-progress";
export const DAYS_GONE_COLLECTIBLE_PROGRESS_KEY = "platinum-router-days-gone-collectible-progress";
export const DAYS_GONE_TROPHY_PROGRESS_KEY = "platinum-router-days-gone-trophy-progress";
export const DAYS_GONE_COMPLETION_PROGRESS_KEY = "platinum-router-days-gone-completion-progress";
export const DAYS_GONE_MISSED_GOALS_KEY = "platinum-router-days-gone-missed-goals";

const GHOST_TROPHY_CHECKLIST = [
  { id: "living-legend", title: "Living Legend", group: "Platinum" },
  { id: "gathering-storm", title: "Gathering Storm", group: "Story" },
  { id: "point-of-no-return", title: "Point of No Return", group: "Story" },
  { id: "company-of-wolves", title: "Company of Wolves", group: "Story" },
  { id: "stoking-the-flame", title: "Stoking the Flame", group: "Story" },
  { id: "family-reunion", title: "Family Reunion", group: "Story" },
  { id: "leader-of-the-people", title: "Leader of the People", group: "Story" },
  { id: "birthright", title: "Birthright", group: "Story" },
  { id: "dying-embers", title: "Dying Embers", group: "Story" },
  { id: "the-ghost", title: "The Ghost", group: "Story" },
  { id: "the-exiled-alliance", title: "The Exiled Alliance", group: "Story" },
  { id: "sovereign-end", title: "Sovereign End", group: "Story" },
  { id: "mono-no-aware", title: "Mono No Aware", group: "Story" },
  { id: "the-warrior-monk", title: "The Warrior Monk", group: "Tales" },
  { id: "the-vengeful-warrior", title: "The Vengeful Warrior", group: "Tales" },
  { id: "the-unbending-archer", title: "The Unbending Archer", group: "Tales" },
  { id: "the-headstrong-thief", title: "The Headstrong Thief", group: "Tales" },
  { id: "teller-of-tales", title: "Teller of Tales", group: "Tales" },
  { id: "helping-sword-hand", title: "Helping Sword Hand", group: "Tales" },
  { id: "flash-of-steel", title: "Flash of Steel", group: "Combat" },
  { id: "witness-protection", title: "Witness Protection", group: "Combat" },
  { id: "all-in-the-wrist", title: "All in the Wrist", group: "Combat" },
  { id: "open-for-business", title: "Open for Business", group: "Combat" },
  { id: "there-can-be-only-one", title: "There Can Be Only One", group: "Combat" },
  { id: "have-a-nice-fall", title: "Have a Nice Fall", group: "Combat" },
  { id: "haunting-precision", title: "Haunting Precision", group: "Combat" },
  { id: "the-ghost-of-legend", title: "The Ghost of Legend", group: "Growth" },
  { id: "quick-study", title: "Quick Study", group: "Growth" },
  { id: "every-trick-in-the-book", title: "Every Trick in the Book", group: "Growth" },
  { id: "the-perfect-storm", title: "The Perfect Storm", group: "Gear" },
  { id: "a-charming-man", title: "A Charming Man", group: "Gear" },
  { id: "gifted", title: "Gifted", group: "Collections" },
  { id: "slay", title: "Slay", group: "Collections" },
  { id: "light-the-way", title: "Light the Way", group: "Collections" },
  { id: "den-of-thieves", title: "Den of Thieves", group: "Collections" },
  { id: "favor-of-the-kami", title: "Favor of the Kami", group: "Collections" },
  { id: "honor-the-unseen", title: "Honor the Unseen", group: "Collections" },
  { id: "lost-and-found", title: "Lost and Found", group: "Collections" },
  { id: "monochrome-masters", title: "Monochrome Masters", group: "Collections" },
  { id: "cooper-clan-cosplayer", title: "Cooper Clan Cosplayer", group: "Collections" },
  { id: "dirge-of-the-fallen-forge", title: "Dirge of the Fallen Forge", group: "Collections" },
  { id: "a-moment-in-time", title: "A Moment in Time", group: "Collections" },
  { id: "avid-reader", title: "Avid Reader", group: "Collections" },
  { id: "know-your-enemy", title: "Know Your Enemy", group: "Collections" },
  { id: "body-mind-and-spirit", title: "Body, Mind, and Spirit", group: "Collections" },
  { id: "hero-of-the-people", title: "Hero of the People", group: "Liberation" },
  { id: "a-fight-for-the-isle", title: "A Fight For The Isle...", group: "Liberation" },
  { id: "good-riddance", title: "Good Riddance", group: "Liberation" },
  { id: "securing-sanctuary", title: "Securing Sanctuary...", group: "Liberation" },
  { id: "mass-eviction", title: "Mass Eviction", group: "Liberation" },
  { id: "a-new-safe-haven", title: "A New Safe Haven", group: "Liberation" },
  { id: "master-liberator", title: "Master Liberator", group: "Liberation" }
];

const GHOST_HAIKU_CHECKLIST = [
  { id: "hiyoshi-1", label: "Hiyoshi #1", location: "North of Hiyoshi Springs", rewardPhrases: ["headband of serenity"] },
  { id: "hiyoshi-2", label: "Hiyoshi #2", location: "South of Old Woodsman's Canopy", rewardPhrases: ["headband of peace"] },
  { id: "komoda", label: "Komoda", location: "Near Wolf Cub Falls", rewardPhrases: ["headband of defeat"] },
  { id: "azamo", label: "Azamo", location: "South of Kuta Grasslands", rewardPhrases: ["headband of the invasion"] },
  { id: "ariake", label: "Ariake", location: "Lake Izuhara island", rewardPhrases: ["headband of refuge"] },
  { id: "kashine", label: "Kashine", location: "West of Shigenori's Peak", rewardPhrases: ["headband of fear"] },
  { id: "komatsu", label: "Komatsu", location: "Black Sands Inlet", rewardPhrases: ["headband of strife"] },
  { id: "tsutsu", label: "Tsutsu", location: "North of Ohama Fishing Village", rewardPhrases: ["headband of death"] },
  { id: "akashima", label: "Akashima", location: "South of Old Kanazawa Marsh", rewardPhrases: ["headband of uncertainty"] },
  { id: "umugi", label: "Umugi", location: "Field of the Equinox Flower", rewardPhrases: ["headband of perseverance"] },
  { id: "otsuna", label: "Otsuna", location: "South of Musashi Coast", rewardPhrases: ["headband of survival"] },
  { id: "kushi", label: "Kushi", location: "North of Benkei's Falls", rewardPhrases: ["headband of preservation"] },
  { id: "kubara", label: "Kubara", location: "East of Kubara Forest", rewardPhrases: ["headband of rebirth"] },
  { id: "kin", label: "Kin", location: "North of Kin Sanctuary", rewardPhrases: ["headband of ruin"] },
  { id: "sago", label: "Sago", location: "West of Guardian's Ridge", rewardPhrases: ["headband of hope"] },
  { id: "jogaku", label: "Jogaku", location: "Whaler's Coast peak", rewardPhrases: ["headband of strength"] },
  { id: "gonoura-1", label: "Gonoura #1", location: "Lone Spirit Falls", rewardPhrases: ["headband of solace"] },
  { id: "gonoura-2", label: "Gonoura #2", location: "Senjo Gorge", rewardPhrases: ["headband of regret"] },
  { id: "yahata", label: "Yahata", location: "North of Tatsu's Ladder", rewardPhrases: ["headband of acceptance"] }
];

const GHOST_SIDE_TALE_CHARM_PHRASES = [
  "charm of advantage",
  "charm of bludgeoning",
  "charm of broken barriers",
  "charm of divine healing i",
  "charm of divine healing ii",
  "charm of dual destruction i",
  "charm of dual destruction ii",
  "charm of efficiency",
  "charm of enduring affliction",
  "charm of ferocity",
  "charm of fire doctrine",
  "charm of fortitude",
  "charm of fortunate return",
  "charm of fortune i",
  "charm of fortune ii",
  "charm of immunity",
  "charm of lost mind",
  "charm of precision",
  "charm of rejuvenation",
  "charm of resistance i",
  "charm of resistance ii",
  "charm of resistance iii",
  "charm of resolve i",
  "charm of resolve ii",
  "charm of shadows",
  "charm of swift return",
  "charm of the lost mind",
  "charm of uneven standing",
  "charm of unyielding i",
  "charm of unyielding ii",
  "charm of vitality",
  "charm of well-being i",
  "charm of well being i",
  "charm of well-being ii",
  "charm of well being ii",
  "yuriko s keepsake",
  "yuriko's keepsake",
  "yuriko’s keepsake"
];

const REGION_PRESETS = {
  route_expected: {
    label: "Route expected",
    dynamic: true
  },
  days_gone_unified: {
    label: "Days Gone buffered scanner (center OCR on)",
    dynamic: true
  },
  popup_fast: {
    label: "Popup fast",
    regions: ["trophy_toast", "trophy_toast_legacy", "artifact_toast", "completion_title", "charm_reward_title", "haiku_reward"]
  },
  smart_multi: {
    label: "Smart multi-region",
    regions: ["trophy_toast", "trophy_toast_legacy", "artifact_toast", "completion_title", "charm_reward_title", "haiku_reward", "lower_center"]
  },
  exhaustive_multi: {
    label: "Exhaustive multi-region",
    regions: ["trophy_toast", "trophy_toast_legacy", "completion_title", "top_center", "artifact_toast", "toast_right", "toast_lower_right", "banner_center", "mission_center", "charm_reward", "haiku_reward", "lower_center", "wide_middle"]
  },
  trophy_toast: { label: "Trophy toast", x: 54, y: 2, width: 45, height: 15 },
  trophy_toast_legacy: { label: "Legacy trophy toast", x: 64, y: 2, width: 35, height: 15 },
  days_gone_top_right_title: { label: "Days Gone top-right title", x: 78, y: 1, width: 21.5, height: 5 },
  days_gone_top_right_wide_title: { label: "Days Gone wide top-right title", x: 60, y: 1, width: 39.5, height: 5 },
  days_gone_top_right_toast: { label: "Days Gone top-right toast", x: 54, y: 1, width: 46, height: 16 },
  days_gone_right_mid_toast: { label: "Days Gone right-mid toast", x: 78, y: 36, width: 21, height: 20 },
  // Keep this below the persistent lower-left HUD. The old 0/59/18/16 crop
  // treated unrelated loot and overlay text as IPCA candidates for most of a
  // run; the pickup stack itself consistently occupies this tighter band.
  days_gone_ipca_pickup: { label: "Days Gone IPCA pickup", x: 0, y: 65, width: 16, height: 14 },
  days_gone_pickup_left: { label: "Days Gone pickup left", x: 0, y: 50, width: 26, height: 40 },
  days_gone_completion_anchor: { label: "Days Gone completion anchor", x: 2, y: 4, width: 39, height: 15 },
  days_gone_completion_title: { label: "Days Gone completion title", x: 23, y: 53, width: 54, height: 15 },
  gta_center_event: { label: "GTA III center event", x: 23, y: 25, width: 56, height: 31 },
  gta_wide_notice: { label: "GTA III wide notice", x: 8, y: 30, width: 84, height: 20 },
  gta_trophy_toast: { label: "GTA III trophy toast", x: 63, y: 1, width: 36, height: 15 },
  completion_title: { label: "Completion title", x: 30, y: 14, width: 40, height: 12 },
  top_center: { label: "Top center pickup", x: 20, y: 1, width: 60, height: 7 },
  artifact_toast: { label: "Artifact toast", x: 62, y: 42, width: 37, height: 24 },
  toast_right: { label: "Right toast", x: 55, y: 34, width: 44, height: 34 },
  toast_lower_right: { label: "Lower right toast", x: 54, y: 50, width: 45, height: 28 },
  banner_center: { label: "Center banner", x: 18, y: 8, width: 64, height: 38 },
  mission_center: { label: "Mission title", x: 14, y: 22, width: 72, height: 30 },
  charm_reward: { label: "Charm reward", x: 4, y: 18, width: 66, height: 42 },
  charm_reward_title: { label: "Charm reward title", x: 6, y: 48, width: 48, height: 24 },
  haiku_reward: { label: "Haiku reward title", x: 35, y: 63, width: 30, height: 7 },
  lower_center: { label: "Lower objective", x: 16, y: 50, width: 68, height: 28 },
  wide_middle: { label: "Wide middle", x: 8, y: 12, width: 84, height: 62 },
  full: { label: "Full frame", x: 0, y: 0, width: 100, height: 100 }
};

// Every Days Gone region participates in the cheap visual gate. OCR itself is
// asynchronous and consumes retained popup episodes without delaying capture.
const DAYS_GONE_LIVE_DISABLED_REGION_IDS = new Set();

const COUNTER_REGION_MAP = {
  trophies: ["trophy_toast", "trophy_toast_legacy"],
  artifacts: ["artifact_toast"],
  records: ["artifact_toast"],
  crickets: ["artifact_toast"],
  bamboo: ["completion_title"],
  inari: ["completion_title"],
  haiku: ["haiku_reward"],
  sidetales: ["charm_reward_title"],
  hotsprings: ["completion_title"],
  shrines: ["completion_title"],
  mythictales: ["completion_title"],
  territories: ["completion_title"],
  charactercollectibles: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  herbology: ["days_gone_top_right_title", "days_gone_top_right_toast", "days_gone_pickup_left"],
  tourism: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  rippersermons: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  historical: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  nerointel: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  sarahlabnotes: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  radiofreeoregon: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  colonelspeeches: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  songs: ["days_gone_top_right_title", "days_gone_top_right_toast"],
  nerosites: ["days_gone_top_right_toast"],
  ipca: ["days_gone_ipca_pickup"],
  ambushcamps: ["days_gone_top_right_toast"],
  infestations: ["days_gone_top_right_toast"],
  hordes: ["days_gone_top_right_toast"],
  encampmentjobs: ["days_gone_top_right_toast"],
  hiddenpackages: ["gta_center_event"],
  rampages: ["gta_center_event"],
  uniquejumps: ["gta_center_event"],
  vehicledeliveries: ["gta_wide_notice"],
  storymissions: ["gta_center_event"],
  routesignals: ["gta_center_event"]
};

const GHOST_RULES = [
  {
    counterKey: "trophies",
    label: "Trophy",
    phrases: ["trophy earned", "trophy", ...GHOST_TROPHY_CHECKLIST.map((entry) => entry.title)],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "artifacts",
    label: "Mongol Artifact",
    phrases: ["mongol artifacts", "mongol artifact", "mongol artefacts", "mongol artefact", "artifacts", "artifact", "artefacts", "artefact"],
    countSync: true,
    autoSync: true
  },
  { counterKey: "records", label: "Record", phrases: ["records", "record collected"], countSync: true, autoSync: true },
  { counterKey: "inari", label: "Fox Den", phrases: ["inari shrine honored", "inari shrine honoured"], autoSync: true },
  { counterKey: "hotsprings", label: "Hot Spring", phrases: ["hot spring"] },
  {
    counterKey: "bamboo",
    label: "Bamboo Strike",
    phrases: ["bamboo strike completed", "bamboo strike complete", "bamboo strike"],
    requireAny: ["complete", "completed"]
  },
  {
    counterKey: "haiku",
    label: "Haiku",
    phrases: ["haiku", ...GHOST_HAIKU_CHECKLIST.flatMap((entry) => entry.rewardPhrases || [])],
    autoSyncPhrases: GHOST_HAIKU_CHECKLIST.flatMap((entry) => entry.rewardPhrases || [])
  },
  { counterKey: "shrines", label: "Shinto Shrine", phrases: ["shinto shrine"] },
  { counterKey: "lighthouses", label: "Lighthouse", phrases: ["lighthouse"] },
  { counterKey: "crickets", label: "Singing Cricket", phrases: ["singing crickets", "singing cricket"], countSync: true, autoSync: true },
  { counterKey: "hiddenaltars", label: "Hidden Altar", phrases: ["hidden altar"] },
  { counterKey: "territories", label: "Territory", phrases: ["territory liberated", "liberated", "mongol territory"] },
  { counterKey: "mythictales", label: "Mythic Tale", phrases: ["mythic tale"] },
  {
    counterKey: "sidetales",
    label: "Side Tale",
    phrases: GHOST_SIDE_TALE_CHARM_PHRASES,
    autoSyncWhenExpected: true
  }
];

const DAYS_GONE_HERBOLOGY_PHRASES = [
  "bearberry",
  "black currant",
  "bristly manzanita",
  "bunchberry",
  "cloudberry",
  "crowberry",
  "desert hackberry",
  "golden currant",
  "salmon berry",
  "salmonberry",
  "agoseris",
  "arrowhead",
  "beargrass",
  "bear grass",
  "bistort",
  "bitterroot",
  "bitter root",
  "blue camas",
  "bulrush",
  "coltsfoot",
  "indian pipe",
  "mayweed",
  "mountain sorrel",
  "silverweed",
  "stone crop",
  "stonecrop",
  "wild bergamot",
  "wood lily",
  "lavender",
  "golden chanterelle",
  "horn of plenty",
  "ink cap",
  "king bolete",
  "king bolette",
  "larch bolete",
  "mica cap",
  "scaly hedgehog",
  "water hemlock"
];

const DAYS_GONE_SONG_PHRASES = [
  "yesterday",
  "mirrors",
  "our lies",
  "perfect",
  "she s my drug",
  "she's my drug",
  "shes my drug",
  "sun won t shine",
  "sun won't shine",
  "sun wont shine"
];

const DAYS_GONE_HERBOLOGY_CHECKLIST_TITLES = [
  "Bearberry",
  "Black Currant",
  "Bristly Manzanita",
  "Bunchberry",
  "Cloudberry",
  "Crowberry",
  "Desert Hackberry",
  "Golden Currant",
  "Salmon Berry",
  "Agoseris",
  "Arrowhead",
  "Beargrass",
  "Bistort",
  "Bitterroot",
  "Blue Camas",
  "Bulrush",
  "Coltsfoot",
  "Indian Pipe",
  "Mayweed",
  "Mountain Sorrel",
  "Silverweed",
  "Stone Crop",
  "Wild Bergamot",
  "Wood Lily",
  "Lavender",
  "Golden Chanterelle",
  "Horn of Plenty",
  "Ink Cap",
  "King Bolete",
  "Larch Bolete",
  "Mica Cap",
  "Scaly Hedgehog",
  "Water Hemlock"
];

const DAYS_GONE_SONG_CHECKLIST_TITLES = [
  "Yesterday",
  "Mirrors",
  "Our Lies",
  "Perfect",
  "She's My Drug",
  "Sun Won't Shine"
];

const DAYS_GONE_NERO_INTEL_CHECKLIST_TITLES = [
  "Researcher Field Note - 2000",
  "Researcher Field Note - 2064",
  "Researcher Field Note - 2068",
  "Researcher Field Note - 2060",
  "Flight Data Recording - 2044",
  "Field Recording - 2011",
  "Flight Data Recording - 1787",
  "Flight Data Recording - 1377",
  "Flight Data Recording - 2041",
  "Flight Data Recording - 2097",
  "Researcher Field Note - 2102",
  "Nero Evacuation Notice",
  "Nero Site Order - TS-03-900SQM",
  "Mobile Medical Site Order - TS-27-760GDQ",
  "Mobile Medical Unit Recording - 0980",
  "Field Recording - 1260",
  "Mobile Medical Unit Recording - 1111",
  "Mobile Medical Unit Recording - 1231",
  "Mobile Medical Unit Recording - 1301",
  "Mobile Medical Unit Recording - 0805",
  "Field Recording - 1577",
  "Mobile Medical Unit Recording - 1788",
  "Mobile Medical Unit Recording - 0817",
  "Researcher Field Note - 0988",
  "Researcher Field Note - 0701",
  "Researcher Field Note - 1677",
  "Mobile Medical Unit Recording - 1682",
  "Black Box Recording - 1001",
  "Mobile Medical Unit Recording - 0820",
  "Researcher Field Note - 2069",
  "Researcher Field Note - 1735",
  "Researcher Field Note - 2073",
  "Researcher Field Note - 1960",
  "Researcher Field Note - 1463",
  "Researcher Field Note - 1833",
  "Researcher Field Note - 2072",
  "Researcher Field Note - 2043",
  "Mobile Medical Unit Recording - 1685",
  "Researcher Field Note - 2020",
  "Researcher Field Note - 1005",
  "Researcher Field Note - 2006",
  "Researcher Field Note - 2071",
  "Researcher Field Note - 2104",
  "Researcher Field Note - 2105",
  "Researcher Field Note - 2106",
  "Inspector Field Note - 1375",
  "Inspector Field Note - 1376",
  "Inspector Field Note - 1381",
  "Inspector Field Note - 1674",
  "Inspector Field Note - 1680",
  "Mobile Medical Unit Recording - 1683",
  "Researcher Field Note - 2055"
];

const DAYS_GONE_RADIO_CHECKLIST_TITLES = [
  "NERO Death Camps",
  "It's All A Lie",
  "My Cold Dead Hands",
  "Numb The People",
  "Home Of The Free",
  "The Dead Can't Speak",
  "The Just Shall Not Starve",
  "Bunker Down",
  "Animals Don't Watch The Sky",
  "Global Conspiracy",
  "The Federal Ark",
  "The Black Helicopters",
  "They're Coming For Us",
  "The Advanced Guard",
  "Built To Last",
  "Traitors Shall Hang",
  "Cleanse Our Minds",
  "The Earth Is Ours",
  "Property Rights",
  "We Are Watching"
];

const DAYS_GONE_SPEECH_CHECKLIST_TITLES = [
  "We Do Not Discriminate",
  "We Must Fill the Ark",
  "Throw Them Into the Furnace",
  "My Eyes Have Been Opened",
  "Evil Surrounds Us",
  "Shadow of Death"
];

const DAYS_GONE_LAB_NOTE_CHECKLIST_TITLES = [
  "Deacon's Alive???",
  "Yeast",
  "Silicate",
  "Riding With Deacon",
  "The Cloverdale Virus",
  "Teensy Tabby"
];

function getDaysGoneExtraCollectiblePhrases(entry = {}) {
  const title = String(entry.title || "");
  const extras = [...(entry.extraPhrases || [])];

  if (entry.counterKey === "herbology" && title === "Crowberry") {
    extras.push("Crowherry", "Crow Herry", "Crovvberry", "Crawberry");
  }

  if (entry.counterKey === "nerointel") {
    if (title === "Inspector Field Note - 1381") {
      // Observed in the JamCar full-run scan. Keep these aliases deliberately
      // narrow so the corrupted number cannot match a different field note.
      extras.push("Inspector Field Nowe 1278", "Inspector Field Note 1278");
    }

    if (title === "Mobile Medical Site Order - TS-27-760GDQ") {
      extras.push(
        "Mobile Medical Site Order TS 27 760600",
        "Medical Site Order TS 27 760600"
      );
    }

    const numberMatch = title.match(/(\d{4})(?!.*\d)/);
    if (numberMatch) {
      const number = numberMatch[1];
      const variants = new Set();

      if (number.startsWith("1")) {
        variants.add(`L${number.slice(1)}`);
        variants.add(`I${number.slice(1)}`);
      }
      if (number.startsWith("0")) {
        variants.add(`O${number.slice(1)}`);
        variants.add(`U${number.slice(1)}`);
      }
      if (number.includes("0")) variants.add(number.replace(/0/g, "O"));
      if (number.includes("1")) {
        variants.add(number.replace(/1/g, "I"));
        variants.add(number.replace(/1/g, "L"));
      }

      variants.forEach((variant) => {
        extras.push(title.replace(number, variant));
      });
    }
  }

  return extras;
}

export const DAYS_GONE_COLLECTIBLE_CHECKLIST = [
  { counterKey: "charactercollectibles", group: "Characters", no: 1, title: "Leon - Crude Drawing of an Angel Statue", extraPhrases: ["finders keepers"] },
  { counterKey: "charactercollectibles", group: "Characters", no: 2, title: "Copeland - The Right to Bear Arms" },
  { counterKey: "charactercollectibles", group: "Characters", no: 3, title: "Copeland - Hunting Season" },
  { counterKey: "charactercollectibles", group: "Characters", no: 4, title: "Manny - Happy Birthday, Stud" },
  { counterKey: "charactercollectibles", group: "Characters", no: 5, title: "Manny - Zen and the Art of Bike Repair" },
  { counterKey: "charactercollectibles", group: "Characters", no: 6, title: "Tucker - Trust No One" },
  { counterKey: "charactercollectibles", group: "Characters", no: 7, title: "Tucker - I Can't Go On" },
  { counterKey: "charactercollectibles", group: "Characters", no: 8, title: "Alkai - A Portrait of Salome" },
  { counterKey: "charactercollectibles", group: "Characters", no: 9, title: "Lisa - Have a Good Day" },
  { counterKey: "charactercollectibles", group: "Characters", no: 10, title: "Lisa - I Can't Forget" },
  { counterKey: "charactercollectibles", group: "Characters", no: 11, title: "Boozer - Our Only Guest" },
  { counterKey: "charactercollectibles", group: "Characters", no: 12, title: "Boozer - My Beautiful Wife" },
  { counterKey: "charactercollectibles", group: "Characters", no: 13, title: "Rikki - Wrench in Hand" },
  {
    counterKey: "charactercollectibles",
    group: "Characters",
    no: 14,
    title: "Rikki - Your Lamp in the Sky",
    extraPhrases: ["your lamp in the sky"]
  },
  {
    counterKey: "charactercollectibles",
    group: "Characters",
    no: 15,
    title: "Skizzo - The Shit List",
    extraPhrases: ["the shit list"]
  },
  { counterKey: "charactercollectibles", group: "Characters", no: 16, title: "Skizzo - With Honors" },
  { counterKey: "charactercollectibles", group: "Characters", no: 17, title: "Iron Mike - I'll Always Be With You" },
  { counterKey: "charactercollectibles", group: "Characters", no: 18, title: "Iron Mike - Let There Be Peace" },
  { counterKey: "charactercollectibles", group: "Characters", no: 19, title: "Addy - Straying From the Path of God" },
  { counterKey: "charactercollectibles", group: "Characters", no: 20, title: "Addy - The Old Generator" },
  { counterKey: "charactercollectibles", group: "Characters", no: 21, title: "Colonel - Sleepy Tea" },
  { counterKey: "charactercollectibles", group: "Characters", no: 22, title: "Colonel - The Good Book" },
  { counterKey: "charactercollectibles", group: "Characters", no: 23, title: "Kouri - To Have And to Hold" },
  { counterKey: "charactercollectibles", group: "Characters", no: 24, title: "Kouri - To Protect and Serve" },
  { counterKey: "charactercollectibles", group: "Characters", no: 25, title: "Doc Jiminez - Doctor Arturo" },
  { counterKey: "charactercollectibles", group: "Characters", no: 26, title: "Weaver - Look to the Stars" },
  { counterKey: "charactercollectibles", group: "Characters", no: 27, title: "Weaver - Chemical Reactions" },
  { counterKey: "charactercollectibles", group: "Characters", no: 28, title: "Taylor - Flying High" },
  { counterKey: "charactercollectibles", group: "Characters", no: 29, title: "Taylor - Delivery Boy" },
  { counterKey: "charactercollectibles", group: "Characters", no: 30, title: "Sarah - My Old Lady" },
  { counterKey: "charactercollectibles", group: "Characters", no: 31, title: "Jessie - Riding With the Mongrels" },
  { counterKey: "charactercollectibles", group: "Characters", no: 32, title: "Jessie - They Shall Be Of One Mind" },
  { counterKey: "charactercollectibles", group: "Characters", no: 33, title: "Jim - Advisory Warning" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 1, title: "Fear the Rising" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 2, title: "Don't Run" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 3, title: "Pain is a Gift" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 4, title: "Set You Free" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 5, title: "Destroy Your Ego" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 6, title: "Sacrifice for Freedom" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 7, title: "One Mind" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 8, title: "Founder's Tale" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 9, title: "The Ultimate Goal" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 10, title: "Rest In Peace" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 11, title: "The Free" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 12, title: "The Rising is Coming" },
  { counterKey: "rippersermons", group: "R.I.P. Sermons", no: 13, title: "Join or Die" },
  { counterKey: "tourism", group: "Tourism", no: 1, title: "Old Pioneer Cemetery Brochure" },
  { counterKey: "tourism", group: "Tourism", no: 2, title: "Hungry Jim's Menu" },
  { counterKey: "tourism", group: "Tourism", no: 3, title: "Marion Forks Bumper Stickers" },
  { counterKey: "tourism", group: "Tourism", no: 4, title: "Marion Forks Postcards" },
  { counterKey: "tourism", group: "Tourism", no: 5, title: "The Benefits of Bear Creek Hotsprings" },
  { counterKey: "tourism", group: "Tourism", no: 6, title: "Salome Hot Springs Guestbook" },
  { counterKey: "tourism", group: "Tourism", no: 7, title: "Bears? Where?! Black Bear Awareness Poster" },
  { counterKey: "tourism", group: "Tourism", no: 8, title: "Belknap Fire Season Warning Sign" },
  { counterKey: "tourism", group: "Tourism", no: 9, title: "Seeking Gorgeous Man" },
  { counterKey: "tourism", group: "Tourism", no: 10, title: "Frontier Motel Brochures" },
  { counterKey: "tourism", group: "Tourism", no: 11, title: "Sherman's Camp Brochure" },
  { counterKey: "tourism", group: "Tourism", no: 12, title: "Meet The Campfire Cadets" },
  { counterKey: "tourism", group: "Tourism", no: 13, title: "Sherman's Camp Farmer's Market Poster" },
  { counterKey: "tourism", group: "Tourism", no: 14, title: "Rogue Camp Whiskey Menu" },
  { counterKey: "tourism", group: "Tourism", no: 15, title: "Preserving The Beauty of Crater Lake Poster" },
  { counterKey: "tourism", group: "Tourism", no: 16, title: "Crater Lake Postcards" },
  { counterKey: "tourism", group: "Tourism", no: 17, title: "Fishing At Diamond Lake Village" },
  { counterKey: "tourism", group: "Tourism", no: 18, title: "Chemult Suds-Fest" },
  { counterKey: "tourism", group: "Tourism", no: 19, title: "Balloons Over Chemult" },
  { counterKey: "tourism", group: "Tourism", no: 20, title: "Take Out & Tunes" },
  { counterKey: "tourism", group: "Tourism", no: 21, title: "Pet Parade" },
  { counterKey: "tourism", group: "Tourism", no: 22, title: "Chemult Community College Green Week Poster" },
  { counterKey: "tourism", group: "Tourism", no: 23, title: "Chemult Ski Resort Brochure" },
  { counterKey: "tourism", group: "Tourism", no: 24, title: "Klamath Marsh Wetlands Preservation Flyer" },
  { counterKey: "tourism", group: "Tourism", no: 25, title: "Iron Butte Ranch Masters Tournament" },
  { counterKey: "tourism", group: "Tourism", no: 26, title: "Adam Finch Stout Label" },
  { counterKey: "tourism", group: "Tourism", no: 27, title: "Snowbrush Ranch Alpaca Farm" },
  { counterKey: "tourism", group: "Tourism", no: 28, title: "Classified Virus Research" },
  {
    counterKey: "historical",
    group: "Historical Markers",
    no: 1,
    title: "Peter Skene Ogden - Fur Trade Warrior",
    extraPhrases: [
      "peter skene ogden",
      "pete skene ogden",
      "peter skene",
      "fur trade warrior",
      "fur trade"
    ]
  },
  { counterKey: "historical", group: "Historical Markers", no: 2, title: "Grotto Caves - The Buried Caves" },
  { counterKey: "historical", group: "Historical Markers", no: 3, title: "Caldera Reservoir - Bombs In The River" },
  { counterKey: "historical", group: "Historical Markers", no: 4, title: "Rainbow Falls - Path Of The Spirits" },
  { counterKey: "historical", group: "Historical Markers", no: 5, title: "Peaceful Lake - Battle on the Misty Lake" },
  { counterKey: "historical", group: "Historical Markers", no: 6, title: "Teller Cabin - The Horror House" },
  { counterKey: "historical", group: "Historical Markers", no: 7, title: "Belknap Crater - Belknap's Volcano" },
  { counterKey: "historical", group: "Historical Markers", no: 8, title: "Salome Hot Springs - The Salt Springs" },
  { counterKey: "historical", group: "Historical Markers", no: 9, title: "Belknap Caves - The Lava River Caves" },
  { counterKey: "historical", group: "Historical Markers", no: 10, title: "McKenzie Pass - Robber's Pass" },
  { counterKey: "historical", group: "Historical Markers", no: 11, title: "Indigenous Petroglyphs - Stories in Stone" },
  { counterKey: "historical", group: "Historical Markers", no: 12, title: "Memorial of The Unknown Mailman - Pioneer Mailman" },
  { counterKey: "historical", group: "Historical Markers", no: 13, title: "Three Fingered Jack Viewpoint - Old Hot Fingers" },
  { counterKey: "historical", group: "Historical Markers", no: 14, title: "The Lava Arch - Lava River Cave" },
  { counterKey: "historical", group: "Historical Markers", no: 15, title: "Berley Lake - The Moon Country" },
  { counterKey: "historical", group: "Historical Markers", no: 16, title: "Moon Trees - Grown From Outer Space" },
  { counterKey: "historical", group: "Historical Markers", no: 17, title: "Metolius Lava Cave - Distillery Cave" },
  { counterKey: "historical", group: "Historical Markers", no: 18, title: "Architectural Memorial - The Community Builder" },
  { counterKey: "historical", group: "Historical Markers", no: 19, title: "Booker-Hicks Logging Camp - The Wandering Timber Town" },
  { counterKey: "historical", group: "Historical Markers", no: 20, title: "Camp Pioneer - The Grand Campsite" },
  { counterKey: "historical", group: "Historical Markers", no: 21, title: "Lost Cabin Mine - The Goldmine" },
  { counterKey: "historical", group: "Historical Markers", no: 22, title: "Crater Lake - The Volcanic Lake" },
  { counterKey: "historical", group: "Historical Markers", no: 23, title: "Crater Lake - The Native American Legend" },
  { counterKey: "historical", group: "Historical Markers", no: 24, title: "Outlaw Memorial - The Oregon Legend" },
  { counterKey: "historical", group: "Historical Markers", no: 25, title: "Captain Jack - The Modoc Warrior" },
  {
    counterKey: "historical",
    group: "Historical Markers",
    no: 26,
    title: "The 45th Parallel - The Halfway Point",
    extraPhrases: [
      "45h parallel the halfway point",
      "457h parallel the halfway point",
      "1th parallel the halfway point"
    ]
  },
  { counterKey: "historical", group: "Historical Markers", no: 27, title: "Crater Lake - The Old Man Of The Lake" },
  { counterKey: "historical", group: "Historical Markers", no: 28, title: "Mazama Village - The New Deal Projects" },
  { counterKey: "historical", group: "Historical Markers", no: 29, title: "Mazama Falls - The Silent Falls" },
  { counterKey: "historical", group: "Historical Markers", no: 30, title: "The Phantom Ship - The Ghost On The Water" },
  { counterKey: "historical", group: "Historical Markers", no: 31, title: "Camp Adair - The War Games" },
  { counterKey: "historical", group: "Historical Markers", no: 32, title: "Gentleman Bandit Memorial - Poetic Justice" },
  { counterKey: "historical", group: "Historical Markers", no: 33, title: "Bill The Grey Fox Miner - Oregon's Worst Bandit" },
  { counterKey: "historical", group: "Historical Markers", no: 34, title: "The Stagecoach Legend - Rushing for Gold" },
  { counterKey: "historical", group: "Historical Markers", no: 35, title: "Japanese Balloon Bomb - The Casualties of War" },
  { counterKey: "historical", group: "Historical Markers", no: 36, title: "Margaret Alice Miller - The Guardian Angel" },
  { counterKey: "historical", group: "Historical Markers", no: 37, title: "Devil's Lake - View Of The Cascades" },
  { counterKey: "historical", group: "Historical Markers", no: 38, title: "Waloo Lake - The Oregon Conservationist" },
  { counterKey: "historical", group: "Historical Markers", no: 39, title: "Snowbrush Ranch - The First Alpaca Farm" },
  { counterKey: "historical", group: "Historical Markers", no: 40, title: "Iron Butte Ranch - The Summer Marsh" },
  { counterKey: "historical", group: "Historical Markers", no: 41, title: "Iron Butte - The Iron Mountain" },
  { counterKey: "historical", group: "Historical Markers", no: 42, title: "Lucky Lad Mine - The Gold Rush Mine" },
  { counterKey: "historical", group: "Historical Markers", no: 43, title: "Iron Butte Meteorite - Gift From the Sky" },
  ...DAYS_GONE_HERBOLOGY_CHECKLIST_TITLES
    .map((title, index) => ({ counterKey: "herbology", group: "Herbology", no: index + 1, title })),
  ...DAYS_GONE_SONG_CHECKLIST_TITLES
    .map((title, index) => ({ counterKey: "songs", group: "Camp Guitar Songs", no: index + 1, title })),
  ...DAYS_GONE_NERO_INTEL_CHECKLIST_TITLES
    .map((title, index) => ({ counterKey: "nerointel", group: "NERO Intel", no: index + 1, title })),
  ...DAYS_GONE_RADIO_CHECKLIST_TITLES
    .map((title, index) => ({ counterKey: "radiofreeoregon", group: "Radio Free Oregon", no: index + 1, title })),
  ...DAYS_GONE_SPEECH_CHECKLIST_TITLES
    .map((title, index) => ({ counterKey: "colonelspeeches", group: "Colonel Speeches", no: index + 1, title })),
  ...DAYS_GONE_LAB_NOTE_CHECKLIST_TITLES
    .map((title, index) => ({ counterKey: "sarahlabnotes", group: "Sarah Lab Notes", no: index + 1, title }))
].map((entry) => ({
  ...entry,
  id: `${entry.counterKey}-${String(entry.no).padStart(2, "0")}`,
  phrases: entry.manualOnly ? [] : [
    entry.title,
    entry.title.replace(/\s+-\s+/g, " "),
    entry.title.replace(/'/g, ""),
    ...getDaysGoneExtraCollectiblePhrases(entry)
  ]
}));

export const DAYS_GONE_TROPHY_CHECKLIST = [
  { id: "one-percenter", title: "One Percenter", group: "Platinum" },
  { id: "just-a-flesh-wound", title: "Just a Flesh Wound", group: "Story" },
  { id: "special-delivery", title: "Special Delivery", group: "Story" },
  { id: "the-ends-and-the-means", title: "The Ends and the Means", group: "Story" },
  { id: "lost-and-found", title: "Lost and Found", group: "Story" },
  { id: "brothers-in-arm", title: "Brothers in Arm", group: "Story" },
  { id: "take-back-your-name", title: "Take Back Your Name", group: "Story" },
  { id: "riding-nomad", title: "Riding NOMAD", group: "Story" },
  { id: "hold-on-tight", title: "Hold on Tight", group: "Story", linkedCollectibleId: "charactercollectibles-23" },
  { id: "its-getting-cold-outside", title: "It's Getting Cold Outside", group: "Story" },
  { id: "morior-invictus", title: "Morior Invictus", group: "Story" },
  { id: "ive-been-waiting-for-this", title: "I've Been Waiting for This", group: "Story" },
  { id: "days-done", title: "Days Done", group: "Story" },
  { id: "ambush-camp-hunter", title: "Ambush Camp Hunter", group: "Storylines" },
  { id: "infestation-exterminator", title: "Infestation Exterminator", group: "Storylines" },
  { id: "marauder-camp-hunter", title: "Marauder Camp Hunter", group: "Storylines" },
  { id: "worlds-end", title: "World's End", group: "Storylines" },
  { id: "one-down", title: "One Down", group: "Hordes" },
  { id: "farewell-drift", title: "Farewell Drift", group: "Bike" },
  { id: "this-is-a-knife", title: "This is a Knife", group: "Combat" },
  { id: "ghost-of-farewell", title: "Ghost of Farewell", group: "Combat" },
  { id: "old-reliable", title: "Old Reliable", group: "Combat" },
  { id: "variety-is-the-spice-of-life", title: "Variety is the Spice of Life", group: "Combat" },
  { id: "farewell-original", title: "Farewell Original", group: "Bike" },
  { id: "first-time-buyer", title: "First Time Buyer", group: "Bike" },
  { id: "burnout-apocalypse", title: "Burnout Apocalypse", group: "Bike" },
  { id: "the-art-of-bike-repair", title: "The Art of Bike Repair", group: "Bike" },
  { id: "youve-got-red-on-you", title: "You've Got Red on You", group: "Grind" },
  { id: "lend-me-your-ears", title: "Lend Me Your Ears", group: "Grind" },
  { id: "finders-keepers", title: "Finders Keepers", group: "Collectibles", linkedCollectibleId: "charactercollectibles-01" },
  { id: "wannabe-fortune-hunter", title: "Wannabe Fortune Hunter", group: "Collectibles" },
  { id: "the-broken-roadshow", title: "The Broken Roadshow", group: "Collectibles" },
  { id: "surviving-isnt-living", title: "Surviving isn't Living", group: "World" },
  { id: "better-living-through-chemistry", title: "Better Living through Chemistry", group: "Growth" },
  { id: "performance-enhanced", title: "Performance Enhanced", group: "Growth" },
  { id: "best-friends-forever", title: "Best Friends Forever", group: "Camps" },
  { id: "best-friends-forever-for-life", title: "Best Friends Forever (For Life)", group: "Camps" },
  { id: "make-it-rain", title: "Make it Rain", group: "Camps" },
  { id: "welcome-to-the-party-pal", title: "Welcome to the Party, Pal", group: "World" },
  { id: "kitchen-courier", title: "Kitchen Courier", group: "Camps" },
  { id: "dont-stop-me-now", title: "Don't Stop Me Now", group: "Skills" },
  { id: "im-out-of-control", title: "I'm Out of Control", group: "Skills" },
  { id: "theres-no-stopping-me", title: "There's No Stopping Me", group: "Skills" },
  { id: "mr-fahrenheit", title: "Mr. Fahrenheit", group: "Skills" },
  { id: "go-kick-rocks", title: "Go Kick Rocks", group: "Collectibles" },
  { id: "diy-oregonian", title: "D.I.Y. Oregonian", group: "Crafting" }
].map((entry) => ({
  ...entry,
  phrases: [
    entry.title,
    entry.title.replace(/[().]/g, ""),
    entry.title.replace(/'/g, "")
  ]
}));

export const DAYS_GONE_COLLECTIBLE_BY_ID = new Map(
  DAYS_GONE_COLLECTIBLE_CHECKLIST.map((entry) => [entry.id, entry])
);

export const DAYS_GONE_TROPHY_BY_ID = new Map(
  DAYS_GONE_TROPHY_CHECKLIST.map((entry) => [entry.id, entry])
);

export function getScreenTrackerOcrGoalOptions(
  gameId = "",
  {
    completionTitles = {},
    neroIpcaClusters = []
  } = {}
) {
  if (gameId !== "days-gone") return [];

  const completionOptions = Object.entries(completionTitles || {}).flatMap(([counterKey, category]) =>
    (Array.isArray(category?.titles) ? category.titles : []).map((entry) => ({
      id: getDaysGoneCompletionGoalId(counterKey, entry?.title),
      type: "completion",
      label: String(entry?.title || "").trim(),
      counterKey,
      countsTowardCounter: entry?.countsTowardCounter !== false,
      group: `Completion — ${String(category?.label || counterKey).trim()}`,
      phrases: [
        entry?.title,
        ...(Array.isArray(entry?.aliases) ? entry.aliases : [])
      ].map((phrase) => String(phrase || "").trim()).filter(Boolean)
    }))
  ).filter((entry) => entry.id && entry.label);

  const ipcaOptions = (Array.isArray(neroIpcaClusters) ? neroIpcaClusters : [])
    .map((cluster) => {
      const index = Number(cluster?.ipcaIndex || 0);
      const siteName = String(cluster?.siteName || "").trim();
      const siteSlug = normalizeText(siteName).replaceAll(" ", "-");
      if (!index || !siteSlug) return null;

      return {
        id: `ipca-tech-${String(index).padStart(2, "0")}-${siteSlug}`,
        type: "pickup",
        label: `IPCA Tech - ${siteName}`,
        counterKey: "ipca",
        group: `IPCA Tech — ${String(cluster?.region || "Days Gone").trim()}`,
        phrases: ["ipca tech", "ipca"]
      };
    })
    .filter(Boolean);

  return [
    ...DAYS_GONE_TROPHY_CHECKLIST.map((entry) => ({
      id: entry.id,
      type: "trophy",
      label: entry.title,
      counterKey: "trophies",
      group: entry.group || "Trophies",
      phrases: entry.phrases || []
    })),
    ...DAYS_GONE_COLLECTIBLE_CHECKLIST.map((entry) => ({
      id: entry.id,
      type: "collectible",
      label: entry.title,
      counterKey: entry.counterKey,
      group: entry.group || "Collectibles",
      no: entry.no || null,
      phrases: entry.phrases || []
    })),
    ...completionOptions,
    ...ipcaOptions
  ];
}

const DAYS_GONE_COLLECTIBLE_BUNDLES = [
  ["charactercollectibles-02", "charactercollectibles-03"],
  ["charactercollectibles-04", "charactercollectibles-05"],
  // "This Could Be It" awards both notes together. The durable top-right
  // Weaver toast is the reliable OCR anchor for the otherwise silent lab note.
  ["charactercollectibles-27", "sarahlabnotes-06"]
];

// Some automatically awarded collectibles never get a dependable standalone
// toast. A confirmed mission-completion title can therefore act as a precise
// fallback without enabling broad fuzzy matching across unrelated goals.
const DAYS_GONE_COMPLETION_COLLECTIBLE_LINKS = [
  { phrase: "No Starving Patriots", collectibleIds: ["radiofreeoregon-05"] },
  { phrase: "Drinking Himself to Death", collectibleIds: ["radiofreeoregon-04"] },
  { phrase: "I Don't Have a Pic", collectibleIds: ["charactercollectibles-23"] },
  { phrase: "They Will Never Stop", collectibleIds: ["charactercollectibles-32"] },
  { phrase: "We Do Not Discriminate", collectibleIds: ["colonelspeeches-01"] },
  { phrase: "We Must Fill the Ark", collectibleIds: ["colonelspeeches-02"] },
  { phrase: "Throw Them Into the Furnace", collectibleIds: ["colonelspeeches-03"] },
  { phrase: "My Eyes Have Been Opened", collectibleIds: ["colonelspeeches-04"] },
  { phrase: "Evil Surrounds Us", collectibleIds: ["colonelspeeches-05"] },
  { phrase: "Shadow of Death", collectibleIds: ["colonelspeeches-06"] }
].map((entry) => ({
  ...entry,
  normalizedPhrase: normalizeText(entry.phrase)
}));

function expandDaysGoneCollectibleBundleEntries(entries = []) {
  const ids = new Set(entries.map((entry) => entry.id));

  DAYS_GONE_COLLECTIBLE_BUNDLES.forEach((bundle) => {
    if (bundle.some((id) => ids.has(id))) {
      bundle.forEach((id) => ids.add(id));
    }
  });

  return DAYS_GONE_COLLECTIBLE_CHECKLIST.filter((entry) => ids.has(entry.id));
}

export function getDaysGoneCollectibleBundle(id) {
  return DAYS_GONE_COLLECTIBLE_BUNDLES.find((bundle) => bundle.includes(id)) || null;
}

function daysGoneChecklistPhrases(counterKey) {
  return DAYS_GONE_COLLECTIBLE_CHECKLIST
    .filter((entry) => entry.counterKey === counterKey)
    .flatMap((entry) => entry.phrases || []);
}

const DAYS_GONE_GENERIC_COLLECTIBLE_PHRASES = [
  "collectible",
  "collectable",
  "character",
  "characters",
  "herbology",
  "tourism",
  "historical",
  "historic marker",
  "r i p sermons",
  "rip sermons",
  "ripper sermon",
  "ripper sermons",
  "sermon collectible",
  "nero intel",
  "nero recording",
  "nero field note",
  "field note",
  "recorder",
  "sarah s lab notes",
  "sarah's lab notes",
  "lab note",
  "lab notes",
  "radio free oregon",
  "colonel garret",
  "colonel's speech",
  "colonels speech",
  "speeches collectible",
  "camp guitarist collectible",
  "camp guitarist",
  "camp guitar songs",
  "guitar song",
  "song collectible"
];

const DAYS_GONE_IGNORED_OCR_PHRASES = [
  "health cocktail"
];

const DAYS_GONE_RULES = [
  {
    counterKey: "trophies",
    label: "Trophy",
    phrases: [...DAYS_GONE_TROPHY_CHECKLIST.flatMap((entry) => entry.phrases || []), "trophy earned", "trophy"],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "charactercollectibles",
    label: "Character Collectible",
    phrases: [...daysGoneChecklistPhrases("charactercollectibles"), "characters collectible", "characters collectable", "characters"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "herbology",
    label: "Herbology",
    phrases: [...DAYS_GONE_HERBOLOGY_PHRASES, "herbology collectible", "herbology collectable", "herbology"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "tourism",
    label: "Tourism Collectible",
    phrases: [...daysGoneChecklistPhrases("tourism"), "tourism collectible", "tourism collectable", "tourism"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "historical",
    label: "Historic Marker",
    phrases: [...daysGoneChecklistPhrases("historical"), "historical marker", "historic marker", "historical collectible", "historical"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "rippersermons",
    label: "Ripper Sermon",
    phrases: [...daysGoneChecklistPhrases("rippersermons"), "r i p sermons", "rip sermons", "ripper sermons", "ripper sermon", "sermon collectible"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "nerointel",
    label: "NERO Intel",
    phrases: [...daysGoneChecklistPhrases("nerointel"), "nero intel", "nero recording", "nero field note", "field note", "recorder"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "ipca",
    label: "IPCA Tech",
    phrases: ["ipca tech", "ipca"],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "sarahlabnotes",
    label: "Sarah Lab Note",
    phrases: [...daysGoneChecklistPhrases("sarahlabnotes"), "sarah s lab notes", "sarah's lab notes", "lab notes", "lab note"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "radiofreeoregon",
    label: "Radio Free Oregon",
    phrases: [...daysGoneChecklistPhrases("radiofreeoregon"), "radio free oregon"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "colonelspeeches",
    label: "Colonel Speech",
    phrases: [...daysGoneChecklistPhrases("colonelspeeches"), "colonel garret", "colonel's speech", "colonels speech", "speeches collectible"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  },
  {
    counterKey: "songs",
    label: "Camp Song",
    phrases: [...DAYS_GONE_SONG_PHRASES, "camp guitarist collectible", "camp guitarist", "camp guitar songs", "guitar song", "song collectible"],
    expectedWith: ["routecollectibles"],
    autoSyncWhenExpected: true,
    extraCounters: [{ counterKey: "routecollectibles", delta: 1 }]
  }
];

const GTA_III_MISSION_START_PHRASES = [
  "give me liberty",
  "luigi s girls",
  "mike lips last lunch",
  "don't spank ma bitch up",
  "dont spank ma bitch up",
  "drive misty for me",
  "pump action pimp",
  "the fuzz ball",
  "trial by fire",
  "kingdom come",
  "sayonara salvatore"
];

const GTA_III_RULES = [
  {
    counterKey: "trophies",
    label: "Trophy",
    phrases: ["trophy earned", "trophy"],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "paramedic",
    label: "Paramedic Level 12",
    phrases: ["paramedic missions complete", "playing doctor"],
    targetValue: 12,
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "hiddenpackages",
    label: "Hidden Package",
    phrases: ["hidden package"],
    countSync: true,
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "rampages",
    label: "Rampage Complete",
    phrases: ["rampage complete"],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "uniquejumps",
    label: "Unique Jump",
    phrases: ["unique stunt bonus"],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "vehicledeliveries",
    label: "Vehicle Delivered",
    phrases: ["delivered like a pro", "nice one here s your", "nice one here's your"],
    autoSync: true,
    ignoreExpectedOnly: true
  },
  {
    counterKey: "storymissions",
    label: "Mission Passed",
    phrases: ["mission passed"],
    autoSyncWhenExpected: true
  },
  {
    counterKey: "routesignals",
    label: "Mission Start",
    phrases: GTA_III_MISSION_START_PHRASES,
    autoSyncWhenExpected: true
  }
];

const GHOST_BLOCKED_CONTEXT_PHRASES = [
  "fast travel",
  "travel here",
  "undiscovered location",
  "guiding wind",
  "map legend",
  "track location",
  "pan map",
  "zoom map",
  "recentre",
  "recenter",
  "act rescue lord shimura",
  "legend of the ghost"
];

const GHOST_MENU_CONTEXT_PHRASES = [
  "map",
  "journal",
  "gear",
  "techniques",
  "collections",
  "progress",
  "exit"
];

function isGhostMenuContext(normalizedText) {
  const strongBlock = GHOST_BLOCKED_CONTEXT_PHRASES.some((phrase) =>
    normalizedText.includes(normalizeText(phrase))
  );
  if (strongBlock) return true;

  const menuHits = GHOST_MENU_CONTEXT_PHRASES.filter((phrase) =>
    normalizedText.includes(normalizeText(phrase))
  ).length;
  return menuHits >= 2;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactNormalizedText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizedIncludesPhrase(normalizedText, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  if (normalizedText.includes(normalizedPhrase)) return true;

  const compactPhrase = compactNormalizedText(normalizedPhrase);
  if (compactPhrase.length < 8) return false;

  return compactNormalizedText(normalizedText).includes(compactPhrase);
}

export function normalizedApproximatelyIncludesPhrase(normalizedText, phrase) {
  if (normalizedIncludesPhrase(normalizedText, phrase)) return true;

  const text = compactNormalizedText(normalizedText);
  const target = compactNormalizedText(phrase);
  if (!text || target.length < 6) return false;

  // Short labels are common in Days Gone ("Mirrors", "Mayweed", "IPCA
  // Tech"). Never fuzzy-match those against an arbitrary substring: a noisy
  // fragment such as "rior" must not complete "Mirrors". Compare whole OCR
  // token windows of roughly the same length instead.
  if (target.length < 10) {
    const words = normalizeText(normalizedText).split(/\s+/).filter(Boolean);
    const phraseWordCount = Math.max(1, normalizeText(phrase).split(/\s+/).filter(Boolean).length);
    const maximumDistance = Math.max(1, Math.floor(target.length * 0.2));
    for (let start = 0; start < words.length; start += 1) {
      for (let count = 1; count <= phraseWordCount + 1 && start + count <= words.length; count += 1) {
        const candidate = compactNormalizedText(words.slice(start, start + count).join(" "));
        if (Math.abs(candidate.length - target.length) > maximumDistance) continue;
        if (editDistance(candidate, target) <= maximumDistance) return true;
      }
    }
    return false;
  }

  // Expected split goals are a very small candidate set, so a bounded fuzzy
  // substring is safe here and recovers toast OCR such as
  // "FRONTIER MBTEEBROCHURES" for "Frontier Motel Brochures".
  const maximumDistance = Math.max(1, Math.min(7, Math.floor(target.length * 0.3)));
  const previous = Array.from({ length: text.length + 1 }, () => 0);

  for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
    const current = [targetIndex];
    let rowMinimum = current[0];
    for (let textIndex = 1; textIndex <= text.length; textIndex += 1) {
      const cost = target[targetIndex - 1] === text[textIndex - 1] ? 0 : 1;
      current[textIndex] = Math.min(
        previous[textIndex] + 1,
        current[textIndex - 1] + 1,
        previous[textIndex - 1] + cost
      );
      rowMinimum = Math.min(rowMinimum, current[textIndex]);
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
    if (rowMinimum > maximumDistance && targetIndex > maximumDistance + text.length) return false;
  }

  return Math.min(...previous) <= maximumDistance;
}

function normalizedEqualsPhrase(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  return compactNormalizedText(normalizedLeft) === compactNormalizedText(normalizedRight);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const settings = {
      obsUrl: DEFAULT_OBS_URL,
      obsSource: "",
      obsPassword: "",
      regionPreset: "route_expected",
      expectedOnly: true,
      lookahead: 1,
      videoScanIntervalMs: DEFAULT_VIDEO_SCAN_INTERVAL_MS,
      pauseVideoOnSuggestion: false,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      ...stored
    };
    settings.pauseVideoOnSuggestion = false;
    if ((stored.regionPreset === "smart_multi" || stored.regionPreset === "popup_fast") && stored.autoMigratedPopupFast !== true) {
      settings.regionPreset = "route_expected";
      settings.autoMigratedPopupFast = true;
    }
    return settings;
  } catch {
    return {
      obsUrl: DEFAULT_OBS_URL,
      obsSource: "",
      obsPassword: "",
      regionPreset: "route_expected",
      expectedOnly: true,
      lookahead: 1,
      videoScanIntervalMs: DEFAULT_VIDEO_SCAN_INTERVAL_MS,
      pauseVideoOnSuggestion: false,
      cooldownMs: DEFAULT_COOLDOWN_MS
    };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Keep the tracker usable even if storage is blocked.
  }
}

function createOcrRunSessionId() {
  return `ocr-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadOcrRunSessionId() {
  try {
    const stored = String(localStorage.getItem(OCR_RUN_SESSION_KEY) || "").trim();
    if (stored) return stored;
  } catch {
    // A page-session id is enough if storage is unavailable.
  }

  const next = createOcrRunSessionId();
  try {
    localStorage.setItem(OCR_RUN_SESSION_KEY, next);
  } catch {
    // Ignore storage failures; logs still work for this page session.
  }
  return next;
}

function saveOcrRunSessionId(sessionId) {
  try {
    localStorage.setItem(OCR_RUN_SESSION_KEY, sessionId);
  } catch {
    // The in-memory session id is still useful for this page session.
  }
}

function loadOcrRunLog() {
  try {
    const stored = JSON.parse(localStorage.getItem(OCR_RUN_LOG_KEY) || "[]");
    if (Array.isArray(stored)) return stored.slice(-OCR_RUN_LOG_MAX_ENTRIES);
    if (Array.isArray(stored?.entries)) return stored.entries.slice(-OCR_RUN_LOG_MAX_ENTRIES);
  } catch {
    // Bad or old log data should not break OCR.
  }
  return [];
}

function saveOcrRunLog(entries) {
  const trimmed = Array.isArray(entries) ? entries.slice(-OCR_RUN_LOG_MAX_ENTRIES) : [];
  try {
    localStorage.setItem(OCR_RUN_LOG_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch {
    const emergencyTrimmed = trimmed.slice(-Math.floor(OCR_RUN_LOG_MAX_ENTRIES / 2));
    try {
      localStorage.setItem(OCR_RUN_LOG_KEY, JSON.stringify(emergencyTrimmed));
    } catch {
      // Keep the in-memory log if browser storage is full or blocked.
    }
    return emergencyTrimmed;
  }
}

function loadOcrRunFileQueue() {
  try {
    const stored = JSON.parse(localStorage.getItem(OCR_RUN_LOG_FILE_QUEUE_KEY) || "[]");
    return Array.isArray(stored) ? stored.slice(-OCR_RUN_LOG_FILE_QUEUE_MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function saveOcrRunFileQueue(entries) {
  const trimmed = Array.isArray(entries) ? entries.slice(-OCR_RUN_LOG_FILE_QUEUE_MAX_ENTRIES) : [];
  try {
    localStorage.setItem(OCR_RUN_LOG_FILE_QUEUE_KEY, JSON.stringify(trimmed));
  } catch {
    // If storage is full, keep the newest retry entries for this page session.
  }
  return trimmed;
}

function loadHaikuProgress() {
  try {
    const ids = JSON.parse(localStorage.getItem(HAIKU_PROGRESS_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveHaikuProgress(completed) {
  try {
    localStorage.setItem(HAIKU_PROGRESS_KEY, JSON.stringify([...completed]));
  } catch {
    // The checklist remains usable for this page session if storage is unavailable.
  }
}

function loadTrophyProgress() {
  try {
    const ids = JSON.parse(localStorage.getItem(TROPHY_PROGRESS_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveTrophyProgress(completed) {
  try {
    localStorage.setItem(TROPHY_PROGRESS_KEY, JSON.stringify([...completed]));
  } catch {
    // The checklist remains usable for this page session if storage is unavailable.
  }
}

export function loadDaysGoneCollectibleProgress() {
  try {
    const ids = JSON.parse(localStorage.getItem(DAYS_GONE_COLLECTIBLE_PROGRESS_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export function saveDaysGoneCollectibleProgress(completed) {
  try {
    localStorage.setItem(DAYS_GONE_COLLECTIBLE_PROGRESS_KEY, JSON.stringify([...completed]));
  } catch {
    // The checklist remains usable for this page session if storage is unavailable.
  }
}

export function loadDaysGoneTrophyProgress() {
  try {
    const ids = JSON.parse(localStorage.getItem(DAYS_GONE_TROPHY_PROGRESS_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export function saveDaysGoneTrophyProgress(completed) {
  try {
    localStorage.setItem(DAYS_GONE_TROPHY_PROGRESS_KEY, JSON.stringify([...completed]));
  } catch {
    // The checklist remains usable for this page session if storage is unavailable.
  }
}

export function loadDaysGoneCompletionProgress() {
  try {
    const ids = JSON.parse(localStorage.getItem(DAYS_GONE_COMPLETION_PROGRESS_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export function saveDaysGoneCompletionProgress(completed) {
  try {
    localStorage.setItem(DAYS_GONE_COMPLETION_PROGRESS_KEY, JSON.stringify([...completed]));
  } catch {
    // The route remains usable for this page session if storage is unavailable.
  }
}

export function getDaysGoneCompletionGoalId(counterKey = "", title = "") {
  const counter = normalizeText(counterKey).replaceAll(" ", "-");
  const slug = normalizeText(title).replaceAll(" ", "-");
  return counter && slug ? `completion-${counter}-${slug}` : "";
}

export function loadDaysGoneMissedGoals() {
  try {
    const stored = JSON.parse(localStorage.getItem(DAYS_GONE_MISSED_GOALS_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function saveDaysGoneMissedGoals(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  try {
    const payload = JSON.stringify(safeItems);
    if (localStorage.getItem(DAYS_GONE_MISSED_GOALS_KEY) !== payload) {
      localStorage.setItem(DAYS_GONE_MISSED_GOALS_KEY, payload);
    }
  } catch {
    // The dashboard remains usable for this page session if storage is unavailable.
  }
  return safeItems;
}

export function clearDaysGoneMissedGoals() {
  try {
    localStorage.removeItem(DAYS_GONE_MISSED_GOALS_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value || "";
}

function getInputValue(id) {
  const input = document.getElementById(id);
  return input?.value || "";
}

function getExpectedCounters(state, lookahead) {
  const result = new Set();
  const splits = Array.isArray(state?.splits?.items) ? state.splits.items : [];
  const currentIndex = Number(state?.splits?.currentIndex || 0);
  const maxIndex = Math.min(splits.length - 1, currentIndex + Math.max(0, Number(lookahead || 0)));

  for (let index = currentIndex; index <= maxIndex; index += 1) {
    Object.keys(splits[index]?.auto || {}).forEach((key) => result.add(key));
  }

  return result;
}

export function resolveDaysGoneOcrGoal(goal = {}) {
  const type = String(goal?.type || "").toLowerCase();
  const id = String(goal?.id || "").trim();
  const collectible = type === "collectible" || DAYS_GONE_COLLECTIBLE_BY_ID.has(id)
    ? DAYS_GONE_COLLECTIBLE_BY_ID.get(id)
    : null;
  const trophy = type === "trophy" || DAYS_GONE_TROPHY_BY_ID.has(id)
    ? DAYS_GONE_TROPHY_BY_ID.get(id)
    : null;
  const source = collectible || trophy || null;
  const counterKey = collectible
    ? collectible.counterKey
    : trophy
      ? "trophies"
      : String(goal?.counterKey || "").trim();
  const label = String(goal?.label || source?.title || id || "").trim();
  const explicitPhrases = Array.isArray(goal?.phrases)
    ? goal.phrases.map((phrase) => String(phrase || "").trim()).filter(Boolean)
    : [];
  const phrases = source?.phrases || (explicitPhrases.length ? explicitPhrases : label ? [label] : []);
  const linkedCounters = Array.isArray(goal?.linkedCounters)
    ? goal.linkedCounters
      .map((entry) => ({
        counterKey: String(entry?.counterKey || "").trim(),
        delta: Number(entry?.delta || 0)
      }))
      .filter((entry) => entry.counterKey && Number.isFinite(entry.delta) && entry.delta > 0)
    : [];

  if (!counterKey || !label) return null;

  return {
    id: id || `${counterKey}:${label}`,
    type: collectible ? "collectible" : trophy ? "trophy" : type,
    counterKey,
    label,
    optional: !!goal?.optional,
    phrases,
    linkedCounters
  };
}

function getDaysGoneGoalStorageKey(goal = {}) {
  return `${goal.type || "goal"}:${goal.id || goal.label || ""}`;
}

function isDaysGoneMissedGoalComplete(
  goal = {},
  completedCollectibles = new Set(),
  completedTrophies = new Set(),
  completedCompletions = loadDaysGoneCompletionProgress()
) {
  if (goal.type === "collectible") return completedCollectibles.has(goal.id);
  if (goal.type === "trophy") return completedTrophies.has(goal.id);
  return completedCompletions.has(goal.id);
}

export function pruneDaysGoneMissedGoals(
  items = loadDaysGoneMissedGoals(),
  completedCollectibles = loadDaysGoneCollectibleProgress(),
  completedTrophies = loadDaysGoneTrophyProgress(),
  completedCompletions = loadDaysGoneCompletionProgress()
) {
  const pruned = (Array.isArray(items) ? items : []).filter((item) => {
    const goal = resolveDaysGoneOcrGoal(item);
    return goal && !isDaysGoneMissedGoalComplete(
      goal,
      completedCollectibles,
      completedTrophies,
      completedCompletions
    );
  });
  return saveDaysGoneMissedGoals(pruned);
}

export function recordDaysGoneMissedGoalsFromState(
  state,
  {
    completedCollectibles = loadDaysGoneCollectibleProgress(),
    completedTrophies = loadDaysGoneTrophyProgress(),
    completedCompletions = loadDaysGoneCompletionProgress()
  } = {}
) {
  const gameId = state?.gameId || "";
  if (gameId !== "days-gone") return loadDaysGoneMissedGoals();

  const splits = Array.isArray(state?.splits?.items) ? state.splits.items : [];
  const currentIndex = Math.max(0, Math.min(
    Number(state?.splits?.currentIndex || 0),
    splits.length
  ));
  const existing = new Map();

  pruneDaysGoneMissedGoals(
    loadDaysGoneMissedGoals(),
    completedCollectibles,
    completedTrophies,
    completedCompletions
  )
    .forEach((item) => existing.set(getDaysGoneGoalStorageKey(item), item));

  for (let index = 0; index < currentIndex; index += 1) {
    const split = splits[index];
    (Array.isArray(split?.ocrGoals) ? split.ocrGoals : [])
      .map(resolveDaysGoneOcrGoal)
      .filter(Boolean)
      .forEach((goal) => {
        if (isDaysGoneMissedGoalComplete(
          goal,
          completedCollectibles,
          completedTrophies,
          completedCompletions
        )) return;

        const key = getDaysGoneGoalStorageKey(goal);
        if (existing.has(key)) return;

        existing.set(key, {
          ...goal,
          key,
          splitId: split?.id || "",
          splitLabel: split?.label || `Split ${index + 1}`,
          splitIndex: index,
          phaseId: split?.phase || "",
          addedAt: new Date().toISOString(),
          firstSeenElapsedMs: Number(state?.timer?.elapsed || 0),
          source: "previous-split-ocr-goal"
        });
      });
  }

  const next = [...existing.values()].sort((a, b) => {
    const splitDelta = Number(a.splitIndex || 0) - Number(b.splitIndex || 0);
    if (splitDelta) return splitDelta;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
  return saveDaysGoneMissedGoals(next);
}

function isDaysGoneOcrCompletionGoalDone(
  goalId,
  completedCollectibles = new Set(),
  completedTrophies = new Set(),
  completedCompletions = new Set()
) {
  const id = String(goalId || "").trim();
  if (!id) return false;
  return completedCollectibles.has(id) || completedTrophies.has(id) || completedCompletions.has(id);
}

function isSplitOcrCompletionSatisfiedWithSets(
  split = null,
  completedCollectibles = new Set(),
  completedTrophies = new Set(),
  completedCompletions = new Set()
) {
  const completion = split?.ocrCompletion;
  if (!completion || typeof completion !== "object") return true;

  const mode = String(completion.mode || "").trim();
  const groups = Array.isArray(completion.groups) ? completion.groups : [];
  if (!groups.length) return true;

  const isGroupDone = (group) =>
    Array.isArray(group)
    && group.length > 0
    && group.every((goalId) => isDaysGoneOcrCompletionGoalDone(
      goalId,
      completedCollectibles,
      completedTrophies,
      completedCompletions
    ))
  ;

  if (mode === "allGoalGroups") return groups.every(isGroupDone);
  if (mode === "anyGoalGroups") return groups.some(isGroupDone);
  return false;
}

function getExpectedOcrGoals(state, lookahead) {
  const result = [];
  const splits = Array.isArray(state?.splits?.items) ? state.splits.items : [];
  const currentIndex = Number(state?.splits?.currentIndex || 0);
  const maxIndex = Math.min(splits.length - 1, currentIndex + Math.max(0, Number(lookahead || 0)));
  const gameId = state?.gameId || "";
  const completedCollectibles = gameId === "days-gone" ? loadDaysGoneCollectibleProgress() : new Set();
  const completedTrophies = gameId === "days-gone" ? loadDaysGoneTrophyProgress() : new Set();
  const completedCompletions = gameId === "days-gone" ? loadDaysGoneCompletionProgress() : new Set();

  for (let index = currentIndex; index <= maxIndex; index += 1) {
    const split = splits[index];
    (Array.isArray(split?.ocrGoals) ? split.ocrGoals : [])
      .map(resolveDaysGoneOcrGoal)
      .filter(Boolean)
      .forEach((goal) => result.push({
        ...goal,
        splitLabel: split?.label || `Split ${index + 1}`,
        splitIndex: index
      }));

    if (
      gameId === "days-gone"
      && !isSplitOcrCompletionSatisfiedWithSets(
        split,
        completedCollectibles,
        completedTrophies,
        completedCompletions
      )
    ) {
      break;
    }
  }

  return result;
}

function ruleSetForGame(gameId) {
  if (gameId === "ghost-of-tsushima") return GHOST_RULES;
  if (gameId === "days-gone") return DAYS_GONE_RULES;
  if (gameId === "gta-iii-definitive-edition") return GTA_III_RULES;
  return [];
}

function getExpectedRegionIds(state, settings) {
  const gameId = state?.gameId || "";
  const defaultRegions = gameId === "days-gone"
    ? [
        "days_gone_top_right_toast",
        "days_gone_ipca_pickup",
        "days_gone_completion_anchor",
        "days_gone_completion_title"
      ]
    : gameId === "gta-iii-definitive-edition"
      ? ["gta_trophy_toast", "gta_center_event", "gta_wide_notice"]
      : ["trophy_toast", "trophy_toast_legacy"];
  const splits = Array.isArray(state?.splits?.items) ? state.splits.items : [];
  const currentIndex = Number(state?.splits?.currentIndex || 0);
  const maxIndex = Math.min(splits.length - 1, currentIndex + Math.max(0, Number(settings.lookahead || 0)));
  const explicit = [];

  for (let index = currentIndex; index <= maxIndex; index += 1) {
    const splitRegions = splits[index]?.scanRegions;
    if (Array.isArray(splitRegions)) explicit.push(...splitRegions);
  }

  if (explicit.length) {
    return [...new Set([...defaultRegions, ...explicit])];
  }

  const expected = getExpectedCounters(state, settings.lookahead);
  const goals = getExpectedOcrGoals(state, settings.lookahead);
  const regionIds = [...defaultRegions];

  expected.forEach((counterKey) => {
    (COUNTER_REGION_MAP[counterKey] || []).forEach((regionId) => regionIds.push(regionId));
  });

  goals.forEach((goal) => {
    (COUNTER_REGION_MAP[goal.counterKey] || []).forEach((regionId) => regionIds.push(regionId));
  });

  return [...new Set(regionIds)];
}

function getScanRegions(regionPreset, state = null, settings = {}) {
  const preset = REGION_PRESETS[regionPreset] || REGION_PRESETS.route_expected;
  const regionIds = preset.dynamic
    ? getExpectedRegionIds(state, settings)
    : Array.isArray(preset.regions) ? preset.regions : [regionPreset];
  const expandedRegionIds =
    state?.gameId === "days-gone" && regionIds.includes("days_gone_top_right_toast")
      ? ["days_gone_top_right_title", "days_gone_top_right_wide_title", ...regionIds]
      : regionIds;

  return [...new Set(expandedRegionIds)]
    .filter((id) =>
      state?.gameId !== "days-gone"
      || (
        id.startsWith("days_gone_")
        && !DAYS_GONE_LIVE_DISABLED_REGION_IDS.has(id)
      )
    )
    .map((id) => REGION_PRESETS[id] ? { ...REGION_PRESETS[id], id } : null)
    .filter((region) => region && !Array.isArray(region.regions));
}

function getCounterLabel(counterKey, gameData) {
  const def = gameData?.counters?.[counterKey] || {};
  return def.shortLabel || def.queueLabel || def.label || counterKey;
}

function isDaysGoneTopRightTitleRegion(regionId = "") {
  return ["days_gone_top_right_title", "days_gone_top_right_wide_title"].includes(regionId);
}

function getOcrPsmForRegion(regionId = "") {
  if (isDaysGoneTopRightTitleRegion(regionId)) return 7;
  if (["days_gone_ipca_pickup", "days_gone_pickup_left"].includes(regionId)) return 11;
  return 6;
}

function getOcrPreprocessScaleForRegion(regionId = "") {
  if (["days_gone_top_right_title", "days_gone_ipca_pickup"].includes(regionId)) return 3;
  if (regionId === "days_gone_pickup_left") return 2;
  return undefined;
}

function getOcrThresholdForRegion(regionId = "") {
  return ["days_gone_ipca_pickup", "days_gone_pickup_left"].includes(regionId) ? 135 : undefined;
}

function getRecoveryOcrThresholdForRegion(regionId = "") {
  if (regionId === "days_gone_ipca_pickup") return 115;
  if (regionId === "days_gone_pickup_left") return 115;
  if ([
    "days_gone_top_right_title",
    "days_gone_top_right_wide_title",
    "days_gone_top_right_toast"
  ].includes(regionId)) return 155;
  return null;
}

function getVideoCandidateQuality(candidate) {
  const gate = candidate?.gate || {};
  const transitions = Number(gate.maxTransitions || 0);
  const strongRows = Number(gate.strongRows || 0);
  const mediumRows = Number(gate.mediumRows || 0);
  const brightRatio = Number(gate.softBrightRatio || gate.brightRatio || 0);
  return (strongRows * 12) + (mediumRows * 3) + transitions + Math.min(12, brightRatio * 240);
}

function getRuleByCounterKey(gameId, counterKey) {
  return ruleSetForGame(gameId).find((rule) => rule.counterKey === counterKey) || null;
}

function parseCollectedCount(normalizedText) {
  const countText = String(normalizedText || "")
    .replace(/\bof\b/g, "of")
    .replace(/\b0f\b/g, "of")
    .replace(/\bo\s*f\b/g, "of")
    .replace(/[oO](?=\d)/g, "0")
    .replace(/[sS](?=0\b)/g, "5");
  const patterns = [
    /(\d{1,3})\s+of\s+(\d{1,3})\s+collected/,
    /(\d{1,3})\s+of\s+(\d{1,3})/,
    /(\d{1,3})\s*\/\s*(\d{1,3})/
  ];

  for (const pattern of patterns) {
    const match = countText.match(pattern);
    if (!match) continue;

    const current = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) continue;

    return { current, total };
  }

  return null;
}

function extractTrophyTitle(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const trophyLineIndex = lines.findIndex((line) => normalizedIncludesPhrase(normalizeText(line), "trophy earned"));
  const cleanup = (value) => String(value || "")
    .replace(/\btrophy earned\b/ig, "")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9'’:\-\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = [];
  if (trophyLineIndex > 0) candidates.push(lines[trophyLineIndex - 1]);
  if (trophyLineIndex >= 0) candidates.push(lines[trophyLineIndex]);
  candidates.push(...lines);

  return cleanup(candidates.find((candidate) => {
    const normalized = normalizeText(cleanup(candidate));
    return normalized.length >= 3
      && normalized.length <= 70
      && !normalizedIncludesPhrase(normalized, "trophy earned")
      && normalized !== "trophy"
      && normalized !== "earned";
  }) || "");
}

function editDistance(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

function analyzeText({ text, gameData, state, settings, regionLabel }) {
  const normalized = normalizeText(text);
  const gameId = state?.gameId || gameData?.meta?.id || "";
  const rules = ruleSetForGame(gameId);
  const expected = getExpectedCounters(state, settings.lookahead);
  const expectedGoals = getExpectedOcrGoals(state, settings.lookahead);
  const expectedGoalCounterKeys = new Set(expectedGoals.map((goal) => goal.counterKey));
  const matches = [];

  if (gameId === "ghost-of-tsushima") {
    if (isGhostMenuContext(normalized)) return matches;
  }

  if (
    gameId === "days-gone"
    && DAYS_GONE_IGNORED_OCR_PHRASES.some((phrase) => normalizedIncludesPhrase(normalized, phrase))
  ) {
    return matches;
  }

  const addDaysGoneOutOfRouteChecklistMatches = () => {
    if (gameId !== "days-gone" || !normalized) return;

    const region = normalizeText(regionLabel);
    const isToastRegion =
      region.includes("days gone top right")
      || region.includes("days gone right mid");
    if (!isToastRegion) return;

    const existingMatchedIds = new Set(
      matches.flatMap((match) => Array.isArray(match.matchedChecklistIds) ? match.matchedChecklistIds : [])
    );
    const expectedGoalIds = new Set(expectedGoals.map((goal) => goal.id));
    const collectibleCounterKeys = new Set(gameData?.meta?.collectibleCounterKeys || []);

    DAYS_GONE_COLLECTIBLE_CHECKLIST
      .filter((entry) => !entry.manualOnly)
      .filter((entry) => !expectedGoalIds.has(entry.id))
      .filter((entry) => !existingMatchedIds.has(entry.id))
      .forEach((entry) => {
        const matchedPhrase = (entry.phrases || []).find((phrase) => normalizedIncludesPhrase(normalized, phrase));
        if (!matchedPhrase) return;
        if (collectibleCounterKeys.has(entry.counterKey) && !gameData?.counters?.[entry.counterKey]) return;

        matches.push({
          id: `${entry.counterKey}:future:${entry.id}:${Date.now()}`,
          autoSync: true,
          counterKey: entry.counterKey,
          delta: 1,
          label: entry.title,
          matchedPhrase,
          text,
          normalizedText: normalized,
          regionLabel,
          confidence: "exact out-of-route item",
          countsAgainstSplitAuto: false,
          matchedChecklistIds: [entry.id],
          outOfRoute: true,
          extraCounters: collectibleCounterKeys.has(entry.counterKey)
            ? [{ counterKey: "routecollectibles", delta: 1, countsAgainstSplitAuto: false }]
            : []
        });
      });
  };

  rules.forEach((rule) => {
    if (!gameData?.counters?.[rule.counterKey]) return;
    const expectedForRule = expected.has(rule.counterKey)
      || expectedGoalCounterKeys.has(rule.counterKey)
      || (rule.expectedWith || []).some((counterKey) => expected.has(counterKey) || expectedGoalCounterKeys.has(counterKey));
    if (settings.expectedOnly && !expectedForRule && rule.ignoreExpectedOnly !== true) return;

    const ruleExpectedGoals = expectedGoals
      .filter((goal) => goal.counterKey === rule.counterKey);
    const matchedExpectedGoal = ruleExpectedGoals.find((goal) =>
      (goal.phrases || []).some((phrase) => normalizedApproximatelyIncludesPhrase(normalized, phrase))
    );
    const matchedGoalPhrase = (matchedExpectedGoal?.phrases || [])
      .find((phrase) => normalizedApproximatelyIncludesPhrase(normalized, phrase));
    const isDaysGoneIpcaPickup =
      gameId === "days-gone"
      && rule.counterKey === "ipca"
      && normalizeText(regionLabel).includes("ipca pickup");
    const matchedPhrase = matchedGoalPhrase || rule.phrases.find((phrase) =>
      normalizedIncludesPhrase(normalized, phrase)
      || (isDaysGoneIpcaPickup && normalizedApproximatelyIncludesPhrase(normalized, phrase))
    );
    if (!matchedPhrase) return;

    const matchedPhraseNormalized = normalizeText(matchedPhrase);

    if (rule.counterKey === "trophies" && !normalizedIncludesPhrase(matchedPhraseNormalized, "trophy")) {
      const trophyRegion = normalizeText(regionLabel).includes("trophy");
      const trophyText = normalizedIncludesPhrase(normalized, "trophy earned");
      if (!trophyRegion && !trophyText) return;
    }

    if (Array.isArray(rule.requireAny) && rule.requireAny.length) {
      const hasRequiredCue = rule.requireAny.some((phrase) => normalizedIncludesPhrase(normalized, phrase));
      if (!hasRequiredCue) return;
    }

    const currentValue = Number(state?.counters?.[rule.counterKey]?.value || 0);
    const max = Number(state?.totals?.[rule.counterKey] || gameData?.counters?.[rule.counterKey]?.max || 0);
    const observedCount = (rule.countSync || rule.counterKey === "trophies")
      ? parseCollectedCount(normalized)
      : null;

    if (observedCount) {
      const targetValue = max > 0 ? Math.min(observedCount.current, max) : observedCount.current;
      const delta = targetValue - currentValue;

      if (delta !== 0) {
        matches.push({
          id: `${rule.counterKey}:sync:${observedCount.current}:${Date.now()}`,
          kind: "sync",
          autoSync: rule.autoSync === true,
          counterKey: rule.counterKey,
          delta,
          targetValue,
          observedValue: observedCount.current,
          observedTotal: observedCount.total,
          label: getCounterLabel(rule.counterKey, gameData),
          matchedPhrase,
          text,
          normalizedText: normalized,
          regionLabel,
          confidence: "count-check",
          countsAgainstSplitAuto: delta > 0
            && settings.expectedOnly
            && expected.has(rule.counterKey)
            && !matchedExpectedGoal
        });
        return;
      }

      return;
    }

    if (max > 0 && currentValue >= max) return;
    const delta = rule.counterKey === "trophies" ? 1 : 1;

    const genericDaysGoneCollectibleMatch = gameId === "days-gone"
      && rule.expectedWith?.includes("routecollectibles")
      && !matchedGoalPhrase
      && DAYS_GONE_GENERIC_COLLECTIBLE_PHRASES.some((phrase) => normalizedIncludesPhrase(matchedPhraseNormalized, phrase));
    const specificDaysGoneCollectibleMatch = gameId === "days-gone"
      && rule.expectedWith?.includes("routecollectibles")
      && !genericDaysGoneCollectibleMatch;
    const genericDaysGoneTrophyMatch = gameId === "days-gone"
      && rule.counterKey === "trophies"
      && (normalizedEqualsPhrase(matchedPhrase, "trophy earned") || normalizedEqualsPhrase(matchedPhrase, "trophy"));
    const specificDaysGoneTrophyMatch = gameId === "days-gone"
      && rule.counterKey === "trophies"
      && !genericDaysGoneTrophyMatch;

    const shouldAutoSync = rule.autoSync === true
      || specificDaysGoneCollectibleMatch
      || (rule.autoSyncWhenExpected === true && expectedForRule)
      || (rule.autoSyncPhrases || []).some((phrase) => normalizedEqualsPhrase(phrase, matchedPhrase));

    const trophyTitle = rule.counterKey === "trophies"
      ? (specificDaysGoneTrophyMatch
        ? matchedPhrase
        : (extractTrophyTitle(text) || (normalizedIncludesPhrase(matchedPhraseNormalized, "trophy") ? "" : matchedPhrase)))
      : "";
    const detailLabel = rule.label && rule.label !== getCounterLabel(rule.counterKey, gameData)
      ? rule.label
      : getCounterLabel(rule.counterKey, gameData);

    matches.push({
      id: `${rule.counterKey}:${matchedPhrase}:${Date.now()}`,
      autoSync: genericDaysGoneCollectibleMatch || genericDaysGoneTrophyMatch ? false : shouldAutoSync,
      counterKey: rule.counterKey,
      delta,
      label: trophyTitle ? `${getCounterLabel(rule.counterKey, gameData)}: ${trophyTitle}` : detailLabel,
      trophyTitle,
      matchedPhrase,
      text,
      normalizedText: normalized,
      regionLabel,
      confidence: matchedGoalPhrase ? "expected item" : settings.expectedOnly && expectedForRule ? "high" : "medium",
      expectedGoalId: matchedExpectedGoal?.id || "",
      countsAgainstSplitAuto: delta > 0
        && settings.expectedOnly
        && expected.has(rule.counterKey)
        && !matchedExpectedGoal,
      extraCounters: [
        ...(rule.extraCounters || []).map((extra) => ({
          ...extra,
          countsAgainstSplitAuto: delta > 0 && settings.expectedOnly && expected.has(extra.counterKey)
        })),
        ...(matchedExpectedGoal?.linkedCounters || []).map((extra) => ({
          ...extra,
          countsAgainstSplitAuto: false
        }))
      ]
    });
  });

  addDaysGoneOutOfRouteChecklistMatches();
  return matches;
}

async function sha256Base64(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  new Uint8Array(digest).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function buildObsAuth(password, challenge, salt) {
  const secret = await sha256Base64(`${password}${salt}`);
  return sha256Base64(`${secret}${challenge}`);
}

class ObsClient {
  constructor({ onStateChange } = {}) {
    this.socket = null;
    this.requestId = 1;
    this.pending = new Map();
    this.connectedAt = 0;
    this.lastSuccessfulRequestAt = 0;
    this.onStateChange = onStateChange;
  }

  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  notifyState() {
    this.onStateChange?.({
      connected: this.isConnected,
      connectedAt: this.connectedAt,
      lastSuccessfulRequestAt: this.lastSuccessfulRequestAt
    });
  }

  rejectPending(message) {
    this.pending.forEach(({ reject }) => reject(new Error(message)));
    this.pending.clear();
  }

  async connect(url, password) {
    this.close();

    this.socket = new WebSocket(url);
    const socket = this.socket;

    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connectedAt = 0;
      this.rejectPending("OBS WebSocket disconnected");
      this.notifyState();
    });

    const hello = await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("OBS connection timed out")), 7000);

      socket.addEventListener("open", () => {}, { once: true });
      socket.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("OBS WebSocket connection failed"));
      }, { once: true });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.op !== 0) return;
        window.clearTimeout(timer);
        resolve(message.d || {});
      }, { once: true });
    });

    const auth = hello.authentication
      ? await buildObsAuth(password || "", hello.authentication.challenge, hello.authentication.salt)
      : undefined;

    socket.send(JSON.stringify({
      op: 1,
      d: {
        rpcVersion: 1,
        authentication: auth
      }
    }));

    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("OBS identify timed out")), 7000);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.op !== 2) return;
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });

    this.connectedAt = Date.now();
    this.notifyState();
  }

  handleMessage(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.op !== 7) return;

    const requestId = message.d?.requestId;
    const pending = this.pending.get(requestId);
    if (!pending) return;

    this.pending.delete(requestId);
    if (message.d?.requestStatus?.result) {
      this.lastSuccessfulRequestAt = Date.now();
      this.notifyState();
      pending.resolve(message.d?.responseData || {});
    } else {
      pending.reject(new Error(message.d?.requestStatus?.comment || "OBS request failed"));
    }
  }

  request(requestType, requestData = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("OBS is not connected"));
    }

    const requestId = String(this.requestId++);
    this.socket.send(JSON.stringify({
      op: 6,
      d: {
        requestId,
        requestType,
        requestData
      }
    }));

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      window.setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        reject(new Error("OBS request timed out"));
      }, 8000);
    });
  }

  close() {
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
    this.connectedAt = 0;
    this.rejectPending("OBS connection closed");
    this.notifyState();
  }
}

async function imageFromDataUrl(dataUrl) {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();
  return image;
}

function cropToRegion(image, region) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const x = Math.floor(sourceWidth * (region.x / 100));
  const y = Math.floor(sourceHeight * (region.y / 100));
  const width = Math.floor(sourceWidth * (region.width / 100));
  const height = Math.floor(sourceHeight * (region.height / 100));
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvas.getContext("2d").drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function prepareCanvasForOcr(canvas) {
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  const targetMinWidth = 720;
  const targetMinHeight = 180;
  const scale = Math.min(
    4,
    Math.max(
      1,
      Math.ceil(targetMinWidth / Math.max(1, sourceWidth)),
      Math.ceil(targetMinHeight / Math.max(1, sourceHeight))
    )
  );

  if (scale <= 1) return canvas;

  const output = document.createElement("canvas");
  output.width = sourceWidth * scale;
  output.height = sourceHeight * scale;
  const ctx = output.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, output.width, output.height);
  return output;
}

function analyzeCanvasTextPresence(canvas) {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor(width / 360));
  let brightPixels = 0;
  let darkPixels = 0;
  let sampledPixels = 0;
  let strongRows = 0;
  let mediumRows = 0;
  let softBrightPixels = 0;
  let maxTransitions = 0;

  const luminanceAt = (x, y) => {
    const index = ((y * width) + x) * 4;
    return ((pixels[index] * 77) + (pixels[index + 1] * 150) + (pixels[index + 2] * 29)) >> 8;
  };

  for (let y = 0; y < height; y += step) {
    let transitions = 0;
    let previous = luminanceAt(0, y);

    for (let x = step; x < width; x += step) {
      const current = luminanceAt(x, y);
      sampledPixels += 1;
      if (current >= 170) brightPixels += 1;
      if (current >= 150) softBrightPixels += 1;
      if (current <= 85) darkPixels += 1;
      if (
        (previous <= 105 && current >= 155)
        || (previous >= 155 && current <= 105)
      ) {
        transitions += 1;
      }
      previous = current;
    }

    maxTransitions = Math.max(maxTransitions, transitions);
    if (transitions >= 3) mediumRows += 1;
    if (transitions >= 8) strongRows += 1;
  }

  const brightRatio = brightPixels / Math.max(1, sampledPixels);
  const softBrightRatio = softBrightPixels / Math.max(1, sampledPixels);
  const darkRatio = darkPixels / Math.max(1, sampledPixels);
  const likelyText = maxTransitions >= 8
    && strongRows >= 4
    && brightRatio >= 0.002
    && darkRatio >= 0.08;

  // A coarse contrast fingerprint lets a genuinely new toast bypass the
  // per-region OCR cooldown. It describes text-like light/dark structure,
  // rather than raw color, so ordinary gameplay motion has less influence.
  const fingerprintColumns = 24;
  const fingerprintRows = 8;
  let textFingerprint = "";
  for (let cellY = 0; cellY < fingerprintRows; cellY += 1) {
    for (let cellX = 0; cellX < fingerprintColumns; cellX += 1) {
      let minimum = 255;
      let maximum = 0;
      for (let sampleY = 0; sampleY < 4; sampleY += 1) {
        for (let sampleX = 0; sampleX < 4; sampleX += 1) {
          const x = Math.min(width - 1, Math.floor(((cellX + ((sampleX + 0.5) / 4)) / fingerprintColumns) * width));
          const y = Math.min(height - 1, Math.floor(((cellY + ((sampleY + 0.5) / 4)) / fingerprintRows) * height));
          const luminance = luminanceAt(x, y);
          minimum = Math.min(minimum, luminance);
          maximum = Math.max(maximum, luminance);
        }
      }
      textFingerprint += maximum - minimum >= 75 && maximum >= 145 && minimum <= 105 ? "1" : "0";
    }
  }

  return {
    likelyText,
    maxTransitions,
    strongRows,
    mediumRows,
    brightRatio: Number(brightRatio.toFixed(4)),
    softBrightRatio: Number(softBrightRatio.toFixed(4)),
    darkRatio: Number(darkRatio.toFixed(4)),
    textFingerprint
  };
}

function fingerprintDifference(left = "", right = "") {
  if (!left || !right || left.length !== right.length) return 1;
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) differences += 1;
  }
  return differences / Math.max(1, left.length);
}

function refineDaysGoneTextPresence(presence, regionId = "") {
  if (!presence || presence.likelyText) return presence;

  if (
    isDaysGoneTopRightTitleRegion(regionId)
    && presence.maxTransitions >= 8
    && presence.strongRows >= 2
    && presence.darkRatio >= 0.08
    && (
      presence.brightRatio >= 0.0001
      || presence.softBrightRatio >= 0.001
      || presence.maxTransitions >= 11
    )
  ) {
    presence.likelyText = true;
  }

  if (
    regionId === "days_gone_top_right_toast"
    && presence.maxTransitions >= 9
    && presence.strongRows >= 1
    && presence.darkRatio >= 0.08
  ) {
    presence.likelyText = true;
  }

  if (
    regionId === "days_gone_ipca_pickup"
    && presence.maxTransitions >= 3
    && presence.mediumRows >= 3
    && presence.softBrightRatio >= 0.003
    && presence.darkRatio >= 0.08
  ) {
    presence.likelyText = true;
  }

  // Plant pickup text can be very dim against a nearly black left-side crop.
  // Its horizontal stroke transitions are more stable than absolute
  // brightness, so use a dedicated gate instead of forcing the full crop.
  if (
    regionId === "days_gone_pickup_left"
    && presence.maxTransitions >= 8
    && presence.strongRows >= 1
    && presence.darkRatio >= 0.75
  ) {
    presence.likelyText = true;
  }

  return presence;
}

function isDaysGonePeriodicFailsafeRegion(regionId = "") {
  return DAYS_GONE_PERIODIC_FAILSAFE_REGIONS.has(regionId);
}

async function detectTextFromCanvas(canvas, options = {}) {
  const nativeResolution = options.nativeResolution === true;
  const ocrCanvas = nativeResolution ? canvas : prepareCanvasForOcr(canvas);

  if ("TextDetector" in window) {
    try {
      const detector = new window.TextDetector();
      const detections = await detector.detect(ocrCanvas);
      return detections.map((item) => item.rawValue || item.text || "").join("\n").trim();
    } catch {
      // TextDetector API exists but model unavailable (e.g. "this model does not support image input").
      // Fall through to Python OCR server below.
    }
  }

  if (window.location.protocol === "file:") {
    throw new Error("Local OCR needs the Python server. Start Platinum Router with start-python-server.bat, then open http://localhost:8080/index.html.");
  }

  let response = null;
  try {
    response = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageData: ocrCanvas.toDataURL("image/png"),
        preprocessScale: Number(options.preprocessScale ?? (nativeResolution ? 1 : 3)),
        preprocessThreshold: Number.isFinite(Number(options.preprocessThreshold))
          ? Number(options.preprocessThreshold)
          : null,
        psm: Number(options.psm || 6)
      })
    });
  } catch {
    throw new Error("Local OCR server is unreachable. Restart Platinum Router with start-python-server.bat and refresh this page.");
  }

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Local OCR failed.");
  }

  return String(result.text || "").trim();
}

export function createScreenTracker({ gameData, getCurrentState, actionController, debug }) {
  let settings = loadSettings();
  let pendingSuggestion = null;
  let lastSignature = "";
  let lastAcceptedAt = 0;
  let ocrRunSessionId = loadOcrRunSessionId();
  let ocrRunLogEntries = loadOcrRunLog();
  let ocrRunLogSequence = Number(ocrRunLogEntries.at(-1)?.sequence || ocrRunLogEntries.length || 0);
  let ocrRunFileQueue = loadOcrRunFileQueue();
  let ocrRunFileFlushTimer = null;
  let ocrRunFileFlushInFlight = false;
  let videoScanTimer = null;
  let videoScanRunning = false;
  let videoScanBusy = false;
  let videoCaptureBusy = false;
  let videoOcrWorkersActive = 0;
  let videoOcrQueue = [];
  let videoScanGeneration = 0;
  let videoQueueStats = createVideoQueueStats();
  const lastRegionOcrAt = new Map();
  const lastRegionRecoveryOcrAt = new Map();
  const lastRegionVisualState = new Map();
  let daysGoneCenterPreRoll = [];
  let daysGoneCenterFlurry = null;
  let daysGoneCenterFlurrySequence = 0;
  const resolvedDaysGoneCenterFlurries = new Set();
  let daysGoneCompletionEpisodeActive = false;
  let daysGoneCompletionEpisodeApplied = false;
  let daysGoneCompletionLastSeenAt = 0;
  let daysGoneUnassignedIpcaDetections = [];
  let completedHaiku = loadHaikuProgress();
  let completedTrophies = loadTrophyProgress();
  let completedDaysGoneCollectibles = loadDaysGoneCollectibleProgress();
  let completedDaysGoneTrophies = loadDaysGoneTrophyProgress();
  let completedDaysGoneCompletions = loadDaysGoneCompletionProgress();
  const obs = new ObsClient({ onStateChange: renderObsHealth });

  function syncDaysGoneProgressFromStorage({ renderChecklist = false } = {}) {
    const state = getCurrentState();
    const gameId = state?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return false;

    completedDaysGoneCollectibles = loadDaysGoneCollectibleProgress();
    completedDaysGoneTrophies = loadDaysGoneTrophyProgress();
    completedDaysGoneCompletions = loadDaysGoneCompletionProgress();
    pruneDaysGoneMissedGoals(undefined, completedDaysGoneCollectibles, completedDaysGoneTrophies);
    syncDaysGoneTrophyCounterFromChecklist("days-gone-progress-storage-sync");
    if (renderChecklist) renderDaysGoneCollectibleChecklist();
    return true;
  }

  function getCompletedDaysGoneTrophyCount() {
    return DAYS_GONE_TROPHY_CHECKLIST
      .filter((entry) => completedDaysGoneTrophies.has(entry.id)).length;
  }

  function syncDaysGoneTrophyCounterFromChecklist(source = "days-gone-trophy-checklist-sync") {
    const state = getCurrentState();
    const gameId = state?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return 0;

    const currentValue = Number(state?.counters?.trophies?.value || 0);
    const targetValue = getCompletedDaysGoneTrophyCount();
    const delta = targetValue - currentValue;
    if (!delta) return 0;

    actionController.applyCounterDelta?.("trophies", delta, {
      source,
      countsAgainstSplitAuto: false
    });
    return delta;
  }

  function syncDaysGoneMissedGoals() {
    const state = getCurrentState();
    const gameId = state?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return [];

    syncDaysGoneProgressFromStorage();
    return recordDaysGoneMissedGoalsFromState({
      ...state,
      gameId
    }, {
      completedCollectibles: completedDaysGoneCollectibles,
      completedTrophies: completedDaysGoneTrophies
    });
  }

  function syncInputs() {
    const obsUrl = document.getElementById("screenTrackerObsUrl");
    const obsSource = document.getElementById("screenTrackerObsSource");
    const obsPassword = document.getElementById("screenTrackerObsPassword");
    const regionPreset = document.getElementById("screenTrackerRegion");
    const expectedOnly = document.getElementById("screenTrackerExpectedOnly");
    const pauseOnSuggestion = document.getElementById("screenTrackerPauseOnSuggestion");
    const videoInterval = document.getElementById("screenTrackerVideoInterval");
    const lookahead = document.getElementById("screenTrackerLookahead");

    if (obsUrl) obsUrl.value = settings.obsUrl;
    if (obsSource) obsSource.value = settings.obsSource;
    if (obsPassword) obsPassword.value = settings.obsPassword;
    if (expectedOnly) expectedOnly.checked = settings.expectedOnly !== false;
    if (pauseOnSuggestion) pauseOnSuggestion.checked = false;
    if (videoInterval) videoInterval.value = String(settings.videoScanIntervalMs ?? DEFAULT_VIDEO_SCAN_INTERVAL_MS);
    if (lookahead) lookahead.value = String(settings.lookahead ?? 1);

    if (regionPreset) {
      const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
      if (gameId === "days-gone") {
        settings.regionPreset = "days_gone_unified";
        regionPreset.innerHTML = '<option value="days_gone_unified">Days Gone buffered scanner (center OCR on)</option>';
        regionPreset.value = "days_gone_unified";
        regionPreset.disabled = true;
        saveSettings(settings);
      } else {
        regionPreset.innerHTML = Object.entries(REGION_PRESETS)
          .filter(([id]) => id !== "days_gone_unified" && !id.startsWith("days_gone_"))
          .map(([id, region]) => `<option value="${id}">${region.label}</option>`)
          .join("");
        regionPreset.value = settings.regionPreset || "route_expected";
        regionPreset.disabled = false;
      }
    }

    updateVideoScanButton();
    renderLookingForDock();
    renderHaikuChecklist();
    renderTrophyChecklist();
    syncDaysGoneTrophyCounterFromChecklist("days-gone-tracker-load-sync");
    renderDaysGoneCollectibleChecklist();
    syncDaysGoneMissedGoals();
    renderOcrRunLogState();
  }

  function readSettingsFromUi() {
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    settings = {
      ...settings,
      obsUrl: getInputValue("screenTrackerObsUrl").trim() || DEFAULT_OBS_URL,
      obsSource: getInputValue("screenTrackerObsSource").trim(),
      obsPassword: getInputValue("screenTrackerObsPassword"),
      regionPreset: gameId === "days-gone"
        ? "days_gone_unified"
        : getInputValue("screenTrackerRegion") || "route_expected",
      expectedOnly: !!document.getElementById("screenTrackerExpectedOnly")?.checked,
      pauseVideoOnSuggestion: false,
      lookahead: Math.max(0, Math.min(3, Number(getInputValue("screenTrackerLookahead") || 1))),
      videoScanIntervalMs: Math.max(
        gameId === "days-gone" ? 17 : 250,
        Math.min(5000, Number(getInputValue("screenTrackerVideoInterval") || DEFAULT_VIDEO_SCAN_INTERVAL_MS))
      ),
      cooldownMs: DEFAULT_COOLDOWN_MS
    };
    saveSettings(settings);
    renderLookingForDock();
    renderHaikuChecklist();
    renderTrophyChecklist();
    renderDaysGoneCollectibleChecklist();
    syncDaysGoneMissedGoals();
  }

  function buildLookingForEntries() {
    const state = getCurrentState();
    const gameId = state?.gameId || gameData?.meta?.id || "";
    const rules = ruleSetForGame(gameId);

    if (!settings.expectedOnly) {
      return rules
        .filter((rule) => !!gameData?.counters?.[rule.counterKey])
        .map((rule) => ({
          counterKey: rule.counterKey,
          amount: 1,
          label: getCounterLabel(rule.counterKey, gameData),
          phrases: rule.phrases || [],
          splitLabel: "Any route position",
          splitIndex: null
        }));
    }

    const splits = Array.isArray(state?.splits?.items) ? state.splits.items : [];
    const currentIndex = Number(state?.splits?.currentIndex || 0);
    const maxIndex = Math.min(splits.length - 1, currentIndex + Math.max(0, Number(settings.lookahead || 0)));
    const entries = [];

    for (let index = currentIndex; index <= maxIndex; index += 1) {
      const split = splits[index];
      (Array.isArray(split?.ocrGoals) ? split.ocrGoals : [])
        .map(resolveDaysGoneOcrGoal)
        .filter(Boolean)
        .filter((goal) => {
          if (goal.type === "collectible") return !completedDaysGoneCollectibles.has(goal.id);
          if (goal.type === "trophy") return !completedDaysGoneTrophies.has(goal.id);
          return !completedDaysGoneCompletions.has(goal.id);
        })
        .forEach((goal) => {
          entries.push({
            counterKey: goal.counterKey,
            amount: 1,
            label: goal.label,
            phrases: goal.phrases || [],
            splitLabel: split?.label || `Split ${index + 1}`,
            splitIndex: index,
            optional: goal.optional,
            isOcrGoal: true
          });
        });

      Object.entries(split?.auto || {}).forEach(([counterKey, rawAmount]) => {
        const rule = getRuleByCounterKey(gameId, counterKey);
        const amount = Number(rawAmount || 0);

        if (!rule || !amount || !gameData?.counters?.[counterKey]) return;

        entries.push({
          counterKey,
          amount,
          label: getCounterLabel(counterKey, gameData),
          phrases: rule.phrases || [],
          splitLabel: split?.label || `Split ${index + 1}`,
          splitIndex: index
        });
      });
    }

    return entries;
  }

  function renderLookingForDock() {
    const summary = document.getElementById("screenTrackerLookingForSummary");
    const mode = document.getElementById("screenTrackerLookingForMode");
    const list = document.getElementById("screenTrackerLookingForList");
    if (!summary || !mode || !list) return;

    const state = getCurrentState();
    const entries = buildLookingForEntries();
    const activeRegions = getScanRegions(settings.regionPreset, state, settings);
    const modeText = settings.expectedOnly
      ? `Expected +${Number(settings.lookahead || 0)}`
      : "All tracked";

    mode.textContent = modeText;
    summary.textContent = entries.length
      ? `${entries.length} objective ${entries.length === 1 ? "target" : "targets"} active - ${activeRegions.length} scan ${activeRegions.length === 1 ? "region" : "regions"}`
      : settings.expectedOnly
        ? `No OCR-mapped objectives in the current route window - ${activeRegions.length} scan ${activeRegions.length === 1 ? "region" : "regions"}`
        : "No OCR-mapped objectives for this game.";

    list.innerHTML = entries.length
      ? entries.slice(0, 8).map((entry) => {
        const amountText = entry.isOcrGoal
          ? (entry.optional ? "Optional" : "Goal")
          : Number(entry.amount || 0) > 1 ? `+${entry.amount}` : "+1";
        const phraseText = (entry.phrases || []).slice(0, 3).join(" | ");
        const splitText = entry.splitIndex == null
          ? entry.splitLabel
          : `#${entry.splitIndex + 1} ${entry.splitLabel}`;

        return `
          <div class="screenTrackerTarget">
            <div class="screenTrackerTargetTop">
              <strong>${escapeHtml(`${amountText} ${entry.label}`)}</strong>
              <span>${escapeHtml(splitText)}</span>
            </div>
            <div class="screenTrackerTargetPhrases">${escapeHtml(phraseText || "No OCR phrases")}</div>
          </div>
        `;
      }).join("")
      : `<div class="screenTrackerTarget screenTrackerTarget-empty">Nothing route-expected is OCR-mapped right now.</div>`;

    syncDaysGoneMissedGoals();
  }

  function renderHaikuChecklist() {
    const checklist = document.getElementById("screenTrackerHaikuChecklist");
    const summary = document.getElementById("screenTrackerHaikuSummary");
    const state = document.getElementById("screenTrackerHaikuState");
    const list = document.getElementById("screenTrackerHaikuList");
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    if (!checklist || !summary || !state || !list) return;

    const isGhost = gameId === "ghost-of-tsushima";
    checklist.hidden = !isGhost;
    if (!isGhost) return;

    const completedCount = GHOST_HAIKU_CHECKLIST.filter((entry) => completedHaiku.has(entry.id)).length;
    const missingCount = GHOST_HAIKU_CHECKLIST.length - completedCount;
    summary.textContent = `${completedCount}/${GHOST_HAIKU_CHECKLIST.length} found - ${missingCount} missing`;
    state.textContent = missingCount ? `${missingCount} missing` : "Complete";
    list.innerHTML = GHOST_HAIKU_CHECKLIST.map((entry) => {
      const complete = completedHaiku.has(entry.id);
      return `
        <label class="screenTrackerHaikuItem${complete ? " is-complete" : ""}">
          <input type="checkbox" data-haiku-id="${escapeHtml(entry.id)}"${complete ? " checked" : ""} />
          <span class="screenTrackerHaikuItemText">
            <strong>${escapeHtml(entry.label)}</strong>
            <small>${escapeHtml(`${entry.location} - ${entry.rewardPhrases?.[0] || ""}`)}</small>
          </span>
        </label>
      `;
    }).join("");
  }

  function markMatchedHaiku(suggestion) {
    if (suggestion?.counterKey !== "haiku") return;
    const normalized = suggestion.normalizedText || normalizeText(suggestion.text);
    const matchedEntry = GHOST_HAIKU_CHECKLIST.find((entry) =>
      (entry.rewardPhrases || []).some((phrase) => normalized.includes(normalizeText(phrase)))
    );
    if (!matchedEntry || completedHaiku.has(matchedEntry.id)) return;

    completedHaiku.add(matchedEntry.id);
    saveHaikuProgress(completedHaiku);
    renderHaikuChecklist();
  }

  function isCompletedHaikuReward(suggestion) {
    if (suggestion?.counterKey !== "haiku") return false;
    const normalized = suggestion.normalizedText || normalizeText(suggestion.text);
    return GHOST_HAIKU_CHECKLIST.some((entry) =>
      completedHaiku.has(entry.id)
      && (entry.rewardPhrases || []).some((phrase) => normalized.includes(normalizeText(phrase)))
    );
  }

  function getMatchedTrophyEntry(suggestion) {
    if (suggestion?.counterKey !== "trophies" || !suggestion.trophyTitle) return null;
    const normalizedTitle = normalizeText(suggestion.trophyTitle);
    if (!normalizedTitle) return null;

    const entries = GHOST_TROPHY_CHECKLIST.map((entry) => ({
      entry,
      normalized: normalizeText(entry.title)
    }));
    const exact = entries.find((item) => item.normalized === normalizedTitle);
    if (exact) return exact.entry;

    const partial = entries
      .sort((a, b) => b.normalized.length - a.normalized.length)
      .find((item) => normalizedTitle.includes(item.normalized) || item.normalized.includes(normalizedTitle));
    if (partial) return partial.entry;

    const fuzzy = entries
      .map((item) => ({
        ...item,
        distance: editDistance(normalizedTitle, item.normalized)
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    const allowedDistance = normalizedTitle.length <= 8 ? 1 : normalizedTitle.length <= 14 ? 2 : 3;
    return fuzzy && fuzzy.distance <= allowedDistance ? fuzzy.entry : null;
  }

  function ensureTrophyChecklistNode() {
    let checklist = document.getElementById("screenTrackerTrophyChecklist");
    if (checklist) return checklist;

    checklist = document.createElement("details");
    checklist.id = "screenTrackerTrophyChecklist";
    checklist.className = "screenTrackerChecklist";
    checklist.hidden = true;
    checklist.innerHTML = `
      <summary>
        <span>
          <span class="eyebrow">Trophy Checklist</span>
          <span id="screenTrackerTrophySummary" class="subtitle">52 missing</span>
        </span>
        <span id="screenTrackerTrophyState" class="pill">Missing</span>
      </summary>
      <div id="screenTrackerTrophyList" class="screenTrackerChecklistList"></div>
      <div class="row" style="margin-top:10px;gap:8px;">
        <button id="screenTrackerTrophyResetBtn" class="btn" type="button">Reset Trophy List</button>
      </div>
    `;

    const haikuChecklist = document.getElementById("screenTrackerHaikuChecklist");
    const actions = document.querySelector(".screenTrackerActions");
    if (haikuChecklist?.parentElement) {
      haikuChecklist.insertAdjacentElement("afterend", checklist);
    } else if (actions?.parentElement) {
      actions.parentElement.insertBefore(checklist, actions);
    }

    return checklist;
  }

  function renderTrophyChecklist() {
    const checklist = ensureTrophyChecklistNode();
    const summary = document.getElementById("screenTrackerTrophySummary");
    const state = document.getElementById("screenTrackerTrophyState");
    const list = document.getElementById("screenTrackerTrophyList");
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    if (!checklist || !summary || !state || !list) return;

    const isGhost = gameId === "ghost-of-tsushima";
    checklist.hidden = !isGhost;
    if (!isGhost) return;

    const completedCount = GHOST_TROPHY_CHECKLIST.filter((entry) => completedTrophies.has(entry.id)).length;
    const missingCount = GHOST_TROPHY_CHECKLIST.length - completedCount;
    summary.textContent = `${completedCount}/${GHOST_TROPHY_CHECKLIST.length} earned - ${missingCount} missing`;
    state.textContent = missingCount ? `${missingCount} missing` : "Complete";
    list.innerHTML = GHOST_TROPHY_CHECKLIST.map((entry) => {
      const complete = completedTrophies.has(entry.id);
      return `
        <label class="screenTrackerChecklistItem${complete ? " is-complete" : ""}">
          <input type="checkbox" data-trophy-id="${escapeHtml(entry.id)}"${complete ? " checked" : ""} />
          <span class="screenTrackerChecklistItemText">
            <strong>${escapeHtml(entry.title)}</strong>
            <small>${escapeHtml(entry.group)}</small>
          </span>
        </label>
      `;
    }).join("");
  }

  function markMatchedTrophy(suggestion) {
    const matchedEntry = getMatchedTrophyEntry(suggestion);
    if (!matchedEntry || completedTrophies.has(matchedEntry.id)) return;

    completedTrophies.add(matchedEntry.id);
    saveTrophyProgress(completedTrophies);
    renderTrophyChecklist();
  }

  function isCompletedTrophyToast(suggestion) {
    const matchedEntry = getMatchedTrophyEntry(suggestion);
    return !!matchedEntry && completedTrophies.has(matchedEntry.id);
  }

  function getMatchedDaysGoneCollectibleEntries(suggestion) {
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return [];

    const normalized = suggestion?.normalizedText || normalizeText(suggestion?.text);
    if (!normalized) return [];

    const linkedCollectibleIds = new Set(
      DAYS_GONE_TROPHY_CHECKLIST
        .filter((entry) => entry.linkedCollectibleId)
        .filter((entry) => (entry.phrases || []).some((phrase) => normalizedIncludesPhrase(normalized, phrase)))
        .map((entry) => entry.linkedCollectibleId)
    );
    if (suggestion?.linkedCollectibleId) {
      linkedCollectibleIds.add(String(suggestion.linkedCollectibleId));
    }
    if (suggestion?.completionEpisode === true) {
      DAYS_GONE_COMPLETION_COLLECTIBLE_LINKS.forEach((link) => {
        if (!normalizedIncludesPhrase(normalized, link.normalizedPhrase)) return;
        link.collectibleIds.forEach((id) => linkedCollectibleIds.add(id));
      });
    }
    const allowedCounterKeys = new Set([
      suggestion?.counterKey,
      ...(suggestion?.counterKey === "routecollectibles" ? gameData?.meta?.collectibleCounterKeys || [] : [])
    ].filter(Boolean));

    const expectedGoalId = String(suggestion?.expectedGoalId || "");
    const matchedEntries = DAYS_GONE_COLLECTIBLE_CHECKLIST.filter((entry) => {
      if (entry.id === expectedGoalId) return true;
      if (linkedCollectibleIds.has(entry.id)) return true;
      if (!allowedCounterKeys.has(entry.counterKey)) return false;
      return (entry.phrases || []).some((phrase) => normalizedIncludesPhrase(normalized, phrase));
    });
    return expandDaysGoneCollectibleBundleEntries(matchedEntries);
  }

  function getMatchedDaysGoneTrophyChainEntries(suggestion, matchedCollectibles = null) {
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return [];

    const normalized = suggestion?.normalizedText || normalizeText(suggestion?.text);
    const collectibleMatches = matchedCollectibles || getMatchedDaysGoneCollectibleEntries(suggestion);
    const matchedCollectibleIds = new Set(collectibleMatches.map((entry) => entry.id));

    const expectedGoalId = String(suggestion?.expectedGoalId || "");
    return DAYS_GONE_TROPHY_CHECKLIST.filter((entry) => {
      if (entry.id === expectedGoalId) return true;
      if (matchedCollectibleIds.has(entry.linkedCollectibleId)) return true;
      return normalized && (entry.phrases || []).some((phrase) => normalizedIncludesPhrase(normalized, phrase));
    });
  }

  function renderDaysGoneCollectibleChecklist() {
    const checklist = document.getElementById("screenTrackerDaysGoneCollectibleChecklist");
    const summary = document.getElementById("screenTrackerDaysGoneCollectibleSummary");
    const state = document.getElementById("screenTrackerDaysGoneCollectibleState");
    const list = document.getElementById("screenTrackerDaysGoneCollectibleList");
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    if (!checklist || !summary || !state || !list) return;

    const isDaysGone = gameId === "days-gone";
    checklist.hidden = !isDaysGone;
    if (!isDaysGone) return;

    const completedCount = DAYS_GONE_COLLECTIBLE_CHECKLIST
      .filter((entry) => completedDaysGoneCollectibles.has(entry.id)).length;
    const missingCount = DAYS_GONE_COLLECTIBLE_CHECKLIST.length - completedCount;
    const trophyCompletedCount = DAYS_GONE_TROPHY_CHECKLIST
      .filter((entry) => completedDaysGoneTrophies.has(entry.id)).length;
    summary.textContent = `${completedCount}/${DAYS_GONE_COLLECTIBLE_CHECKLIST.length} found - ${missingCount} missing`;
    state.textContent = missingCount
      ? `${missingCount} missing`
      : trophyCompletedCount < DAYS_GONE_TROPHY_CHECKLIST.length
        ? "Trophies pending"
        : "Complete";

    const groups = new Map();
    DAYS_GONE_COLLECTIBLE_CHECKLIST.forEach((entry) => {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    });

    const collectibleGroupsHtml = [...groups.entries()].map(([group, entries]) => {
      const groupCompleted = entries.filter((entry) => completedDaysGoneCollectibles.has(entry.id)).length;
      const sortedEntries = [...entries].sort((a, b) => {
        const aComplete = completedDaysGoneCollectibles.has(a.id) ? 1 : 0;
        const bComplete = completedDaysGoneCollectibles.has(b.id) ? 1 : 0;
        if (aComplete !== bComplete) return aComplete - bComplete;
        return Number(a.no || 0) - Number(b.no || 0);
      });
      const items = sortedEntries.map((entry) => {
        const complete = completedDaysGoneCollectibles.has(entry.id);
        const bundle = getDaysGoneCollectibleBundle(entry.id);
        const bundleText = bundle ? " - bundled pickup" : "";
        return `
          <label class="screenTrackerChecklistItem${complete ? " is-complete" : ""}">
            <input type="checkbox" data-days-gone-collectible-id="${escapeHtml(entry.id)}"${complete ? " checked" : ""} />
              <span class="screenTrackerChecklistItemText">
                <strong>${escapeHtml(entry.title)}</strong>
              <small>${escapeHtml(`#${entry.no} - ${getCounterLabel(entry.counterKey, gameData)}${entry.manualOnly ? " - manual slot" : ""}${bundleText}`)}</small>
              </span>
          </label>
        `;
      }).join("");

      return `
        <section class="screenTrackerChecklistGroup">
          <div class="screenTrackerChecklistGroupTitle">
            <strong>${escapeHtml(group)}</strong>
            <span>${groupCompleted}/${entries.length}</span>
          </div>
          <div class="screenTrackerChecklistGroupItems">${items}</div>
        </section>
      `;
    }).join("");

    const trophyChainHtml = DAYS_GONE_TROPHY_CHECKLIST.length
      ? `
        <section class="screenTrackerChecklistGroup">
          <div class="screenTrackerChecklistGroupTitle">
            <strong>Platinum Trophies</strong>
            <span>${trophyCompletedCount}/${DAYS_GONE_TROPHY_CHECKLIST.length}</span>
          </div>
          <div class="screenTrackerChecklistGroupItems">
            ${[...DAYS_GONE_TROPHY_CHECKLIST].sort((a, b) => {
              const aComplete = completedDaysGoneTrophies.has(a.id) ? 1 : 0;
              const bComplete = completedDaysGoneTrophies.has(b.id) ? 1 : 0;
              if (aComplete !== bComplete) return aComplete - bComplete;
              return a.title.localeCompare(b.title);
            }).map((entry) => {
              const complete = completedDaysGoneTrophies.has(entry.id);
              return `
                <label class="screenTrackerChecklistItem${complete ? " is-complete" : ""}">
                  <input type="checkbox" data-days-gone-trophy-id="${escapeHtml(entry.id)}"${complete ? " checked" : ""} />
                  <span class="screenTrackerChecklistItemText">
                    <strong>${escapeHtml(entry.title)}</strong>
                    <small>${escapeHtml(entry.linkedCollectibleId ? "chains with first collectible" : entry.group)}</small>
                  </span>
                </label>
              `;
            }).join("")}
          </div>
        </section>
      `
      : "";

    list.innerHTML = collectibleGroupsHtml + trophyChainHtml;
  }

  function applyDaysGoneManualChecklistDeltas({ collectibleIds = [], trophyIds = [], checked = false } = {}) {
    const collectibleCounterKeys = new Set(gameData?.meta?.collectibleCounterKeys || []);
    const counterDeltas = {};

    const addDelta = (counterKey, delta) => {
      if (!counterKey || !delta) return;
      counterDeltas[counterKey] = Number(counterDeltas[counterKey] || 0) + delta;
    };

    collectibleIds.forEach((id) => {
      const entry = DAYS_GONE_COLLECTIBLE_BY_ID.get(id);
      if (!entry) return;

      const isComplete = completedDaysGoneCollectibles.has(id);
      const delta = checked && !isComplete
        ? 1
        : !checked && isComplete
          ? -1
          : 0;

      if (!delta) return;
      addDelta(entry.counterKey, delta);
      if (collectibleCounterKeys.has(entry.counterKey)) {
        addDelta("routecollectibles", delta);
      }
    });

    trophyIds.forEach((id) => {
      const entry = DAYS_GONE_TROPHY_BY_ID.get(id);
      if (!entry) return;

      const isComplete = completedDaysGoneTrophies.has(id);
      const delta = checked && !isComplete
        ? 1
        : !checked && isComplete
          ? -1
          : 0;

      if (!delta) return;
      addDelta("trophies", delta);
    });

    Object.entries(counterDeltas).forEach(([counterKey, delta]) => {
      actionController.applyCounterDelta?.(counterKey, delta, {
        source: "manual-checklist",
        countsAgainstSplitAuto: false
      });
    });
  }

  function applyDaysGoneCollectedEntryDeltas(entries = [], source = "screen-tracker-chain") {
    const collectibleCounterKeys = new Set(gameData?.meta?.collectibleCounterKeys || []);
    const counterDeltas = {};

    entries.forEach((entry) => {
      if (!entry?.counterKey) return;
      counterDeltas[entry.counterKey] = Number(counterDeltas[entry.counterKey] || 0) + 1;
      if (collectibleCounterKeys.has(entry.counterKey)) {
        counterDeltas.routecollectibles = Number(counterDeltas.routecollectibles || 0) + 1;
      }
    });

    Object.entries(counterDeltas).forEach(([counterKey, delta]) => {
      actionController.applyCounterDelta?.(counterKey, delta, {
        source,
        countsAgainstSplitAuto: false
      });
    });
  }

  function applyDaysGoneTrophyEntryDeltas(entries = [], source = "screen-tracker-chain") {
    if (!entries.length) return;
    actionController.applyCounterDelta?.("trophies", entries.length, {
      source,
      countsAgainstSplitAuto: false
    });
  }

  function markMatchedDaysGoneCollectibles(suggestion) {
    const matchedEntries = getMatchedDaysGoneCollectibleEntries(suggestion)
      .filter((entry) => !completedDaysGoneCollectibles.has(entry.id));
    if (!matchedEntries.length) return;

    const collectibleKeys = new Set(gameData?.meta?.collectibleCounterKeys || []);
    const suggestionAppliedIds = new Set(
      Array.isArray(suggestion?.matchedChecklistIds)
        ? suggestion.matchedChecklistIds.map((id) => String(id || ""))
        : []
    );
    const suggestionAlreadyAppliedCollectible =
      suggestion?.action !== "route-goal"
      && (
        collectibleKeys.has(suggestion?.counterKey)
        || suggestion?.counterKey === "routecollectibles"
      );
    const entriesNeedingCounterDelta = suggestionAlreadyAppliedCollectible
      ? matchedEntries.filter((entry) => !suggestionAppliedIds.has(entry.id))
      : matchedEntries;
    if (entriesNeedingCounterDelta.length) {
      applyDaysGoneCollectedEntryDeltas(entriesNeedingCounterDelta);
    }

    matchedEntries.forEach((entry) => completedDaysGoneCollectibles.add(entry.id));
    saveDaysGoneCollectibleProgress(completedDaysGoneCollectibles);
    pruneDaysGoneMissedGoals(undefined, completedDaysGoneCollectibles, completedDaysGoneTrophies);
    renderDaysGoneCollectibleChecklist();
    tryCompleteCurrentSplitFromDaysGoneOcrCompletion("days-gone-collectible-goals");
  }

  function markMatchedDaysGoneTrophyChains(suggestion) {
    const matchedCollectibles = getMatchedDaysGoneCollectibleEntries(suggestion);
    const matchedEntries = getMatchedDaysGoneTrophyChainEntries(suggestion, matchedCollectibles)
      .filter((entry) => !completedDaysGoneTrophies.has(entry.id));
    if (!matchedEntries.length) return;

    if (suggestion?.counterKey !== "trophies") {
      applyDaysGoneTrophyEntryDeltas(matchedEntries);
    }

    matchedEntries.forEach((entry) => completedDaysGoneTrophies.add(entry.id));
    saveDaysGoneTrophyProgress(completedDaysGoneTrophies);
    syncDaysGoneTrophyCounterFromChecklist("days-gone-trophy-chain-sync");
    pruneDaysGoneMissedGoals(undefined, completedDaysGoneCollectibles, completedDaysGoneTrophies);
    renderDaysGoneCollectibleChecklist();
    tryCompleteCurrentSplitFromDaysGoneOcrCompletion("days-gone-trophy-goals");
  }

  function markMatchedDaysGoneCompletionTitle(suggestion) {
    const expectedGoal = suggestion?.expectedGoalId
      ? getExpectedOcrGoals(getCurrentState(), settings.lookahead)
        .find((goal) => goal.id === suggestion.expectedGoalId)
      : null;
    if (["collectible", "trophy"].includes(expectedGoal?.type)) return false;

    const goalId = expectedGoal?.id || (
      suggestion?.completionEpisode === true
      && suggestion?.action === "counter"
      && suggestion?.canonicalTitle
        ? getDaysGoneCompletionGoalId(suggestion.counterKey, suggestion.canonicalTitle)
        : ""
    );
    if (!goalId || completedDaysGoneCompletions.has(goalId)) return false;

    completedDaysGoneCompletions.add(goalId);
    saveDaysGoneCompletionProgress(completedDaysGoneCompletions);
    renderLookingForDock();
    tryCompleteCurrentSplitFromDaysGoneOcrCompletion("days-gone-center-completion-title");
    return true;
  }

  function getDaysGoneIpcaClusterGoal(cluster = {}) {
    const index = String(Number(cluster?.ipcaIndex || 0)).padStart(2, "0");
    const siteSlug = normalizeText(cluster?.siteName).replaceAll(" ", "-");
    if (!siteSlug || index === "00") return null;
    return {
      id: `ipca-tech-${index}-${siteSlug}`,
      type: "pickup",
      label: `Did you pick up IPCA Tech? - ${cluster.siteName}`,
      counterKey: "ipca",
      optional: false,
      phrases: ["ipca tech", "ipca"]
    };
  }

  function markDaysGoneIpcaClusterComplete(goalId = "") {
    const id = String(goalId || "").trim();
    if (!id || completedDaysGoneCompletions.has(id)) return false;
    completedDaysGoneCompletions.add(id);
    saveDaysGoneCompletionProgress(completedDaysGoneCompletions);
    pruneDaysGoneMissedGoals(
      undefined,
      completedDaysGoneCollectibles,
      completedDaysGoneTrophies,
      completedDaysGoneCompletions
    );
    renderLookingForDock();
    return true;
  }

  function findDaysGoneIpcaClusterForSuggestion(suggestion) {
    const clusters = Array.isArray(gameData?.neroIpcaClusters) ? gameData.neroIpcaClusters : [];
    if (!clusters.length) return null;

    const matchedIntelIds = new Set(
      getMatchedDaysGoneCollectibleEntries(suggestion)
        .filter((entry) => entry.counterKey === "nerointel")
        .map((entry) => entry.id)
    );
    const observedTitle = normalizeText(
      suggestion?.canonicalTitle || suggestion?.matchedPhrase || suggestion?.text || ""
    );

    return clusters.find((cluster) =>
      (cluster.neroIntel || []).some((entry) => matchedIntelIds.has(entry.id))
      || (observedTitle && normalizedApproximatelyIncludesPhrase(observedTitle, cluster.siteName))
    ) || null;
  }

  function handleDaysGoneIpcaDetection(suggestion) {
    if (suggestion?.counterKey !== "ipca") return null;
    if (
      suggestion?.expectedGoalId
      && completedDaysGoneCompletions.has(suggestion.expectedGoalId)
    ) return { status: "route-goal-confirmed", goalId: suggestion.expectedGoalId };

    const now = Date.now();
    const pending = loadDaysGoneMissedGoals()
      .filter((item) => item?.source === "nero-ipca-anchor-reminder")
      .filter((item) => now - Date.parse(item?.addedAt || "") <= DAYS_GONE_IPCA_ANCHOR_WINDOW_MS)
      .sort((left, right) => Date.parse(right?.addedAt || "") - Date.parse(left?.addedAt || ""))[0];

    if (pending?.id) {
      markDaysGoneIpcaClusterComplete(pending.id);
      return { status: "anchor-reminder-confirmed", goalId: pending.id };
    }

    daysGoneUnassignedIpcaDetections = daysGoneUnassignedIpcaDetections
      .filter((timestamp) => now - timestamp <= DAYS_GONE_IPCA_ANCHOR_WINDOW_MS);
    daysGoneUnassignedIpcaDetections.push(now);
    return { status: "awaiting-nero-anchor" };
  }

  function handleDaysGoneIpcaAnchor(suggestion) {
    const cluster = findDaysGoneIpcaClusterForSuggestion(suggestion);
    const goal = getDaysGoneIpcaClusterGoal(cluster);
    if (!cluster || !goal) return null;
    if (completedDaysGoneCompletions.has(goal.id)) {
      return { status: "already-confirmed", cluster, goal };
    }

    const now = Date.now();
    daysGoneUnassignedIpcaDetections = daysGoneUnassignedIpcaDetections
      .filter((timestamp) => now - timestamp <= DAYS_GONE_IPCA_ANCHOR_WINDOW_MS);
    if (daysGoneUnassignedIpcaDetections.length) {
      daysGoneUnassignedIpcaDetections.pop();
      markDaysGoneIpcaClusterComplete(goal.id);
      return { status: "recent-pickup-confirmed", cluster, goal };
    }

    const state = getCurrentState();
    const splitIndex = Number(state?.splits?.currentIndex || 0);
    const split = state?.splits?.items?.[splitIndex] || {};
    const key = getDaysGoneGoalStorageKey(goal);
    const reminders = loadDaysGoneMissedGoals();
    if (!reminders.some((item) => item.key === key)) {
      saveDaysGoneMissedGoals([...reminders, {
        ...goal,
        key,
        splitId: split?.id || "",
        splitLabel: split?.label || `Split ${splitIndex + 1}`,
        splitIndex,
        phaseId: state?.phase || "",
        addedAt: new Date(now).toISOString(),
        firstSeenElapsedMs: Number(state?.timer?.elapsed || 0),
        source: "nero-ipca-anchor-reminder",
        anchorLabel: cluster.siteName,
        bodyHint: cluster.bodyHint || ""
      }]);
    }
    return { status: "reminder-created", cluster, goal };
  }

  function isCompletedDaysGoneCompletionTitle(suggestion) {
    if (suggestion?.expectedGoalId && completedDaysGoneCompletions.has(suggestion.expectedGoalId)) return true;
    if (suggestion?.completionEpisode !== true || !suggestion?.canonicalTitle) return false;
    const goalId = getDaysGoneCompletionGoalId(suggestion.counterKey, suggestion.canonicalTitle);
    return Boolean(goalId && completedDaysGoneCompletions.has(goalId));
  }

  function getMatchedDaysGoneTrophyEntriesFromText(text, { pendingOnly = false, requireToast = false } = {}) {
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return [];

    const normalized = normalizeText(text);
    if (!normalized || (requireToast && !normalizedIncludesPhrase(normalized, "trophy earned"))) return [];

    return DAYS_GONE_TROPHY_CHECKLIST
      .filter((entry) => !pendingOnly || !completedDaysGoneTrophies.has(entry.id))
      .filter((entry) => (entry.phrases || []).some((phrase) => normalizedIncludesPhrase(normalized, phrase)));
  }

  function markMatchedDaysGoneTrophiesFromText(text) {
    const matchedEntries = getMatchedDaysGoneTrophyEntriesFromText(text, {
      pendingOnly: true,
      requireToast: true
    });
    if (!matchedEntries.length) return 0;

    const linkedCollectibleEntries = matchedEntries
      .map((entry) => DAYS_GONE_COLLECTIBLE_BY_ID.get(entry.linkedCollectibleId))
      .filter((entry) => entry && !completedDaysGoneCollectibles.has(entry.id));

    applyDaysGoneTrophyEntryDeltas(matchedEntries);
    applyDaysGoneCollectedEntryDeltas(linkedCollectibleEntries);
    matchedEntries.forEach((entry) => completedDaysGoneTrophies.add(entry.id));
    linkedCollectibleEntries.forEach((entry) => completedDaysGoneCollectibles.add(entry.id));
    saveDaysGoneCollectibleProgress(completedDaysGoneCollectibles);
    saveDaysGoneTrophyProgress(completedDaysGoneTrophies);
    syncDaysGoneTrophyCounterFromChecklist("days-gone-trophy-text-sync");
    pruneDaysGoneMissedGoals(undefined, completedDaysGoneCollectibles, completedDaysGoneTrophies);
    renderDaysGoneCollectibleChecklist();
    tryCompleteCurrentSplitFromDaysGoneOcrCompletion("days-gone-trophy-chain");
    return matchedEntries.length;
  }

  function isCompletedDaysGoneCollectibleToast(suggestion) {
    const matchedEntries = getMatchedDaysGoneCollectibleEntries(suggestion);
    const matchedTrophies = getMatchedDaysGoneTrophyChainEntries(suggestion, matchedEntries);
    return matchedEntries.length > 0
      && matchedEntries.every((entry) => completedDaysGoneCollectibles.has(entry.id))
      && matchedTrophies.every((entry) => completedDaysGoneTrophies.has(entry.id));
  }

  function isCompletedDaysGoneTrophyToast(suggestion) {
    const matchedEntries = getMatchedDaysGoneTrophyChainEntries(suggestion);
    return matchedEntries.length > 0 && matchedEntries.every((entry) => completedDaysGoneTrophies.has(entry.id));
  }

  function setStatus(message, tone = "") {
    const status = document.getElementById("screenTrackerStatus");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.tone = tone;
  }

  function getCurrentSplitContext() {
    const state = getCurrentState();
    const splitIndex = Number(state?.splits?.currentIndex || 0);
    const split = state?.splits?.items?.[splitIndex] || null;

    return {
      gameId: state?.gameId || gameData?.meta?.id || "",
      routeId: state?.routeId || gameData?.route?.id || gameData?.meta?.routeId || "",
      phaseId: state?.phase || "",
      splitIndex,
      splitId: split?.id || "",
      splitLabel: split?.label || (split ? `Split ${splitIndex + 1}` : ""),
      elapsedMs: Number(state?.timer?.elapsed || 0),
      timerRunning: !!state?.timer?.running
    };
  }

  function summarizeRegionsForLog(regionTexts = []) {
    return (Array.isArray(regionTexts) ? regionTexts : []).map((entry) => ({
      regionId: String(entry?.regionId || ""),
      regionLabel: String(entry?.regionLabel || entry?.label || "screen"),
      text: String(entry?.text || ""),
      normalizedText: normalizeText(entry?.text || ""),
      error: entry?.error ? String(entry.error) : "",
      timingMs: Number.isFinite(Number(entry?.timingMs)) ? Number(entry.timingMs) : null,
      scanTimingMs: Number.isFinite(Number(entry?.scanTimingMs)) ? Number(entry.scanTimingMs) : null,
      gate: entry?.gate ? {
        skipped: entry.gate.skipped === true,
        forced: entry.gate.forced === true,
        reason: String(entry.gate.reason || ""),
        likelyText: entry.gate.likelyText === true,
        maxTransitions: Number(entry.gate.maxTransitions || 0),
        strongRows: Number(entry.gate.strongRows || 0),
        brightRatio: Number(entry.gate.brightRatio || 0),
        darkRatio: Number(entry.gate.darkRatio || 0)
      } : null
    }));
  }

  function summarizeMatchesForLog(matches = []) {
    return (Array.isArray(matches) ? matches : []).map((suggestion) => ({
      kind: suggestion?.kind || "delta",
      counterKey: suggestion?.counterKey || "",
      label: suggestion?.label || "",
      delta: Number(suggestion?.delta || 0),
      targetValue: suggestion?.targetValue ?? null,
      observedValue: suggestion?.observedValue ?? null,
      observedTotal: suggestion?.observedTotal ?? null,
      matchedPhrase: suggestion?.matchedPhrase || "",
      trophyTitle: suggestion?.trophyTitle || "",
      confidence: suggestion?.confidence || "",
      regionLabel: suggestion?.regionLabel || "",
      autoSync: suggestion?.autoSync === true,
      outOfRoute: suggestion?.outOfRoute === true,
      countsAgainstSplitAuto: suggestion?.countsAgainstSplitAuto === true,
      matchedChecklistIds: Array.isArray(suggestion?.matchedChecklistIds)
        ? suggestion.matchedChecklistIds
        : []
    }));
  }

  function buildCombinedOcrText(regionTexts = []) {
    return (Array.isArray(regionTexts) ? regionTexts : [])
      .map((entry) => {
        const label = entry?.regionLabel || entry?.label || "screen";
        const text = entry?.error
          ? `OCR error: ${entry.error}`
          : entry?.text || "";
        if (!String(text || "").trim()) return "";
        return `[${label}]\n${text}`.trim();
      })
      .filter(Boolean)
      .join("\n\n");
  }

  function renderOcrRunLogState() {
    const node = document.getElementById("screenTrackerOcrLogState");
    if (!node) return;

    const latest = ocrRunLogEntries.at(-1);
    const lastText = latest?.at
      ? ` | last ${new Date(latest.at).toLocaleTimeString()}`
      : "";
    const sessionTail = String(ocrRunSessionId || "").slice(-6);
    const pendingText = ocrRunFileQueue.length
      ? ` | ${ocrRunFileQueue.length} file write pending`
      : " | file log synced";
    node.textContent = `${ocrRunLogEntries.length} OCR events saved${pendingText} | session ${sessionTail}${lastText}`;
  }

  function scheduleOcrRunFileFlush(delayMs = 300) {
    if (ocrRunFileFlushTimer || !ocrRunFileQueue.length) return;

    ocrRunFileFlushTimer = window.setTimeout(() => {
      ocrRunFileFlushTimer = null;
      flushOcrRunFileQueue();
    }, Math.max(0, Number(delayMs || 0)));
  }

  async function flushOcrRunFileQueue() {
    if (ocrRunFileFlushInFlight || !ocrRunFileQueue.length) return;

    ocrRunFileFlushInFlight = true;
    const batch = ocrRunFileQueue.slice(0, OCR_RUN_LOG_FILE_BATCH_SIZE);

    try {
      const response = await fetch(OCR_LOG_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ entries: batch })
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "OCR file log write failed.");
      }

      ocrRunFileQueue = saveOcrRunFileQueue(ocrRunFileQueue.slice(batch.length));
      renderOcrRunLogState();
    } catch (error) {
      debug?.warn?.("OCR file log write failed", { message: error?.message || "unknown" });
    } finally {
      ocrRunFileFlushInFlight = false;
      if (ocrRunFileQueue.length) scheduleOcrRunFileFlush(2500);
    }
  }

  function queueOcrRunFileLog(entry) {
    if (!entry) return;

    ocrRunFileQueue = saveOcrRunFileQueue([...ocrRunFileQueue, entry]);
    renderOcrRunLogState();
    scheduleOcrRunFileFlush(100);
  }

  function appendOcrRunLog({
    source = "unknown",
    status = "scan",
    message = "",
    regionTexts = [],
    matches = [],
    applied = [],
    error = null,
    force = false
  } = {}) {
    const context = getCurrentSplitContext();
    if (!context.timerRunning) {
      return null;
    }

    const regions = summarizeRegionsForLog(regionTexts);
    const combinedText = buildCombinedOcrText(regionTexts);
    const errors = [
      ...regions
        .filter((entry) => entry.error)
        .map((entry) => ({ regionLabel: entry.regionLabel, message: entry.error })),
      ...(error ? [{ regionLabel: "", message: String(error?.message || error) }] : [])
    ];

    const eventBucket = classifyOcrLogEvent({
      status,
      regionTexts: regions,
      matches,
      applied,
      errors
    });

    if (
      !eventBucket
      && !force
    ) {
      return null;
    }

    // A forced call is useful for errors/control events, but empty gated video frames
    // are not events and previously made trial logs grow to hundreds of thousands of lines.
    if (!eventBucket) return null;

    const now = Date.now();
    const lastFrameAt = Number(obs.lastSuccessfulRequestAt || 0);
    const entry = {
      id: `${now}-${ocrRunLogSequence + 1}`,
      sequence: ocrRunLogSequence + 1,
      sessionId: ocrRunSessionId,
      at: new Date(now).toISOString(),
      eventBucket,
      timestamps: buildOcrLogTimestamps(now, context.elapsedMs, eventBucket),
      source,
      status,
      message,
      context,
      obs: {
        connected: !!obs.isConnected,
        lastFrameAgoMs: lastFrameAt ? Math.max(0, now - lastFrameAt) : null,
        videoScanRunning
      },
      settings: {
        regionPreset: settings.regionPreset || "",
        expectedOnly: settings.expectedOnly !== false,
        lookahead: Number(settings.lookahead || 0),
        videoScanIntervalMs: Number(settings.videoScanIntervalMs || DEFAULT_VIDEO_SCAN_INTERVAL_MS)
      },
      regions,
      combinedText,
      normalizedText: normalizeText(combinedText),
      matches: summarizeMatchesForLog(matches),
      applied,
      errors
    };

    ocrRunLogSequence = entry.sequence;
    ocrRunLogEntries = saveOcrRunLog([...ocrRunLogEntries, entry]);
    queueOcrRunFileLog(entry);
    renderOcrRunLogState();
    return entry;
  }

  function clearOcrRunLog() {
    ocrRunLogEntries = [];
    ocrRunLogSequence = 0;
    try {
      localStorage.removeItem(OCR_RUN_LOG_KEY);
    } catch {
      // Ignore storage failures; the visible log count still resets.
    }
    renderOcrRunLogState();
    setStatus("OCR run log cleared.", "");
  }

  function downloadOcrRunLog() {
    const buckets = bucketOcrLogEntries(ocrRunLogEntries);
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      activeSessionId: ocrRunSessionId,
      entryCount: ocrRunLogEntries.length,
      bucketCounts: Object.fromEntries(
        Object.entries(buckets).map(([bucket, entries]) => [bucket, entries.length])
      ),
      buckets,
      entries: ocrRunLogEntries
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `platinum-router-ocr-log-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("OCR run log downloaded.", "ok");
  }

  function isDaysGoneCompletionGoalDone(goalId) {
    const id = String(goalId || "").trim();
    if (!id) return false;
    return completedDaysGoneCollectibles.has(id)
      || completedDaysGoneTrophies.has(id)
      || completedDaysGoneCompletions.has(id);
  }

  function isSplitOcrCompletionSatisfied(split = null) {
    const completion = split?.ocrCompletion;
    if (!completion || typeof completion !== "object") return false;

    const mode = String(completion.mode || "").trim();
    const groups = Array.isArray(completion.groups) ? completion.groups : [];
    if (!groups.length) return false;

    const isGroupDone = (group) =>
      Array.isArray(group)
      && group.length > 0
      && group.every((goalId) => isDaysGoneCompletionGoalDone(goalId))
    ;

    if (mode === "allGoalGroups") return groups.every(isGroupDone);
    if (mode === "anyGoalGroups") return groups.some(isGroupDone);
    return false;
  }

  function tryCompleteCurrentSplitFromDaysGoneOcrCompletion(reason = "ocr-completion") {
    const state = getCurrentState();
    const gameId = state?.gameId || gameData?.meta?.id || "";
    if (gameId !== "days-gone") return false;

    const splitIndex = Number(state?.splits?.currentIndex || 0);
    const split = state?.splits?.items?.[splitIndex] || null;
    if (!split || !isSplitOcrCompletionSatisfied(split)) return false;

    const ok = actionController.completeCurrentSplit?.({
      source: "screen-tracker-ocr-completion",
      reason
    });

    if (ok) {
      setStatus(`Auto-completed split: ${split.label || `Split ${splitIndex + 1}`}.`, "ok");
    }

    return !!ok;
  }

  function renderObsHealth() {
    const health = document.getElementById("screenTrackerObsHealth");
    const text = document.getElementById("screenTrackerObsHealthText");
    if (!health || !text) return;

    if (!obs.isConnected) {
      health.dataset.tone = "offline";
      text.textContent = "OBS not connected";
      return;
    }

    const lastFrameAt = Number(obs.lastSuccessfulRequestAt || 0);
    if (!lastFrameAt) {
      health.dataset.tone = "warn";
      text.textContent = "OBS connected - waiting for a frame";
      return;
    }

    const secondsAgo = Math.max(0, Math.floor((Date.now() - lastFrameAt) / 1000));
    const staleAfterSeconds = Math.max(5, Math.ceil(settings.videoScanIntervalMs / 1000) * 3);
    const stale = videoScanRunning && secondsAgo > staleAfterSeconds;
    health.dataset.tone = stale ? "warn" : "ok";
    text.textContent = stale
      ? `OBS connected - last frame ${secondsAgo}s ago (scan may be stalled)`
      : `OBS stable - last frame ${secondsAgo}s ago${videoScanRunning ? " (video scan active)" : ""}`;
  }

  function updateVideoScanButton() {
    const button = document.getElementById("screenTrackerVideoBtn");
    if (!button) return;

    button.textContent = videoScanRunning ? "Stop Video Scan" : "Start Video Scan";
    button.classList.toggle("danger", videoScanRunning);
    button.classList.toggle("primary", !videoScanRunning);
    button.setAttribute("aria-pressed", String(videoScanRunning));
  }

  function stopVideoScan(message = "") {
    const wasRunning = videoScanRunning;
    if (videoScanTimer) {
      window.clearInterval(videoScanTimer);
      videoScanTimer = null;
    }

    videoScanRunning = false;
    videoScanBusy = false;
    videoCaptureBusy = false;
    videoScanGeneration += 1;
    videoOcrQueue = [];
    daysGoneCenterPreRoll = [];
    daysGoneCenterFlurry = null;
    resolvedDaysGoneCenterFlurries.clear();
    daysGoneCompletionEpisodeActive = false;
    daysGoneCompletionEpisodeApplied = false;
    daysGoneCompletionLastSeenAt = 0;
    updateVideoScanButton();
    renderObsHealth();

    if (wasRunning) {
      appendOcrRunLog({
        source: "control",
        status: "video-queue-summary",
        message: `Capture queue: ${videoQueueStats.frames} frames, ${videoQueueStats.episodesQueued} popup episodes buffered, ${videoQueueStats.processed} OCR crops processed, ${videoQueueStats.episodeFramesMerged} repeat frames merged, ${videoQueueStats.replaced} episodes upgraded with a stronger frame, ${videoQueueStats.centerEarlyMatches}/${videoQueueStats.centerFlurries} center flurries resolved early, ${videoQueueStats.centerFramesCancelled} later center entries cancelled, ${videoQueueStats.overflow} safety-cap overflow, ${videoQueueStats.visualChangeBypasses} new-popup cooldown bypasses, ${videoQueueStats.fallbackMatches}/${videoQueueStats.fallbackAttempts} alternate-frame matches, ${videoQueueStats.recoveryMatches}/${videoQueueStats.recoveryAttempts} recovery matches, max depth ${videoQueueStats.maxDepth}, peak workers ${videoQueueStats.maxWorkers}.`,
        queueStats: { ...videoQueueStats },
        force: true
      });
    }

    if (message) {
      setStatus(message, "");
    }
  }

  function clearSuggestion() {
    pendingSuggestion = null;
    const card = document.getElementById("screenTrackerSuggestion");
    if (card) card.hidden = true;
  }

  function getSuggestionSignature(suggestion) {
    if (suggestion?.completionEpisode === true) {
      return `days-gone-completion:${suggestion.action || "counter"}:${suggestion.counterKey || "split"}:${normalizeText(suggestion.matchedPhrase || "")}`;
    }
    if (suggestion?.kind === "sync") {
      return `${suggestion.counterKey}:sync:${suggestion.targetValue}`;
    }
    if (suggestion?.counterKey === "trophies") {
      const trophyEntries = getMatchedDaysGoneTrophyEntriesFromText(
        suggestion?.normalizedText || suggestion?.text || suggestion?.trophyTitle || suggestion?.matchedPhrase,
        { pendingOnly: false }
      );
      if (trophyEntries.length) {
        return `${suggestion.counterKey}:checklist:${trophyEntries.map((entry) => entry.id).join("+")}`;
      }
    }
    const titleKey = suggestion?.counterKey === "trophies" && suggestion.trophyTitle
      ? normalizeText(suggestion.trophyTitle)
      : suggestion?.matchedPhrase;
    return `${suggestion?.counterKey}:${titleKey}`;
  }

  function showSuggestion(suggestion) {
    pendingSuggestion = null;
    const card = document.getElementById("screenTrackerSuggestion");
    const title = document.getElementById("screenTrackerSuggestionTitle");
    const detail = document.getElementById("screenTrackerSuggestionDetail");
    const text = document.getElementById("screenTrackerOcrText");
    const actions = document.getElementById("screenTrackerSuggestionActions");

    if (card) card.hidden = false;
    if (actions) actions.hidden = true;
    if (title) {
      if (suggestion.kind === "sync") {
        title.textContent = `Logged sync: ${suggestion.label} to ${suggestion.targetValue}`;
      } else {
        const sign = Number(suggestion.delta || 0) > 0 ? "+" : "";
        title.textContent = `Logged ${sign}${suggestion.delta} ${suggestion.label}`;
      }
    }
    if (detail) {
      detail.textContent = suggestion.kind === "sync"
        ? `${suggestion.confidence} | game shows ${suggestion.observedValue}/${suggestion.observedTotal} | ${suggestion.regionLabel}`
        : `${suggestion.confidence} confidence | ${suggestion.regionLabel} | matched "${suggestion.matchedPhrase}"`;
    }
    if (text) text.textContent = suggestion.text || "No OCR text captured.";
  }

  function enrichDaysGoneCollectibleSuggestion(suggestion) {
    const gameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
    const collectibleKeys = new Set(gameData?.meta?.collectibleCounterKeys || []);
    if (gameId !== "days-gone" || !collectibleKeys.has(suggestion?.counterKey)) return suggestion;

    const matchedEntries = getMatchedDaysGoneCollectibleEntries(suggestion);
    const pendingEntries = matchedEntries
      .filter((entry) => entry.counterKey === suggestion.counterKey)
      .filter((entry) => !completedDaysGoneCollectibles.has(entry.id));
    if (!pendingEntries.length) return suggestion;

    const delta = pendingEntries.length;
    const extraCounters = (suggestion.extraCounters || []).map((extra) => ({
      ...extra,
      delta: extra.counterKey === "routecollectibles" ? delta : extra.delta
    }));
    const bundleLabel = delta > 1 ? `${suggestion.label} bundle` : suggestion.label;

    return {
      ...suggestion,
      delta,
      label: bundleLabel,
      matchedChecklistIds: pendingEntries.map((entry) => entry.id),
      extraCounters
    };
  }

  function getRegionMatches(regionTexts) {
    const state = getCurrentState();
    const entries = Array.isArray(regionTexts) ? regionTexts : [];
    const now = Date.now();
    const completionAnchor = entries.find((entry) => entry?.regionId === "days_gone_completion_anchor");
    const completionTitle = entries.find((entry) => entry?.regionId === "days_gone_completion_title");
    const completionScanEnabled = Boolean(completionAnchor || completionTitle);
    const anchorSeen = completionScanEnabled
      && isDaysGoneMissionCompleteAnchor(completionAnchor?.text || "");
    const splitIndex = Number(state?.splits?.currentIndex || 0);
    const currentSplit = state?.splits?.items?.[splitIndex] || null;
    const centeredCompletion = completionScanEnabled
      ? classifyDaysGoneCompletion({
          anchorText: completionAnchor?.text || "",
          titleText: completionTitle?.text || "",
          currentSplit,
          completionTitleRules: gameData?.meta?.completionTitleRules || [],
          completionTitles: gameData?.completionTitles || {}
        })
      : null;
    const completionSignalSeen = anchorSeen || Boolean(centeredCompletion);

    if (completionSignalSeen) {
      if (!daysGoneCompletionEpisodeActive) {
        daysGoneCompletionEpisodeActive = true;
        daysGoneCompletionEpisodeApplied = false;
      }
      daysGoneCompletionLastSeenAt = now;
    } else if (daysGoneCompletionEpisodeActive && now - daysGoneCompletionLastSeenAt >= 1800) {
      daysGoneCompletionEpisodeActive = false;
      daysGoneCompletionEpisodeApplied = false;
    }

    const completion = !daysGoneCompletionEpisodeApplied
      ? centeredCompletion
      : null;
    const currentCompletionGoal = completion
      ? (Array.isArray(currentSplit?.ocrGoals) ? currentSplit.ocrGoals : [])
        .map(resolveDaysGoneOcrGoal)
        .filter(Boolean)
        .find((goal) => goal.type === "completion" && (goal.phrases || []).some((phrase) =>
          normalizedApproximatelyIncludesPhrase(completion.matchedPhrase || "", phrase)
        ))
      : null;
    const completionSuggestions = completion
      ? [{
          id: `days-gone-completion:${now}`,
          ...completion,
          autoSync: true,
          delta: 1,
          text: completionTitle?.text || "",
          normalizedText: normalizeText(completionTitle?.text || ""),
          regionLabel: completionTitle?.regionLabel || "Days Gone completion title",
          completionEpisode: true,
          expectedGoalId: currentCompletionGoal?.id || getDaysGoneCompletionGoalId(
            completion.counterKey,
            completion.canonicalTitle || completion.matchedPhrase
          ),
          countsAgainstSplitAuto: !currentCompletionGoal
            && completion.action === "counter"
            && Number(currentSplit?.auto?.[completion.counterKey] || 0) > 0
        }]
      : [];
    const suggestions = [
      ...completionSuggestions,
      ...entries.flatMap((entry) => analyzeText({
        text: entry.text || "",
        gameData,
        state,
        settings,
        regionLabel: entry.regionLabel || "screen"
      }))
    ]
    .map((suggestion) => enrichDaysGoneCollectibleSuggestion(suggestion))
    .filter((suggestion) =>
      !isCompletedHaikuReward(suggestion)
      && !isCompletedTrophyToast(suggestion)
      && !isCompletedDaysGoneCollectibleToast(suggestion)
      && !isCompletedDaysGoneTrophyToast(suggestion)
      && !isCompletedDaysGoneCompletionTitle(suggestion)
    );

    const priority = (suggestion) => {
      const checklistIds = Array.isArray(suggestion?.matchedChecklistIds)
        ? suggestion.matchedChecklistIds.length
        : 0;
      const confidence = String(suggestion?.confidence || "");
      return (suggestion?.autoSync === true ? 1000 : 0)
        + (checklistIds ? 200 + checklistIds : 0)
        + (confidence.includes("exact") ? 50 : 0)
        + (confidence.includes("expected") ? 25 : 0);
    };

    suggestions.sort((left, right) => priority(right) - priority(left));

    const seen = new Set();
    return suggestions.filter((suggestion) => {
      const checklistIds = Array.isArray(suggestion?.matchedChecklistIds)
        ? [...suggestion.matchedChecklistIds].sort()
        : [];
      const key = checklistIds.length
        ? `checklist:${checklistIds.join("+")}`
        : `${suggestion?.counterKey || ""}:${suggestion?.kind || "delta"}:${normalizeText(suggestion?.matchedPhrase || suggestion?.trophyTitle || "")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function handleRegionTexts(regionTexts, options = {}) {
    const source = options.source || "scan";
    const entries = Array.isArray(regionTexts) ? regionTexts : [];
    const matches = getRegionMatches(entries);
    const combinedText = buildCombinedOcrText(entries);
    const hasErrors = entries.some((entry) => !!entry.error);
    const daysGoneTrophiesMarked = matches.length ? 0 : markMatchedDaysGoneTrophiesFromText(combinedText);

    if (!matches.length) {
      clearSuggestion();
      setText("screenTrackerOcrText", combinedText || "No OCR text captured.");
      const message = daysGoneTrophiesMarked
        ? `Marked ${daysGoneTrophiesMarked} Days Gone trophy ${daysGoneTrophiesMarked === 1 ? "check" : "checks"}.`
        : hasErrors
          ? "OCR error logged for review."
        : settings.expectedOnly
          ? "No expected tracked objective found."
          : "No tracked objective found.";
      appendOcrRunLog({
        source,
        status: daysGoneTrophiesMarked ? "auto-applied" : hasErrors ? "ocr-error" : "no-match",
        message,
        regionTexts: entries,
        matches,
        applied: daysGoneTrophiesMarked
          ? [{ type: "days-gone-trophy-text", count: daysGoneTrophiesMarked }]
          : [],
        force: options.forceLog === true
      });
      setStatus(message, daysGoneTrophiesMarked ? "ok" : "warn");
      return;
    }

    const suggestion = matches[0];
    const signature = getSuggestionSignature(suggestion);
    const now = Date.now();

    if (signature === lastSignature && now - lastAcceptedAt < Number(settings.cooldownMs || DEFAULT_COOLDOWN_MS)) {
      appendOcrRunLog({
        source,
        status: "duplicate",
        message: "Duplicate OCR match ignored by cooldown.",
        regionTexts: entries,
        matches
      });
      setStatus("Duplicate scan ignored by cooldown.", "warn");
      return;
    }

    if (suggestion.autoSync && Number(suggestion.delta || 0) > 0) {
      const ok = suggestion.action === "route-goal"
        ? markMatchedDaysGoneCompletionTitle(suggestion)
        : suggestion.action === "complete-current-split"
        ? actionController.completeCurrentSplit?.({
            source: "screen-tracker-mission-complete",
            reason: suggestion.matchedPhrase || "mission-complete"
          })
        : actionController.confirmScreenTrackerSuggestion(suggestion);
      if (ok) {
        if (suggestion.completionEpisode === true) {
          daysGoneCompletionEpisodeApplied = true;
        }
        lastSignature = signature;
        lastAcceptedAt = now;
        const ipcaAnchor = handleDaysGoneIpcaAnchor(suggestion);
        markMatchedHaiku(suggestion);
        markMatchedTrophy(suggestion);
        markMatchedDaysGoneCollectibles(suggestion);
        markMatchedDaysGoneTrophyChains(suggestion);
        markMatchedDaysGoneCompletionTitle(suggestion);
        const ipcaDetection = handleDaysGoneIpcaDetection(suggestion);
        setText("screenTrackerOcrText", combinedText || suggestion.text || "");
        const message = ipcaAnchor?.status === "reminder-created"
          ? `NERO anchor confirmed - did you pick up IPCA Tech? Added to the missed panel.`
          : ipcaAnchor?.status === "recent-pickup-confirmed"
            ? `NERO anchor confirmed with its recent IPCA Tech pickup.`
          : ipcaDetection?.status === "anchor-reminder-confirmed"
            ? `IPCA Tech confirmed for the pending NERO location.`
          : suggestion.action === "route-goal"
            ? `Auto-confirmed route OCR: ${suggestion.label}.`
          : suggestion.action === "complete-current-split"
          ? `Auto-completed split from mission: ${suggestion.label}.`
          : suggestion.kind === "sync"
          ? `Auto-synced ${suggestion.label} to ${suggestion.targetValue}.`
          : suggestion.outOfRoute
            ? `Auto-applied future pickup: ${suggestion.label}.`
          : `Auto-applied +${suggestion.delta} ${suggestion.label}.`;
        appendOcrRunLog({
          source,
          status: "auto-applied",
          message,
          regionTexts: entries,
          matches,
          applied: [{
            action: suggestion.action || "counter",
            counterKey: suggestion.counterKey,
            label: suggestion.label,
            delta: Number(suggestion.delta || 0),
            targetValue: suggestion.targetValue ?? null,
            matchedPhrase: suggestion.matchedPhrase || "",
            confidence: suggestion.confidence || "",
            outOfRoute: suggestion.outOfRoute === true,
            ipcaAnchorStatus: ipcaAnchor?.status || "",
            ipcaCluster: ipcaAnchor?.cluster?.siteName || "",
            ipcaDetectionStatus: ipcaDetection?.status || "",
            matchedChecklistIds: Array.isArray(suggestion.matchedChecklistIds) ? suggestion.matchedChecklistIds : [],
            extraCounters: suggestion.extraCounters || []
          }]
        });
        setStatus(message, "ok");
        return;
      }
    }

    showSuggestion(suggestion);
    appendOcrRunLog({
      source,
      status: "match-logged",
      message: "OCR match logged with manual confirmation disabled.",
      regionTexts: entries,
      matches
    });
    setStatus("OCR match logged. Confirm/Reject is disabled for raw trial runs.", "ok");
  }

  function handleText(text, regionLabel = "manual text") {
    handleRegionTexts([{ text, regionLabel }], { source: "manual-text" });
  }

  async function connectObs() {
    readSettingsFromUi();
    if (!settings.obsSource) {
      setStatus("Enter the OBS source name first.", "error");
      return;
    }

    setStatus("Connecting to OBS...", "");
    try {
      await obs.connect(settings.obsUrl, settings.obsPassword);
    } catch (error) {
      obs.close();
      throw error;
    }
    setStatus("OBS connected.", "ok");
  }

  async function scanObs({ quiet = false } = {}) {
    readSettingsFromUi();
    if (!settings.obsSource) {
      setStatus("Enter the OBS source name first.", "error");
      return;
    }

    if (!quiet) {
      setStatus("Scanning OBS source...", "");
    }
    const scanStartedAt = performance.now();
    const result = await obs.request("GetSourceScreenshot", {
      sourceName: settings.obsSource,
      imageFormat: "jpg",
      imageWidth: 1600,
      imageCompressionQuality: 72
    });
    const image = await imageFromDataUrl(result.imageData);
    const regionTexts = [];
    const source = quiet ? "video-scan" : "screen-scan";
    const state = getCurrentState();
    const isDaysGone = state?.gameId === "days-gone";
    const isGtaThree = state?.gameId === "gta-iii-definitive-edition";
    let forcedOcrUsed = false;
    for (const region of getScanRegions(settings.regionPreset, state, settings)) {
      const canvas = cropToRegion(image, region);
      let gate = null;

      if (quiet && (isDaysGone || isGtaThree) && (String(region.id || "").startsWith("days_gone_") || String(region.id || "").startsWith("gta_"))) {
        const presence = isDaysGone
          ? refineDaysGoneTextPresence(analyzeCanvasTextPresence(canvas), region.id)
          : analyzeCanvasTextPresence(canvas);
        const now = Date.now();
        const lastOcrAt = Number(lastRegionOcrAt.get(region.id) || 0);
        const forceEligible = isDaysGone
          ? isDaysGonePeriodicFailsafeRegion(region.id)
          : !["gta_center_event"].includes(region.id);
        const forceDue = forceEligible
          && (!lastOcrAt || now - lastOcrAt >= DAYS_GONE_TEXT_GATE_FORCE_MS);
        const forced = forceDue && !forcedOcrUsed;
        gate = {
          ...presence,
          forced,
          skipped: !presence.likelyText && !forced,
          reason: presence.likelyText ? "text-like" : forced ? "periodic-failsafe" : "no-text-shape"
        };

        if (gate.skipped) {
          regionTexts.push({ regionId: region.id, regionLabel: region.label, text: "", gate, timingMs: 0 });
          continue;
        }

        if (forced) forcedOcrUsed = true;
        lastRegionOcrAt.set(region.id, now);
      }

      const ocrStartedAt = performance.now();
      try {
        const text = await detectTextFromCanvas(canvas, {
          nativeResolution: isDaysGone || isGtaThree,
          psm: getOcrPsmForRegion(region.id),
          preprocessScale: getOcrPreprocessScaleForRegion(region.id),
          preprocessThreshold: getOcrThresholdForRegion(region.id)
        });
        regionTexts.push({
          regionId: region.id,
          regionLabel: region.label,
          text,
          gate,
          timingMs: Math.round(performance.now() - ocrStartedAt)
        });
      } catch (error) {
        regionTexts.push({
          regionId: region.id,
          regionLabel: region.label,
          text: "",
          error: error?.message || "OCR failed",
          gate,
          timingMs: Math.round(performance.now() - ocrStartedAt)
        });
      }
      if (quiet && getRegionMatches(regionTexts).length) break;
    }

    regionTexts.forEach((entry) => {
      entry.scanTimingMs = Math.round(performance.now() - scanStartedAt);
    });
    handleRegionTexts(regionTexts, { source });
  }

  function getVideoCandidatePriority(regionId = "") {
    if (regionId === "days_gone_completion_title") return 100;
    if (regionId === "days_gone_completion_anchor") return 90;
    if (regionId === "days_gone_ipca_pickup") return 85;
    if (regionId === "days_gone_top_right_title") return 70;
    if (regionId === "days_gone_top_right_wide_title") return 65;
    if (regionId === "days_gone_top_right_toast") return 60;
    if (regionId === "days_gone_pickup_left") return 30;
    return 40;
  }

  function isSameVideoOcrEpisode(left, right) {
    if (!left?.region?.id || left.region.id !== right?.region?.id) return false;
    if (Math.abs(Number(left.capturedAt || 0) - Number(right.capturedAt || 0)) > DAYS_GONE_VIDEO_OCR_EPISODE_WINDOW_MS) {
      return false;
    }
    const leftFingerprint = String(left?.gate?.textFingerprint || "");
    const rightFingerprint = String(right?.gate?.textFingerprint || "");
    if (!leftFingerprint || !rightFingerprint) return false;
    const differenceLimit = String(left.region.id || "").includes("completion")
      ? DAYS_GONE_VIDEO_OCR_CENTER_FINGERPRINT_DIFFERENCE
      : DAYS_GONE_VIDEO_OCR_EPISODE_FINGERPRINT_DIFFERENCE;
    return fingerprintDifference(leftFingerprint, rightFingerprint) <= differenceLimit;
  }

  function sortVideoOcrQueue() {
    const now = Date.now();
    const score = (candidate) => {
      // Age eventually outranks region priority so low-priority pickup toasts
      // cannot starve while higher-priority text continues to arrive.
      const ageBoost = Math.min(80, Math.max(0, now - Number(candidate.capturedAt || now)) / 250);
      return Number(candidate.priority || 0) + ageBoost;
    };
    videoOcrQueue.sort((left, right) => (
      score(right) - score(left)
      || Number(left.capturedAt || 0) - Number(right.capturedAt || 0)
    ));
  }

  function cloneCenterFrame(frame = {}) {
    return {
      canvas: frame.canvas,
      gate: frame.gate,
      capturedAt: Number(frame.capturedAt || 0),
      capturedPerformanceAt: Number(frame.capturedPerformanceAt || 0)
    };
  }

  function rememberDaysGoneCenterFrame(frame = {}) {
    const now = Number(frame.capturedAt || Date.now());
    const previous = daysGoneCenterPreRoll.at(-1);
    if (!previous || now - Number(previous.capturedAt || 0) >= DAYS_GONE_CENTER_FLURRY_SAMPLE_MS) {
      daysGoneCenterPreRoll.push(cloneCenterFrame(frame));
    }
    daysGoneCenterPreRoll = daysGoneCenterPreRoll.filter((entry) => (
      now - Number(entry.capturedAt || 0) <= DAYS_GONE_CENTER_FLURRY_PRE_ROLL_MS
    ));
  }

  function getDaysGoneCenterFlurry(frame = {}) {
    const now = Number(frame.capturedAt || Date.now());
    rememberDaysGoneCenterFrame(frame);
    if (frame.gate?.likelyText !== true) {
      return null;
    }

    const expired = !daysGoneCenterFlurry
      || now - daysGoneCenterFlurry.lastTextAt >= DAYS_GONE_CENTER_FLURRY_QUIET_MS
      || now - daysGoneCenterFlurry.startedAt >= DAYS_GONE_CENTER_FLURRY_MAX_MS;
    if (expired) {
      const previousLastTextAt = Number(daysGoneCenterFlurry?.lastTextAt || 0);
      const previousEndedQuietly = previousLastTextAt
        && now - previousLastTextAt >= DAYS_GONE_CENTER_FLURRY_QUIET_MS;
      daysGoneCenterFlurrySequence += 1;
      daysGoneCenterFlurry = {
        id: `days-gone-center-flurry-${daysGoneCenterFlurrySequence}`,
        startedAt: now,
        lastTextAt: now,
        preRollFloorAt: previousEndedQuietly
          ? previousLastTextAt + DAYS_GONE_CENTER_FLURRY_QUIET_MS
          : now - DAYS_GONE_CENTER_FLURRY_PRE_ROLL_MS,
        resolved: false
      };
      videoQueueStats.centerFlurries += 1;
    } else {
      daysGoneCenterFlurry.lastTextAt = now;
    }
    return daysGoneCenterFlurry;
  }

  function cancelResolvedDaysGoneCenterFlurry(flurryId = "") {
    if (!flurryId) return;
    resolvedDaysGoneCenterFlurries.add(flurryId);
    const before = videoOcrQueue.length;
    videoOcrQueue = videoOcrQueue.filter((entry) => entry.centerFlurryId !== flurryId);
    videoQueueStats.centerFramesCancelled += before - videoOcrQueue.length;
    if (daysGoneCenterFlurry?.id === flurryId) daysGoneCenterFlurry.resolved = true;
  }

  function videoCandidateTextMatches(candidate, text = "") {
    if (!text) return false;
    if (candidate?.centerFlurryId) {
      const state = getCurrentState();
      const splitIndex = Number(state?.splits?.currentIndex || 0);
      return Boolean(classifyDaysGoneCompletion({
        titleText: text,
        currentSplit: state?.splits?.items?.[splitIndex] || null,
        completionTitleRules: gameData?.meta?.completionTitleRules || [],
        completionTitles: gameData?.completionTitles || {}
      }));
    }
    return getRegionMatches([{
      regionId: candidate.region.id,
      regionLabel: candidate.region.label,
      text
    }]).length > 0;
  }

  function enqueueVideoOcrCandidate(candidate) {
    const existingIndex = videoOcrQueue.findIndex((entry) => isSameVideoOcrEpisode(entry, candidate));
    if (existingIndex >= 0) {
      const existing = videoOcrQueue[existingIndex];
      if (candidate.centerFlurryId) {
        const frames = [
          ...(existing.chronologicalFrames || []),
          ...(candidate.chronologicalFrames || [cloneCenterFrame(candidate)])
        ]
          .sort((left, right) => Number(left.capturedAt || 0) - Number(right.capturedAt || 0))
          .filter((frame, index, all) => index === 0
            || Number(frame.capturedAt || 0) - Number(all[index - 1].capturedAt || 0) >= DAYS_GONE_CENTER_FLURRY_SAMPLE_MS)
          .slice(0, DAYS_GONE_CENTER_FLURRY_FRAME_MAX);
        existing.chronologicalFrames = frames;
        videoQueueStats.episodeFramesMerged += 1;
        return;
      }
      if (getVideoCandidateQuality(candidate) <= getVideoCandidateQuality(existing)) {
        existing.fallbackCanvases = [
          ...(existing.fallbackCanvases || []),
          candidate.canvas
        ].slice(-DAYS_GONE_VIDEO_OCR_FALLBACK_FRAME_MAX);
        videoQueueStats.weakerDiscarded += 1;
        videoQueueStats.episodeFramesMerged += 1;
        return;
      }
      candidate.fallbackCanvases = [
        existing.canvas,
        ...(existing.fallbackCanvases || [])
      ].slice(0, DAYS_GONE_VIDEO_OCR_FALLBACK_FRAME_MAX);
      videoOcrQueue.splice(existingIndex, 1);
      videoQueueStats.replaced += 1;
      videoQueueStats.episodeFramesMerged += 1;
    }
    videoOcrQueue.push(candidate);
    if (existingIndex < 0) videoQueueStats.episodesQueued += 1;
    sortVideoOcrQueue();
    while (videoOcrQueue.length > DAYS_GONE_VIDEO_OCR_QUEUE_MAX) {
      videoOcrQueue.pop();
      videoQueueStats.dropped += 1;
      videoQueueStats.overflow += 1;
    }
    videoQueueStats.queued += 1;
    videoQueueStats.maxDepth = Math.max(videoQueueStats.maxDepth, videoOcrQueue.length);
  }

  async function drainVideoOcrQueue(generation) {
    if (videoOcrWorkersActive >= DAYS_GONE_VIDEO_OCR_WORKER_MAX) return;
    videoOcrWorkersActive += 1;
    videoQueueStats.maxWorkers = Math.max(videoQueueStats.maxWorkers, videoOcrWorkersActive);
    try {
      while (videoScanRunning && generation === videoScanGeneration && videoOcrQueue.length) {
        sortVideoOcrQueue();
        const candidate = videoOcrQueue.shift();
        if (candidate.centerFlurryId && resolvedDaysGoneCenterFlurries.has(candidate.centerFlurryId)) {
          videoQueueStats.centerFramesCancelled += 1;
          continue;
        }
        const ocrStartedAt = performance.now();
        let text = "";
        let error = "";
        let matched = false;
        let resolvedFrame = cloneCenterFrame(candidate);
        const chronologicalFrames = candidate.centerFlurryId
          ? (candidate.chronologicalFrames || [cloneCenterFrame(candidate)])
          : [cloneCenterFrame(candidate)];
        let centerFramesTried = 0;
        for (const frame of chronologicalFrames) {
          if (candidate.centerFlurryId && resolvedDaysGoneCenterFlurries.has(candidate.centerFlurryId)) break;
          centerFramesTried += 1;
          try {
            const frameText = await detectTextFromCanvas(frame.canvas, {
              nativeResolution: true,
              psm: getOcrPsmForRegion(candidate.region.id),
              preprocessScale: getOcrPreprocessScaleForRegion(candidate.region.id),
              preprocessThreshold: getOcrThresholdForRegion(candidate.region.id)
            });
            text = normalizeText(frameText).length > normalizeText(text).length ? frameText : text;
            if (videoCandidateTextMatches(candidate, frameText)) {
              text = frameText;
              matched = true;
              resolvedFrame = frame;
              if (candidate.centerFlurryId) videoQueueStats.centerEarlyMatches += 1;
              break;
            }
          } catch (ocrError) {
            if (!error) error = ocrError?.message || "OCR failed";
          }
        }
        if (candidate.centerFlurryId && resolvedDaysGoneCenterFlurries.has(candidate.centerFlurryId)) {
          videoQueueStats.centerFramesCancelled += Math.max(1, chronologicalFrames.length - centerFramesTried);
          continue;
        }
        if (!videoScanRunning || generation !== videoScanGeneration) continue;
        let recoveryText = "";
        const recoveryThreshold = getRecoveryOcrThresholdForRegion(candidate.region.id);
        const recoveryNow = Date.now();
        const lastRecoveryAt = Number(lastRegionRecoveryOcrAt.get(candidate.region.id) || 0);
        const firstPassMatched = matched || videoCandidateTextMatches(candidate, text);
        matched = firstPassMatched;
        if (!matched && !candidate.centerFlurryId && Array.isArray(candidate.fallbackCanvases)) {
          for (const fallbackCanvas of candidate.fallbackCanvases) {
            videoQueueStats.fallbackAttempts += 1;
            try {
              const fallbackText = await detectTextFromCanvas(fallbackCanvas, {
                nativeResolution: true,
                psm: getOcrPsmForRegion(candidate.region.id),
                preprocessScale: getOcrPreprocessScaleForRegion(candidate.region.id),
                preprocessThreshold: getOcrThresholdForRegion(candidate.region.id)
              });
              const fallbackEntry = {
                regionId: candidate.region.id,
                regionLabel: candidate.region.label,
                text: fallbackText
              };
              if (fallbackText && getRegionMatches([fallbackEntry]).length > 0) {
                text = fallbackText;
                matched = true;
                videoQueueStats.fallbackMatches += 1;
                break;
              }
              if (normalizeText(fallbackText).length > normalizeText(text).length) text = fallbackText;
            } catch (fallbackError) {
              if (!error) error = fallbackError?.message || "Fallback OCR failed";
            }
          }
        }
        const recoveryEligible = recoveryThreshold !== null
          && candidate.gate?.likelyText === true
          && getVideoCandidateQuality(candidate) >= 15
          && !matched
          && recoveryNow - lastRecoveryAt >= DAYS_GONE_RECOVERY_OCR_INTERVAL_MS;
        if (recoveryEligible) {
          lastRegionRecoveryOcrAt.set(candidate.region.id, recoveryNow);
          videoQueueStats.recoveryAttempts += 1;
          try {
            recoveryText = await detectTextFromCanvas(candidate.canvas, {
              nativeResolution: true,
              psm: getOcrPsmForRegion(candidate.region.id),
              preprocessScale: getOcrPreprocessScaleForRegion(candidate.region.id),
              preprocessThreshold: recoveryThreshold
            });
              if (videoCandidateTextMatches(candidate, recoveryText)) {
                text = recoveryText;
                matched = true;
                videoQueueStats.recoveryMatches += 1;
            } else if (normalizeText(recoveryText).length > normalizeText(text).length) {
              text = recoveryText;
            }
          } catch (recoveryError) {
            if (!error) error = recoveryError?.message || "Recovery OCR failed";
          }
        }
        if (!videoScanRunning || generation !== videoScanGeneration) continue;
        videoQueueStats.processed += 1;
        if (matched && candidate.centerFlurryId) {
          cancelResolvedDaysGoneCenterFlurry(candidate.centerFlurryId);
        }
        handleRegionTexts([{
          regionId: candidate.region.id,
          regionLabel: candidate.region.label,
          text,
          recoveryText,
          error,
          gate: resolvedFrame.gate || candidate.gate,
          capturedAt: resolvedFrame.capturedAt || candidate.capturedAt,
          queueDelayMs: Math.max(0, Math.round(ocrStartedAt - (resolvedFrame.capturedPerformanceAt || candidate.capturedPerformanceAt))),
          timingMs: Math.round(performance.now() - ocrStartedAt),
          scanTimingMs: Math.round(performance.now() - (resolvedFrame.capturedPerformanceAt || candidate.capturedPerformanceAt)),
          centerFlurryId: candidate.centerFlurryId || "",
          centerFramesTried: candidate.centerFlurryId ? centerFramesTried : 1,
          centerEarlyExit: Boolean(candidate.centerFlurryId && matched)
        }], { source: "video-scan" });
      }
    } finally {
      videoOcrWorkersActive = Math.max(0, videoOcrWorkersActive - 1);
      while (
        videoScanRunning
        && generation === videoScanGeneration
        && videoOcrQueue.length
        && videoOcrWorkersActive < DAYS_GONE_VIDEO_OCR_WORKER_MAX
      ) {
        drainVideoOcrQueue(generation);
      }
    }
  }

  async function captureDaysGoneVideoFrame() {
    if (!videoScanRunning || videoCaptureBusy) return;
    videoCaptureBusy = true;
    const generation = videoScanGeneration;
    const capturedPerformanceAt = performance.now();
    try {
      const result = await obs.request("GetSourceScreenshot", {
        sourceName: settings.obsSource,
        imageFormat: "jpg",
        imageWidth: DAYS_GONE_VIDEO_CAPTURE_WIDTH,
        imageCompressionQuality: DAYS_GONE_VIDEO_CAPTURE_JPEG_QUALITY
      });
      if (!videoScanRunning || generation !== videoScanGeneration) return;
      const image = await imageFromDataUrl(result.imageData);
      if (!videoScanRunning || generation !== videoScanGeneration) return;
      videoQueueStats.frames += 1;
      let forcedOcrUsed = false;

      for (const region of getScanRegions(settings.regionPreset, getCurrentState(), settings)) {
        const canvas = cropToRegion(image, region);
        const presence = refineDaysGoneTextPresence(analyzeCanvasTextPresence(canvas), region.id);
        const now = Date.now();
        const centerFrame = region.id === "days_gone_completion_title"
          ? {
              canvas,
              gate: presence,
              capturedAt: now,
              capturedPerformanceAt
            }
          : null;
        const centerFlurry = centerFrame ? getDaysGoneCenterFlurry(centerFrame) : null;
        if (centerFlurry?.resolved === true) continue;
        const lastOcrAt = Number(lastRegionOcrAt.get(region.id) || 0);
        const minimumOcrInterval = Number(DAYS_GONE_REGION_OCR_MIN_INTERVAL_MS[region.id] || 0);
        const previousVisualState = lastRegionVisualState.get(region.id) || null;
        const fingerprintChanged = previousVisualState
          && fingerprintDifference(previousVisualState.fingerprint, presence.textFingerprint) >= 0.28;
        const qualityImproved = previousVisualState
          && getVideoCandidateQuality({ gate: presence }) >= previousVisualState.quality * 1.18;
        const newPopupLikely = presence.likelyText && (fingerprintChanged || qualityImproved);
        if (presence.likelyText && minimumOcrInterval > 0 && now - lastOcrAt < minimumOcrInterval) {
          if (!newPopupLikely) continue;
          videoQueueStats.visualChangeBypasses += 1;
        }
        const forceEligible = isDaysGonePeriodicFailsafeRegion(region.id);
        const forced = forceEligible
          && !forcedOcrUsed
          && (!lastOcrAt || now - lastOcrAt >= DAYS_GONE_TEXT_GATE_FORCE_MS);
        const gate = {
          ...presence,
          forced,
          skipped: !presence.likelyText && !forced,
          reason: presence.likelyText ? "text-like" : forced ? "periodic-failsafe" : "no-text-shape"
        };
        if (gate.skipped) continue;
        if (forced) forcedOcrUsed = true;
        lastRegionOcrAt.set(region.id, now);
        lastRegionVisualState.set(region.id, {
          fingerprint: presence.textFingerprint,
          quality: getVideoCandidateQuality({ gate: presence }),
          capturedAt: now
        });
        enqueueVideoOcrCandidate({
          region,
          canvas,
          gate,
          priority: getVideoCandidatePriority(region.id),
          capturedAt: now,
          capturedPerformanceAt,
          centerFlurryId: centerFlurry?.id || "",
          chronologicalFrames: centerFlurry
            ? daysGoneCenterPreRoll
              .filter((frame) => (
                frame.gate?.likelyText === true
                && Number(frame.capturedAt || 0) >= Number(centerFlurry.preRollFloorAt || 0)
              ))
              .map(cloneCenterFrame)
              .slice(0, DAYS_GONE_CENTER_FLURRY_FRAME_MAX)
            : undefined
        });
      }
      drainVideoOcrQueue(generation);
    } catch (error) {
      if (generation !== videoScanGeneration) return;
      appendOcrRunLog({
        source: "video-scan",
        status: "capture-error",
        message: error?.message || "Video capture stopped after an error.",
        error,
        force: true
      });
      stopVideoScan(error?.message || "Video capture stopped after an error.");
    } finally {
      videoCaptureBusy = false;
    }
  }

  async function captureRegionDebug() {
    readSettingsFromUi();
    if (!settings.obsSource) {
      setStatus("Enter the OBS source name first.", "error");
      return;
    }

    setStatus("Saving OCR debug crops...", "");
    const result = await obs.request("GetSourceScreenshot", {
      sourceName: settings.obsSource,
      imageFormat: "png",
      imageWidth: 1920
    });
    const image = await imageFromDataUrl(result.imageData);
    const regions = [];

    for (const region of getScanRegions(settings.regionPreset, getCurrentState(), settings)) {
      const canvas = cropToRegion(image, region);
      let text = "";
      try {
        text = await detectTextFromCanvas(canvas, {
          nativeResolution: ["days-gone", "gta-iii-definitive-edition"].includes(getCurrentState()?.gameId)
        });
      } catch (error) {
        text = `OCR error: ${error?.message || "unknown"}`;
      }
      regions.push({
        regionId: region.id,
        regionLabel: region.label,
        label: region.label,
        imageData: canvas.toDataURL("image/png"),
        text,
        error: text.startsWith("OCR error:") ? text.replace(/^OCR error:\s*/i, "") : ""
      });
    }

    const response = await fetch(OCR_DEBUG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ regions })
    });
    const saveResult = await response.json().catch(() => null);

    if (!response.ok || !saveResult?.ok) {
      throw new Error(saveResult?.error || "Could not save OCR debug crops.");
    }

    setStatus(`Saved OCR debug crops: ${saveResult.path}`, "ok");
    handleRegionTexts(regions, { source: "debug-crops" });
  }

  async function runVideoScanTick() {
    if (!videoScanRunning) return;
    if ((getCurrentState()?.gameId || gameData?.meta?.id) === "days-gone") {
      captureDaysGoneVideoFrame();
      return;
    }
    if (videoScanBusy) return;

    videoScanBusy = true;

    try {
      await scanObs({ quiet: true });
    } catch (error) {
      appendOcrRunLog({
        source: "video-scan",
        status: "scan-error",
        message: error?.message || "Video scan stopped after an error.",
        error,
        force: true
      });
      stopVideoScan(error?.message || "Video scan stopped after an error.");
      debug?.warn?.("Screen tracker video scan stopped", { message: error?.message || "unknown" });
    } finally {
      videoScanBusy = false;
    }
  }

  function startVideoScan() {
    readSettingsFromUi();

    if (!settings.obsSource) {
      setStatus("Enter the OBS source name first.", "error");
      return;
    }

    if ((getCurrentState()?.gameId || gameData?.meta?.id) === "days-gone") {
      settings.regionPreset = "days_gone_unified";
      // The all-tracked mode expanded every mapped pickup region and flooded
      // the single OCR worker during the trial. Expected mode still keeps the
      // global top-right title/toast and IPCA regions active, while adding only
      // the route-specific failsafes needed around the current split.
      settings.expectedOnly = true;
      settings.videoScanIntervalMs = Math.min(settings.videoScanIntervalMs, 17);
      const intervalInput = document.getElementById("screenTrackerVideoInterval");
      if (intervalInput) intervalInput.value = String(settings.videoScanIntervalMs);
      const presetInput = document.getElementById("screenTrackerRegion");
      if (presetInput) presetInput.value = "days_gone_unified";
      const expectedOnlyInput = document.getElementById("screenTrackerExpectedOnly");
      if (expectedOnlyInput) expectedOnlyInput.checked = true;
      saveSettings(settings);
    }

    stopVideoScan();
    videoScanRunning = true;
    videoScanGeneration += 1;
    videoQueueStats = createVideoQueueStats();
    daysGoneCenterPreRoll = [];
    daysGoneCenterFlurry = null;
    daysGoneCenterFlurrySequence = 0;
    resolvedDaysGoneCenterFlurries.clear();
    lastRegionOcrAt.clear();
    lastRegionRecoveryOcrAt.clear();
    lastRegionVisualState.clear();
    updateVideoScanButton();
    renderObsHealth();
    const modeLabel = REGION_PRESETS[settings.regionPreset]?.label || settings.regionPreset;
    appendOcrRunLog({
      source: "control",
      status: "video-start",
      message: `Video scan started every ${settings.videoScanIntervalMs}ms in ${modeLabel} mode.`,
      force: true
    });
    setStatus(`Video scan running every ${settings.videoScanIntervalMs}ms in ${modeLabel} mode.`, "ok");
    runVideoScanTick();
    videoScanTimer = window.setInterval(runVideoScanTick, settings.videoScanIntervalMs);
  }

  function toggleVideoScan() {
    if (videoScanRunning) {
      appendOcrRunLog({
        source: "control",
        status: "video-stop",
        message: "Video scan stopped by user.",
        force: true
      });
      stopVideoScan("Video scan stopped.");
      return;
    }

    startVideoScan();
  }

  async function scanFile(file) {
    readSettingsFromUi();
    if (!file) return;

    setStatus("Scanning image...", "");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });
    const image = await imageFromDataUrl(dataUrl);
    const regionTexts = [];

    for (const region of getScanRegions(settings.regionPreset, getCurrentState(), settings)) {
      const canvas = cropToRegion(image, region);
      try {
        const text = await detectTextFromCanvas(canvas, {
          nativeResolution: ["days-gone", "gta-iii-definitive-edition"].includes(getCurrentState()?.gameId)
        });
        regionTexts.push({ regionId: region.id, regionLabel: `${region.label} upload`, text });
      } catch (error) {
        regionTexts.push({
          regionId: region.id,
          regionLabel: `${region.label} upload`,
          text: "",
          error: error?.message || "OCR failed"
        });
      }
    }

    handleRegionTexts(regionTexts, { source: "image-upload" });
  }

  function confirmSuggestion() {
    if (!pendingSuggestion) return;

    const ok = actionController.confirmScreenTrackerSuggestion(pendingSuggestion);
    if (!ok) {
      setStatus("Suggestion could not be applied.", "error");
      return;
    }

    lastSignature = getSuggestionSignature(pendingSuggestion);
    lastAcceptedAt = Date.now();
    const ipcaAnchor = handleDaysGoneIpcaAnchor(pendingSuggestion);
    markMatchedHaiku(pendingSuggestion);
    markMatchedTrophy(pendingSuggestion);
    markMatchedDaysGoneCollectibles(pendingSuggestion);
    markMatchedDaysGoneTrophyChains(pendingSuggestion);
    markMatchedDaysGoneCompletionTitle(pendingSuggestion);
    const ipcaDetection = handleDaysGoneIpcaDetection(pendingSuggestion);
    const message = ipcaAnchor?.status === "reminder-created"
      ? "NERO anchor confirmed - did you pick up IPCA Tech? Added to the missed panel."
      : ipcaDetection?.status === "anchor-reminder-confirmed"
        ? "IPCA Tech confirmed for the pending NERO location."
        : `Applied +${pendingSuggestion.delta} ${pendingSuggestion.label}.`;
    setStatus(message, "ok");
    clearSuggestion();
  }

  function bind() {
    syncInputs();
    renderObsHealth();
    scheduleOcrRunFileFlush(500);
    window.setInterval(renderObsHealth, 1000);

    document.getElementById("screenTrackerHaikuList")?.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.matches("input[data-haiku-id]")) return;

      const id = input.dataset.haikuId;
      if (!id) return;
      if (input.checked) completedHaiku.add(id);
      else completedHaiku.delete(id);
      saveHaikuProgress(completedHaiku);
      renderHaikuChecklist();
    });

    document.getElementById("screenTrackerHaikuResetBtn")?.addEventListener("click", () => {
      completedHaiku = new Set();
      saveHaikuProgress(completedHaiku);
      renderHaikuChecklist();
      setStatus("Haiku checklist reset.", "");
    });

    document.getElementById("screenTrackerTrophyList")?.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.matches("input[data-trophy-id]")) return;

      const id = input.dataset.trophyId;
      if (!id) return;
      if (input.checked) completedTrophies.add(id);
      else completedTrophies.delete(id);
      saveTrophyProgress(completedTrophies);
      renderTrophyChecklist();
    });

    document.getElementById("screenTrackerTrophyResetBtn")?.addEventListener("click", () => {
      completedTrophies = new Set();
      saveTrophyProgress(completedTrophies);
      renderTrophyChecklist();
      setStatus("Trophy checklist reset.", "");
    });

    document.getElementById("screenTrackerDaysGoneCollectibleList")?.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;

      if (input.matches("input[data-days-gone-collectible-id]")) {
        const id = input.dataset.daysGoneCollectibleId;
        if (!id) return;
        const ids = getDaysGoneCollectibleBundle(id) || [id];
        const linkedTrophyIds = DAYS_GONE_TROPHY_CHECKLIST
          .filter((entry) => ids.includes(entry.linkedCollectibleId))
          .map((entry) => entry.id);

        applyDaysGoneManualChecklistDeltas({
          collectibleIds: ids,
          trophyIds: linkedTrophyIds,
          checked: input.checked
        });

        ids.forEach((entryId) => {
          if (input.checked) completedDaysGoneCollectibles.add(entryId);
          else completedDaysGoneCollectibles.delete(entryId);
        });

        DAYS_GONE_TROPHY_CHECKLIST
          .filter((entry) => ids.includes(entry.linkedCollectibleId))
          .forEach((entry) => {
            if (input.checked) completedDaysGoneTrophies.add(entry.id);
            else completedDaysGoneTrophies.delete(entry.id);
          });

        saveDaysGoneCollectibleProgress(completedDaysGoneCollectibles);
        saveDaysGoneTrophyProgress(completedDaysGoneTrophies);
        syncDaysGoneTrophyCounterFromChecklist("days-gone-manual-collectible-sync");
        pruneDaysGoneMissedGoals(undefined, completedDaysGoneCollectibles, completedDaysGoneTrophies);
        renderDaysGoneCollectibleChecklist();
        tryCompleteCurrentSplitFromDaysGoneOcrCompletion("days-gone-manual-collectible-goals");
        return;
      }

      if (input.matches("input[data-days-gone-trophy-id]")) {
        const id = input.dataset.daysGoneTrophyId;
        if (!id) return;
        const linkedCollectibleIds = DAYS_GONE_TROPHY_CHECKLIST
          .filter((entry) => entry.id === id && entry.linkedCollectibleId)
          .map((entry) => entry.linkedCollectibleId);

        applyDaysGoneManualChecklistDeltas({
          collectibleIds: linkedCollectibleIds,
          trophyIds: [id],
          checked: input.checked
        });

        if (input.checked) completedDaysGoneTrophies.add(id);
        else completedDaysGoneTrophies.delete(id);

        DAYS_GONE_TROPHY_CHECKLIST
          .filter((entry) => entry.id === id && entry.linkedCollectibleId)
          .forEach((entry) => {
            if (input.checked) completedDaysGoneCollectibles.add(entry.linkedCollectibleId);
            else completedDaysGoneCollectibles.delete(entry.linkedCollectibleId);
          });

        saveDaysGoneCollectibleProgress(completedDaysGoneCollectibles);
        saveDaysGoneTrophyProgress(completedDaysGoneTrophies);
        syncDaysGoneTrophyCounterFromChecklist("days-gone-manual-trophy-sync");
        pruneDaysGoneMissedGoals(undefined, completedDaysGoneCollectibles, completedDaysGoneTrophies);
        renderDaysGoneCollectibleChecklist();
        tryCompleteCurrentSplitFromDaysGoneOcrCompletion("days-gone-manual-trophy-goals");
      }
    });

    document.getElementById("screenTrackerDaysGoneCollectibleResetBtn")?.addEventListener("click", () => {
      completedDaysGoneCollectibles = new Set();
      completedDaysGoneTrophies = new Set();
      completedDaysGoneCompletions = new Set();
      daysGoneUnassignedIpcaDetections = [];
      daysGoneCompletionEpisodeActive = false;
      daysGoneCompletionEpisodeApplied = false;
      daysGoneCompletionLastSeenAt = 0;
      saveDaysGoneCollectibleProgress(completedDaysGoneCollectibles);
      saveDaysGoneTrophyProgress(completedDaysGoneTrophies);
      saveDaysGoneCompletionProgress(completedDaysGoneCompletions);
      syncDaysGoneTrophyCounterFromChecklist("days-gone-dashboard-reset-sync");
      clearDaysGoneMissedGoals();
      renderDaysGoneCollectibleChecklist();
      setStatus("Days Gone collectible checklist reset.", "");
    });

    window.addEventListener("platinum-router-run-reset", (event) => {
      const eventGameId = event?.detail?.gameId || "";
      const currentGameId = getCurrentState()?.gameId || gameData?.meta?.id || "";
      if (eventGameId && eventGameId !== "days-gone") return;
      if (!eventGameId && currentGameId !== "days-gone") return;

      completedDaysGoneCollectibles = new Set();
      completedDaysGoneTrophies = new Set();
      completedDaysGoneCompletions = new Set();
      daysGoneUnassignedIpcaDetections = [];
      saveDaysGoneCollectibleProgress(completedDaysGoneCollectibles);
      saveDaysGoneTrophyProgress(completedDaysGoneTrophies);
      saveDaysGoneCompletionProgress(completedDaysGoneCompletions);
      syncDaysGoneTrophyCounterFromChecklist("days-gone-run-reset-sync");
      clearDaysGoneMissedGoals();
      renderDaysGoneCollectibleChecklist();
      appendOcrRunLog({
        source: "control",
        status: "run-reset",
        message: "Run reset received; starting a new OCR run session.",
        force: true
      });
      ocrRunSessionId = createOcrRunSessionId();
      saveOcrRunSessionId(ocrRunSessionId);
      renderOcrRunLogState();
      setStatus("Days Gone collectible checklist reset with run.", "");
    });

    window.addEventListener("storage", (event) => {
      if (!event.key) return;
      const shouldSyncDaysGone =
        event.key === DAYS_GONE_COLLECTIBLE_PROGRESS_KEY
        || event.key === DAYS_GONE_TROPHY_PROGRESS_KEY
        || event.key === DAYS_GONE_COMPLETION_PROGRESS_KEY
        || event.key === DAYS_GONE_MISSED_GOALS_KEY;
      if (!shouldSyncDaysGone) return;

      if (syncDaysGoneProgressFromStorage({ renderChecklist: true })) {
        syncDaysGoneMissedGoals();
        renderLookingForDock();
      }
    });

    document.getElementById("screenTrackerConnectBtn")?.addEventListener("click", () => {
      connectObs().catch((error) => {
        setStatus(error?.message || "OBS connection failed", "error");
        debug?.warn?.("Screen tracker OBS connection failed", { message: error?.message || "unknown" });
      });
    });

    document.getElementById("screenTrackerScanBtn")?.addEventListener("click", () => {
      scanObs().catch((error) => {
        appendOcrRunLog({
          source: "screen-scan",
          status: "scan-error",
          message: error?.message || "Screen scan failed",
          error,
          force: true
        });
        setStatus(error?.message || "Screen scan failed", "error");
        debug?.warn?.("Screen tracker scan failed", { message: error?.message || "unknown" });
      });
    });

    document.getElementById("screenTrackerVideoBtn")?.addEventListener("click", toggleVideoScan);

    document.getElementById("screenTrackerDebugCropsBtn")?.addEventListener("click", () => {
      captureRegionDebug().catch((error) => {
        appendOcrRunLog({
          source: "debug-crops",
          status: "scan-error",
          message: error?.message || "Could not save OCR debug crops.",
          error,
          force: true
        });
        setStatus(error?.message || "Could not save OCR debug crops.", "error");
      });
    });

    document.getElementById("screenTrackerMissedDashboardBtn")?.addEventListener("click", () => {
      const dashboard = window.open(
        "./missed-dashboard.html",
        "platinum-router-missed-dashboard",
        "popup,width=620,height=760"
      );
      dashboard?.focus?.();
    });

    document.getElementById("screenTrackerDownloadLogBtn")?.addEventListener("click", downloadOcrRunLog);
    document.getElementById("screenTrackerClearLogBtn")?.addEventListener("click", clearOcrRunLog);

    document.getElementById("screenTrackerAnalyzeTextBtn")?.addEventListener("click", () => {
      readSettingsFromUi();
      handleText(getInputValue("screenTrackerManualText"), "manual text");
    });

    document.getElementById("screenTrackerConfirmBtn")?.addEventListener("click", confirmSuggestion);
    document.getElementById("screenTrackerRejectBtn")?.addEventListener("click", () => {
      clearSuggestion();
      setStatus("Suggestion rejected.", "");
    });

    document.getElementById("screenTrackerUploadInput")?.addEventListener("change", (event) => {
      const file = event.target?.files?.[0];
      scanFile(file).catch((error) => {
        appendOcrRunLog({
          source: "image-upload",
          status: "scan-error",
          message: error?.message || "Image scan failed",
          error,
          force: true
        });
        setStatus(error?.message || "Image scan failed", "error");
      });
      event.target.value = "";
    });

    [
      "screenTrackerObsUrl",
      "screenTrackerObsSource",
      "screenTrackerObsPassword",
      "screenTrackerRegion",
      "screenTrackerExpectedOnly",
      "screenTrackerPauseOnSuggestion",
      "screenTrackerLookahead",
      "screenTrackerVideoInterval"
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        readSettingsFromUi();
        setStatus("Tracker settings saved.", "");
      });
    });
  }

  return {
    bind,
    renderLookingForDock: () => {
      renderLookingForDock();
      renderHaikuChecklist();
      renderTrophyChecklist();
      renderDaysGoneCollectibleChecklist();
    }
  };
}
