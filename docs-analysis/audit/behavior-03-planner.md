# Behavior Audit 03 — Planner (calendar / history)

Legacy: `docs/workout-planner.js` (~1605), `docs/planner-backend.js` (~379), `docs/planner-analysis.js` (~365).
New: `web/src/ui/PlannerView.svelte`, `web/src/core/planner-analysis.ts`, `web/src/core/chart.ts`, `web/src/ports/web/WebFileStore.ts`, `web/src/state/ui.svelte.ts`, `web/src/ui/App.svelte`.

Known-deferred (per PlannerView header comment, lines 13-21): drag-reschedule, deep-scroll row recycling, picker schedule-mode handoff, and the `?` hotkey overlay. These are marked GAP/PARTIAL with the deferred note.

## Keyboard handlers

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | `onKeyDown` global keydown dispatcher | workout-planner.js:1285, registered 1445-1456 | Master key router while planner open | App.svelte:64-66 explicitly suppresses ALL keys when `ui.activeOverlay !== 'none'` | **GAP** | The planner has NO per-overlay keymap. Every hotkey below (h/j/k/l, arrows, Enter, e, d/Delete) is unreachable. |
| 2 | `h` / ArrowLeft → moveSelection(-1) | workout-planner.js:1385-1389 | Move selected day left one | — | **GAP** | No keyboard selection in new code. |
| 3 | `l` / ArrowRight → moveSelection(1) | workout-planner.js:1390-1394 | Move selected day right | — | **GAP** | |
| 4 | `j` / ArrowDown → moveSelection(7) | workout-planner.js:1375-1379 | Move selection down a week | — | **GAP** | |
| 5 | `k` / ArrowUp → moveSelection(-7) | workout-planner.js:1380-1384 | Move selection up a week | — | **GAP** | |
| 6 | `Enter` (open detail / load scheduled / schedule) | workout-planner.js:1325-1346 | Open day detail; else load scheduled[0]; else (future) requestSchedule | — | **GAP** | No keyboard activation. |
| 7 | `e` (edit scheduled / schedule) | workout-planner.js:1348-1365 | Edit scheduled[0] via picker handoff; else requestSchedule on future day | — | **GAP** | |
| 8 | `d` / `Delete` (delete first item in cell) | workout-planner.js:1367-1373 | Confirm + delete first scheduled/history item of selected day | — | **GAP** | |
| 9 | `d` in detail mode → deleteCurrentDetail | workout-planner.js:1304-1308 | Delete shown ride to trash | — | **GAP** | Delete only reachable via the on-screen delete button (PlannerView.svelte:767). |
| 10 | `Delete` in detail mode → deleteCurrentDetail | workout-planner.js:1299-1303 | Same as above | — | **GAP** | |
| 11 | `Backspace` / `Escape` in detail mode → exitDetailMode | workout-planner.js:1309-1312 | Return from ride detail to calendar | PARTIAL: backdrop-click onClose exits detail (PlannerView.svelte:715-721); Escape goes through App.svelte:56 → ui.handleEscape() → ui.close() (ui.svelte.ts:43-51) | **PARTIAL** | Escape CLOSES THE WHOLE PLANNER instead of returning to calendar — `handleEscape` never consults `detail`. Backspace does nothing. See Gaps. |
| 12 | `Escape` (non-detail) is intentionally ignored to avoid closing planner | workout-planner.js:1316-1319 | Planner does NOT close on Esc | ui.svelte.ts:43-51 closes planner on Esc | **GAP** | Behavior inverted: legacy keeps planner open on Esc; new closes it. |
| 13 | `?` (and Shift+/) hold → show hotkey help overlay (keydown) | workout-planner.js:1275-1278, 1446-1454 | Hold `?` to reveal hotkey list, hide agg footer | — | **GAP** (deferred) | Footer hint text "Press ? for shortcuts" is still rendered (PlannerView.svelte:950) but inert; no `#plannerHotkeyList`. |
| 14 | `?` release (keyup) → hide hotkey help | workout-planner.js:1280-1283, 1457-1466 | Restore agg footer | — | **GAP** (deferred) | |

