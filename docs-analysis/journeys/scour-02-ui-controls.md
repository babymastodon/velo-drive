# Scour 02 — UI Controls / Interaction Modes (LEGACY VeloDrive)

Read-only enumeration of **every** interactive control, keyboard shortcut, and
pointer gesture in the legacy app at `docs/`, with the exact effect and the
context/state guard that governs when it is active vs. suppressed/disabled.

DOM ids/markup come from `docs/index.html`. Handlers come from `docs/workout.js`
(HUD + global keys + nav/playback), `docs/workout-picker.js` (library/schedule
overlay), `docs/workout-planner.js` (calendar overlay), `docs/workout-builder.js`
(workout editor keymap + chart drag), `docs/workout-chart.js` (chart hover/render),
`docs/settings.js` (settings overlay), `docs/welcome.js` (first-run tour).

Key architectural facts to keep in mind:
- The **main HUD chart (`#chartSvg`) is hover/read-only** — no click-to-seek, no
  scrub, no drag, no keyboard. All HUD interactivity lives in `workout.js`.
- The **builder is NOT a true vim editor.** It is a custom keymap with one modal
  split: *block selected* vs. *insertion-cursor between blocks* (no insert/normal/
  visual modes, no `gg`/`b`/`w`/`0` motions, no `.` repeat, no numeric counts;
  `Shift` is the ×5 "big step" modifier; `g`→start, `$`→end are the only vim-doubles).
- **Drag-handle hitboxes are built in `workout-chart.js` but driven by
  `workout-builder.js`** (the pointerdown→move→up state machine).
- **Modal stacking:** `isAnyModalOpen()` (picker ∥ settings ∥ planner) suppresses
  HUD global keys; `welcome-active` suppresses everything.

---

## 1. HUD / main screen — buttons & inputs (`workout.js` + `index.html`)

| Control / interaction | Where (view) | What it does | Context/guard (active when…) | Legacy code (file:line) |
|---|---|---|---|---|
| Stat cards (`.stat-card` Power / Interval Time / Heart Rate / Target Power / Workout Time / Cadence) | HUD top panel | **Display-only.** No click handler; font auto-sized to fit on resize. | Always rendered; not interactive | index.html:117-149; workout.js:578-597 |
| Bike connect button (`#bikeConnectBtn`) | HUD bottom-nav left | Opens Web-Bluetooth picker to pair the trainer (`BleManager.connectBikeViaPicker`); status dot reflects state | If no Web BT support → alerts + opens Settings instead | index.html:208-220; workout.js:1525-1544 |
| HRM connect button (`#hrConnectBtn`) | HUD bottom-nav left | Opens Web-Bluetooth picker to pair HR strap (`connectHrViaPicker`); shows battery label | If no Web BT support → alerts + opens Settings | index.html:223-236; workout.js:1546-1565 |
| Settings button (`#settingsBtn`, "Settings (S)") | HUD bottom-nav left | Opens settings overlay (`openSettings`) | Always | index.html:239-245; settings.js:530-534 |
| Calendar button (`#calendarBtn`, "Open calendar (C)") | HUD bottom-nav left | Opens the planner/calendar overlay (`planner.open`) | **Suppressed while a workout is active** (running/paused/starting); button hidden during active workout | index.html:247-257; workout.js:1615-1625; visibility 933-937 |
| Workout-name label (`#workoutNameLabel`, "Select a workout (W)") | HUD bottom-nav right | Click → opens picker focused on current workout (`openPickerWithGuard`) | **Alerts and aborts if a workout is running**; also guarded by root-dir-configured check | index.html:307-309; workout.js:1508-1520 |
| Center workout title (`#workoutTitleCenter`) | HUD center (during run) | **Display-only** (shows running workout title + tooltip); only the `title` attr is set | Shown only while workout running/starting | index.html:260-269; workout.js:521-570, 1521-1523 |
| ERG/Resistance mode toggle (`#modeToggle`, two `.mode-toggle-button[data-mode]`) | HUD right (free-ride) | Click switches free-ride control mode ERG↔Resistance (`engine.setFreeRideMode`) | Only shown when workout active **and** `isFreeRideActive`; no-op if clicking already-active mode | index.html:273-289; workout.js:1567-1580; visibility 957-967 |
| Manual `−` / `+` buttons (`#manualControls .control-btn[data-delta=±10]`) | HUD right (free-ride) | Adjust manual ERG target (±10 W) or resistance (±10 %) | Only when workout active **and** `isFreeRideActive`; routes to ERG vs resistance by `freeRideMode` | index.html:293-304; workout.js:1582-1599 |
| Manual value input (`#manualInput`, number) | HUD right (free-ride) | Type a target; commits on **Enter** (then blur) or on **blur** (`handleManualInputSave`) | Only commits when workout active + free-ride; ERG clamps 50…2.5×FTP, resistance 0…100 | index.html:296-302; workout.js:1601-1613, 996-1043 |
| Start button (`#startBtn`, "Start workout (Space)") | HUD right | `engine.startWorkout()` (begins/resumes) | Visible only when a workout is selected and not running | index.html:312-320; workout.js:1627-1631; visibility 939-942 |
| Resume/play button (`#playBtn`) | HUD right | `engine.startWorkout()` (resume) | Visible only while **paused** | index.html:323-327; workout.js:1633-1637; visibility 946-949 |
| Pause button (`#pauseBtn`) | HUD right | `engine.startWorkout()` (the engine toggles → pauses) | Visible only while **running & not paused** | index.html:330-334; workout.js:1639-1643; visibility 950-951 |
| Stop button (`#stopBtn`, "End workout") | HUD right | `confirm("End current workout and save it?")` then `engine.endWorkout()` | Visible only while running (running ∥ paused) | index.html:337-341; workout.js:1645-1651; visibility 944-946 |
| Chart empty overlay (`#chartEmptyOverlay` / connect arrow) | HUD chart | **Display-only** "Connect your bike"; JS only flips the arrow L/R | Shown when no device/no workout; no click handler | index.html:156-201; toggled workout.js:847-869 |

