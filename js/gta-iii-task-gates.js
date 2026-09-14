export const GTA_III_TASK_GATE_DATA = {
  tasks: [
    {
      id: "paramedic-level-12",
      label: "Paramedic Level 12",
      counterKey: "paramedic",
      target: 12,
      requirement: "Finish Paramedic before gang hostility makes the route unsafe.",
      completionPhrases: ["paramedic missions complete", "playing doctor"],
      gates: ["trial-by-fire", "sayonara-salvatore", "kingdom-come"]
    }
  ],
  hazards: [
    {
      id: "cartel",
      gang: "Colombian Cartel",
      area: "Cedar Grove / Fort Staunton",
      mission: "Hostile from the start",
      missionPhrases: [],
      activeFromStart: true,
      requiredTaskIds: ["paramedic-level-12"]
    },
    {
      id: "triads",
      gang: "Triads",
      area: "Chinatown",
      mission: "Trial by Fire",
      missionPhrases: ["trial by fire"],
      requiredTaskIds: ["paramedic-level-12"]
    },
    {
      id: "diablos",
      gang: "Diablos",
      area: "Hepburn Heights",
      mission: "King Courtney mission chain",
      missionPhrases: ["king courtney"],
      requiredTaskIds: ["paramedic-level-12"]
    },
    {
      id: "yardies",
      gang: "Yardies",
      area: "Newport",
      mission: "Kingdom Come",
      missionPhrases: ["kingdom come"],
      requiredTaskIds: ["paramedic-level-12"]
    },
    {
      id: "leone",
      gang: "Leone Family Mafia",
      area: "Saint Mark's",
      mission: "Sayonara Salvatore",
      missionPhrases: ["sayonara salvatore"],
      requiredTaskIds: ["paramedic-level-12"]
    }
  ],
  watchedMissionPhrases: [
    "mike lips last lunch",
    "trial by fire",
    "kingdom come",
    "sayonara salvatore",
    "king courtney"
  ]
};