## DOM event listeners

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 15 | calendarBody `click` → onCellClick → setSelectedDate | workout-planner.js:1269-1273, 1444 | Click a day to select it | per-cell `onclick={() => selectDay(cell.key)}` PlannerView.svelte:827, 543-545 | **OK** | |
| 16 | history card `click` → openDetailView | workout-planner.js:315-318 | Open ride analysis detail | PlannerView.svelte:844 `onclick → openDetail(p)` (547-606) | **OK** | stopPropagation preserved (844). |
| 17 | scheduled card `click` → onScheduledLoadRequested(entry) | workout-planner.js:450-456 | Load/start the scheduled workout | — | **GAP** | Scheduled card div (PlannerView.svelte:865) has NO onclick to load the workout; only the edit/delete button is wired. Clicking a scheduled card does nothing. |
| 18 | scheduled card hover → suppress day hover (mouseenter/leave) | workout-planner.js:475-485 (and history 319-329) | Adds/removes `suppress-hover` class | — | **GAP** | Minor; cosmetic hover-suppression dropped for both card types. |
| 19 | scheduled card `dragstart` (set JSON payload) | workout-planner.js:457-471 | Begin drag-reschedule | — | **GAP** (deferred) | Drag-reschedule dropped. |
| 20 | scheduled card `dragend` (clear dragging class) | workout-planner.js:472-474 | End drag | — | **GAP** (deferred) | |
| 21 | day cell `dragover` → onDayDragOver | workout-planner.js:985-995, 1077 | Allow drop on future day, drop-hover class | — | **GAP** (deferred) | |
| 22 | day cell `dragleave` → onDayDragLeave | workout-planner.js:997-1000, 1078 | Remove drop-hover | — | **GAP** (deferred) | |
| 23 | day cell `drop` → onDayDrop → moveScheduledEntry | workout-planner.js:1002-1023, 1079 | Reschedule via drop | — | **GAP** (deferred) | |
| 24 | calendarBody `scroll` → onScroll → rAF → maybeRecycleRows | workout-planner.js:1260-1267, 1443 | Virtualized row recycling | — | **GAP** (deferred) | Fixed 16-week window; deep scroll stops (PlannerView.svelte:13-17). |
| 25 | scheduled edit button `click` (future) → onScheduledEditRequested | workout-planner.js:392-398 | Open picker in edit mode | — | **GAP** | New edit button always deletes (PlannerView.svelte:873-884); no edit-via-picker. See #28. |
| 26 | scheduled edit button `click` (past) → removeScheduledEntryInternal | workout-planner.js:384-387 | Delete past scheduled (trash icon) | PlannerView.svelte:877 `onclick → onDeleteScheduled(p)` (689-699) | **OK** | Past case matches (delete). |
| 27 | schedule footer button `click` → requestSchedule | workout-planner.js:1497-1504 | Schedule a workout on selected future day | PlannerView.svelte:783 `onclick → onScheduleDay()` (664-687) | **PARTIAL** | New version self-schedules the engine's current workout via a Dialog confirm; legacy opened the picker in schedule mode. Functional but different handoff (deferred). |
| 28 | scheduled edit button icon differs past vs future | workout-planner.js:380-398 | Pencil (future=edit) vs trash (past=delete) | PlannerView.svelte:873-884 always renders trash icon, always deletes | **PARTIAL** | Future scheduled entries can no longer be EDITED (re-pick workout); only deleted. |
| 29 | detail back button `click` → exitDetailMode | workout-planner.js:1473-1477; header back 564-565 | Return to calendar | PlannerView.svelte:747 `onclick={exitDetail}` (608-610) | **OK** | |
| 30 | detail delete button `click` → deleteCurrentDetail | workout-planner.js:1506-1510 | Delete shown ride to trash | PlannerView.svelte:767 `onclick → onDeleteDetail()` (701-713) | **OK** | |
| 31 | close button `click` → close() | workout-planner.js:1469-1471 | Close planner | PlannerView.svelte:796 `onclick={onClose}` (715-721) | **OK** | onClose exits detail first if open, else ui.close(). |
| 32 | overlay backdrop pointerdown/pointerup → close() | workout-planner.js:1479-1495 | Click backdrop to dismiss (press+release on backdrop) | OverlayModal.svelte:28-35 + PlannerView onClose | **OK** | Gesture preserved; onClose handles detail→calendar (PlannerView.svelte:716-720). |
| 33 | window `resize` → updateRowHeightVar | workout-planner.js:1467, 177-183 | Recompute `--planner-row-height` (24vh, min 140) | — | **GAP** | New code uses CSS for row sizing; no JS var. Charts are redrawn only on mount (use: actions), not on resize → see #40. |