---

## 2. HUD global keyboard shortcuts (`workout.js` `document` keydown, :1653)

All suppressed if welcome overlay active, if any meta/ctrl/alt held, and (except
Escape/Space special-casing) if focus is in INPUT/TEXTAREA/SELECT or a modal is open.

| Key | Where | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|---|
| **Space** | HUD | `engine.startWorkout()` (start/toggle play-pause) | Requires a selected `canonicalWorkout`; **suppressed if modal open or focus in input/textarea/select**; ignores welcome | workout.js:1663-1671 |
| **w** | HUD | Open the workout picker focused on current workout | Only when **no active workout**; suppressed if modal open / input focused | workout.js:1694-1701 |
| **e** | HUD | Switch free-ride control mode to **ERG** | Only when workout active **and** `isFreeRideActive` | workout.js:1703-1715 |
| **r** | HUD | Switch free-ride control mode to **Resistance** | Only when workout active **and** `isFreeRideActive` | workout.js:1717-1729 |
| **s** | HUD | Open settings overlay | Suppressed if modal open / input focused | workout.js:1731-1735 |
| **c** | HUD | Open the planner/calendar overlay | **Suppressed while a workout is active**; suppressed if modal/input | workout.js:1737-1744 |
| **↑ / k** | HUD (free-ride) | Increase manual target by +10 (ERG W or resistance %) | Only when `isFreeRideActive`; suppressed if modal/input | workout.js:1680-1692 |
| **↓ / j** | HUD (free-ride) | Decrease manual target by −10 | Only when `isFreeRideActive`; suppressed if modal/input | workout.js:1680-1692 |
| **Escape** | Global dispatcher | Closes the top-most overlay: detail→exit, planner→close, picker→close | **Does nothing in builder mode**; if picker search is focused, lets picker clear search instead of closing | workout.js:1747-1772 |

---

## 3. Settings overlay (`settings.js` + `index.html`)

| Control / interaction | Where | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|---|
| Close button (`#settingsCloseBtn`) | Settings header | `closeSettings()` | Always | index.html:937-946; settings.js:536-540 |
| Back-from-logs button (`#settingsBackFromLogsBtn`) | Settings header | `showMainView()` (return from logs view) | Shown only in logs view | index.html:904-930; settings.js:562-566 |
| Click-outside backdrop (`#settingsOverlay`) | Settings | pointerdown **and** pointerup both on the overlay backdrop → `closeSettings()` | Left button only; both events must land on overlay (not modal) | settings.js:542-554 |
| "Help"/"What's this?" toggles (`[data-settings-help-toggle]`) | Settings rows | Show/hide the matching help blurb (`settingsFoldersHelp`/`Ftp`/`Sound`/`Env`/`Pwa`) with fade | Each toggles its own target | index.html (per row); settings.js:501-525 |
| Choose folder button (`#rootDirButton`, "Choose…") | Settings | `handleChooseRootDir()` — pick the VeloDrive root directory handle | Always | index.html:987-994; settings.js:568-572 |
| FTP `−` / `+` buttons (`[data-ftp-delta=±10]`) | Settings | Step FTP by ±10 W and apply (`handleFtpDelta`) | Clamped to valid FTP range (50–500) | index.html:1034-1059; settings.js:589-597, 375-384 |
| FTP input (`#settingsFtpInput`, number) | Settings | Type FTP; commits on **Enter** (then blur) or **blur** (`handleFtpSave`) | Normalised/clamped on commit | index.html:1042-1052; settings.js:574-587 |
| Sound toggle checkbox (`#settingsSoundCheckbox`) | Settings | On `change` saves sound preference on/off | Always | index.html:1097-1101; settings.js:599-603, 394-400 |
| Theme toggle (`#settingsThemeToggle`, three `[data-theme-mode]` = Auto/Dark/Light) | Settings | Click saves+applies theme mode and marks active | Always | index.html:1132-1160; settings.js:605-610, 467-479 |
| View logs button (`#settingsOpenLogsBtn`) | Settings | `showLogsView()` (switch to connection-logs view) | Always | index.html:1270-1277; settings.js:556-560 |
| Bluetooth / PWA status (`#settingsBtStatusText`, `#settingsPwaStatusText`) | Settings | **Display-only** status text | Refreshed on open | index.html:1187-1192, 1239-1244; settings.js:404-452 |
| **Escape** | Settings | If logs view open → back to main view; else close settings | Only when settings overlay visible; ignored with meta/ctrl/alt | settings.js:613-624 |

