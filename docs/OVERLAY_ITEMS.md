# Overlay Items

Reference for what the Platinum Router OBS overlays show and which counters are intentionally hidden to avoid duplicate information.

## Full Overlay

Shown by `overlay.html`.

- Overall percent: route completion percent from `meta.overallCounterKeys`.
- Timer: current run timer.
- Trophy chip: trophy checklist progress, pinned beside the timer when the game tracks trophies.
- All Collectibles chip: synthetic combined collectible progress from `meta.collectibleCounterKeys` and `meta.collectibleTotal`.
- Side counter chips: unfinished, non-hidden counters from the current phase. These are horizontal-feed context; the center `% + timer + trophies` group is kept narrow enough to survive a center vertical crop.
- Dirge chip: Ghost of Tsushima-only reminder when Dirge is supported and not completed.
- Debug dock: hidden unless the overlay is opened with `?debug=1`.

## Core Overlay

Shown by `overlay.html?layout=core`.

- Overall percent.
- Timer.
- Trophy chip.
- Side counters are hidden. Use this for vertical streams or mid-screen placement where the full dashboard would become too small.

## Mini Overlay

Shown by `minoverlay.html`.

- Timer.
- Trophy chip.
- Death chip, only when the death counter is enabled.
- Overall percent.
- Current split auto chips: what the active split will add when completed.

## Days Gone Overlay Decisions

Keep visible:

- Overall percent.
- Timer.
- Trophies `0/46`.
- All Collectibles `0/240`.
- Objective counters such as jobs, combined NERO sites, nests, ambush camps, hordes, IPCA, and cairns when relevant to the phase.

Hide from OBS overlay:

- `routecollectibles` `0/201`: redundant beside All Collectibles `0/240` and less useful for viewers.
- Individual collectible buckets such as Character, NERO Intel, Historical, Tourism, Ripper Sermons, Herbology, Songs, Radio, Speeches, and Lab Notes. These stay available in the controller/manual dashboard and checklist views.

## Redundancy Rules

- Do not show an aggregate and its source buckets on the same OBS overlay.
- Prefer the viewer-facing total when two counters describe similar progress.
- Keep technical/manual counters in the controller unless they answer a live viewer question.
- The mini overlay should stay lean; it is for timer, trophy/death status, percent, and current split consequences.
