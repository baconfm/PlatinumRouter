# Game Data

Each game is defined entirely through JSON files.

## Structure


/data/
games.json
/ghost-of-tsushima/
meta.json
counters.json
default-splits.json
phases.json
quotas.json


---

## Files

### meta.json
Basic info:
- title
- subtitle
- (future: difficulty baked here)

---

### counters.json
Defines all tracked objectives.

Example:

"inari": {
"label": "Inari Shrines",
"max": 49
}


---

### default-splits.json
Defines run route.

Each split:
- id
- label
- phase (optional)
- note
- auto (counter increments)

---

### phases.json
Controls UI + structure.

Each phase:
- visibleCounters
- objectives
- notes
- (future: pace targets)

---

### quotas.json
Defines phase targets.

Used for:
- Act quotas
- Progress tracking

---

## Design Rules

- No logic here — only data
- Everything must be optional-safe
- Backwards compatible

---

## Important

Splits are the **true driver** of the run.

Phases are **just a lens** for UI + pacing.