---

## 4. Workout picker overlay — library mode + schedule mode (`workout-picker.js`)

Master keydown listener runs only when picker is open, bails in builder mode, bails
with meta/ctrl/alt. `/`, `z`, `d` are checked **before** the input-focus early-return.

### 4a. Picker keyboard

| Key | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| **/** | Focus + select-all the search input | Picker open, not builder; works regardless of focus | workout-picker.js:1372-1377 |
| **Enter** (search focused) | Blur search, expand first result, focus its "Select" button | Only when search is active element and results exist | workout-picker.js:1379-1392 |
| **Escape** (search focused) | Clear search value, blur, re-render | Only when search is active element (this is why HUD Escape defers) | workout-picker.js:1393-1398 |
| **z** | Focus the zone filter `<select>` and open it | Not builder, not in search box, `zoneFilter` exists | workout-picker.js:1402-1407 |
| **d** | Focus the duration filter `<select>` and open it | Not builder, not in search box | workout-picker.js:1409-1414 |
| **↑/↓ / j/k** (select focused) | Navigate `<select>` options ±1 and dispatch change | When a filter `<select>` is focused | workout-picker.js:1417-1422, 1336-1362 |
| **Enter** (select focused) | Blur the select | When a `<select>` is focused | workout-picker.js:1423-1427 |
| **Escape** (table focus) | Schedule mode → close back to planner; library mode → no-op | Only acts if `scheduleMode` | workout-picker.js:1432-1438 |
| **Backspace** | Close picker, return to planner | Only when `scheduleMode` | workout-picker.js:1439-1443 |
| **Enter** (table focus) | Select the expanded workout — library: `doSelectWorkout`; schedule: `onScheduleSelected` | Requires an expanded row | workout-picker.js:1445-1466 |
| **e** | Open the expanded workout in the builder | Picker open, **not** schedule mode, an expanded row exists | workout-picker.js:1468-1478 |
| **↓ / j** | Move expansion to next visible workout (wraps; if none, selects first) | Table focus | workout-picker.js:1480-1484, 1259-1275 |
| **↑ / k** | Move expansion to previous workout (wraps; if none, selects last) | Table focus | workout-picker.js:1486-1490, 1259-1275 |

### 4b. Picker mouse/inputs/buttons

| Control / interaction | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| Search input (`#pickerSearchInput`) | Filter rows by tokens against title/zone/source; supports duration ranges (`60`, `60-90`, `<30`, `>90`, `90m`) | Always wired | index.html:434-438; workout-picker.js:401-462, 2054-2070 |
| Search clear button (`.picker-search-clear`) | Clear search, refocus, re-render | Visible only when search non-empty | index.html:439-454; workout-picker.js:2071-2079, 1531-1533 |
| Zone filter (`#pickerZoneFilter`) | Filter to `item.zone === value` (Recovery/Endurance/Tempo/Threshold/VO2Max/Anaerobic) | Hidden in builder mode | index.html:456-464; workout-picker.js:391-393, 2081-2087 |
| Duration filter (`#pickerDurationFilter`) | Filter by duration bucket (1–30 … >240) | Hidden in builder mode | index.html:465-476; workout-picker.js:395-399, 2089-2095 |
| Sortable headers (`th[data-sort-key]` = name/if/tss/duration/kjAdj) | Click sets sort key; same key toggles asc/desc; new key defaults desc (kJ→asc) | "Zone"/"Source" headers **not** sortable; default sort `kjAdj` asc | index.html:650-680; workout-picker.js:1290-1308, 240-241 |
| Table row collapsed (`.picker-row`, click) | Toggle-expand that workout (collapses others) | Collapsed rows only | workout-picker.js:724-727 |
| Expanded-row collapse band (`.picker-expanded-collapse-hit`) | Collapse the expanded row | Only in expanded row; the row body has no click handler | workout-picker.js:745-750, 985 |
| "Visit website" (expanded) | Open `sourceURL` in new tab | Only if `sourceURL` exists; hidden in schedule mode | workout-picker.js:768-788 |
| "Delete" (expanded) | Confirm, move `.zwo` to trash, rescan | Library mode only (not schedule) | workout-picker.js:791-805 |
| "Clone" (expanded) | Clone workout ("Copy" suffix), save, rescan, expand clone | Library mode only | workout-picker.js:808-831 |
| "Edit" (expanded) | Open workout in builder | Library mode only | workout-picker.js:834-848 |
| "Select"/"Schedule Workout" (expanded) | Library: select + close; schedule: `onScheduleSelected` | Text/behavior switches on `scheduleMode` | workout-picker.js:851-874 |
| "Unschedule" (created in JS) | `onScheduleUnschedule(entry)` | Shown only in schedule **edit** mode | workout-picker.js:224-234, 1931 |
| Create workout (`#pickerAddWorkoutBtn`) | `startBuilderFromScratch()` | Hidden in builder mode and schedule mode | index.html:478-493; workout-picker.js:2008-2013 |
| Empty-state add (`#pickerEmptyAddBtn`) | `startBuilderFromScratch()` | Shown only when 0 workouts, not builder | index.html:641-647; workout-picker.js:2029-2034 |
| Close (`#workoutPickerCloseBtn`) | `close()` (with unsaved-builder confirm) | Always | index.html:614-622; workout-picker.js:1997-2001 |
| Back to calendar (`#pickerBackToPlannerBtn`) | `close({returnToPlanner:true})` | Visible only in schedule mode | index.html:356-372; workout-picker.js:2002-2006, 253-257 |
| Back to library (`#workoutBuilderBackBtn`) | `handleBackToLibrary()` (confirm unsaved, exit builder) | Builder mode only | index.html:374-400; workout-picker.js:2015-2020 |
| Save (`#workoutBuilderSaveBtn`) | Validate + save `.zwo`, reopen library | Builder mode only; hidden in schedule mode | index.html:571-612; workout-picker.js:2022-2027 |
| Import TrainerDay (`#workoutBuilderTrainerDayBtn`) | Prompt for URL → parse → load into builder, mark dirty | Builder mode only | index.html:501-535; workout-picker.js:275-303 |
| Upload File (`#workoutBuilderUploadBtn` → hidden `.zwo,.fit` input) | Pick a file → parse → load into builder, mark dirty | Builder mode only | index.html:537-569; workout-picker.js:305-359 |
| Click-outside backdrop | pointerdown+pointerup on overlay → close | Left button; overlay must have `picker-mode` class (suppressed in planner mode) | workout-picker.js:2036-2052 |
| Footer hint (library) | **Display-only**: `j k`/`↑ ↓` move • Enter select • `/` search | Static markup | index.html:688-695 |
| Builder shortcut hint (`#builderShortcuts`) | **Display-only**: rendered by picker, lists builder keys per selection state | Builder mode | workout-picker.js:1137-1153 |

---

## 5. Planner / calendar overlay (`workout-planner.js`)

Keyboard handler split into a detail-mode path and a calendar path; both suppress
when focus is in INPUT/TEXTAREA/SELECT (and contentEditable in detail), and the
calendar path ignores meta/ctrl/alt.

### 5a. Planner keyboard

| Key | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| **j / ↓** | Move selection +7 days (down a week) | Planner open, **not** detail mode, no input focus | workout-planner.js:1375-1379 |
| **k / ↑** | Move selection −7 days | same | workout-planner.js:1380-1384 |
| **h / ←** | Move selection −1 day | same | workout-planner.js:1385-1389 |
| **l / →** | Move selection +1 day | same | workout-planner.js:1390-1394 |
| **Enter** | Cascades by day state: past/today history → open detail; else scheduled → load workout; else future → open schedule picker | Requires `selectedDate`/dateKey | workout-planner.js:1325-1346 |
| **e** | Scheduled entry → edit it; else future/today → open schedule picker | No edit on a past empty day | workout-planner.js:1348-1365 |
| **d / Delete** | Delete first item in selected cell: scheduled entry (confirm) or move first history file to trash (confirm) | Requires `selectedDate` | workout-planner.js:1367-1373 |
| **Escape** (calendar) | **No-op — deliberately does NOT close planner** | Calendar mode | workout-planner.js:1316-1319 |
| **? (Shift+/)** | Hold to show full hotkey list (hides aggregates); `questionHeld` prevents auto-repeat | Planner open | workout-planner.js:1275-1278, 1445-1456 |
| **? / / release (keyup)** | Hide hotkey list, restore aggregate footer | Only if it was held | workout-planner.js:1280-1283, 1457-1466 |
| **Delete** (detail) | `deleteCurrentDetail()` (confirm + trash current file) | Detail mode, no editable focus | workout-planner.js:1299-1303 |
| **d** (detail) | `deleteCurrentDetail()` | Detail mode | workout-planner.js:1304-1308 |
| **Backspace** (detail) | `exitDetailMode()` back to calendar | Detail mode | workout-planner.js:1309-1312 |
| **Escape** (detail) | `exitDetailMode()` | Detail mode | workout-planner.js:1309-1312 |

### 5b. Planner mouse / cards / drag

| Control / interaction | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| Calendar day cell (click) | `setSelectedDate(...)` — select day, update label/aggregates/schedule button, scroll into view | Cell must have `data-date` | workout-planner.js:1269-1273, 1443-1444 |
| Today / selected highlight | Cell gets `is-today` / `is-selected` class | per day-state | workout-planner.js:1045-1075, 812-821 |
| History workout card (click) | `openDetailView(dateKey, data)` — stats + power curve + detail chart (stops cell click) | Only for past/today days with history | workout-planner.js:315-318, 630-631 |
| History/scheduled card (hover) | Toggle `suppress-hover` on parent day | Card present in a day | workout-planner.js:319-329, 475-485 |
| Scheduled card (click body) | `onScheduledLoadRequested(entry)` — load/start it | Only when `!entry.missing` | workout-planner.js:449-456 |
| Scheduled card edit button (future/today) | Pencil → `onScheduledEditRequested(date, entry)` (stops propagation) | When `!isPast` | workout-planner.js:388-398 |
| Scheduled card edit button (past) | Trash → `removeScheduledEntryInternal(entry)` (stops propagation) | When `isPast` | workout-planner.js:380-387 |
| Scheduled card **drag** (dragstart) | Set JSON payload `{kind:'scheduled',date,workoutTitle}`, add `planner-dragging` | All scheduled cards draggable | workout-planner.js:457-471 |
| Day cell dragover | preventDefault + `dropEffect=move` + `planner-drop-hover` | **Rejected if target day is past**; payload must be JSON | workout-planner.js:985-995 |
| Day cell dragleave | Remove `planner-drop-hover` | any drag leave | workout-planner.js:997-1000 |
| Day cell **drop (reschedule)** | Parse payload → `moveScheduledEntry({fromDate,toDate,workoutTitle})` | **Cannot drop on a past date**; same-day is no-op; today allowed | workout-planner.js:1002-1023, 223-258 |
| Schedule workout (`#plannerScheduleBtn`) | `requestSchedule(dateKey)` → opens picker in schedule mode | Requires selection; **blocked/hidden if selected date is past** or in detail mode | index.html:767-783; workout-planner.js:1497-1504, 891-905 |
| Delete (`#plannerDeleteBtn`) | `deleteCurrentDetail()` | Shown only in detail mode | index.html:730-766; workout-planner.js:1506-1510 |
| Close (`#workoutPlannerCloseBtn`) | `close()` | Always | index.html:784-792; workout-planner.js:1469-1471 |
| Back (`#plannerBackBtn`) | `exitDetailMode()` | Detail mode only | index.html:705-721; workout-planner.js:1473-1477 |
| Click-outside backdrop | pointerdown+pointerup on overlay → `close()` | Left button; `planner-mode` active; modal visible | workout-planner.js:1479-1495 |
| Hotkey prompt/list (`#plannerHotkeyPrompt` / `#plannerHotkeyList`) | **Display-only**; toggled by `?` hold | driven by `showHotkeys` | index.html:872-880; workout-planner.js:929-940 |
| Footer aggregates (`#plannerAgg3/7/30`) | **Display-only** 3/7/30-day duration·kJ·TSS sums | hidden while hotkey list shown | index.html:883-888; workout-planner.js:936-955 |
| Selected-date label (`#plannerSelectedDateLabel`) | **Display-only** (aria-live) | — | index.html:724-728; workout-planner.js:805-810 |
| Power-curve help icon | Native `title`/`aria-label` tooltip; no JS | detail view | index.html:822-847 |
| Month navigation | **No prev/next buttons** — infinite vertical scroll recycles week rows; keyboard selection auto-scrolls | on scroll near buffer edges | workout-planner.js:1248-1267, 839-850 |

---

## 6. Workout builder (editor) keymap & gestures (`workout-builder.js`)

Single global keydown handler (`handleBuilderShortcuts`, :498). Bails if
`defaultPrevented`, if the builder root isn't visible, or if focus is in
INPUT/TEXTAREA/SELECT/contentEditable. The modal split is **block-selected** vs.
**insertion-cursor (no selection)**. `Shift` = ×5 big-step.

### 6a. Insertion-cursor movement (no block selected)

| Key | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| **Cmd/Ctrl+A** | Cursor to very start | No selection, blocks exist | workout-builder.js:525-532 |
| **Cmd/Ctrl+E** | Cursor to very end | No selection | workout-builder.js:533-538 |
| **Home** | Cursor to start | No selection | workout-builder.js:796-801 |
| **End** | Cursor to end | No selection | workout-builder.js:802-807 |
| **g** | Cursor to start (gg-like) | No selection | workout-builder.js:808-813 |
| **$** | Cursor to end | No selection | workout-builder.js:814-819 |
| **h / ←** | Move cursor left one block | No selection | workout-builder.js:820-831 |
| **l / →** | Move cursor right one block | No selection | workout-builder.js:832-843 |
| **j / ↓** | Lower power of the two blocks around cursor by 5% (×5 Shift) | No selection | workout-builder.js:844-864 |
| **k / ↑** | Raise power of blocks around cursor by 5% (×5 Shift) | No selection | workout-builder.js:844-864 |

### 6b. Block-insert shortcuts (insert at cursor, then auto-select)

| Key | Inserts | Guard | Legacy code (file:line) |
|---|---|---|---|
| **R** | Recovery (Z1) steady | no meta/ctrl/alt | workout-builder.js:638-641 |
| **E** | Endurance (Z2) | (Cmd/Ctrl+E = end-cursor) | workout-builder.js:642-645 |
| **T** | Tempo (Z3) | — | workout-builder.js:646-649 |
| **S** | Threshold (Z4) | — | workout-builder.js:650-653 |
| **V** | VO2Max (Z5) | — | workout-builder.js:654-657 |
| **A** | Anaerobic (Z6) | (Cmd/Ctrl+A = start-cursor) | workout-builder.js:658-661 |
| **W** | Warmup ramp (50→75%) | — | workout-builder.js:662-665 |
| **C** | Cooldown ramp (75→50%) | (Cmd/Ctrl+C = copy) | workout-builder.js:666-669 |
| **I** | Intervals (6×, 60s/60s, 110%/55%) | — | workout-builder.js:670-673 |
| **F** | Freeride (300s) | — | workout-builder.js:674-677 |
| **X** | Text event (auto-selects for editing) | — | workout-builder.js:678-681 |

### 6c. Undo / redo / clipboard

| Key | What it does | Guard | Legacy code (file:line) |
|---|---|---|---|
| **Cmd/Ctrl+Z** or **U** | Undo | `U` only without modifiers/Shift | workout-builder.js:541-548 |
| **Cmd/Ctrl+Shift+Z**, **Cmd/Ctrl+Y**, **Shift+U** | Redo | — | workout-builder.js:550-559 |
| **Cmd/Ctrl+C** | Copy selection (blocks→ZWO XML, or text-event→`VELO_TEXT_EVENTS:` JSON) to system clipboard | — | workout-builder.js:568-572 |
| **Cmd/Ctrl+X** | Cut (copy + delete) | — | workout-builder.js:573-577 |
| **Cmd/Ctrl+V** | Paste at insertion point (parses ZWO XML / VELO_TEXT_EVENTS) | — | workout-builder.js:578-582 |
| **P** | Paste from clipboard | no modifiers | workout-builder.js:583-587 |
| **Ctrl/Cmd+Insert** | Copy | — | workout-builder.js:588-592 |
| **Shift+Insert** | Paste | — | workout-builder.js:593-597 |
| **Shift+Delete** | Cut | — | workout-builder.js:598-602 |
| **y** | Copy multi-block selection then deselect | Only when `selectionCount > 1` | workout-builder.js:623-629 |

### 6d. Selection range, delete, escape/enter/space (context-dependent)

| Key | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| **Shift+H / Shift+←** | Shift-move/extend selection left | Shift held, no meta/ctrl/alt | workout-builder.js:604-619 |
| **Shift+L / Shift+→** | Shift-move/extend selection right | same | workout-builder.js:604-619 |
| **d** | Text-event selected → delete; block(s) selected → **cut** (copy+delete) | priority text-event > block | workout-builder.js:683-699 |
| **Delete** | Text-event → delete; block(s) → plain delete; nothing selected → select block **after** cursor and delete | falls through to cursor-delete | workout-builder.js:683-719 |
| **Backspace** | Text-event → delete; block(s) → plain delete; nothing selected → select block **before** cursor and delete | cursor-delete only if `prev>=0` | workout-builder.js:683-719 |
| **Escape** | If block/text-event selected → deselect (stops propagation, overlay stays open); else → `onRequestBack()` (exit builder) | guarded by has-selection first | workout-builder.js:724-740 |
| **Enter** | If selection active → deselect; else select the block at the cursor (edit it) | — | workout-builder.js:724-755 |
| **Space** | Toggle insertion cursor between a selected block's leading/trailing edge (multi-select: first-1 ↔ last) | Only when `hasSelection`; stops propagation (won't start workout) | workout-builder.js:770-788 |

### 6e. Selected-block attribute editing (single selection only; `Shift`=×5)

| Key | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| **h / ←** | Decrease duration one step (intervals→on-duration; ramps/steady/freeride→block duration) | single selection | workout-builder.js:930-938, 872-893 |
| **l / →** | Increase duration one step | single selection | workout-builder.js:939-947 |
| **j / ↓** | Decrease power 5% (steady→powerRel; ramp→low/high by cursor side; intervals→on/off by side; freeride→no-op) | single selection | workout-builder.js:948-952, 895-928 |
| **k / ↑** | Increase power 5% | single selection | workout-builder.js:953-957 |

Which edge (low/on vs high/off) an edit hits is decided by `isInsertionAtEndOfSelection()` (workout-builder.js:759-768).

### 6f. Builder buttons & steppers

| Control | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| Block-insert palette (`.wb-code-insert-btn[data-key]`) | Click inserts that block at the cursor (does **not** auto-select, unlike the key) | always; labels collapse on narrow widths | workout-builder.js:338-368, 374-406 |
| Move-left / Move-right (`.wb-block-move-btn`) | Reorder selected block ±1 | exactly one block selected | workout-builder.js:142-159, 1711 |
| Delete-block (`.wb-block-delete-btn`) | Delete selected block | ≥1 selected | workout-builder.js:160-168 |
| Undo / Redo (`.wb-toolbar-action-btn`) | Undo/redo | `disabled` when `!canUndo`/`!canRedo` | workout-builder.js:173-191, 1531-1535 |
| Copy / Paste (toolbar) | Copy selection / paste | Copy `disabled` when no selection; Paste always enabled | workout-builder.js:193-211 |
| Block steppers `−`/`+` (`.control-btn`) + number input (`.wb-block-stepper-input`) | Edit duration/power/cadence/reps; duration uses dynamic step; commit on change/Enter; cadence allows empty | per selected block kind | workout-builder.js:2027-2073, 1733-1926 |
| Text-event editor: duration stepper, "Starts at" offset stepper (step 15), text input (`#wbTextEventInput`) | Edit display duration / start offset / cue text live | text event selected | workout-builder.js:428-467, 492-496 |
| Meta inputs: Name, Author/Source, Description textarea | Edit metadata on input; textarea auto-grows; `.wb-input-error` on failed save validation | always | workout-builder.js:75-96, 1070-1132 |

### 6g. Builder chart pointer gestures (handlers in `workout-builder.js`, hitboxes in `workout-chart.js`)

| Gesture | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| pointerdown entry | Blur inputs; Shift+pointerdown → preventDefault no-op; needs blocks | — | workout-builder.js:962, 2385-2393 |
| Click block/segment handle (no drag) | Select that block + set insertion cursor near click | `!didDrag` on pointerup | workout-builder.js:2740-2751 |
| Click text-event marker (no drag) | Select that text event | — | workout-builder.js:2394-2436, 2723-2726 |
| Drag text-event marker (horizontal) | Reposition offset, snapped to 15s, clamped `[0,totalSec]` | handle `text-event` | workout-builder.js:2598-2605 |
| Drag handle **top** (steady) | Vertical → set block power (`powerRel`) | non-freeride | workout-builder.js:2647-2651 |
| Drag handle **top** (warmup/cooldown) | Left third→powerLow, right third→powerHigh, middle→shift both | ramp; thirds at 2482-2494 | workout-builder.js:2653-2667 |
| Drag handle **top** (intervals) | Even seg→on-power, odd→off-power | intervals | workout-builder.js:2669-2678 |
| Drag handle **right** (steady/freeride/ramp) | Horizontal → set duration (snapped); timeline locked during drag | — | workout-builder.js:2682-2694 |
| Drag handle **right** (intervals) | Even seg→on-duration, odd→off-duration (back-computed) | intervals | workout-builder.js:2696-2715 |
| Drag handle **move** (reorder) | Drag block; live drop indicator; on up reorders to slot | — | workout-builder.js:2607-2642, 2738-2739 |
| Drag threshold | 4px distinguishes click vs drag | all drags | workout-builder.js:42, 2589-2594 |
| Shift+click segment | Range-select from anchor to clicked block | anchor exists | workout-builder.js:1367-1386; workout-chart.js:1797-1806 |
| Click empty chart area | Set insertion cursor (or deselect if no insert callback) | — | workout-builder.js:1392-1396; workout-chart.js:1853-1894 |

**Builder absences:** no `?` overlay (hints via element `title` + `#builderShortcuts`),
no true vim modes, no Save button inside the builder (save is the picker's `#workoutBuilderSaveBtn`).

---

## 7. Main chart hover/render (`workout-chart.js`) — HUD + builder + planner

The chart file attaches **only** hover/render and builder click/select — no
keyboard, no scrub/seek, no drag listeners (drag hitboxes are built here but driven
by the builder).

| Interaction | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| Segment hover (`#chartSvg`) | mousemove hit-tests `.chart-segment`; shows tooltip (`Zone: P0–P1% FTP, W…, dur[, rpm]` / `Free ride: dur`), highlights polygon | Whenever chart rendered; line-dot hover takes priority if live samples | workout-chart.js:1022-1048, 935-1020 |
| Live-line hover (power/HR/cadence) | Interpolates value at cursor x-time; snaps a colored dot within 16px; tooltip `Label: value unit` | Only with non-empty `liveSamples`; skips data gaps >6s; priority over segment hover | workout-chart.js:822-931, 840 |
| Text-event marker hover (builder) | Tooltip `Ns: <text>`; z-raises marker on pointerenter | builder graph only | workout-chart.js:895-912, 1368-1372 |
| Tooltip scroll-follow | On horizontal scroll of chart's scroll parent, re-applies hover (rAF) so tooltip/highlight track content | only if `scrollEl` exists (wide builder timeline) | workout-chart.js:761-787, 1036-1046 |
| Mouse-leave (any chart) | Hide dots, clear tooltip + highlight, forget hover pos | on `mouseleave` | workout-chart.js:1030-1034 |
| Power-curve hover (`#plannerPowerCurveSvg`) | Maps cursor-x (log duration axis) to a duration; binary-search + interpolate; dot + label `NNN W · dur` | history detail only, points exist | workout-chart.js:663-701 |
| Builder click — select block | `onSelectBlock(idx,{shiftKey})`; shift-click multi-selects | builder graph; needs callback | workout-chart.js:1797-1806 |
| Builder click — set insert point | Non-shift click computes insert-after index from click-x; `onSetInsertAfterFromSegment`/`onSetInsertAfter` | builder graph | workout-chart.js:1807-1894 |
| Builder mousedown + Shift | preventDefault (suppress text selection during shift-select) | builder graph, shift held | workout-chart.js:1791-1795 |
| Progress line / past-shade | **Display-only** yellow position line + shade from `elapsedSec` (no seek) | `showProgress && elapsedClamped>0` | workout-chart.js:2014-2025, 2068-2079 |

---

## 8. Welcome / first-run tour overlay (`welcome.js` + `index.html`)

Global keydown is captured (stopPropagation/stopImmediatePropagation) while open, so
it shields the HUD. Two modes: **splash** (icon-only, most keys swallowed) and **full**.

| Control / key | What it does | Context/guard | Legacy code (file:line) |
|---|---|---|---|
| Prev button (`#welcomePrevBtn`) | `goToPrev()` (previous slide) | not on splash / not at first slide | index.html:96-103; welcome.js:752-757, 679-684 |
| Next button (`#welcomeNextBtn`) | `goToNext()` (next slide, or close on last) | not on splash | index.html:105-112; welcome.js:759-764, 669-677 |
| Close button (`#welcomeCloseBtn`, "Skip intro") | `closeOverlay()` | always | index.html:67-74; welcome.js:766-771 |
| Click anywhere on overlay | `goToNext()` | full mode only; ignored on splash and on nav/close controls | welcome.js:686-704, 750 |
| **Escape** | `closeOverlay()` | works in both splash and full | welcome.js:718-720, 724-728 |
| **→ / PageDown** | `goToNext()` | full mode (swallowed on splash) | welcome.js:729-733 |
| **← / PageUp** | `goToPrev()` | full mode | welcome.js:734-738 |
| **Space / Enter** | `goToNext()` | full mode; **only when focus is on overlay or body** (so it doesn't hijack a focused control) | welcome.js:739-747 |
| (modifier guard) | All keys ignored with meta/ctrl/alt | — | welcome.js:708 |
| Splash mode | All keys except Escape swallowed (preventDefault) | `currentMode === "splash"` | welcome.js:714-722 |

---

### Cross-cutting context guards (the trickiest)

- **The same key does different things by overlay**: `e` = ERG (HUD) / edit (picker, planner) / Endurance-or-end-cursor (builder); `d` = duration filter (picker) / delete (planner, builder); `j/k` = manual ±10 (HUD free-ride) / move selection (picker, planner) / power adjust (builder).
- **Escape is the most context-split key:** HUD dispatcher closes the top overlay but **defers to picker search** (clear) and is a **no-op in builder selection / planner calendar**; planner calendar Escape never closes the planner.
- **Drag-reschedule is future-only** (past dates reject dragover/drop; same-day no-op; today allowed).
- **Free-ride controls** (mode toggle, manual ±, manual input, e/r, j/k) all require `workoutActive && isFreeRideActive`.
- **Calendar button + `c` are blocked during an active workout**; **`w`/name-label picker is blocked during an active workout**.
- **Builder modal split** is selection-vs-cursor, not vim modes; `Shift` is the ×5 step; ramp/interval power edits target low/on vs high/off by which edge the insertion cursor sits on.
