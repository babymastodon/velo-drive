# Verified 04 — Planner / History + Import

Read-only verification of the **Planner / History** (J-PLAN-01…34) and **Import**
(J-IMP-01…18) journey rows against the new Svelte app under `web/src`, reviewed
against the legacy modules `docs/workout-planner.js`, `docs/planner-backend.js`,
`docs/planner-analysis.js`, `docs/scrapers.js`, and `docs/workout.js`.

New-code surfaces:
- `web/src/ui/PlannerView.svelte` (the whole planner overlay + ride detail)
- `web/src/core/planner-analysis.ts` (power segments / power curve / HR-cad stats)
- `web/src/core/chart.ts` (`drawMiniHistoryChart`, `drawPowerCurveChart`, `drawWorkoutChart`)
- `web/src/ports/web/WebFileStore.ts` (history preview + stats cache, schedule.json, trash moves)
- `web/src/core/scrapers.ts` (TrainerDay URL importer only)
- `web/src/ui/PickerView.svelte` (TrainerDay-URL import + .zwo/.fit upload, both in builder)
- `web/src/state/ui.svelte.ts`, `web/src/ui/App.svelte` (overlay open/close, Escape routing, onWorkoutEnded)

Legend: **OK** faithful · **PARTIAL** present but reduced (incl. known-deferred) ·
**GAP** absent · **WRONG** present but diverges behaviorally.

---

## Planner / History

