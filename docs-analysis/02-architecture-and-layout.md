# VeloDrive — Architecture & Code Layout

> Companion to `01-functionality-and-user-journeys.md`. This documents *how the code is
> structured today*, the data model, the storage and hardware layers, and the code-quality
> signals that drive the modernization plan in doc 03.

---

## 1. Top-level layout

```
velo-drive/
├── README.md, TODO.md, .gitignore
└── docs/                      ← the entire app (served as GitHub Pages + Chrome extension root)
    ├── index.html             ← single page; every "view" is a hidden overlay
    ├── manifest.json          ← Chrome MV3 extension manifest
    ├── velodrive.webmanifest  ← PWA manifest (landscape, standalone)
    ├── service-worker.js      ← PWA offline cache (manual PRECACHE_URLS list, version v62)
    ├── theme-init.js          ← inline non-module anti-FOUC theme script (only <script> in <head>)
    ├── workout.js             ← ES-module ENTRY POINT (the controller/shell)
    ├── …23 more .js modules…
    ├── *.css (5 files, ~3.9k lines)
    ├── icons/, img/, screenshots/
    └── workouts/              ← 41 bundled .zwo default workouts
```

No build system, no bundler, no TypeScript, no tests, no linter, no `package.json`. 24 JS files,
~21.6k LOC, 688 commits. The README states it was "vibe-coded with ChatGPT."

Two scripts load in `index.html`: `theme-init.js` (head, sync) and `workout.js`
(`<script type="module">`, end of body). Everything else is pulled in via **static ES-module
imports** — no `window.*` globals, no global event bus. Module coupling is a clean DAG.

---

## 2. Module dependency graph

```
                         workout.js  (entry / controller)
        ┌──────────────┬─────────┼───────────────┬──────────────┬─────────────┐
        ▼              ▼         ▼               ▼              ▼             ▼
  workout-engine   workout-    workout-      workout-      settings.js   welcome.js
   (state machine)  picker      planner       chart                       theme.js
     │  │  │  │       │ │ │ │      │ │ │         │              │            │
     │  │  │  └─ fit-file        │ │ │ └ planner-backend        │            │
     │  │  └──── beeper          │ │ └── planner-analysis       └─ workout-engine
     │  └─────── ble-manager     │ └──── builder (→ builder-backend, zwo)
     │                           └────── scrapers, zwo, fit-file
     └─ workout-metrics ◄───────────────── (shared by ~7 modules)
        storage.js  ◄───────────────────── (shared by ~10 modules — the persistence hub)

  Leaf modules (no internal imports, most portable):
    zwo.js · fit-file.js · workout-metrics.js · beeper.js · welcome.js
    storage.js · scrapers.js · content.js · service-worker.js · theme-init.js

  Extension-only:  background.js → storage.js ;  content.js → (dynamic import) scrapers.js
```

**Two hubs:** `storage.js` (49 exports, imported by ~10 modules) is the data API; `workout-metrics.js`
(pure math) is imported by ~7. The architecture's good news is that the *core is already
DOM-free and framework-agnostic*: `workout-engine.js`, `workout-metrics.js`, `zwo.js`,
`fit-file.js`, and the parsing half of `ble-manager.js`/`scrapers.js` contain no DOM access.

| File | LOC | Role |
|---|---:|---|
| `workout-builder.js` | 2792 | Builder UI (imperative DOM + SVG icons + drag engine + vim keymap) |
| `workout-chart.js` | 2195 | All SVG charts (live, mini-history, power-curve, picker, builder) |
| `workout-picker.js` | 2120 | Library browse/search/sort + builder host + schedule mode + file I/O |
| `workout.js` | 1815 | Entry/controller; wires engine ↔ DOM ↔ overlays (`initPage` ~480-line god fn) |
| `builder-backend.js` | 1789 | Builder model: blocks ↔ rawSegments, selection, undo/redo, text-event anchoring |
| `workout-planner.js` | 1605 | Virtualized week-calendar UI + ride detail view |
| `fit-file.js` | 1141 | FIT binary read/write codec (leaf) |
| `zwo.js` | 1127 | ZWO XML parse/serialize + canonical model (leaf) |
| `ble-manager.js` | 1106 | Web Bluetooth FTMS/HR manager (event-emitter facade) |
| `scrapers.js` | 821 | Per-site workout scrapers (TrainerRoad/TrainerDay/WhatsOnZwift) |
| `welcome.js` | 791 | First-run tour (SVG animation) |
| `workout-engine.js` | 765 | Live-ride state machine + 1 Hz tick loop (no DOM) |
| `settings.js` | 681 | Settings modal |
| `beeper.js` | 558 | Web Audio cues + status overlay |
| `storage.js` | 540 | Persistence hub (IndexedDB + File System Access + localStorage) |
| `planner-backend.js` | 379 | Planner data layer (FIT index, schedule.json, stats cache, aggregates) |
| `workout-metrics.js` | 377 | Pure IF/TSS/kJ/NP/zone math (leaf, cleanest module) |
| `planner-analysis.js` | 365 | Power curve / power segments + detail renderers + trash I/O |
| `content.js` | 184 | Extension content script (scrape dispatcher) |
| `background.js` | 134 | Extension MV3 service worker (icon click, message routing) |
| `workout-library.js` | 42 | Hydrate a schedule entry → load its `.zwo` |
| `theme.js` | 33 | Theme runtime API |
| `theme-init.js` | 15 | Anti-FOUC inline theme bootstrap |

