# Platinum Router Implementation Worklog

Living notes for route tracker ideas, OCR experiments, split behavior, and future implementation work.

Use this file to capture decisions while the tool evolves. The goal is to keep the route data flexible and keep the app logic generic enough to work with different playstyles.

## Core Principles

- Confirmed state is the source of truth. OCR confirmations, manual corrections, trophy chains, and counter state are more important than the planned route.
- Route data is an expectation layer. It should guide OCR priority and dashboard grouping, but it should not punish players for routing differently.
- Deviation is normal. Combat, ammo, health, camera angle, missed prompts, and player preference can change pickup order.
- Manual corrections stay first-class. If OCR misses something, manual ticks must reconcile checklist state, counters, future split goals, and unresolved items.
- Avoid hardcoded route logic. Split-specific behavior should live in editable route data where possible.

## Current Route/OCR Model

- Splits can have editable `ocrGoals`.
- OCR goals are separate from split auto counters.
- OCR goal picker should hide goals already assigned to earlier splits.
- OCR goals can be optional.
- Split auto counters should stay objective-focused. Collectible autocomplete belongs in OCR goals and checklist state, not in auto-progress counters.

## Days Gone Decisions

### IPCA Tech

Status: planned.

IPCA is currently a manual route counter in split planning.

Future idea:
- Enable IPCA OCR only for specific NERO checkpoint or NERO crate locations.
- Scan a different screen region from the normal top-right collectible toast.
- Keep IPCA out of broad OCR autocomplete until we have reliable reference images and region rules.
- Route data should opt into the specific IPCA scan target per split/location.

Open questions:
- Which screen region reliably shows IPCA pickup text?
- Does IPCA always use the same pickup toast location?
- Should IPCA stay manual by default unless a split explicitly enables it?

### Anarchist Cairns

Status: manual for now.

Cairns do not have a normal notification, so they should remain manual unless we later find a reliable detection method.

Potential future logic:
- Manual checklist/counter only.
- Optional route reminders in split notes or OCR goal dashboard.
- No automatic OCR until there is a stable visual signal.

### Peaceful Lake Autosplit Rule

Status: implemented as an autocomplete path.

Desired behavior:
- Peaceful Lake can still be completed manually.
- Peaceful Lake should autocomplete when both Copeland and Manny collectible groups are complete.

Required goals:
- Copeland - The Right to Bear Arms
- Copeland - Hunting Season
- Manny - Happy Birthday, Stud
- Manny - Zen and the Art of Bike Repair

Rule concept:
- If both Copeland collectibles and both Manny collectibles are confirmed while Peaceful Lake is the active split, complete the Peaceful Lake split.
- If only one item in a pair appears because the game suppresses the second toast, the paired collectible may need bundle logic or a manual confirmation prompt.

Implementation notes:
- This should be data-driven, likely through a split completion policy such as `allGoalGroups`.
- The existing bundle behavior for Copeland and Manny collectibles can feed this rule.
- The split should not autocomplete from only one Copeland item or only one Manny item unless that item has confirmed bundle behavior.

Example shape:

```json
{
  "id": "peaceful-lake",
  "ocrCompletion": {
    "mode": "allGoalGroups",
    "groups": [
      ["charactercollectibles-02", "charactercollectibles-03"],
      ["charactercollectibles-04", "charactercollectibles-05"]
    ]
  }
}
```

### Early Route Trigger Windows

Status: seeded in route data.

Use impossible-before relationships as OCR priority hints, not as permanent hard locks.

Current early chain:
- Leon split: `Finders Keepers` and `Leon - Crude Drawing of an Angel Statue`.
- `Finders Keepers` completes Leon and starts Crazy Willies.
- Crazy Willies split: Mayweed, Crowberry, Frontier Motel Brochures, optional Arrowhead, optional Seeking Gorgeous Man, and `Just a Flesh Wound`.
- `Just a Flesh Wound` completes Crazy Willies and starts O'Leary.
- O'Leary split: Black Currant, Wood Lily, Mountain Sorrel, Wild Bergamot, Salmon Berry.

Training value:
- Reduces noisy matching before items can realistically exist.
- Gives the run log an expected-versus-missed comparison per split.
- Makes OCR misses easier to diagnose because the log can show "expected but unseen" instead of one huge global checklist.
- OCR lookahead should stop at the first unfinished split completion gate, so later split goals do not compete before the route has cleared the current gate.

Screenshot notes:
- Keep screenshots for any miss where the item is visible on screen.
- Especially useful: alternate toast positions, blocked overlays, low contrast, rain/fog, YouTube controls, facecam overlap, and items appearing in the left pickup feed instead of the top-right collectible toast.
- Mayweed can appear in a right-mid toast position, so herbology now scans a narrow right-mid region in addition to top-right and left pickup.
- Crowberry appears in the normal top-right title position in the current sample; if it misses again, compare timing and debug crops before adding another region.

## Future Systems

### Event-Bucketed OCR Run Logs

Status: implemented.