| ID | New-app impl (file:line) | Status | Note |
|---|---|---|---|
| J-PLAN-01 | PlannerView `onOpen` 208-220 → today selected + `scrollToToday()` 222-233 | OK | today selected & centered one row down; same as legacy `centerOnDate`. |
| J-PLAN-02 | App `openPlanner` 296-301 guards `workoutRunning/Paused/Starting` | OK | calendar no-op while running (BottomNav button + `c` key both go through this). |
| J-PLAN-03 | PlannerView `weeks` 300-385 renders fixed 16-week window; `bind:this` body | PARTIAL | **Known-deferred (deep-scroll recycle).** Renders the legacy initial 16-week window only; scroll stops at the ends instead of recycling rows (documented at top of PlannerView). Keyboard selection auto-scroll is *also* dropped (see J-PLAN-04). |
| J-PLAN-04 | `selectDay` 535-537 sets `selectedDate`; cell `onclick` 999 | PARTIAL | Click selects + updates label/agg/schedule-btn. But **no scroll-into-view on selection** — legacy `setSelectedDate`→`scrollCellIntoView`/`ensureSelectionRendered` (workout-planner.js 852-860) scrolls the selected day into view and rebuilds the window if it fell outside; keyboard nav past the rendered window selects an off-screen day with no scroll. |
| J-PLAN-05 | `weeks` builds `is-today`/`is-selected` classes 360-362 | OK | |
| J-PLAN-06 | `handlePlannerKey` 841-856 (j/k ±7, h/l ±1, arrows) | OK | guarded on editable target + meta/ctrl/alt; matches legacy ±7/±1. |
| J-PLAN-07 | `handlePlannerKey` Enter 796-813 | OK | history→detail / scheduled→load / future-empty→schedule cascade matches legacy. |
| J-PLAN-08 | `handlePlannerKey` `e` 815-824 | OK | edit scheduled[0] or schedule on non-past empty; no-op on past empty. |
| J-PLAN-09 | `handlePlannerKey` d/Delete 826-839 | OK | scheduled[0] first else history[0]→trash, both confirmed. |
| J-PLAN-10 | `handlePlannerKey` escape 790 returns `false`; App 184-196 | **WRONG** | Calendar Escape returns false → App falls through to `ui.handleEscape()` → `close()`. **Legacy deliberately NO-OPs Escape on the calendar and never closes the planner** (workout-planner.js 1316-1319, J-KEY-14). New app closes the whole planner on calendar Escape. |
| J-PLAN-11 | — | **GAP** | **Known-deferred (`?` overlay).** No `?`-held hotkey list / aggregate-hide. Footer still prints the static "Press ? for shortcuts" hint (PlannerView 1136) but `?` does nothing. |
| J-PLAN-12 | `onScheduleDay` 656-679; `fileStore.saveSchedule` | PARTIAL | Schedules the **engine's currently-selected** workout via a confirm Dialog and writes schedule.json directly — there is no picker schedule-mode handoff (documented simplification). User cannot pick an arbitrary library workout for the day; only the one already loaded on the HUD. |
| J-PLAN-13 | `showScheduleBtn` 653 (`!isPastDate`) | OK | hidden on past dates. |
| J-PLAN-14 | — | **GAP** | **Known-deferred (drag-reschedule).** No dragstart/dragover/drop; legacy `moveScheduledEntry` (457-471, 985-1023) dropped. |
| J-PLAN-15 | — | **GAP** | Drag past-date rejection moot — drag itself dropped (see J-PLAN-14). |
| J-PLAN-16 | `isPastDate`/`isPastOrTodayDate` 186-191 used in schedule/enter/edit guards | OK | non-drag schedule-add guards present and match the legacy isPast vs isPastOrToday split. |
| J-PLAN-17 | scheduled card `onclick` 1045 → `onLoadScheduled` (only `!p.missing`) | OK | |
| J-PLAN-18 | scheduled `planner-scheduled-edit-btn` 1050-1070 (future=pencil edit, past=trash) | OK | stopPropagation present. |
| J-PLAN-19 | `loadHistory` 235-256 + `historyChart` action 467-481; cards 1008-1034 | OK | All previews loaded eagerly on open (no per-cell lazy attach), keyed by file day; chart drawn via `drawMiniHistoryChart`. |
| J-PLAN-20 | `openDetail` 539-598 re-reads FIT via `listHistory`, builds stats/curve/trace | OK | mirrors legacy `openDetailView`; same duration/paused/NP/IF/TSS/VI/EF math. |
| J-PLAN-21 | `detailStats` 615-638; `buildPowerCurve` + `POWER_CURVE_DURS` (planner-analysis.ts 150-190) | OK | NP/IF/TSS/VI/EF/HR/cadence + power curve 1s→8h; curve math ported verbatim. |
| J-PLAN-22 | `drawPowerCurveChart` chart.ts 1799+ | PARTIAL | Curve path/grid/FTP line/1h marker drawn, **but the hover dot + label + mouse listeners are dropped** (chart.ts 1795-1798 comment; legacy workout-chart.js 663-701 binary-search interpolated hover). No power-curve hover readout. |
| J-PLAN-23 | `handlePlannerKey` detail branch 776-787 | OK | d/Delete trash, Backspace/Esc exit detail. |
| J-PLAN-24 | `openDetail` reached only from past/today history cards; `isPastOrTodayDate` exists | OK (de facto) | Legacy `openDetailView` early-returns on a future date (workout-planner.js 631). New `openDetail` has **no explicit future guard**, but future days never carry history cards so it is unreachable; behaviorally equivalent. |
| J-PLAN-25 | `agg` 388-437 (scheduled `if (start < todayMs) return`) | OK | 3/7/30 rolling; scheduled counted today-forward only; matches planner-backend.js `recomputeAggTotals`. Aggregates are computed over the FULL history/schedule (eager load) rather than only attached cells — strictly more complete than legacy's lazy version. |
| J-PLAN-26 | footer 1138-1144; agg right column | PARTIAL | Aggregates always shown. The "hidden when hotkeys shown" toggle is moot because the `?` hotkey overlay is dropped (J-PLAN-11). |
| J-PLAN-27 | `plannerSelectedDateLabel` 928-930; `selectedLabelText` 650 | OK | aria-live label; shows workout title in detail mode. |
| J-PLAN-28 | close btn 964-973 `onClose`; back btn 913-925 `exitDetail` | OK | Back pops detail; close closes planner (onClose pops detail first if open). |
| J-PLAN-29 | OverlayModal backdrop close (planner-mode) | OK | handled by `OverlayModal` `onClose`; same pointerdown+up-on-backdrop pattern. |
| J-PLAN-30 | empty cells render no card; `has-history` only when items present 1002 | OK | |
| J-PLAN-31 | `onDeleteDetail` 693-706 → `deleteHistoryToTrash` | PARTIAL | Confirm + trash + cache invalidate + reload present. **But every failure path is silent** (`deleteHistoryToTrash` only console.errors and returns false; WebFileStore.ts 643-670). Legacy `moveHistoryFileToTrash` (planner-analysis.js 309-363) alerts on no-history-folder / no-trash-folder / src-permission-revoked / trash-permission-revoked / move-failure (J-ERR-07…11). All five user-facing alerts are dropped. Also the confirm text differs: new "Move this ride file to the trash folder?" vs legacy `Move workout "…" to the trash folder?`. |
| J-PLAN-32 | `onDeleteScheduled` 681-691 | PARTIAL | Confirm wording differs: new `Remove the scheduled workout "…"?` vs legacy `Delete scheduled workout "…" on {date}?` (no date in new copy). Behavior OK. |
| J-PLAN-33 | `onDeleteFirstHistory` 865-875 (cell d/Delete on history) | PARTIAL | Same silent-failure issue as J-PLAN-31 (no alerts from `deleteHistoryToTrash`). Confirm copy matches legacy here. |
| J-PLAN-34 | App `onWorkoutEnded` 43-46 → `ui.openPlannerForRide`; ui 65-69 | **WRONG / GAP** | Two legacy behaviors missing: (1) the finished workout's **scheduled entry for today is never removed** — legacy calls `planner.removeScheduledByTitle(dateKey, title)` (workout.js 1377-1378). (2) the saved **ride detail is never auto-opened** — `ui.pendingHistoryFile` is set (ui.svelte.ts 63-68) but **no code reads it** (PlannerView never consumes it); legacy calls `planner.openDetailByFile(info.fileName, date)` (workout.js 1383-1389). The planner just opens to today's calendar. |