---

## 3. The application shell (SPA without a router)

`index.html` is one page. "Views" are absolutely-positioned overlay `<div>`s toggled by CSS
`display`/classes. There is **no router** and no component framework.

- **Base layer (always rendered):** the riding view — top stat cards, `#chartPanel`, bottom nav
  (bike/HR connect, settings, calendar, workout title, play/pause/stop).
- **Overlays:** welcome (`#welcomeOverlay`), settings (`#settingsOverlay`), and a **shared**
  picker/planner overlay (`#workoutPickerOverlay` / `#workoutPickerModal`) that the picker and
  planner *both* own and toggle via `picker-mode` / `planner-mode` classes. The builder is nested
  inside the picker modal (`#workoutBuilderRoot`).

**View switching** = imperative `open()/close()/show()/hide()` calls on three sibling controller
objects (picker, planner, settings), plus a hand-rolled Escape "modal stack" chain in `workout.js`
and an `isAnyModalOpen()` poll. The shared picker/planner DOM is the single most fragile coupling.

**State flow:** the engine is the de-facto store. It exposes `getViewModel()` (a flat VM snapshot)
and pushes updates via an `onStateChanged(vm)` callback; `workout.js` does a full, non-diffed
re-render (`renderFromEngine`) on every tick. The only true event bus is `BleManager.on(...)`.

---

## 4. The canonical data model (the crux of any refactor)

The same workout exists in **three representations**, with lossy/heuristic conversions between
them. Unifying these behind one typed model is the highest-value refactor.

### (a) `CanonicalWorkout` — interchange/export shape (defined in `zwo.js`)
```ts
{
  source: string;            // author
  sourceURL: string;         // original page URL
  workoutTitle: string;      // ⚠️ de-facto identity key (filename = encodeURIComponent(title)+".zwo")
  description: string;
  rawSegments: RawSegment[];
  textEvents: { offsetSec; durationSec; text }[];
}
```
**`RawSegment` is a positional tuple** `[minutes, startPct, endPct, type?, cadence?]`:
- `[1]/[2]` are **percent** of FTP (0–100), *except* a `toRel` heuristic treats values ≤5 as
  already-relative — a real 3 % segment would be misread.
- `[3]` is **overloaded**: the string `"freeride"` *or* a numeric cadence.
- This tuple is decoded by **duplicated `getRawCadence`/`isFreeRide` helpers in 3 files**
  (`workout-engine.js`, `workout-chart.js`, `workout-metrics.js`/`zwo.js`).

### (b) `Block` — the builder editing model (`builder-backend.js`)
Discriminated by `kind` (`steady | warmup | cooldown | intervals | freeride`), with kind-specific
`attrs` in **relative** power (0.95) and a flattened `segments[]` (intervals expand to `2*repeat`).
Tuple↔block conversion + interval re-detection logic is **duplicated** between
`builder-backend.js segmentsToBlocks` and `zwo.js segmentsToZwoSnippet`.

### (c) FIT — `workout_step` watts + the full canonical JSON embedded as chunked developer fields,
giving a lossless round-trip; a degraded step-reconstruction path is the fallback.

**Other shapes:** `liveSample {t, power, hr, cadence, targetPower}`; `pauseEvent {type, at}`;
scheduled entry `{date, workoutTitle}` (hydrated at runtime); history preview + `detailState`
(planner). `FREERIDE_POWER_REL = 0.5` is redefined in 3 places.

---

## 5. Persistence layer (`storage.js`) — three backends

| Backend | Used for | Tauri impact |
|---|---|---|
| **IndexedDB** (`velo-drive` DB, `settings` store) | key/value app state: FTP, theme, sound, selected/active workout, picker/builder state, BLE device ids, stats cache, scrape queue — **and the persisted `FileSystemDirectoryHandle`s** | DB works in WebView, but persisting FS handles does **not** port |
| **File System Access API** | the real data: `root/workouts/*.zwo`, `root/history/*.fit`, `root/trash/`, `root/schedule.json` | `showDirectoryPicker`, persistable handles, `queryPermission`/`requestPermission`, `createWritable` are Chromium-only → replace with native FS |
| **localStorage** | exactly one key: `themeMode` (anti-FOUC fast path; also mirrored to IndexedDB) | trivially portable |

