# Days Gone Interactive Map — Design & Architecture Handover

## Project Goal

Build a highly modular **Days Gone interactive map platform** that starts as a completion/exploration tool and can later expand into routing, speedrunning, community discoveries, OCR-based automatic tracking, and GeoGuessr-style gameplay.

The first game is **Days Gone**, and it should be treated as the reference implementation.

The long-term product is **not just an interactive map**.

It should evolve into:

> **A Days Gone completion, exploration, routing, and community knowledge platform.**

The map is the primary interface, but the underlying system should be a structured game database and generic map engine.

---

## Core Product Direction

The project should eventually support:

- Interactive map
- Collectibles
- Loot
- Objectives
- Progress tracking
- Platinum tracking
- Community-added markers
- Community verification
- Route creation
- Speedrun routes
- Route comparison
- Mission dependencies
- Fuel-aware routing
- "Do this while you're here" recommendations
- OCR-based automatic completion tracking
- GeoGuessr-style gameplay
- Multiple games later

However, the initial implementation must remain deliberately simple.

Do not prematurely build the later systems.

---

## Current Milestone

### Version 0.1 — Map Foundation

The immediate goal is:

> Render the Days Gone world map as the background of a modular interactive map engine.

The first version should support:

- Days Gone world map background
- Pan
- Zoom
- Reset view
- Responsive browser sizing
- Coordinate conversion
- Layer architecture
- Clean modular file structure

No actual collectible database is required yet.

No backend is required yet.

No account system is required yet.

---

## Architectural Principle

### Maximum Modularity

The generic map engine must know as little as possible about Days Gone.

Days Gone-specific information should live in game configuration and data files.

The intended conceptual split is:

```text
GENERIC ENGINE
│
├── Map engine
├── Camera
├── Renderer
├── Coordinates
├── Layers
├── Input
└── UI primitives

GAME IMPLEMENTATION
│
└── Days Gone
    ├── Map configuration
    ├── Regions
    ├── Entity definitions
    ├── Icons
    ├── Map assets
    └── Game-specific rules
```

The goal is to eventually allow:

```text
games/
├── days-gone/
├── ghost-of-tsushima/
├── gta/
└── another-game/
```

without rewriting the engine.

---

## Recommended Project Structure

```text
days-gone-map/
│
├── index.html
├── styles.css
│
├── src/
│   ├── main.js
│   │
│   ├── core/
│   │   ├── config.js
│   │   ├── state.js
│   │   └── events.js
│   │
│   ├── map/
│   │   ├── MapEngine.js
│   │   ├── MapCamera.js
│   │   ├── MapRenderer.js
│   │   ├── MapCoordinates.js
│   │   ├── MapLayers.js
│   │   └── MapInput.js
│   │
│   ├── entities/
│   │   ├── EntityManager.js
│   │   ├── EntityRenderer.js
│   │   └── EntityTypes.js
│   │
│   ├── ui/
│   │   ├── UIManager.js
│   │   ├── Controls.js
│   │   └── Sidebar.js
│   │
│   └── games/
│       └── days-gone/
│           ├── config.js
│           ├── map.js
│           ├── regions.js
│           └── entities.js
│
└── assets/
    └── games/
        └── days-gone/
            ├── map/
            └── icons/
```

This exact structure can change if there is a better technical reason, but the engine/game separation should remain.

---

## Map Engine Responsibilities

### MapEngine

High-level coordinator.

Responsibilities:

- Initialize map
- Register systems
- Start render loop if required
- Connect camera, renderer, layers, input, and entities
- Load current game configuration

It should not contain Days Gone-specific logic.

---

### MapCamera

Responsible for:

- Camera position
- Zoom level
- Zoom limits
- Pan limits
- Centering
- Reset view
- Viewport calculations

Suggested state:

```js
{
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.25,
    maxZoom: 5
}
```

Mouse-wheel zoom should ideally zoom toward the cursor rather than toward the center of the screen.

---

### MapCoordinates

This is extremely important.

It should provide conversions between:

```text
MAP SPACE
WORLD SPACE
SCREEN SPACE
```

Example functions:

```js
mapToScreen(x, y)
screenToMap(x, y)
worldToMap(x, y)
mapToWorld(x, y)
```

Markers, routes, GeoGuessr positions, community submissions, and future OCR integrations must all depend on this consistent coordinate system.

Avoid storing marker positions as arbitrary CSS percentages if possible.

---

### MapRenderer

Responsible for drawing the map.

It should accept game/map configuration and render the current background layer.

The renderer must not care whether the map belongs to Days Gone or another game.

---

### MapLayers