---

## Import

| ID | New-app impl (file:line) | Status | Note |
|---|---|---|---|
| J-IMP-01 | — | **GAP** | **No browser-extension scrape pipeline.** `background.js`/`content.js` and the TR/TD/WhatsOnZwift `VD_SCRAPE_WORKOUT`/`RESULT` host-check flow have no equivalent in `web/src`. (The copies under `web/legacy*` are the old app, not the Svelte build.) |
| J-IMP-02 | — | **GAP** | **Known-deferred (scrape-on-focus).** No `window` focus listener / `handleLastScrapedWorkout` equivalent (legacy workout.js 1786-1792, 1122-1221). |
| J-IMP-03 | — | **GAP** | Concurrency guard moot — no scrape-on-focus path exists. |
| J-IMP-04 | — | **GAP** | "Failed to import workout" alert path absent (no scrape pipeline). |
| J-IMP-05 | — | **GAP** | "Failed to save imported workout" alert path absent. |
| J-IMP-06 | — | **GAP** | Partial-success "imported but picker won't open" alert path absent. |
| J-IMP-07 | — | **GAP** | Partial-success "imported but engine load failed" alert path absent. |
| J-IMP-08 | — | **GAP** | Unexpected-scrape-failure alert path absent. |
| J-IMP-09 | — | **GAP** | "Failed to clear scrape flag" alert path absent (no flag exists). |
| J-IMP-10 | — | **GAP** | Extension "open VeloDrive anyway?" confirm absent (content.js:172 has no port). |
| J-IMP-11 | PickerView `onImportTrainerDay` 513-526 → `parseTrainerDayUrl` | OK | prompt → fetch bySlug → load into builder. Same UX as legacy (in builder, "Import TrainerDay" button 953-966). |
| J-IMP-12 | scrapers.ts `importTrainerDayFromPathAndSource` 125-187 | OK | All status-specific messages ported verbatim (404 / 401-403 / 429 / 5xx / CORS / offline / invalid-JSON / generic). Load-bearing copy preserved. |
| J-IMP-13 | PickerView `onUploadFileChange` 536-562 (.zwo/.fit, branch by ext) | OK | FIT→`parseFitFile`, else ZWO; `normalizeUploadedWorkout` 566-583 ports title/source/description defaults. Hidden file input accept `.zwo,.fit` (972). |
| J-IMP-14 | PickerView 557-559 → `dialogs.alert('Unable to load workout file.')` | OK | Rejects null/empty/no-rawSegments. Slightly stricter than legacy (legacy 339 accepts an *empty* rawSegments array; new also rejects `!length`) — matches the journey note ("invalid/empty/no rawSegments"). |
| J-IMP-15 | scrapers.ts 141-144 (CORS message) | PARTIAL | The TrainerDay CORS message is ported. But the legacy J-IMP-15 row is the **TrainerRoad** page-scrape CORS message (scrapers.js 308-312) — that scraper (`parseTrainerRoadPage`) is **not ported** (scrapers.ts header comment: "TrainerRoad / WhatsOnZwift page scrapers … are not used by the re-hosted picker"). So the TR-specific structured CORS message is GAP; only the TrainerDay analogue exists. |
| J-IMP-16 | scrapers.ts 146-147 (offline message) | PARTIAL | TrainerDay offline message ported; TrainerRoad offline message (scrapers.js 315-319) not ported (no TR scraper). |
| J-IMP-17 | — | **GAP** | TrainerRoad "courseData empty → doesn't contain interval data" (scrapers.js 330) absent — no TR scraper. The TrainerDay analogue ("no intervals VeloDrive can use", scrapers.ts 171-176) exists but is a different code path/message. |
| J-IMP-18 | — | **GAP** | Extension host-check / options-page redirect (background.js 44-132) — no extension in new app. |

---

## Gaps & defects

Severity: **HIGH** = user-visible behavior loss or wrong outcome · **MED** = degraded
but recoverable · **LOW** = cosmetic/copy.

