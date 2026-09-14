# JS Architecture

This folder contains all application logic.

## Structure

- `controller.js` → Entry point
- `controller-core.js` → Pure logic (state shaping, helpers)
- `controller-actions.js` → Mutations (timer, splits, counters)
- `controller-render.js` → UI rendering glue

- `storage.js` → State persistence (localStorage)
- `data-loader.js` → Loads game data from /data
- `ui-render.js` → DOM rendering

- `split-logic.js` → Split normalization + helpers
- `split-editor.js` → Split editor UI
- `acts-editor.js` → Phase editor UI
- `debug.js` → Debug panel

---

## Responsibilities

### controller-core
Pure logic only.
- No DOM
- No side effects

### controller-actions
Handles:
- Timer
- Split progression
- Counter updates

### controller-render
Handles:
- Mapping state → UI
- Small UI glue logic

---

## Design Rules

- State is immutable (always cloned)
- No direct DOM manipulation outside render layer
- No business logic inside UI files

---

## Debugging

Use debug panel:
- Shows state snapshot
- Logs actions
- Tracks active phase

---

## Common Issues

### Splits not loading
→ Check data-loader paths  
→ Check normalizeSplits  

### UI not updating
→ Check storage subscription  
→ Check render() is triggered  

### Buttons not working
→ Check bindStaticEvents()
