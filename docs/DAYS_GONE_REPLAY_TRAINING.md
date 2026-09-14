# Days Gone Replay Training

The replay dataset uses original recordings as immutable inputs. It does not train from arbitrary OCR guesses.

## Labels

- Confirmed OCR events are positive popup labels.
- Split completion timestamps are search hints only. Manual split timestamps are not positive popup labels.
- Raw and gibberish OCR entries are grouped into review episodes.
- Route goals missing from confirmed events are search targets only; they are not accepted as positive labels until reviewed.

## Build a manifest

```powershell
node scripts/build-days-gone-training-manifest.mjs "E:\Train\2026-07-18 10-01-32.mkv" --video-start "2026-07-18T10:01:32+03:00"
```

## Extract a validation batch

```powershell
node scripts/extract-days-gone-training-samples.mjs outputs/training/days-gone/20260718/manifest.json --limit 24
```

Each event produces three timestamps around the historical detection and region-specific crops. The first use is regression testing for popup presence, fuzzy title matching, and short-lived frames. A learned classifier should only be introduced after reviewed positive and hard-negative samples are available.

## Center-screen completion discovery

Days Gone presents a flurry of centered progression panels after a mission or objective. The first panel carries the completed mission/event title, so replay discovery targets the middle title area and does not require the changing top-left text.

Run a short calibration scan before scanning the entire recording:

```powershell
python scripts/scan_days_gone_center_popups.py outputs/training/days-gone/20260718/manifest.json --duration 1200 --fps 6 --output outputs/training/days-gone/20260718/center-popup-calibration.json
```

Candidates within 25 seconds are grouped into one popup episode, and the first recognized centered title is retained as the primary completion title. The output includes a review ledger for approximately 60 story missions and the configured NERO, infestation, ambush-camp, camp-job, and horde totals. These totals are review targets, not automatic labels, because one completion episode can show several progression panels.

## Overnight optimization

Double-click `run-days-gone-overnight-training.bat`, or run:

```powershell
.\scripts\run-days-gone-overnight-training.ps1 -NegativeCount 2000 -OptimizationRounds 160
```

The job is resumable. It rebuilds the manifest, skips existing positive and background images, optimizes a lightweight logistic popup-presence model, saves checkpoints, and runs project validation. The resulting model is written to `outputs/training/days-gone/20260718/models/top-right-popup-model.json`. It is an offline candidate until its validation recall and false-positive rate are reviewed; the live scanner is not silently changed by training.

## Training logs

Every overnight run gets its own folder under `outputs/training/days-gone/20260718/logs/`. It contains a readable `console.log`, a combined `events.jsonl`, and separate event buckets for control, extraction, dataset, optimization, metrics, review, and errors. `session.json` records the exact recording and parameters used.

Generate a cross-run analysis report with:

```powershell
npm run analyze:days-gone-training
```

The report is written to `outputs/training/days-gone/20260718/training-log-analysis.json` and identifies incomplete/failed runs, phase durations, model improvements, validation metrics, review counts, and deployable candidates.

While training is running, double-click `check-days-gone-training-status.bat` or run `npm run status:days-gone-training`. It reports whether the run is active, its current phase, positive/background image counts, the latest milestone, and an estimated time remaining for the current extraction phase.