The map should be designed as a layered system from the beginning.

Conceptually:

```text
BASE MAP
↓
REGIONS
↓
ROADS
↓
OBJECTIVES
↓
COLLECTIBLES
↓
LOOT
↓
COMMUNITY
↓
ROUTES
↓
PLAYER / LIVE DATA
```

Every layer should eventually be independently:

- enabled
- disabled
- reordered if necessary
- rendered
- queried

The initial build only needs the base map layer and enough infrastructure to prove the layer system works.

---

## Background Map

The Days Gone world map should be the initial background.

Preferred long-term solution:

### Tiled Map

Instead of relying permanently on one enormous PNG, the architecture should support map tiles.

Example:

```text
assets/games/days-gone/map/
│
├── 0/
│   └── 0/
│       └── 0.webp
│
├── 1/
│   ├── 0/
│   └── 1/
│
└── 2/
    └── ...
```

Benefits:

- Lazy loading
- Better performance
- High zoom levels
- CDN friendly
- Cloudflare-friendly
- Easier replacement
- Lower initial bandwidth

However, using a single image during early development is acceptable if this significantly speeds up initial implementation.

The renderer should ideally be designed so the map source can later be swapped for tiles without rewriting the rest of the application.

---

## Days Gone Game Configuration

Days Gone-specific values should exist in its config.

Example:

```js
export default {
    id: "days-gone",

    name: "Days Gone",

    map: {
        width: 8192,
        height: 8192,
        source: "/assets/games/days-gone/map/world-map.webp"
    },

    regions: [
        "cascade",
        "belknap",
        "lost-lake",
        "iron-butte",
        "crater-lake",
        "highway-97"
    ]
};
```

Values are placeholders until the real map dimensions and map source are established.

---

## Entity Philosophy

Do not think in terms of hardcoded pins.

Everything displayed on the map should eventually be represented as an **entity**.

Example:

```js
{
    id: "nero_checkpoint_001",

    game: "days-gone",

    type: "nero_checkpoint",

    position: {
        x: 1245,
        y: 873
    },

    region: "cascade",

    title: "NERO Checkpoint",

    description: "",

    images: [],

    requirements: [],

    relatedEntities: [],

    platformSupport: {
        pc: true,
        ps4: true,
        ps5: true
    },

    metadata: {}
}
```

The renderer should not need special code for every individual marker.

It should receive structured entities and render them according to type.

---

## Why Stable Entity IDs Matter

Every entity needs a permanent ID.

Example:

```text
nero_checkpoint_001
horde_cascade_004
historical_marker_017
fuel_can_00381
```

Later, the same entity can be referenced by:

- Map marker
- Completion tracker
- Route
- Speedrun route
- OCR event
- GeoGuessr
- Community comment
- Community verification
- API response
- Related objective

Avoid duplicating the same location into separate systems.

---

## Future Entity Relationships

Entities should eventually support relationships.

Example:

```text
Horde
│
├── Nearby fuel
├── Nearby explosive
├── Associated region
├── Associated mission
├── Route waypoint
└── Community strategy
```

This will later enable intelligent features.

---

## Planned Roadmap

### Phase 1 — Map Foundation

- Map renderer
- Days Gone map
- Zoom/pan
- Coordinates
- Regions
- Responsive UI
- Marker architecture
- Layers
- Basic search/filter infrastructure

### Phase 2 — Core Database

#### Collectibles

- Locations
- Types
- Descriptions
- Screenshots
- Completion state

#### Loot

- Weapons
- Crafting materials
- Supplies
- Containers
- Fuel
- Ammo
- Medical resources

#### Objectives

- Missions
- Camps
- NERO
- Hordes
- Infestations
- Other completion objectives

### Phase 3 — Personal Tracker

- Local player profile
- Completed/uncompleted entities
- Progress percentages
- Platinum tracker
- Import/export progress
- Reset progress

LocalStorage is acceptable initially.

Accounts/cloud storage are not necessary for MVP.

### Phase 4 — Community

Community users should eventually be able to add markers.

Potential community marker types:

- Loot
- Fuel
- Hidden item
- Secret
- Easter egg
- Glitch
- Shortcut
- Speedrun strategy
- Useful Horde position
- Danger
- Screenshot location
- GeoGuessr location

Marker submission should include:

- Position
- Type
- Title
- Description
- Screenshot
- Optional video
- Platform
- Game version
- Tags
- Creator
- Creation date

Community marker states:

```text
Unverified
Community Verified
Author/Admin Verified
Disputed
Deprecated
```

Do not allow anonymous edits directly into authoritative data.

Use suggestions/version history instead.