The "database" is really **a folder of files** the user picks. This is a strength: portable,
inspectable, and it maps *more simply* to a native filesystem than to the browser.

One wart: file mutations (delete/clone/save) are done **directly inside `workout-picker.js`**
(~lines 1591–1845) rather than through `storage.js`, so the FS surface is split across two files.

---

## 6. Hardware layer (`ble-manager.js`) — the Tauri blocker

A clean IIFE singleton with a 6-event emitter facade (`bikeStatus`, `hrStatus`, `bikeSample`,
`hrSample`, `hrBattery`, `log`) and methods (`connectBikeViaPicker`, `connectHrViaPicker`,
`setTrainerState({kind:"erg"|"resistance", value})`, `init`, `on/off`). **No DOM access** — all
status reaches the UI through events. Consumers split cleanly: the engine owns data+control, the
page owns status+user-action.

- FTMS service 0x1826; Indoor Bike Data 0x2AD2 (notify, bit-flag parsed); Control Point 0x2AD9
  (requestControl/startOrResume/setTargetPower 0x05/setTargetResistance 0x04). HR 0x180D/0x2A37;
  battery 0x180F/0x2A19 (one-shot).
- Byte-level parsers (`parseIndoorBikeData`, `parseHrMeasurement`) and control-point encoders are
  pure and reusable verbatim (or movable to Rust).
- **Every connection primitive is Web Bluetooth** (`navigator.bluetooth.requestDevice/getDevices`,
  `device.gatt`, `getPrimaryService`, `getCharacteristic`, `startNotifications`,
  `writeValueWithResponse`, `gattserverdisconnected`). None of these exist in Tauri's WebViews
  (WKWebView / WebKitGTK / WebView2). The whole transport must be reimplemented natively (e.g.
  Rust `btleplug` behind the existing event facade). Note `device.id` is a Chrome-opaque per-origin
  id, **not** a MAC — so the persisted-device format changes in the port.

---

## 7. Rendering & UI patterns

- **All charts are hand-built SVG** (`document.createElementNS`), reading ~dozens of CSS custom
  properties at render time. `workout-chart.js` packs 5 distinct renderers + a ~350-line hover
  engine + builder drag handles into one file. The builder's drag system is tightly coupled to the
  exact SVG `data-*` attributes the chart emits.
- **All other UI is imperative DOM**: `createElement` trees and `innerHTML` for small fragments.
  The calendar is a custom **virtualized infinite week-scroll** with manual `scrollTop`
  compensation — the most fragile, least testable UI.
- **Vim-style keymaps** in the builder, picker, and planner (large hand-rolled `keydown` switches).

### Code-quality signals (measured)
| Signal | Count | Where concentrated |
|---|---:|---|
| `getElementById` / `querySelector` | 174 | `workout.js` 61, `workout-planner.js` 37, `settings.js` 25, `workout-picker.js` 20 |
| `alert` / `confirm` / `prompt` | 45 | picker 18, workout 11, planner/settings/analysis (TODO already says "don't use browser.alert") |
| `innerHTML` writes | 23 | builder/picker/planner/chart (incl. one **unsanitized** description sink in picker — XSS for scraped text) |
| Tests / TS / lint / build config | 0 | — |

---

## 8. The good seams (what makes a refactor tractable)

1. **Engine is callback-isolated** — `getViewModel()` + `onStateChanged` + imperative methods; no
   DOM. A view layer can be swapped under it without touching ride logic.
2. **Pure leaf modules** — `workout-metrics`, `zwo`, `fit-file` are DOM-free, import-free codecs.
   Ideal to keep as plain TS (or move to Rust).
3. **BLE is a facade with an event API** — make that facade the stable boundary and swap transports.
4. **Storage is a single hub** — narrow it to one interface and you have one place to port to native.
5. **Picker/planner/settings already take injected DOM + callbacks** — loosely coupled to the shell
   except for the hardcoded ids.

## 9. The sharp edges (what a refactor must fix)

1. **Three workout representations + overloaded positional tuples + the `≤5 means relative`
   heuristic** decoded in duplicate across files — define one typed model + edge codecs.
2. **Giant view files** (builder 2792, picker 2120, chart 2195) mixing 3–4 concerns each.
3. **Shared picker/planner overlay DOM** — implicit, breakable contract.
4. **174 raw DOM lookups + full non-diffed re-render** — replace with reactive rendering.
5. **45 blocking `alert/confirm/prompt`** — unstyled, and a hazard for native packaging.
6. **Title-as-identity** (no stable workout/schedule ids; rename = trash+rewrite).
7. **Manual service-worker `PRECACHE_URLS`** must be hand-updated on every new file.
8. **`setInterval(1000)` elapsed-time** advances by exactly 1 per tick and does not reconcile drift
   — vulnerable to background throttling.
9. **Confirmed latent bug:** `workout-metrics.js:375` references undefined `workout`
   (`return workout.baseKj`) in the `baseFtp <= 0` branch.