### Defects (WRONG — diverges from legacy)

1. **[HIGH] J-PLAN-10 — Calendar Escape closes the planner.**
   `handlePlannerKey` returns `false` for Escape on the calendar (PlannerView.svelte:790),
   so `App.svelte`:192 falls back to `ui.handleEscape()` → `close()`. Legacy
   deliberately swallows Escape on the calendar and **never closes** the planner
   from there (workout-planner.js:1316-1319; cross-ref J-KEY-14). New app closes
   the whole overlay — a real behavioral regression.

2. **[HIGH] J-PLAN-34 / J-RIDE-26 — Post-ride: scheduled entry not removed + detail not auto-opened.**
   `App.svelte` `onWorkoutEnded` (43-46) only calls `ui.openPlannerForRide`. Missing
   vs legacy (workout.js:1368-1390):
   - the just-finished workout's **today scheduled entry is never removed**
     (`removeScheduledByTitle` has no port) → a completed scheduled ride stays on
     the calendar.
   - the saved **ride detail never auto-opens**: `ui.pendingHistoryFile` is written
     (ui.svelte.ts:63-68) but **no component reads it** (dead state) — PlannerView
     has no consumer. Planner opens to the bare calendar instead of the ride.

### Reductions (PARTIAL / GAP)

3. **[HIGH] Import — entire extension/scrape pipeline absent (J-IMP-01…10, 15-18).**
   No `background.js`/`content.js` port, no scrape-on-focus, no TrainerRoad or
   WhatsOnZwift page scraper, and none of the 8 partial-failure/error alerts
   (J-IMP-04…10) or the TR-specific CORS/offline/empty-data messages (J-IMP-15…17).
   J-IMP-02 (scrape-on-focus) and J-IMP-18 (host-check) are the known-deferred
   extension items; the rest fall out of dropping the extension entirely. Only
   TrainerDay-URL import (J-IMP-11/12) and .zwo/.fit upload (J-IMP-13/14) survive,
   and both are faithful.

4. **[MED] J-PLAN-31 / J-PLAN-33 / (J-ERR-07…11) — Trash-move failures are silent.**
   `WebFileStore.deleteHistoryToTrash` (643-670) only `console.error`s and returns
   false. Legacy `moveHistoryFileToTrash` (planner-analysis.js:309-363) surfaces
   five distinct user alerts (no history folder / no trash folder / src-perm
   revoked / trash-perm revoked / move failure). All dropped — a user whose
   permission lapsed sees the delete silently no-op.

5. **[MED] J-PLAN-04 — No scroll-into-view / window-rebuild on selection.**
   `selectDay`/`moveSelection` set `selectedDate` but never scroll. Legacy
   `setSelectedDate`→`scrollCellIntoView`/`ensureSelectionRendered`
   (workout-planner.js:852-860, 823-837) scrolls the selected day into view and
   rebuilds the 16-week window if the selection fell outside it. With the fixed
   window (J-PLAN-03), keyboard-navigating beyond ~7 weeks selects an off-screen,
   non-rendered day with no visual feedback and no auto-scroll.

6. **[MED] J-PLAN-22 — Power-curve hover dropped.** Curve renders but the
   binary-search hover dot + W/duration label are gone (chart.ts:1795-1798 vs
   legacy workout-chart.js:663-701).

7. **[MED] J-PLAN-12 — Schedule handoff reduced.** Can only schedule the workout
   currently loaded on the HUD (a confirm Dialog), not an arbitrary library
   workout via the picker schedule-mode. Documented simplification.

8. **[LOW] J-PLAN-03 / J-PLAN-11 / J-PLAN-14-15 — Known-deferred:** deep-scroll
   row recycling, the `?`-held hotkey overlay, and drag-reschedule (+ its past-date
   rejection) are all intentionally dropped per the PlannerView header comment.

9. **[LOW] J-PLAN-31 / J-PLAN-32 — Confirm copy drift.** Delete-detail uses
   "Move this ride file to the trash folder?" (loses the workout name); delete-
   scheduled uses "Remove the scheduled workout …?" (loses the date). Cosmetic.

### Faithful (no action)

Calendar open/center, today/selected highlighting, nav keymap (j/k/h/l/arrows),
Enter cascade, e/d cell actions, history & scheduled card rendering + mini-charts,
ride-detail stats (NP/IF/TSS/VI/EF/HR/cadence) and curve math, 3/7/30 aggregates
(eagerly complete), the persisted FIT stats cache (`STATS_CACHE_VERSION = 30`,
keyed by file name with pruning), schedule.json read/write, TrainerDay-URL import
with full status-specific error copy, and .zwo/.fit upload — all match legacy.
