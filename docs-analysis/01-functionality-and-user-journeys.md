# VeloDrive — Functionality & User Journeys

> Analysis date: 2026-06-18. Source: full read of every file in `docs/` (~21.6k LOC JS,
> ~3.9k LOC CSS, 1.3k LOC HTML). This document enumerates *what the app does* and *the user
> journeys that matter*. See `02-architecture-and-layout.md` for how it is built and
> `03-modernization-options-and-recommendation.md` for the path forward.

---

## 1. What VeloDrive is

A **single-page web app** for creating, organizing, and riding structured indoor-cycling
workouts on Bluetooth FTMS smart trainers. It ships in three forms from one `docs/` tree:

- **PWA** (primary) at `https://velodrive.bike/` — installable, fully offline, no accounts, no backend.
- **Chrome extension** (optional) — a "Download ZWO" importer that scrapes workouts from
  TrainerRoad / TrainerDay / WhatsOnZwift into the app's library.
- **Unpacked dev extension** — `options_ui` points at the same `index.html`.

There is **no server**. All data lives on the user's machine: small key/value state in
IndexedDB + localStorage, and the real data (`.zwo` workouts, `.fit` ride history,
`schedule.json`) as **actual files in a user-picked folder** via the File System Access API.

The app is **chartware**: a live SVG HUD that controls the trainer in ERG mode, follows a
workout's power profile second-by-second, records the ride, and saves it to history.

---

## 2. Feature catalogue

### Riding / execution
- Live HUD: power, target power, cadence (with in/out-of-range arrows), HR, interval time, elapsed time.
- SVG workout-profile chart with zone colors, "past" shading, a moving position line, live
  power/HR/cadence trace overlays, hover tooltips, and inline text-event cues.
- ERG mode (app writes target watts to the trainer every tick, throttled).
- Resistance mode + free-ride blocks (manual ± control of watts or resistance level).
- 3-2-1-Start audio countdown; interval-change beeps (warning beeps at 9 s and 3 s before a
  step change; an "air-raid + honk" alarm before a big step-up).
- **Auto-start** when the user starts pedaling above a threshold.
- **Auto-pause** after ≥1 s of zero power; **auto-resume** when pedaling returns to ≥90 % target.
- Manual play / pause / resume / stop (all multiplexed through one engine entry point).
- Live FTP change rescales targets mid-ride.
- Crash/reload recovery: a mid-workout session is restored **paused** for safety.
- On finish: writes a `.fit` file (with the full workout embedded losslessly) to the history folder.

### Workout library & browsing
- Folder-backed library of `.zwo` files; auto-seeds bundled default workouts on first folder pick.
- Sortable/filterable table: search (text + duration ranges like `30-45`, `<40`, `>60`),
  zone filter, duration-bucket filter; sort by kJ / IF / TSS / duration / name.
- Expandable rows with full stats (IF, TSS, kJ, duration, zone), description, and a mini chart.
- Per-workout actions: **Select to ride**, **Delete** (move to trash), **Clone**, **Edit/Rename**,
  **Visit source URL**.
- All metrics are derived on the fly from `rawSegments` + current FTP (never stored).

### Workout builder
- From-scratch interactive editor: insert warmup, cooldown, steady (6 zone presets), intervals
  (repeated on/off), free-ride, and **text-event** cues.
- Visual editing: drag a segment's top edge (power), right edge (duration), or whole block (reorder).
- Vim-style keyboard editor (h/j/k/l nav, zone/insert hotkeys, undo/redo, copy/cut/paste of
  blocks via ZWO-on-clipboard).
- Snapshot-based undo/redo with grouping (one drag = one undo).
- Text events anchored to blocks so cues stay attached as durations change.
- Auto-derived live stats + zone classification; validation before save.

### Import / export
- **Import `.zwo`** (upload or clipboard paste).
- **Import `.fit`** (parse a ride/workout; canonical workout reconstructed losslessly if present).
- **Import via Chrome extension** from TrainerRoad / TrainerDay / WhatsOnZwift.
- **Import via pasted TrainerDay URL** (no extension needed).
- **Export `.zwo`** (serialize canonical → Zwift XML).
- **Export `.fit`** (ride history; embeds the canonical workout as chunked developer fields).

### Calendar planner & history
- Infinite-scroll week calendar (virtualized DOM recycling, **not** a month grid).
- Schedule a workout on a future date (drag-to-reschedule; persisted in `schedule.json`).
- Past/today cells show completed-ride history cards (read from `.fit` files on disk).
- Ride detail view: stat chips (Duration, Paused, Zone, Avg, NP, Work, IF, TSS, VI, EF, HR,
  Cadence), a **mean-maximal power curve**, and the full ride chart (planned vs actual).
- Footer 3 / 7 / 30-day rolling totals (duration, kJ, TSS) combining past actuals + future scheduled.
- Delete a ride (move `.fit` to trash).
- **No CTL/ATL/TSB / fitness-fatigue-form modeling exists** — only the windowed sums.