- OCR entries are retained only while the run timer is active.
- Empty frames rejected by the text-presence gate are not log events.
- Each run session writes separate `confirmed`, `candidate`, `raw`, `gibberish`, `error`, and `control` JSONL files.
- Every entry keeps its wall-clock capture time and run-timer elapsed time.
- Raw OCR entries also carry explicit raw-text timestamps; gibberish entries carry both raw-text and gibberish timestamps.
- Downloaded logs retain the flat entry list for compatibility and add bucketed lists/counts for analysis.

Future ideas:

- Add crop/image references to selected raw or gibberish events without saving every frame.
- Compact repeated gibberish fingerprints into first-seen/last-seen/count summaries.
- Add a small run-log viewer with filters for bucket, split, region, and timer range.
- Promote manually reviewed raw candidates into a separate training-data export.
- Define retention limits per bucket so confirmed events outlive disposable noise logs.

### Days Gone Trial Scanner

Status: active for trial runs.

- The route-aware scan always includes trophy/collectible toasts, the IPCA pickup feed, and the full-screen mission-complete anchor/title regions.
- Exact IPCA text is globally eligible and auto-applies even outside the current route window.
- Full-screen completion events are latched so the title panel and later camp reward panel count only once.
- Exact NERO checkpoint, infestation, ambush camp, and horde titles update their objective counters globally.
- Generic camp-job completion screens update `encampmentjobs` only when the current split expects that counter.
- A mission title matching the current split label can complete that split.
- The default trial polling interval is 250 ms, and only one text-gate failsafe OCR is allowed per scan cycle.

### Route-Aware Unresolved Dashboard

Status: partially implemented.

Show three buckets during a run:

- Current split goals: likely pickups now.
- Unresolved earlier goals: expected earlier but not confirmed.
- Confirmed out-of-order goals: found early, so future splits should not nag about them.

Important behavior:
- Advancing the route should not mark unresolved goals complete.
- Picking up an item early should remove it from future split expectations.
- Unresolved goals should stay eligible for OCR/manual confirmation later.

Current implementation:
- Exact Days Gone checklist names from the top-right or right-mid toast regions can auto-apply even when they belong to a future split.
- Future exact matches update the overlay counters and checklist immediately.
- Future exact matches do not count against current split auto counters.
- OCR logs mark these as `outOfRoute` with `confidence: "exact out-of-route item"` so practice runs can teach future autosplit rules.
- Generic category phrases like `herbology collectible` still stay route-gated.

### Autosplit Training

Status: idea.

Use confirmed events from real runs to suggest future autosplit rules.

Confirmed event examples:

```json
{
  "timeMs": 823000,
  "type": "ocr-goal-confirmed",
  "goalId": "herbology-19",
  "label": "Mayweed",
  "counterKey": "herbology",
  "splitIdAtTime": "crazy-willies",
  "source": "ocr"
}
```

```json
{
  "timeMs": 910000,
  "type": "manual-split",
  "fromSplitId": "crazy-willies",
  "toSplitId": "o-leary"
}
```

Training approach:
- Log manual split presses.
- Log confirmed OCR goals.
- Log manual checklist corrections.
- Compare confirmed event order across runs.
- Suggest autosplit triggers only after repeated evidence.
- Never train from raw OCR guesses.

Possible training output:

```json
{
  "splitId": "peaceful-lake",
  "suggestedTriggerGoalIds": [
    "charactercollectibles-02",
    "charactercollectibles-03",
    "charactercollectibles-04",
    "charactercollectibles-05"
  ],
  "confidence": 0.82,
  "sampleRuns": 5
}
```

### Route Comparison / Strategy Data

Status: idea.

With enough confirmed run logs, compare route styles:

- Story rush with minimal off-route pickups.
- Bike upgrade rush.
- Early collectible sweep.
- Cleanup-heavy route.
- Safer combat route.

Useful questions:
- Does rushing story/bike upgrades save enough time to offset later cleanup?
- Which off-route pickups are actually worth grabbing early?
- Which pickups are commonly missed by OCR?
- Which split goals cause the most manual corrections?

### Branching Splits

Status: idea.

Allow a route to define optional split branches for different run plans or recovery paths.

Useful cases:
- Story-first route versus early collectible route.
- Bike upgrade rush versus safer cleanup route.
- Missed pickup recovery without corrupting the main split order.
- Combat-forced detours that still need comparable timing data.

Important behavior:
- Branches should not make route data the hard truth.
- OCR/manual events should remain confirmed-state driven.
- The dashboard should show which branch is active and what unresolved goals exist outside that branch.
- Run logs should preserve the chosen branch so future comparisons can measure route variants.

## Scratchpad

Add new ideas here first, then promote them into sections above once they become concrete.

### Days Gone Patch Overlay Theme

Status: parked for later.

Prototype files:
- `days-gone-patch-overlay.html`
- `assets/days-gone-chain-skull.png`
- patch-only CSS in `overlay.css`

Idea:
- Keep the current clean overlay as the reliable default.
- Revisit a more Days Gone styled "biker patch" overlay using the skull/chain/red cloth art.
- Test whether the patch art works better as a faint background emblem, side badge, or separate decorative plate behind the timer.
- Avoid hurting readability: timer, trophy count, percentage, and key counters still need to win over the art.

Open questions:
- Does the patch visual survive both dark scenes and bright scenes?
- Is it too busy for vertical stream crops?
- Should this be an alternate overlay URL/theme toggle rather than replacing the main overlay?
