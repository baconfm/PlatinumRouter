# Platinum Router

A data-driven speedrun routing tool designed for long-form runs (e.g. Ghost of Tsushima Platinum).

## Core Idea

Everything is driven by:
- Splits (what you do)
- Phases (what is visible / expected)
- Counters (what you track)

The UI is just a renderer of state.

---

## Structure

- `/index.html` → Main controller UI
- `/overlay.html` → Stream overlay UI
- `/splits.html` → Split editor page
- `/phases.html` → Phase editor page
- `/js` → Shared application logic
- `/data` → Game definitions and routing data

---

## Key Concepts

### Splits
Define progression through the run.
- Ordered
- Can auto-increment counters
- Can trigger phase changes

### Phases
Define what is visible + targets.
- Control UI visibility
- Can define pace targets (future)

### State
Stored in localStorage.
- Timer
- Counters
- Splits progress

---

## Design Goals

- No hardcoded game logic
- Fully portable between games
- Fast iteration for routing changes
- Stream-friendly

---

## Known Constraints

- LocalStorage = single device persistence
- No backend (by design)
- Overlay sync via storage events

---

## Future Plans

- Phase-based pacing (replace act timer)
- Separate editor pages
- Multi-game support
- Cloud sync (optional, not priority)

## Important Layout Decision

`overlay.html` stays in the project root on purpose.

Reason:
- It is a core runtime page, just like `index.html`
- It should stay visually and structurally tied to the main routing tool
- Keeping it in root reduces the chance of accidental refactors breaking overlay paths or shared logic

This is intentional and should not be "cleaned up" by moving it into a subfolder.