## Functions (rendering / virtualization / state)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 34 | `buildWeekRow` | workout-planner.js:1025-1085 | Build one 7-day row w/ month label, today/selected classes, drag listeners | weeks `$derived.by` PlannerView.svelte:327-412 (+ template 817-906) | **OK** | Reactive cell model; drag listeners omitted (deferred). |
| 35 | `updateMonthBoundaries` | workout-planner.js:1087-1149 | month-top/left/bottom-boundary classes | PlannerView.svelte:384-409 | **OK** | Same firstDow/lastDow logic. |
| 36 | `renderInitialRows` | workout-planner.js:1151-1172 | Build 16-week window (-8..+7), attach history+scheduled | weeks derived (327-412) + per-cell `{#each historyMap…}` (836-901) | **OK** | History/scheduled looked up from preloaded maps instead of lazy per-cell. |
| 37 | `centerOnDate` / scroll today's week one row down | workout-planner.js:1180-1199 | scrollTop = (relativeRow-1) * measuredRowHeight | scrollToToday PlannerView.svelte:232-243 | **OK** | Explicitly matches legacy formula (uses first-row measured height). |
| 38 | `weekOffsetForDate` | workout-planner.js:1174-1178 | Map a date to week offset | (folded into weeks derivation / scrollToToday) | **OK** | Fixed window, no offset math needed beyond rowsBefore. |
| 39 | `recycleRows(direction)` | workout-planner.js:1201-1246 | Append/prepend row, drop opposite, fix scrollTop | — | **GAP** (deferred) | Deep-scroll recycling dropped. |
| 40 | `maybeRecycleRows` | workout-planner.js:1248-1258 | Trigger recycle near buffer edges | — | **GAP** (deferred) | |
| 41 | `measureRowHeight` / `updateRowHeightVar` | workout-planner.js:793-803, 177-183 | Measure/set row height px | scrollToToday measures first row (240-242) for scroll only | **PARTIAL** | Measurement used for scroll; no `--planner-row-height` var, no resize handling. |
| 42 | `setSelectedDate` | workout-planner.js:852-860 | Set selection, update label/agg/button/scroll | `selectDay` PlannerView.svelte:543-545 (label/agg/btn all `$derived`) | **OK** | Reactive; note it does NOT auto-scroll the cell into view (keyboard nav is gone, so moot). |
| 43 | `moveSelection` | workout-planner.js:862-866 | Selection +/- N days | — | **GAP** | Only used by keyboard nav (gone). |
| 44 | `ensureSelectionRendered` / `scrollCellIntoView` | workout-planner.js:823-850 | Rebuild window around off-screen selection; scroll into view | — | **GAP** | No keyboard nav → off-window selection unreachable; not ported. |
| 45 | `applySelectionStyles` | workout-planner.js:812-821 | Toggle `is-selected` | template class `is-selected` PlannerView.svelte:389 | **OK** | Reactive. |
| 46 | `maybeAttachHistory` | workout-planner.js:958-970 | Lazily load + render history card per cell | loadHistory eager pre-pass PlannerView.svelte:245-284; render 836-862 | **OK** | Eager (all days loaded on open) instead of lazy-per-cell. |
| 47 | `renderHistoryCard` | workout-planner.js:260-353 | Build history card (header, stat chips, mini chart) | template 836-862 + `historyChart` action 479-495 | **OK** | Stat-chip order/sep matches via cardStatParts (467-476). |
| 48 | `maybeAttachScheduled` | workout-planner.js:972-983 | Render scheduled cards per cell | loadSchedule pre-pass PlannerView.svelte:286-316; render 864-901 | **OK** | Eager. |
| 49 | `renderScheduledCard` | workout-planner.js:355-503 | Build scheduled card (tag, edit/delete btn, chart, drag) | template 864-901 + `scheduledChart` action 496-510 | **PARTIAL** | Card body OK; no load-on-click (#17), no drag (#19-20), edit always-delete (#25/28). |
| 50 | `openDetailView` | workout-planner.js:630-761 | Re-parse FIT, compute metrics/VI/EF/curve, populate detail view | `openDetail` PlannerView.svelte:547-606 | **OK** | Same metrics/pausedSec/VI/EF/curve math; re-reads FIT via listHistory. Guards on isPastOrToday in legacy; new relies on card only existing on past days. |
| 51 | `exitDetailMode` | workout-planner.js:550-566 | Tear down detail view, restore header/buttons | `exitDetail` PlannerView.svelte:608-610 (detail=null) | **OK** | Reactive header/buttons via detailMode derived. |
| 52 | `openSelectedDayDetail` | workout-planner.js:874-889 | Open detail for selected day's first ride | — | **GAP** | Only used by Enter key (gone). |
| 53 | `requestSchedule` (callback to host) | workout-planner.js:868-872 | Ask host to open picker schedule mode | onScheduleDay self-handles (664-687) | **PARTIAL** | Different handoff (deferred). |
| 54 | `applyScheduledEntry` (write schedule.json, re-render) | workout-planner.js:1551-1595 | Persist new/edited schedule entry, recompute metrics, re-render cell | onScheduleDay PlannerView.svelte:680-687 (loadSchedule re-pass) | **OK** (subset) | Add path covered; "edit existing entry" replacement path not exposed (no edit UI, #25). |
| 55 | `moveScheduledEntry` | workout-planner.js:223-258 | Move scheduled entry from->to date (drag) | — | **GAP** (deferred) | |
| 56 | `removeScheduledEntryInternal` | workout-planner.js:194-214 | Delete scheduled entry, re-render, recompute agg | onDeleteScheduled PlannerView.svelte:689-699 | **OK** | |
| 57 | `removeScheduledEntryByRef` / `removeScheduledByTitle` (public) | workout-planner.js:216-221, 1598-1603 | External delete-by-ref helpers | — | **GAP** | Public API for host (e.g. picker delete) not present; no external caller in new app. |
| 58 | `deleteFirstItemInCell` | workout-planner.js:568-628 | Confirm+delete first scheduled/history of a day (for `d` key) | — | **GAP** | Only used by `d` key (gone). |
| 59 | `deleteCurrentDetail` | workout-planner.js:505-548 | Confirm+move shown ride to trash, prune index, recompute | onDeleteDetail PlannerView.svelte:701-713 | **OK** | confirm via Dialog; reloads history. |
| 60 | `recomputeAgg` / `updateAggUi` | workout-planner.js:919-956 | 3/7/30-day sums into footer | `agg` $derived.by PlannerView.svelte:415-464; footer 953-957 | **OK** | Same window math (selected day + prior N-1), scheduled only counted if >= today. |
| 61 | `recomputeAggTotals` (backend) | planner-backend.js:312-377 | Sum history+future-scheduled metrics over windows | PlannerView.svelte:415-464 | **OK** | Faithful port. |
| 62 | `updateSelectedLabel` | workout-planner.js:805-810 | Set header date/title label | `selectedLabelText` $derived PlannerView.svelte:658-660; 756 | **OK** | |
| 63 | `updateScheduleButton` | workout-planner.js:891-905 | Hide schedule btn in detail / past day | `showScheduleBtn` $derived PlannerView.svelte:661; {#if} 777 | **OK** | |
| 64 | `rerenderCharts` (resize/redraw all charts) | workout-planner.js:762-791 | Redraw mini + detail charts on resize | — | **GAP** | Charts drawn once via use: actions on mount; no resize redraw (`_plannerChartData` cache not ported). |
| 65 | `open()` lifecycle | workout-planner.js:1397-1430 | Reset, load index/schedule, render, center | `onOpen` PlannerView.svelte:218-230 (via $effect 207-216) | **OK** | |
| 66 | `close()` lifecycle | workout-planner.js:1432-1441 | Exit detail, hide overlay | onClose (715-721) + OverlayModal {#if open} | **OK** | |
| 67 | `openDetailByFile` (public, open detail by filename) | workout-planner.js:1520-1536 | Host entry point to jump to a ride detail | — | **GAP** | Public API (used by legacy "view last ride") not exposed. |
| 68 | `hideModal` / `showModal` (picker handoff) | workout-planner.js:1537-1550 | Toggle planner visibility for picker schedule handoff | — | **GAP** (deferred) | Part of the dropped picker schedule-mode handoff. |
| 69 | isPastDate / isPastOrTodayDate | workout-planner.js:907-917 | Date guards | PlannerView.svelte:196-201 | **OK** | |

## Backend — history index + schedule.json (planner-backend.js)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 70 | `dateKeyFromHandleName` | planner-backend.js:45-66 | Parse FIT filename → local day key | PlannerView.svelte:115-126 | **OK** | Verbatim. |
| 71 | `ensureHistoryIndex` (list .fit, sort newest-first) | planner-backend.js:92-119 | Build dateKey→handles index | WebFileStore.listHistory PlannerView.svelte:245-284 | **OK** | Sort newest-first preserved (PlannerView.svelte:282). |
| 72 | `loadHistoryPreview` (parse FIT, compute metrics, build power segments) | planner-backend.js:163-296 | Per-day preview objects | loadHistory PlannerView.svelte:245-284 | **PARTIAL** | Metrics/segments/zone parity OK. |
| 73 | Stats cache (loadWorkoutStatsCache / save, version 30) | planner-backend.js:22, 77-90, 251-290 | Persist computed metrics to avoid re-parse | — | **GAP** | No stats cache: every planner open re-parses ALL FIT files (and openDetail re-parses again). Perf regression on large histories. |
| 74 | `loadScheduleIntoMap` (load schedule.json, attach workout + metrics) | planner-backend.js:121-150 | Build dateKey→scheduled previews | loadSchedule PlannerView.svelte:286-316 | **OK** | Joins schedule against listWorkouts by title; computes scheduled metrics. |
| 75 | `ensureScheduleLoaded` / `persistSchedule` | planner-backend.js:152-161 | Cache + write schedule.json | fileStore.loadSchedule/saveSchedule (WebFileStore.ts:306-334) | **OK** | |
| 76 | `resetHistoryIndex` | planner-backend.js:68-75 | Clear caches on open | onOpen resets maps (PlannerView.svelte:218-226) | **OK** | |
| 77 | `moveHistoryFileToTrash` (perms, timestamped copy, removeEntry) | planner-analysis.js:305-365 | Move FIT to trash w/ permission checks + collision-safe name | WebFileStore.deleteHistoryToTrash (337-363) | **PARTIAL** | Copy+stamp+removeEntry preserved; but the explicit `ensureDirPermission` checks + user-facing alerts (planner-analysis.js:322-337, 349-351) are NOT ported — failures just return false silently. |

## Analysis — power curve / segments / detail render (planner-analysis.js)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 78 | `computeHrCadStats` | planner-analysis.js:5-31 | avg/max HR + cadence | planner-analysis.ts:31-57 | **OK** | Verbatim. |
| 79 | `buildPowerSegments` (5s buckets, median, slope-merge) | planner-analysis.js:37-122 | Recorded-power step intervals for mini chart | planner-analysis.ts:59-143 | **OK** | Verbatim incl. tolerance bands. |
| 80 | `powerMaxFromIntervals` | planner-analysis.js:124-130 | Max abs power across intervals | planner-analysis.ts:145-148 | **OK** | |
| 81 | `buildPowerCurve` (prefix-sum sliding window, dyn durations) | planner-analysis.js:271-303 | Power-duration curve points | planner-analysis.ts:150-185 | **OK** | Verbatim. |
| 82 | `POWER_CURVE_DURS` | workout-planner.js:30-33 | Seed durations | planner-analysis.ts:187-190 | **OK** | |
| 83 | `formatDuration` (min:sec) | planner-analysis.js:33-35 | Format | formatDurationMinSec from metrics (PlannerView.svelte:33) | **OK** | |
| 84 | `STAT_TOOLTIPS` / `getStatTooltip` | planner-analysis.js:132-171 | Stat chip tooltip text | STAT_TOOLTIPS PlannerView.svelte:613-622 | **OK** | Same copy, inlined. |
| 85 | `renderDetailStats` (date header + stat chips) | planner-analysis.js:173-235 | Build detail stat row | detailStats $derived + template PlannerView.svelte:623-646, 911-925 | **OK** | Same chip order/labels/tooltips. |
| 86 | `renderPowerCurveDetail` | planner-analysis.js:237-248 | Draw power-curve SVG | powerCurveChart action PlannerView.svelte:511-524 + drawPowerCurveChart (chart.ts:1464) | **OK** | |
| 87 | `renderDetailChart` (planned vs actual, tooltip) | planner-analysis.js:250-269 | Draw detail workout chart | detailChart action PlannerView.svelte:525-540 + drawWorkoutChart (chart.ts:257) | **PARTIAL** | Chart drawn; `detailChartTooltip` element exists (PlannerView.svelte:943) and is passed by legacy but the new action does NOT pass `tooltipEl`/`panel` to drawWorkoutChart (525-538) → hover tooltip on the detail chart likely inert. |
| 88 | `drawMiniHistoryChart` (day card mini chart) | workout-chart.js (via import) | Mini ride chart | chart.ts:1327, used by historyChart/scheduledChart actions | **OK** | |

## Gaps

### Critical / High severity

- **#1–#12, #43, #44, #52, #58 — No planner keyboard support at all.** App.svelte:64-66 suppresses every key while any overlay is open, and PlannerView has no `<svelte:window onkeydown>`. The entire legacy keymap (h/j/k/l + arrows for day navigation, Enter to open/load/schedule, `e` to edit, `d`/`Delete` to delete) is GAP. (HIGH — core planner UX.)

- **#11/#12 — Escape in the planner is inverted.** Legacy explicitly ignores Escape so it never closes the planner (workout-planner.js:1316-1319) and only Backspace/Escape *inside the detail view* returns to the calendar (1309-1312). New code: App.svelte:56 → `ui.handleEscape()` (ui.svelte.ts:43-51) calls `ui.close()` unconditionally without checking `detail`. Result: (a) Escape closes the whole planner from the calendar (legacy kept it open); (b) Escape from the ride detail view closes the entire planner instead of returning to the calendar. The detail-back path only works via the on-screen Back button or a backdrop click. (HIGH — wrong/confusing dismissal.)

- **#17 — Scheduled cards are not clickable to start the workout.** Legacy fires `onScheduledLoadRequested(entry)` on click (workout-planner.js:450-456); the new scheduled-card div (PlannerView.svelte:865) has no `onclick`. A user can no longer launch a scheduled ride from the calendar. (HIGH — feature loss.)

- **#73 — No stats cache.** Legacy persists computed FIT metrics (STATS_CACHE_VERSION 30, planner-backend.js). New `loadHistory` (PlannerView.svelte:245-284) re-parses every `.fit` on each open, and `openDetail` (547-606) re-parses again. With a large history this is a real performance/jank regression. (HIGH on big libraries, otherwise MEDIUM.)

### Medium severity

- **#25/#28/#53 — Future scheduled entries can no longer be edited** (re-pick a different workout). New edit button always renders the trash icon and always deletes (PlannerView.svelte:873-884). Legacy showed a pencil for future entries → `onScheduledEditRequested` → picker (workout-planner.js:388-398). Tied to the deferred picker schedule-mode handoff. (MEDIUM.)

- **#33/#41/#64 — No chart resize redraw.** `rerenderCharts`/`updateRowHeightVar`/window `resize` (workout-planner.js:762-803, 1467) are gone; mini + detail charts are drawn once via `use:` actions on mount (PlannerView.svelte:479-540) and never re-rendered, and the `_plannerChartData` cache is not ported. Resizing the window leaves charts at their initial dimensions. (MEDIUM — cosmetic but visible.)

- **#87 — Detail chart hover tooltip likely inert.** Legacy passes `panel` + `tooltipEl` into `drawWorkoutChart` (planner-analysis.js:250-269). The new `detailChart` action (PlannerView.svelte:525-538) omits both, even though `#plannerDetailChartTooltip` is rendered (943). Hover-to-inspect on the detail chart probably doesn't work. (MEDIUM.)

- **#77 — Trash move drops permission checks + alerts.** `deleteHistoryToTrash` (WebFileStore.ts:337-363) ports the copy/stamp/removeEntry but not `ensureDirPermission` nor the user-facing alerts (planner-analysis.js:322-337, 349-351). Failures (no folder / no permission) now return false silently. (MEDIUM.)

### Low severity / deferred

- **#13/#14 — `?` hotkey help overlay** dropped (deferred). Footer still says "Press ? for shortcuts" (PlannerView.svelte:950) but nothing happens; the prompt text is misleading. (LOW.)
- **#19–#24, #39, #40, #55, #68 — Drag-reschedule + deep-scroll row recycling** dropped (deferred). Fixed 16-week window; cannot reschedule by drag, and scrolling far past the window dead-ends. (LOW–MEDIUM depending on usage.)
- **#18 — `suppress-hover` on card hover** dropped (cosmetic). (LOW.)
- **#57/#67 — Public host APIs** `removeScheduledEntryByRef`/`removeScheduledByTitle`/`openDetailByFile` not ported; no current new-app caller. (LOW.)