---

## Community Verification

Community data reliability is important.

Future marker metadata could include:

```text
Added by: User123
Confirmed by: 8 users
Last confirmed: 2026-08-14
Platform: PS5
Version: Remastered 1.025
```

Users should be able to:

- Confirm
- Dispute
- Suggest edits
- Report
- Comment

Accepted edits should create version history rather than silently overwriting data.

---

## Game Version Awareness

Days Gone has meaningful version/platform differences.

The data model should eventually support:

- PS4
- PS5
- PC
- Original version
- Remastered
- Specific patches

Example:

```js
versions: {
    pc: ["latest"],
    ps5: ["1.025"],
    ps4: ["1.00", "1.61"]
}
```

This will be particularly valuable for glitches, speedrun strategies, loot behavior, and patched mechanics.

---

## Routing Phase

Routes should reference entities rather than duplicate locations.

Potential structure:

```js
{
    id: "route_001",

    name: "14:40 Platinum Route",

    author: "Bacon Saint John",

    game: "days-gone",

    category: "platinum",

    waypoints: [
        {
            entityId: "nero_checkpoint_001",
            order: 1
        },
        {
            entityId: "collectible_023",
            order: 2
        }
    ]
}
```

Routes should eventually support:

- Create
- Edit
- Save
- Share
- Clone
- Compare
- Playback

---

## 14:40 Reference Route

The user's completed **14 hour 40 minute Days Gone 100% map + Platinum run** should eventually become a flagship route.

Possible presentation:

> Bacon Saint John's 14:40 Platinum Route

Future route details could show:

- Run time
- Region
- Mission order
- Objectives
- Fuel stops
- Loot pickups
- Route segments
- Strategy notes
- Split times

The map could eventually animate the entire route.

---

## Routing Intelligence

Long-term, routing should become game-aware rather than simply drawing straight lines.

Important planned features:

### "Do this while you're here"

Example:

```text
Current objective:
NERO Checkpoint

Nearby:
Historical Marker — 180m
Fuel Can — 240m
Collectible — 410m

Additional route cost:
+2m 14s
```

### "Don't do this yet"

Example:

```text
Skip Historical Marker #24.

You will pass within 70m of it during Mission X later.
```

This kind of logic differentiates the product from generic map sites.

---

## Fuel-Aware Routing

Days Gone's bike makes routing unique.

The eventual route engine should understand:

- Fuel consumption
- Bike fuel tank upgrades
- Fuel stations
- Fuel cans
- Encampments
- Route distance
- Terrain where useful
- Refueling opportunities

Example:

```text
ROUTE A
12.4 km
Estimated fuel required: 51%
Current fuel: 42%

NOT FEASIBLE

ROUTE B
13.2 km
Fuel stop at station

FEASIBLE
```

This is a major long-term differentiator.

---

## Horde Planner

Days Gone-specific Horde data may eventually contain:

- Horde name
- Size
- Day spawn location
- Night movement
- Cave location
- Nearby explosives
- Nearby loot
- Nearby fuel
- Bike positioning
- Difficulty
- XP/rewards
- Region
- Community strategies

This can later feed:

- Horde routes
- Completion routes
- Speedrun routes
- Community guides

---

## Mission Dependency System

Eventually represent mission progression structurally.

Example:

```text
Mission A
├── Mission B
│   └── Mission D
└── Mission C
    └── Mission D
```

This would allow queries like:

> What is the earliest point where this objective is available?

and:

> What objectives should I delay until a later mission?

---

## OCR Integration

A separate existing/planned system uses OCR to detect game completion events from console gameplay.

Future integration concept:

```text
GAME SCREEN
↓
OCR
↓
"NERO Injector acquired"
↓
Resolve to entity
↓
Mark entity complete
↓
Map updates automatically
```

The map must therefore expose completion state separately from the base entity definition.

Suggested structure:

```js
{
    entityId: "nero_injector_017",
    profileId: "player_001",
    completed: true,
    completedAt: 123456789
}
```

Do not store player completion state directly inside the authoritative entity record.

---

## GeoGuessr Mode

The same location database should eventually power a Days Gone GeoGuessr-style mode.

Possible modes:

- Guess location
- Guess region
- Guess camp
- Guess Horde
- Guess NERO checkpoint
- Speed challenge
- Daily challenge
- Community challenge

GeoGuessr locations should ideally reference existing entities when appropriate.

Community users may also submit dedicated GeoGuessr locations.

---

## Homepage / Product Identity

Avoid presenting the project merely as:

> Days Gone Interactive Map

Preferred concept:

> **Explore Oregon. Track everything. Build better routes.**

