# Platinum Router Agent Notes

Platinum Router is a static, data-driven speedrun routing tool. Treat `index.html`, `overlay.html`, `splits.html`, `phases.html`, and `game-editor.html` as runtime entry points in the project root. Do not move `overlay.html`; it intentionally lives beside `index.html`.

## Architecture

- Vanilla HTML, CSS, and ES modules only. Do not introduce a frontend framework unless explicitly requested.
- Game and route behavior belongs in `data/**` JSON files, not hardcoded into UI logic.
- Shared app logic belongs in `js/**`; keep pure state logic separate from DOM rendering where the existing modules already do.
- State is stored in `localStorage`; overlay sync depends on storage events.
- Editor pages should modify or generate JSON data, not runtime state.

## Useful Skills

- Use `webapp-testing` for controller, overlay, editor, responsive, and localStorage regression checks.
- Use `create-plan` for larger features such as cloud sync, route validation, phase pacing, or route editor changes.
- Use `codebase-migrate` only for broad structural refactors.
- Use `theme-factory` for theme or overlay visual system work.

## Verification

Run these before finishing meaningful changes:

```bash
npm run validate
```

For UI changes, also serve the project and inspect the affected page in a browser:

```bash
npm run serve
```

Then open `http://localhost:8080/`.

## Token Budget Rules

- Prefer the controller `Copy Compact Snapshot` output for AI/debug context.
- Do not paste full Run Data exports, split backups, phase backups, or complete `gameData + state` dumps into chat unless specifically requested.
- If more detail is needed, ask for the smallest route file or exported JSON that contains the missing data.

## Data Rules

- `data/games.json` is the manifest.
- Each game folder should include `meta.json`, `counters.json`, `default-splits.json`, `phases.json`, and `quotas.json`, unless a route explicitly points to route-specific overrides under `routes/**`.
- Split `auto` keys, phase counters, and quota keys should resolve to counters defined in that game.
- Split phase markers should resolve to phase IDs in the route's active `phases.json`.