### Trainer & sensor connectivity (Web Bluetooth)
- Connect FTMS trainer (power/cadence/speed via Indoor Bike Data 0x2AD2; control via Control
  Point 0x2AD9 — requestControl + startOrResume + setTargetPower / setTargetResistance).
- Connect HR monitor (0x2A37) + one-shot battery read (0x2A19).
- Silent auto-reconnect of last-used devices on load; exponential-backoff reconnect on dropout.

### Settings & onboarding
- Settings modal: FTP (only physiological setting — no weight/units), sound on/off, theme
  (auto/light/dark), root data folder picker, connection-log viewer, environment/compatibility
  checks (Web Bluetooth available?, PWA installed?, browser/OS supported?).
- First-run welcome tour: 4 SVG-animated slides (splash, trainers, offline/PWA, workouts).
  Gated by PWA-installed + root-dir state (full tour on web/unconfigured; splash-only when configured).
- Theme bootstrap with anti-FOUC inline script.
- Service worker: network-first for navigations/code, cache-first+revalidate for other assets;
  precaches the shell + ~40 bundled workouts for full offline use.

---

## 3. User journeys that matter (ranked)

Each journey lists the modules involved (see doc 02 for the module map).

### J1 — Ride a structured workout *(the core loop)*
1. Open app → (first run) welcome tour → pick a data folder (defaults seeded).
2. Connect trainer (and optionally HR) via Web Bluetooth.
3. Open picker (`w` / click name) → search/filter → Select a workout.
4. Start (button / Space) **or** just start pedaling (auto-start) → 3-2-1 countdown.
5. Follow the profile: engine pushes ERG target each second; HUD + chart update live; beeps warn
   of interval changes; auto-pause/resume handle stops.
6. Finish (reach end or Stop) → `.fit` written to history → planner opens to the new ride detail.

*Modules:* `workout.js`, `workout-engine.js`, `ble-manager.js`, `workout-chart.js`, `beeper.js`,
`workout-metrics.js`, `fit-file.js`, `storage.js`, `workout-planner.js`.

### J2 — Import a workout
- **Extension:** on a trainer site, click the icon → `content.js`+`scrapers.js` scrape →
  `background.js` persists to IndexedDB → app opens, reads the flag, materializes the `.zwo` into
  the library, selects/loads it.
- **Paste URL / file:** picker → TrainerDay URL import, or upload `.zwo` / `.fit`.

*Modules:* `background.js`, `content.js`, `scrapers.js`, `storage.js`, `workout-picker.js`, `zwo.js`,
`fit-file.js`, `workout.js`.

### J3 — Build / edit a workout
Picker → Add workout (or Edit existing) → builder → insert/drag/keyboard-edit blocks + text
events → live stats → validate → Save (serializes to `.zwo` in the library; rename = trash old +
write new).

*Modules:* `workout-picker.js`, `workout-builder.js`, `builder-backend.js`, `workout-chart.js`,
`workout-metrics.js`, `zwo.js`, `storage.js`.

### J4 — Browse & manage the library
Open picker → search/filter/sort → expand for detail → Select / Delete / Clone / Edit / Visit.

*Modules:* `workout-picker.js`, `workout-metrics.js`, `workout-chart.js`, `storage.js`, `zwo.js`.

### J5 — Plan a training week & review history
Open planner (`c` / calendar button) → scroll the week calendar → schedule a workout on a future
day (or drag to reschedule) → on a past day, open a ride's detail (power curve + chart + stats) →
check 3/7/30-day totals → optionally start today's scheduled ride.

*Modules:* `workout-planner.js`, `planner-backend.js`, `planner-analysis.js`, `fit-file.js`,
`workout-chart.js`, `workout-metrics.js`, `storage.js`, `workout-library.js`.

### J6 — Connect / reconnect hardware
Click bike/HR connect → OS chooser → connect → status dots. Reload → silent auto-reconnect.
Dropout → backoff reconnect.

*Modules:* `ble-manager.js`, `workout.js`, `storage.js`.

### J7 — Configure & first-run onboarding
Welcome tour → set FTP / theme / sound / data folder; environment checks prompt when the folder
or Web Bluetooth is missing.

*Modules:* `welcome.js`, `settings.js`, `theme.js`, `theme-init.js`, `storage.js`, `workout-engine.js`.

---

## 4. Cross-cutting behaviors worth preserving in any rewrite

- **Lossless FIT round-trip:** the `.fit` writer embeds the full `CanonicalWorkout` JSON so a
  recorded ride can reproduce the exact authored workout. Keep this.
- **Folder-as-database:** workouts and history are plain files in a user-owned folder — portable,
  inspectable, no lock-in. This is a feature, not an accident, and maps *better* to native.
- **Resilience:** auto-start, auto-pause/resume, crash recovery (resume paused), and silent BLE
  reconnect are the behaviors that make it usable hands-free mid-ride. They live in the engine and
  BLE manager and must survive the migration intact.
- **Derived-not-stored metrics:** all IF/TSS/kJ/zone come from `rawSegments` + FTP at view time,
  so changing FTP instantly re-rates the whole library. Keep metrics pure.