Or broadly:

> **The ultimate Days Gone completion, exploration and routing tool.**

The product's differentiation should come from intelligence and game-state awareness rather than simply having more markers than competitors.

---

## UX Direction

Visual identity should feel appropriate for Days Gone while remaining functional.

Potential direction:

- Dark/desaturated UI
- Oregon wilderness influence
- Topographic/map feel
- Orange/rust accents
- Clear readable typography
- Minimal clutter
- Game-inspired iconography without making the UI feel like a novelty skin

Do not compromise usability for theme.

---

## Important UI Principle

Avoid displaying hundreds of icons simultaneously.

Use:

- Category filters
- Region filters
- Clustering
- Zoom-dependent visibility
- Search
- Layer toggles

The map should remain readable.

---

## Initial UI

The first version can be extremely simple.

```text
┌──────────────────────────────────────────────┐
│                                              │
│                                              │
│               DAYS GONE MAP                  │
│                                              │
│                                              │
│                                      [+]     │
│                                      [-]     │
│                                      [↺]     │
│                                              │
└──────────────────────────────────────────────┘
```

Initial controls:

- Zoom in
- Zoom out
- Reset view

Optional debug controls during development:

- Current camera position
- Current zoom
- Mouse map coordinates

The coordinate debug readout will be useful when placing initial entities.

---

## First Technical Test

Once the map is working, add exactly one test entity.

Example:

```js
{
    id: "test_nero_001",
    type: "nero_checkpoint",
    position: {
        x: 1200,
        y: 850
    },
    title: "Test NERO Checkpoint"
}
```

Render it.

Then test:

1. Zoom
2. Pan
3. Marker stays aligned with map
4. Click marker
5. Popup opens
6. Resize browser
7. Marker remains aligned
8. Convert screen position back into map position

If this works reliably, the core architecture is valid.

---

## Second Technical Test

Add several dummy entity types:

```text
NERO
Horde
Ambush Camp
Collectible
Fuel
```

Test:

- Different icons
- Layer filtering
- Marker click
- Popup rendering

Do not populate the full game until these systems are stable.

---

## What NOT to Build Yet

Do not currently spend time implementing:

- Full collectible database
- Full loot database
- Community backend
- User accounts
- Route optimizer
- Fuel simulation
- OCR
- GeoGuessr
- Leaderboards
- Public API
- Complex moderation
- Cloud saves

These depend on the map/entity foundation.

---

## MVP Scope

A reasonable first usable MVP is:

```text
Interactive Map
↓
Collectibles
↓
Loot
↓
Objectives
↓
Progress Tracking
```

Everything beyond this is later expansion.

---

## Critical Development Rule

Avoid hardcoded Days Gone logic inside generic systems.

Bad:

```js
if (marker.type === "horde") {
    // large amount of Days Gone-specific behavior
}
```

inside the generic map engine.

Prefer:

```js
const renderer = entityTypeRegistry.get(entity.type);
renderer.render(entity);
```

with game-specific behavior registered externally.

---

## Long-Term System View

Conceptually:

```text
                     GAME DATABASE
                          │
         ┌────────────────┼────────────────┐
         │                │                │
      ENTITIES         RELATIONS        GAME RULES
         │                │                │
         └────────────────┼────────────────┘
                          │
                     MAP ENGINE
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
     TRACKER           ROUTING           COMMUNITY
        │                 │                  │
        └─────────────────┼──────────────────┘
                          │
          ┌───────────────┼────────────────┐
          │               │                │
         OCR          SPEEDRUNS        GEOGUESSR
```

The map should remain one interface over the data rather than becoming the place where all application logic lives.

---

## Current Priority Order

The next chat should work in this order:

1. Create modular project skeleton
2. Load Days Gone map background
3. Implement camera
4. Implement pan
5. Implement cursor-centered zoom
6. Implement map/screen coordinate conversion
7. Implement base layer system
8. Add coordinate debug display
9. Add one dummy entity
10. Add basic entity interaction
11. Validate responsiveness
12. Only then move into real Days Gone data

---

## Success Criteria for Version 0.1

Version 0.1 is successful when:

- Days Gone map loads correctly
- Map fills the intended viewport
- Pan feels smooth
- Zoom feels smooth
- Zoom is constrained sensibly
- Camera cannot lose the map completely
- Map coordinates are deterministic
- Marker positions remain correct at every zoom level
- Browser resizing does not break alignment
- Layers can be added without changing the core renderer
- Days Gone-specific data remains isolated from generic engine code
- One test entity can be displayed and interacted with

Once those conditions are met, begin the actual Days Gone database.
