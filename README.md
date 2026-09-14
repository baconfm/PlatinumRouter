PlatinumRouter

**A real-time game progress tracker that watches gameplay and keeps the run up to date automatically.**

PlatinumRouter was built for long completion challenges where a player may need to track hundreds of objectives without stopping to manually tick boxes.

For supported workflows, it can capture gameplay through OBS, use OCR and visual checks to recognize completed objectives, compare what happened in-game against the planned route, and update route progress, counters, splits and stream overlays.

## What it does

```text
Gameplay / OBS
      ↓
Frame capture
      ↓
OCR + visual detection
      ↓
Objective matching
      ↓
Confirmed game state
      ↓
Route + counters + splits + overlay
```

The route is a guide, not the source of truth. PlatinumRouter is designed around what the player actually completes.

If something happens out of order, OCR misses an event, or the player manually corrects a counter, the confirmed game state remains authoritative.

## Highlights

- **OCR-assisted progress tracking** — captures gameplay from OBS and recognizes supported in-game completion events.
- **Automatic route updates** — detected objectives can update counters, checklists and route state without manual input.
- **Route-aware detection** — expected objectives help prioritize matches without forcing the player to follow the route perfectly.
- **Manual corrections** — missed detections can be corrected without breaking later progress.
- **Run logging and analysis** — OCR events, missed objectives and route deviations can be reviewed after a run.
- **Stream overlays** — dedicated full and compact overlays expose live run progress in OBS.
- **Editable route data** — splits, phases, counters, quotas and route variants are data-driven rather than tied to one game.
- **Validation tools** — project checks verify game data, static pages and OCR log classification.

## Supported game data

PlatinumRouter currently includes route/tracking data for:

- **Ghost of Tsushima**
- **Days Gone**
- **The Last of Us Part II Remastered**
- **Grand Theft Auto III: Definitive Edition**

The level of automation differs by game. The most developed OCR and replay-analysis workflow currently targets **Days Gone**.

## Why I built it

Long platinum, 100% and challenge runs can involve hundreds of objectives spread across many hours.

Tracking all of that manually while also playing creates a second job:

- remember the route,
- update counters,
- track collectibles,
- advance splits,
- watch completion requirements,
- and keep a stream overlay accurate.

PlatinumRouter started as a way to move that bookkeeping out of the player's hands.

The goal is simple:

> **Play the game. Let the tracker handle as much of the tracking as possible.**

## Days Gone OCR workflow

The Days Gone tracker can connect to an OBS WebSocket source and request gameplay frames directly.

Its tracking pipeline includes:

- region-based screen capture;
- OCR and visual-event detection;
- fuzzy matching against known completion titles;
- route-aware objective prioritization;
- duplicate-event protection;
- confirmed, candidate, raw and error log buckets;
- out-of-route completion handling;
- manual reconciliation when automation misses something;
- replay scanning and regression testing against recorded runs.

Offline tooling is also included for reviewing recorded runs, extracting training samples, comparing detections and investigating missed objectives.

## Route model

Each game is defined through JSON data rather than hardcoded into the main UI.

Typical game data includes:

```text
data/
├── games.json
└── <game>/
    ├── meta.json
    ├── counters.json
    ├── default-splits.json
    ├── phases.json
    └── quotas.json
```

The main concepts are:

- **Splits** — ordered route steps.
- **Counters** — tracked completion requirements.
- **Phases** — control which information is relevant during different parts of a run.
- **Quotas** — phase-specific progress targets.
- **OCR goals** — objectives that automation can watch for during supported routes.

Some games also contain multiple route variants and game-specific tracking data.

## Main interfaces

- `index.html` — main run controller
- `overlay.html` — stream overlay
- `minoverlay.html` — compact overlay
- `splits.html` — split editor
- `phases.html` — phase editor
- `game-editor.html` — game configuration editor
- `missed-dashboard.html` — missed-objective review
- `run-comparison.html` — run comparison tooling

## Running locally

### Requirements

For the core tracker:

- Python 3
- a modern browser

For live OCR tracking:

- OBS Studio with WebSocket enabled
- Tesseract OCR
- Python packages `pillow` and `pytesseract`

### Start the local server

On Windows, run:

```text
start-python-server.bat
```

Or from the project directory:

```bash
python scripts/router_server.py --port 8080
```

Then open:

```text
http://localhost:8080/
```

The local server also enables file-backed editor saves, run exports and OCR helper endpoints.

### Install the Python OCR helper packages

On Windows:

```text
install-ocr-python-package.bat
```

Or manually:

```bash
python -m pip install pillow pytesseract
```

Tesseract itself must also be installed separately for local OCR.

## Validation

Run the project checks with:

```bash
npm run validate
```

This currently validates:

- game/route data;
- static runtime pages;
- OCR log classification.

Useful individual commands include:

```bash
npm run validate:data
npm run check:pages
npm run check:ocr-log
```

## Development approach

PlatinumRouter is an independent project created around real speedrun and completion-routing problems.

**System design, game research, requirements, testing, validation and iteration are by Bacon FM. Implementation has been developed with AI-assisted coding.**

The project is intentionally built around practical use: test it during real runs, identify where the workflow fails, change the system, and test again.

## Project status

PlatinumRouter is actively evolving.

Some game profiles are mature routing tools, while others are earlier route or OCR practice scaffolds. Automation coverage is not identical across every supported game.

The project is primarily built for my own runs and research, but the underlying route system is designed to support additional games without rebuilding the tracker from scratch.

## License

The original PlatinumRouter code is released under the [MIT License](LICENSE).

Game names, trademarks, screenshots and other third-party intellectual property belong to their respective owners. PlatinumRouter is an independent fan-made project and is not affiliated with or endorsed by the publishers or developers of the supported games.
