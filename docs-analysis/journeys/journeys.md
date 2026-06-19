# VeloDrive (legacy) — Master Journeys / Interactions / States / Edges Catalog

Canonical, deduplicated checklist of EVERY journey, interaction, UI control, state/mode, and edge/error in the legacy vanilla-JS PWA at `docs/`. Merged from four scours:

- **S1** = `scour-01-user-goals.md` (44 user journeys)
- **S2** = `scour-02-ui-controls.md` (~190 controls/keys/gestures)
- **S3** = `scour-03-states-modes.md` (states/modes/transitions + dark-mode deep-dive)
- **S4** = `scour-04-edge-errors.md` (41 dialogs + guards + empty states + failures)

Each row has a STABLE id. "New-app impl" and "Status" columns are intentionally BLANK — the next phase fills them by auditing the new codebase. Dark-mode and hotkey/Escape-context findings are preserved as their own grouped sections (known-weak areas). Severity tags in Notes: **[HIGH]** = high-impact behavior a rewrite is likely to drop; **[BUG]** = latent legacy bug to be aware of; **[GAP]** = not implemented in legacy.

---

## Onboarding / Welcome

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-WEL-01 | First-run full 4-slide welcome tour (splash/trainers/offline/workouts) | welcome.js:4-41,415,639; workout.js:1223 | S1(J1),S3 | | | Web non-PWA → always full tour |
| J-WEL-02 | `shouldForceFullWelcome()` decision (root-dir + PWA check) | workout.js:184-207,152-182 | S1(J1),S3 | | | forceFullWelcome = !runningAsPwa \|\| missingRootDir |
| J-WEL-03 | PWA + configured → 1.1s splash only (`playSplash`) | welcome.js:778-780; workout.js:1272 | S1(J1),S3 | | | auto-closes 1.1s; splash swallows keys except Esc |
| J-WEL-04 | Welcome skipped entirely if a workout is active | welcome.js; workout.js:1223 | S1(J1),S3 | | | active ride suppresses welcome |
| J-WEL-05 | `body.welcome-active` hides content pre-tour; cleared on close | workout.js:135 | S1(J1) | | | setWelcomeActive |
| J-WEL-06 | Welcome nav: Prev/Next/Close (Skip intro) buttons | welcome.js:752-771; index.html:67-112 | S1(J1),S2 | | | Next on last slide closes |
| J-WEL-07 | Welcome click-anywhere-to-advance | welcome.js:686-704,750 | S2 | | | full mode only; ignored on splash & on controls |
| J-WEL-08 | Welcome keys →/PageDown next, ←/PageUp prev | welcome.js:729-738 | S2 | | | full mode; swallowed on splash |
| J-WEL-09 | Welcome Space/Enter advance | welcome.js:739-747 | S2 | | | only when focus on overlay/body |
| J-WEL-10 | Welcome Escape closes (`stopImmediatePropagation`) | welcome.js:706-748 | S2,S3 | | | absorbs Esc exclusively (z60 topmost) |
| J-WEL-11 | Welcome modifier guard — all keys ignored with meta/ctrl/alt | welcome.js:708 | S2 | | | |
| J-WEL-12 | Welcome tour absent (no `#welcomeOverlay`) → disabled, app continues | workout.js:1225-1227 | S4 | | | silent |
| J-WEL-13 | Welcome illustration SVGs hardcoded near-black linework | img/*.svg; welcome.css | S3 | | | [HIGH] low contrast in dark — see Dark-mode section |

---

## Config / Settings

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-CFG-01 | Settings auto-open on startup attention (missing folder/BT/platform) | settings.js:629-672,650-655 | S1(J2),S3,S4 | | | [HIGH] driven by startupNeedsAttention |
| J-CFG-02 | Auto-expand relevant help section on auto-open | settings.js:484-525,650-664 | S1(J2),S4 | | | folders/env/compat help |
| J-CFG-03 | Open settings (gear button `#settingsBtn` / `S` key) | settings.js:188,530-534; workout.js:1731 | S1,S2 | | | always available |
| J-CFG-04 | Close settings (`#settingsCloseBtn`) | settings.js:536-540 | S2 | | | |
| J-CFG-05 | Settings click-outside backdrop closes (pointerdown+up on overlay) | settings.js:542-554 | S2 | | | left button; both events on backdrop |
| J-CFG-06 | Settings Escape: logs→main view, else close | settings.js:613-624 | S2,S3 | | | uncoordinated w/ picker/planner handler |
| J-CFG-07 | Help/"What's this?" toggles per row | settings.js:501-525 | S1,S2 | | | folders/ftp/sound/env/pwa blurbs |
| J-CFG-08 | View logs button → logs view; Back-from-logs | settings.js:556-566 | S2 | | | |
| J-CFG-09 | Configure FTP — input + commit on Enter/blur, clamp 50–500 | settings.js:333-384,346-365; storage.js:358-360 | S1(J3),S2 | | | applyFtpValue clamps |
| J-CFG-10 | FTP +10/−10 delta buttons (base = currently-typed value) | settings.js:367-384,589-597 | S1(J3),S2 | | | |
| J-CFG-11 | Configure theme Auto/Dark/Light toggle | settings.js:456-479,605-610; theme.js:6-33 | S1(J4),S2,S3 | | | saveAndApplyThemeMode → localStorage + IDB |
| J-CFG-12 | Anti-FOUC theme init (inline, pre-paint) | theme-init.js:1-15 | S1(J4),S3 | | | reads localStorage before paint |
| J-CFG-13 | Auto theme re-renders on OS `prefers-color-scheme` change | workout.js:1402-1415 | S1(J4),S3 | | | OS listener |
| J-CFG-14 | Theme localStorage failure → silent fallback to IDB/auto | storage.js:338-339,352-353 | S1(J4),S4 | | | silent |
| J-CFG-15 | Configure sound toggle (checkbox, default ON) | settings.js:388-400,599-603; beeper.js:75-78 | S1(J5),S2 | | | disabled silences audio, overlays remain |
| J-CFG-16 | Choose root folder (File System Access) | settings.js:303-316,568-572; storage.js:497-540 | S1(J6),S2 | | | showDirectoryPicker + ensureDirPermission |
| J-CFG-17 | Seed 6 default `.zwo` files into empty `workouts/` | storage.js:446-487 | S1(J6) | | | on first folder pick |
| J-CFG-18 | Create `workouts/`/`history/`/`trash/` subdirs | storage.js:497-540 | S1(J6) | | | derived from root on later loads |
| J-CFG-19 | Default-workout seeding per-file failure → silent, continue | storage.js:473-478,440-443 | S4 | | | console.error only |
| J-CFG-20 | Data persistence layer (IndexedDB `velo-drive`/`settings`) | storage.js:14-32,44-113 | S1(J8) | | | keyed config: handles/ftp/sound/theme/selected/state/picker/builder/scrape/devices/statsCache |
| J-CFG-21 | `schedule.json` persisted in root folder (file, not IDB) | storage.js:217-248 | S1(J8) | | | |
| J-CFG-22 | Bluetooth / PWA status text (display-only, refreshed on open) | settings.js:404-452; index.html:1187-1244 | S2,S3 | | | |

---

## Hardware / BLE

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-BLE-01 | Connect trainer (BLE/FTMS 0x1826) via picker | workout.js:1525-1544; ble-manager.js:549-561,581-767 | S1(J9),S2,S3 | | | requestControl(0x00)+startOrResume(0x07) |
| J-BLE-02 | Control Point (0x2AD9) missing → fatal error | ble-manager.js:439-452 | S1(J9) | | | required for ERG |
| J-BLE-03 | Connect HRM (Heart Rate 0x180D) via picker | workout.js:1546-1565; ble-manager.js:773-932 | S1(J10),S2 | | | separate connect button |
| J-BLE-04 | HR battery read once at connect (0x180F/0x2A19, non-fatal) | ble-manager.js:818-847; workout.js:669-670 | S1(J10),S3 | | | no live notify |
| J-BLE-05 | Auto-reconnect on disconnect (1s→×2→10s backoff) | ble-manager.js:208-276,704-738 | S1(J11),S3 | | | one-shot suppression + autoReconnectEnabled gate |
| J-BLE-06 | Auto re-pair saved bike/HR on page load (`getDevices`) | ble-manager.js:938-986 | S1(J11),S3 | | | |
| J-BLE-07 | Backoff resets on manual reconnect / fresh disconnect | ble-manager.js:728-731,1012,1037 | S3 | | | |
| J-BLE-08 | Bike status dot: idle-grey / connecting-amber / connected-green / error-red | workout.js:612-641; workout-base.css:600-620 | S2,S3 | | | dot colors hardcoded, theme-agnostic |
| J-BLE-09 | Progressive connecting messages in button `title` tooltip | ble-manager.js:598-625; workout.js:627-629 | S3 | | | "Connecting…/GATT…/discovering FTMS…" |
| J-BLE-10 | HR status dot mirrors bike (no chart empty-state for HR) | workout.js:643-660; ble-manager.js:789-931 | S3 | | | |
| J-BLE-11 | Battery NORMAL label "N%" (`--text-muted`) | workout.js:669-670; ble-manager.js:818-847 | S3 | | | |
| J-BLE-12 | Battery LOW ≤20% → orange `#f57c00` color-only signal | workout.js:670; workout-base.css:622-624 | S3 | | | no banner/toast, easy to miss |
| J-BLE-13 | Battery UNKNOWN/none → label cleared | workout.js:664-667 | S3 | | | |
| J-BLE-14 | Bike connect — no Web Bluetooth → alert + open Settings | workout.js:1531; ble-manager.js:1007 | S1,S2,S4 | | | "Your browser doesn't support Bluetooth…" |
| J-BLE-15 | HRM connect — no Web Bluetooth → alert + open Settings | workout.js:1552; ble-manager.js:1049 | S2,S4 | | | same message |
| J-BLE-16 | Bike picker cancel/fail → status error, reconnect if connect-fail | ble-manager.js:1019-1027,1041-1044; workout.js:1540 | S3,S4 | | | [BUG] bare-string `setBikeStatus("error")` reverts dot to grey not red |
| J-BLE-17 | HR picker cancel/fail → status error | workout.js:1561-1562 | S3 | | | [BUG] same bare-string dot bug |
| J-BLE-18 | Auto-reconnect skipped if `getDevices` unavailable | ble-manager.js:939 | S3,S4 | | | silent skip |
| J-BLE-19 | `showDirectoryPicker`/BLE picker needs user gesture | storage.js:508,534-537 | S4 | | | SecurityError → generic alert |

---

## Ride Execution

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-RIDE-01 | IDLE state (workout loaded, not started, elapsed 0) | workout-engine.js:574-602; workout.js:858-884 | S1,S3 | | | startBtn visible; Space/W/C active |
| J-RIDE-02 | Pick & load workout (name label / `W` / chart prompt) | workout.js:1508-1520,1694-1701,224-238; workout-engine.js:728-756 | S1(J12),S2 | | | folder-gated; validates segments, resets elapsed/index/samples |
| J-RIDE-03 | Manual start (Start/Play btn / Space) → 3-2-1 countdown | workout.js:1627-1637; workout-engine.js:466-498 | S1(J13),S2 | | | |
| J-RIDE-04 | 3-2-1 COUNTDOWN state (`starting=true`, full-screen overlay) | workout-engine.js:459-498; beeper.js:477-522 | S3 | | | calendarBtn hidden; mode/start guarded while starting |
| J-RIDE-05 | RUNNING state — live title/stats/chart/playhead | workout-engine.js:341-415; workout.js:505-573,775-836 | S3 | | | |
| J-RIDE-06 | Follow structured intervals (ERG, 1Hz ticker, FTMS 0x05) | workout-engine.js:341-415,106-156,165-174; ble-manager.js:503-543 | S1(J14) | | | target throttled ~10s unless changes |
| J-RIDE-07 | Ramp segment interpolation (start→end target) | workout-engine.js:106-156 | S1(J14),S1(J35) | | | |
| J-RIDE-08 | Center title = live segment desc + look-ahead "In N - …" ≤10s | workout.js:521-570 | S3 | | | |
| J-RIDE-09 | Cadence coaching ("Speed up/Slow down") ±5rpm off ≥5s | workout.js:369-423; workout-engine.js | S1(J14),S3 | | | title flips, ▾/▴ indicator |
| J-RIDE-10 | Text events → audio taps + overlay | workout.js:1051-1084; beeper.js:387-444 | S1(J14),S1(J22) | | | |
| J-RIDE-11 | Auto-start by pedaling (≥max(75W, 50%×first target)) | workout-engine.js:284-305,557-565; ble-manager.js:352-413 | S1(J17),S3 | | | suppressed after finish; 15s grace |
| J-RIDE-12 | Auto-pause (power≤0 ≥1s outside 15s grace) → overlay | workout-engine.js:361-374,436-457; beeper.js:465-466 | S1(J18),S3 | | | "Workout Paused" 1600ms flash |
| J-RIDE-13 | AUTO-PAUSED state — "Pedal to resume", elapsed frozen | workout-engine.js:361-373,398-411 | S3 | | | playBtn+stopBtn |
| J-RIDE-14 | Auto-resume (power ≥90% target, not blocked) → +15s grace | workout-engine.js:398-411; beeper.js:469-470 | S1(J19),S3 | | | "Workout Resumed" overlay |
| J-RIDE-15 | Manual pause (Pause btn/Space) → 10s auto-resume block | workout-engine.js:506-511; workout.js:1639-1643 | S1(J18),S3 | | | |
| J-RIDE-16 | MANUAL-PAUSED state (10s suppression timer) | workout-engine.js:506-511,400-403 | S3 | | | visually identical to auto-paused |
| J-RIDE-17 | Manual resume (Play btn / Space while paused) | workout-engine.js:500-511 | S1(J19),S2 | | | clears block, grants 15s grace |
| J-RIDE-18 | Start/Play/Pause/Stop button visibility logic | workout.js:939-951,1627-1651 | S2 | | | start≠running, play=paused, pause=running, stop=running\|\|paused |
| J-RIDE-19 | Adjust intensity mid-ride (FTP change re-sends forced trainer state) | workout.js:1731-1735; workout-engine.js:702-709 | S1(J20),S1(J3) | | | recomputes targets/metrics/chart; throttle bypassed |
| J-RIDE-20 | Interval audio cues: 9s siren+honk danger, 3s before ≥10% change | workout-engine.js:307-337; beeper.js:528-541,359-385 | S1(J22) | | | silenced when sound off, overlays remain |
| J-RIDE-21 | Skip/scrub interval | workout.js:84-87; workout-engine.js:106-156 | S1(J21) | | | [GAP] no user-facing seek/scrub control |
| J-RIDE-22 | Finish & export FIT (Stop → confirm → buildFitFile → history/) | workout.js:1645-1651; workout-engine.js:514-553,232-280; fit-file.js:253-722 | S1(J23),S2 | | | embeds canonical JSON for round-trip; preserves pauses as timer events |
| J-RIDE-23 | FINISHED state (transient → IDLE; autoStartSuppressed) | workout-engine.js:514-553; workout.js:1368-1390 | S3 | | | no samples → no file written |
| J-RIDE-24 | End-workout confirm "End current workout and save it?" | workout.js:1647 | S2,S4 | | | Cancel keeps running |
| J-RIDE-25 | Stop with no samples → no file written | workout-engine.js:514-553 | S1(J23) | | | |
| J-RIDE-26 | Post-ride review → planner opens + `openDetailByFile` | workout.js:1368-1390; workout-planner.js:630 | S1(J24) | | | removes today's scheduled entry |
| J-RIDE-27 | Crash recovery → restores in-progress ride as PAUSED | workout-engine.js:184-214,606-675; storage.js:370-384 | S1(J25),S3 | | | [HIGH] running→recovered paused for safety |
| J-RIDE-28 | RECOVERED-PAUSED state (ticker started then paused) | workout-engine.js:643-647,669-672; workout.js:867-869 | S3 | | | ~0.5s progress can be lost; wall-clock FIT timing preserved |
| J-RIDE-29 | Debounced active-state persist (500ms each tick) | workout-engine.js:184-190,395 | S1(J25),S3 | | | full state: workout/ftp/elapsed/samples/pauses/timers |
| J-RIDE-30 | Start with no workout → alert "No workout selected." | workout-engine.js:461 | S4 | | | |
| J-RIDE-31 | Load/select workout while running → alert reject | workout-engine.js:730; workout.js:1514 | S2,S4 | | | "Please end your current workout first." / "End the current workout before changing…" |
| J-RIDE-32 | Stat cards display (Power/IntervalTime/HR/Target/WorkoutTime/Cadence) | index.html:117-149; workout.js:578-597 | S2 | | | display-only, font auto-sized on resize |
| J-RIDE-33 | Center workout title display (running only) | index.html:260-269; workout.js:521-570 | S2 | | | title attr tooltip |
| J-RIDE-34 | Auto-open planner for today's scheduled workout on load | workout.js:1292-1315 | S1 | | | if not already current |
| J-RIDE-35 | Boot order: DOMContentLoaded→initPage→settings→welcome→engine→UI→scrape→planner | workout.js:1319-1795 | S1 | | | |

---

## Free-ride / Manual

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-FREE-01 | FREE-RIDE ERG state (freeride seg + mode=erg, FTMS 0x05 watts) | workout.js:442-458,957-994; workout-engine.js:165-174,691-700; ble-manager.js:480-489 | S1(J15),S3 | | | clamp 50–1500 / Enter-blur 50…2.5×FTP; unit "W" |
| J-FREE-02 | FREE-RIDE RESISTANCE state (mode=resistance, FTMS 0x04 level×10) | workout.js:448-458,743-756; workout-engine.js:718-723; ble-manager.js:491-501 | S1(J15),S3 | | | clamp 0–100; unit "%"; target stat "--"; zone from resistance bands |
| J-FREE-03 | Free-ride whole workout (no structure, `isFreeRideActive`) | workout-engine.js:583 | S1(J16) | | | same manual path as in-segment freeride |
| J-FREE-04 | ERG/Resistance mode toggle (`#modeToggle` buttons) | workout.js:1567-1580; index.html:273-289 | S1(J15),S2,S3 | | | visible only when active+isFreeRideActive; no-op clicking active mode |
| J-FREE-05 | `E` key → ERG mode | workout.js:1703-1715 | S1,S2 | | | active+freeRide only |
| J-FREE-06 | `R` key → Resistance mode | workout.js:1717-1729 | S1,S2 | | | active+freeRide only |
| J-FREE-07 | Manual −/+ buttons (±10 W ERG or ±10% resistance) | workout.js:1582-1599; index.html:293-304 | S1(J15),S2 | | | routes by freeRideMode |
| J-FREE-08 | Manual value input (commit Enter/blur, clamped) | workout.js:996-1043,1601-1613; index.html:296-302 | S1(J15),S2 | | | |
| J-FREE-09 | ↑/k = +10, ↓/j = −10 manual target | workout.js:1680-1692 | S1,S2 | | | isFreeRideActive only |
| J-FREE-10 | Forced trainer send on manual edit (bypass throttle) | workout-engine.js:711-723; ble-manager.js:510-514,527-531 | S1(J20),S3 | | | mode toggle force-sends |
| J-FREE-11 | Manual controls gated (no-op when no active free-ride) | workout.js:1588-1592 | S4 | | | |
| J-FREE-12 | Striped chart fill marks freeride segments | workout-chart.js:70-128 | S1(J15) | | | |

---

## Library / Picker

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-PICK-01 | Browse library — scan `.zwo`, render rows with metrics | workout-picker.js:72-87,645-748 | S1(J36),S2 | | | |
| J-PICK-02 | Folder-config gate — opening picker w/o folder alerts + opens Settings | workout.js:209-222,219 | S1(J6),S4 | | | [HIGH] "Choose a VeloDrive folder first…" |
| J-PICK-03 | Expand/collapse row (toggle one row, chart/desc/tags/stats) | workout-picker.js:724-727,745-750 | S1(J36),S2 | | | |
| J-PICK-04 | Search by tokens + duration ranges (60-90 / >45 / 90m) | workout-picker.js:401-462,2054-2070; index.html:434-438 | S1(J37),S2 | | | |
| J-PICK-05 | Search clear button (visible when non-empty) | workout-picker.js:2071-2079 | S2 | | | |
| J-PICK-06 | Zone filter dropdown (Recovery…Anaerobic) | workout-picker.js:391-393,2081-2087 | S1(J37),S2 | | | hidden in builder |
| J-PICK-07 | Duration filter dropdown (buckets 1–30…>240) | workout-picker.js:395-399,2089-2095 | S1(J37),S2 | | | hidden in builder |
| J-PICK-08 | Sortable column headers (name/if/tss/duration/kjAdj) | workout-picker.js:1290-1308; index.html:650-680 | S1(J37),S2 | | | toggle dir; default kjAdj asc; zone/source not sortable |
| J-PICK-09 | `/` focus+select search | workout-picker.js:1372-1377 | S1,S2 | | | works regardless of focus |
| J-PICK-10 | Enter (search focused) → expand first result, focus Select | workout-picker.js:1379-1392 | S1,S2 | | | |
| J-PICK-11 | Escape (search focused) → clear search, blur (no close) | workout-picker.js:1393-1398 | S2,S3 | | | why HUD Esc defers |
| J-PICK-12 | `z` focus+open zone filter | workout-picker.js:1402-1407 | S1,S2 | | | |
| J-PICK-13 | `d` focus+open duration filter | workout-picker.js:1409-1414 | S1,S2 | | | |
| J-PICK-14 | ↑/↓/j/k navigate select options (when select focused) | workout-picker.js:1417-1422,1336-1362 | S2 | | | |
| J-PICK-15 | ↓/j / ↑/k move row expansion (wraps) | workout-picker.js:1480-1490,1259-1275 | S1,S2 | | | |
| J-PICK-16 | Enter (table) → select expanded workout | workout-picker.js:1445-1466 | S2 | | | library doSelectWorkout / schedule onScheduleSelected |
| J-PICK-17 | `e` → open expanded workout in builder | workout-picker.js:1468-1478 | S1,S2 | | | not schedule mode |
| J-PICK-18 | Select workout to ride (Select button → engine load, close) | workout-picker.js:851-874,1575; storage.js:366 | S1(J39),S2 | | | |
| J-PICK-19 | "Visit website" (expanded) opens sourceURL | workout-picker.js:768-788 | S2 | | | hidden in schedule mode |
| J-PICK-20 | Delete workout → confirm "Move to trash?" → trash + rescan | workout-picker.js:791-805,1668,1681; planner-analysis.js:305 | S1(J38),S2,S4 | | | timestamped trash filename |
| J-PICK-21 | Clone workout → "Copy (N)" dedupe, save, focus clone | workout-picker.js:807-831,1004-1043 | S1(J32),S2 | | | saves immediately, no builder |
| J-PICK-22 | Edit workout → open in builder | workout-picker.js:834-848,1155-1179 | S1(J31),S2 | | | |
| J-PICK-23 | Create workout button (`#pickerAddWorkoutBtn`) | workout-picker.js:2008-2013; index.html:478-493 | S1,S2 | | | hidden in builder/schedule |
| J-PICK-24 | Close picker (`#workoutPickerCloseBtn`, unsaved-builder confirm) | workout-picker.js:1997-2001 | S2 | | | |
| J-PICK-25 | Click-outside backdrop close (picker-mode only) | workout-picker.js:2036-2052 | S2 | | | suppressed in planner mode |
| J-PICK-26 | Footer hint (display-only key legend) | index.html:688-695 | S2 | | | |
| J-PICK-27 | Picker state persisted/restored (search/sort/filters) to IDB | workout-picker.js:1496-1533 | S1(J37) | | | |
| J-PICK-28 | Empty library panel "No workouts found. Add your first…" | workout-picker.js:652-659; index.html:634-644 | S2,S4 | | | empty-state Add button |
| J-PICK-29 | Picker detail — no structure → "No workout structure available." | workout-chart.js:1133,1147 | S4 | | | |
| J-PICK-30 | Picker detail description empty → blank styling | workout-picker.js:958 | S4 | | | |

---

## Builder

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-BLD-01 | Build from scratch (`enterBuilderMode`, seed warmup or restore draft) | workout-picker.js:1181-1198; workout-builder.js:967-981; builder-backend.js:161-187 | S1(J30) | | | restores unsaved draft from IDB |
| J-BLD-02 | Edit existing (load canonical, suppress-dirty, capture baseline) | workout-picker.js:1155-1179; workout-builder.js:1057-1068 | S1(J31) | | | rename moves old .zwo to trash on save |
| J-BLD-03 | `handleAnyChange` recompute metrics/chart/errors + persist draft | workout-builder.js:1134-1166 | S1(J30) | | | dirty tracked via canonicalEquals |
| J-BLD-04 | Save builder workout to `.zwo` (validate, rename→trash, write) | workout-picker.js:1692-1759,1783-1845; zwo.js:1022-1065 | S1(J33),S2 | | | overwrite→trash first |
| J-BLD-05 | Validate-for-save (name/source/desc/≥1 block) | workout-builder.js:1070-1132 | S1(J34) | | | red borders + status, save blocked |
| J-BLD-06 | Builder name-required inline validation | workout-builder.js:1085,1109-1110 | S4 | | | wb-input-error class |
| J-BLD-07 | Builder source-required inline validation | workout-builder.js:1086-1090 | S4 | | | |
| J-BLD-08 | Builder description-required inline validation | workout-builder.js:1092-1096 | S4 | | | |
| J-BLD-09 | Builder empty-code (zero blocks) validation | workout-builder.js:1098-1102,1715 | S4 | | | "Workout code is empty." / "no intervals to save" |
| J-BLD-10 | Insertion-cursor movement (Ctrl+A/E, Home/End, g/$, h/l/←/→) | workout-builder.js:525-538,796-843 | S2 | | | no-selection mode |
| J-BLD-11 | Cursor power adjust j/k/↓/↑ (±5%, Shift ×5) | workout-builder.js:844-864 | S2 | | | adjusts blocks around cursor |
| J-BLD-12 | Block-insert keys R/E/T/S/V/A/W/C/I/F/X (auto-select) | workout-builder.js:638-681 | S2 | | | zones + warmup/cooldown/intervals/freeride/textevent |
| J-BLD-13 | Block-insert palette buttons (no auto-select) | workout-builder.js:338-368 | S2 | | | labels collapse on narrow widths |
| J-BLD-14 | Undo/redo (Ctrl+Z/U, Ctrl+Shift+Z/Y/Shift+U) + toolbar btns | workout-builder.js:541-559,173-191 | S2 | | | disabled when !canUndo/!canRedo |
| J-BLD-15 | Copy/Cut/Paste (Ctrl+C/X/V, P, Insert variants, y) | workout-builder.js:568-602,623-629,193-211 | S2 | | | ZWO XML / VELO_TEXT_EVENTS clipboard |
| J-BLD-16 | Shift+H/L/← /→ range-select extend | workout-builder.js:604-619 | S2 | | | |
| J-BLD-17 | d/Delete/Backspace delete (text-event > block priority) | workout-builder.js:683-719 | S2 | | | cursor-delete fallthrough |
| J-BLD-18 | Builder Escape: deselect → else exit builder (unsaved confirm) | workout-builder.js:724-740 | S2,S3 | | | 2-level; global handler defers via isBuilderMode |
| J-BLD-19 | Builder Enter: deselect / select block at cursor | workout-builder.js:724-755 | S2 | | | |
| J-BLD-20 | Builder Space: toggle insertion cursor edge | workout-builder.js:770-788 | S2 | | | stops propagation (won't start workout) |
| J-BLD-21 | Selected-block attribute edit (h/l dur, j/k power, Shift ×5) | workout-builder.js:930-957,872-928 | S2 | | | edge decided by isInsertionAtEndOfSelection |
| J-BLD-22 | Move-left/right & delete-block toolbar buttons | workout-builder.js:142-168 | S2 | | | exactly one selected |
| J-BLD-23 | Block steppers −/+ & number input (dur/power/cadence/reps) | workout-builder.js:2027-2073,1733-1926 | S2 | | | dynamic dur step; cadence allows empty |
| J-BLD-24 | Text-event editor (duration / "Starts at" offset / cue text) | workout-builder.js:428-467,492-496 | S2 | | | offset step 15 |
| J-BLD-25 | Meta inputs (Name/Author-Source/Description auto-grow) | workout-builder.js:75-96 | S2 | | | wb-input-error on failed save |
| J-BLD-26 | Builder chart: click block/segment handle → select + cursor | workout-builder.js:2740-2751; workout-chart.js:1797-1806 | S2 | | | |
| J-BLD-27 | Builder chart: click text-event marker → select | workout-builder.js:2394-2436 | S2 | | | |
| J-BLD-28 | Builder chart: drag text-event marker (snap 15s, clamp) | workout-builder.js:2598-2605 | S2 | | | |
| J-BLD-29 | Builder chart: drag handle top → set power (steady/ramp/intervals) | workout-builder.js:2647-2678 | S2 | | | ramp thirds = low/high/both; interval even/odd |
| J-BLD-30 | Builder chart: drag handle right → set duration (snapped) | workout-builder.js:2682-2715 | S2 | | | interval even/odd on/off duration |
| J-BLD-31 | Builder chart: drag handle move → reorder block | workout-builder.js:2607-2642,2738-2739 | S2 | | | live drop indicator |
| J-BLD-32 | Builder chart: drag threshold 4px (click vs drag) | workout-builder.js:42,2589-2594 | S2 | | | |
| J-BLD-33 | Builder chart: Shift+click range-select / click empty → cursor | workout-builder.js:1367-1396; workout-chart.js:1797-1894 | S2 | | | |
| J-BLD-34 | Back to library (`#workoutBuilderBackBtn`, unsaved confirm) | workout-picker.js:2015-2020,1847-1869 | S1(J31),S2 | | | |
| J-BLD-35 | Builder shortcut hint (`#builderShortcuts`, display-only) | workout-picker.js:1137-1153 | S2 | | | per selection state |
| J-BLD-36 | Builder empty status / blank stats | workout-builder.js:1587,1173-1180 | S4 | | | "Empty workout. Add elements." / "--" |
| J-BLD-37 | Builder state persist failure → silent console.warn | workout-builder.js:1162-1164 | S4 | | | editing continues |
| J-BLD-38 | Format parsing ZWO↔canonical (parse/serialize) | zwo.js:1076-1127,105-744,1022-1065 | S1(J35) | | | SteadyState/Warmup/Cooldown/Ramp/IntervalsT/FreeRide/MaxEffort/RestDay/TextEvents |
| J-BLD-39 | Format parsing FIT↔canonical (dev-field JSON or reconstruct) | fit-file.js:786-803,848-1141 | S1(J35) | | | |

---

## Planner / History

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-PLAN-01 | Open planner (`C`/calendar btn) → today selected+centered | workout-planner.js:1397-1423 | S1(J40),S2 | | | |
| J-PLAN-02 | Calendar button blocked/hidden during active workout | workout.js:1615-1625,1620; index.html:247-257 | S2,S4 | | | no-op while running |
| J-PLAN-03 | Infinite vertical scroll (recycles week rows, no prev/next) | workout-planner.js:1248-1267,839-850 | S2 | | | keyboard selection auto-scrolls |
| J-PLAN-04 | Day cell click → setSelectedDate (label/agg/schedule btn/scroll) | workout-planner.js:1269-1273,1443-1444 | S2 | | | |
| J-PLAN-05 | today/selected highlight classes | workout-planner.js:1045-1075,812-821 | S2,S3 | | | |
| J-PLAN-06 | Planner nav keys j/k/h/l & arrows (±7/±1 day) | workout-planner.js:1375-1394 | S2 | | | not detail, no input focus |
| J-PLAN-07 | Planner Enter cascade (history→detail / scheduled→load / future→schedule) | workout-planner.js:1325-1346 | S2 | | | |
| J-PLAN-08 | Planner `e` edit scheduled / open schedule picker | workout-planner.js:1348-1365 | S2 | | | no edit on past empty day |
| J-PLAN-09 | Planner d/Delete → delete first cell item (confirm) | workout-planner.js:1367-1373 | S2 | | | scheduled or history-to-trash |
| J-PLAN-10 | Planner calendar Escape → NO-OP (deliberate, never closes) | workout-planner.js:1316-1319 | S2,S3 | | | |
| J-PLAN-11 | `?` (held) reveal hotkey list (hides aggregates) | workout-planner.js:1275-1283,1445-1466 | S1(J44),S2 | | | questionHeld prevents auto-repeat |
| J-PLAN-12 | Schedule workout on day → picker schedule mode → applyScheduledEntry | workout-planner.js:891-905,1551-1595; workout-picker.js:1923 | S1(J40),S2 | | | persistSchedule to schedule.json |
| J-PLAN-13 | Schedule button hidden on past dates | workout-planner.js:903-904,1497-1504 | S2,S4 | | | display:none |
| J-PLAN-14 | Drag-reschedule scheduled card to another day | workout-planner.js:457-471,985-1023,223-258 | S1(J41),S2 | | | |
| J-PLAN-15 | Drag past-date rejection (dragover/drop reject; same-day no-op) | workout-planner.js:985-995,226 | S1(J41),S2,S4 | | | [HIGH] future-only; today allowed |
| J-PLAN-16 | Schedule-add gated to non-past (multiple guard spots) | workout-planner.js:988,1007,1340,1361 | S4 | | | [HIGH] isPastDate vs isPastOrTodayDate semantics |
| J-PLAN-17 | Scheduled card click body → load/start | workout-planner.js:449-456 | S2 | | | only when !entry.missing |
| J-PLAN-18 | Scheduled card edit (future=pencil) / delete (past=trash) buttons | workout-planner.js:380-398 | S2 | | | stops propagation |
| J-PLAN-19 | View history on calendar (loadHistoryPreview, render card) | workout-planner.js:958-970,260-353; planner-backend.js:163 | S1(J42),S2 | | | auto-attaches as rows recycle |
| J-PLAN-20 | View ride detail (FIT parse, stats, power-curve, live trace) | workout-planner.js:630-761; planner-analysis.js:5-271 | S1(J43),S2 | | | |
| J-PLAN-21 | Post-ride stats: NP/IF/TSS/VI/EF/HR/cadence + power curve | planner-analysis.js:173-271; workout-chart.js:471-702 | S1(J24) | | | power curve 1s→8h |
| J-PLAN-22 | Power-curve hover (log duration axis, dot + label) | workout-chart.js:663-701 | S2 | | | binary-search interpolate |
| J-PLAN-23 | Detail mode keys: d/Delete trash, Backspace/Esc exit | workout-planner.js:1299-1312 | S1(J43),S2 | | | |
| J-PLAN-24 | History detail gated to past/today (future returns false) | workout-planner.js:631 | S4 | | | |
| J-PLAN-25 | View period totals (3/7/30-day rolling load) | workout-planner.js:919-940; planner-backend.js:312-376 | S1(J44),S2 | | | scheduled counts today-forward |
| J-PLAN-26 | Footer aggregates display (min·kJ·TSS, hidden when hotkeys shown) | workout-planner.js:936-955; index.html:883-888 | S2 | | | |
| J-PLAN-27 | Selected-date label (aria-live display) | workout-planner.js:805-810; index.html:724-728 | S2 | | | |
| J-PLAN-28 | Close planner / Back from detail buttons | workout-planner.js:1469-1477 | S2 | | | |
| J-PLAN-29 | Planner click-outside backdrop close (planner-mode) | workout-planner.js:1479-1495 | S2 | | | |
| J-PLAN-30 | Empty schedule/history day → blank cell; pruned when empty | workout-planner.js:521-531,602-612 | S4 | | | |
| J-PLAN-31 | Delete history detail confirm | workout-planner.js:508 | S4 | | | "Move workout … to the trash folder?" |
| J-PLAN-32 | Delete scheduled (cell) confirm | workout-planner.js:573 | S4 | | | "Delete scheduled workout … on {date}?" |
| J-PLAN-33 | Delete history (cell) confirm | workout-planner.js:590 | S4 | | | |
| J-PLAN-34 | OnWorkoutEnded → remove today's scheduled, open detail | workout.js:1368-1390; workout-planner.js:1520 | S1(J24) | | | |

---

## Import

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-IMP-01 | Import via extension scrape (TR/TD/WhatsOnZwift) | background.js:44-132; content.js:25-146; scrapers.js:263-378 | S1(J26) | | | host-check, VD_SCRAPE_WORKOUT/RESULT |
| J-IMP-02 | Scrape-on-window-focus auto-pull (concurrency-guarded) | workout.js:1786-1792,1122-1221 | S1(J27) | | | [HIGH] save .zwo, open picker, auto-load if idle |
| J-IMP-03 | Scrape concurrency guard (re-entrancy) | workout.js:1124 | S4 | | | early return |
| J-IMP-04 | Scrape import failed → alert with title+error | workout.js:1150 | S4 | | | re-scrape from source |
| J-IMP-05 | Save scraped to library failed → alert | workout.js:1161 | S4 | | | |
| J-IMP-06 | Imported but picker won't open → alert (import kept) | workout.js:1175 | S4 | | | [HIGH] partial success preserved |
| J-IMP-07 | Imported but engine load failed → alert (import kept) | workout.js:1196 | S4 | | | [HIGH] partial success preserved |
| J-IMP-08 | Unexpected scrape-handling failure → alert | workout.js:1205 | S4 | | | reload |
| J-IMP-09 | Failed to clear scrape flag → alert | workout.js:1214 | S4 | | | flag may re-trigger |
| J-IMP-10 | Scrape failed — "open VeloDrive anyway?" confirm (extension) | content.js:172 | S4 | | | defaults to open if confirm throws |
| J-IMP-11 | Import TrainerDay URL into builder (prompt → fetch bySlug) | workout-picker.js:275-303; scrapers.js:562-579,443-525 | S1(J28),S2 | | | |
| J-IMP-12 | TrainerDay URL parse/HTTP errors (404/401-403/429/5xx/CORS/offline) | scrapers.js:474-489,458-470,492; workout-picker.js:279,285 | S1(J28),S4 | | | [HIGH] status-specific messages, load-bearing |
| J-IMP-13 | Import file upload (.zwo/.fit only, branch by ext) | workout-picker.js:305-359; fit-file.js:848-1141; zwo.js:1076-1127 | S1(J29),S2 | | | |
| J-IMP-14 | File upload parse error → alert "Unable to load workout file." | workout-picker.js:340 | S1(J29),S4 | | | invalid/empty/no rawSegments |
| J-IMP-15 | Scrape CORS blocked (TrainerRoad) → structured message | scrapers.js:308-312 | S4 | | | [HIGH] "allow VeloDrive access… Site Access" |
| J-IMP-16 | Scrape offline → structured message | scrapers.js:315-319 | S4 | | | |
| J-IMP-17 | TrainerRoad courseData empty → structured error | scrapers.js:330,158 | S4 | | | "doesn't contain interval data…" |
| J-IMP-18 | Extension host-check → opens options page if unsupported | background.js:44-132 | S1(J26) | | | |

---

## Dark-mode rendering (known-weak area)

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-DARK-01 | Theme mechanism: 3 dark sources (`@media auto`, `.theme-dark`, `.theme-light`) | theme-init.js:1-15; workout-base.css:91-315 | S3 | | | auto = no class → prefers-color-scheme |
| J-DARK-02 | All overlays variable-driven (no per-component dark rules) | welcome/settings/picker/planner.css | S3 | | | recolor via workout-base.css vars |
| J-DARK-03 | Surfaces collapse — bg/surface/surface-elevated/nav all #222 | workout-base.css:247-315 | S3 | | | [HIGH] modals don't separate from page except shadow |
| J-DARK-04 | Modal elevation lost (z45/46/50 panels + dark shadow on #222) | workout-picker.css; settings.css; workout-planner.css | S3 | | | [HIGH] box-shadow rgba(0,0,0,.35) near-invisible |
| J-DARK-05 | Welcome illustration SVGs hardcoded light-mode hex linework | img/trainer.svg/browser.svg/builder.svg | S3 | | | [HIGH] near-black #1a1a1a/#4d4d4d low contrast |
| J-DARK-06 | Chart colors read live via getCssVar — MUST redraw on theme change | workout-chart.js | S3 | | | [HIGH] stale line/shade colors otherwise |
| J-DARK-07 | `--shade-bg` inverts: white@5% dark vs black@5% light | workout-chart.js:2021 | S3 | | | [HIGH] starkest chart inversion |
| J-DARK-08 | Line color hue changes: power #ffb300 dark vs #a607a6 light | workout-base.css:124 | S3 | | | hr/cad/ftp also theme-specific |
| J-DARK-09 | Connection dots hardcoded (grey/amber/green/red) theme-agnostic | workout-base.css:600-620 | S3 | | | fine on #222 |
| J-DARK-10 | Battery-low orange #f57c00 hardcoded, color-only signal | workout-base.css:622-624 | S3 | | | easy to miss either theme |
| J-DARK-11 | `theme-color` meta only follows OS prefers-color-scheme | index.html:37-46 | S3 | | | [HIGH] forced-theme mismatches browser chrome |
| J-DARK-12 | Native confirm/alert dialogs render in OS theme not app theme | workout.js:1645; storage.js:498 | S3 | | | hard mismatch in dark |
| J-DARK-13 | status-overlay (countdown/paused) theme-specific bg + text-shadow | workout-base.css:922-944,939-944 | S3 | | | relies on theme class before paint |
| J-DARK-14 | Hover overlays flip black-alpha → white-alpha | workout-base.css:655-849 | S3 | | | nav/control/playback/planner-day |
| J-DARK-15 | Chart empty overlay bg `--chart-empty-bg` rgba(34,34,34,.8) + glow | workout-base.css | S3 | | | |
| J-DARK-16 | Planner palette: selected/today maroon-brown vs pink/cream | workout-planner.css:548-552 | S3 | | | |
| J-DARK-17 | Builder block active filter & insert line theme-specific | workout-base.css; workout-builder.js | S3 | | | brightness 1.4/sat 0.8 dark; insert #6ba8ff |
| J-DARK-18 | Tooltip dark: bg #303030, text #ddd, heavier shadow | workout-base.css:486-493 | S3 | | | |
| J-DARK-19 | Manifest theme/bg #222222 matches dark surface | velodrive.webmanifest:1-20 | S3 | | | |

---

## Hotkeys / Escape-context (known-weak area)

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-KEY-01 | HUD global keydown suppression (welcome/modal/input/meta guards) | workout.js:1653 | S2 | | | |
| J-KEY-02 | Space = start/toggle pause (HUD) | workout.js:1663-1671 | S1,S2 | | | suppressed if modal/input |
| J-KEY-03 | `w` = open picker (no active workout only) | workout.js:1694-1701 | S1,S2 | | | blocked during active workout |
| J-KEY-04 | `s` = open settings (HUD) | workout.js:1731-1735 | S1,S2 | | | |
| J-KEY-05 | `c` = open planner (blocked during active workout) | workout.js:1737-1744 | S1,S2 | | | |
| J-KEY-06 | `e`/`r` = ERG/Resistance (active+freeRide only) | workout.js:1703-1729 | S1,S2 | | | context-collision: e=edit in picker/planner, Endurance in builder |
| J-KEY-07 | ↑/k, ↓/j = manual ±10 (HUD free-ride) | workout.js:1680-1692 | S1,S2 | | | context-collision: move in picker/planner, power in builder |
| J-KEY-08 | HUD Escape layered dispatcher (builder→search→detail→planner→picker) | workout.js:1747-1772 | S1,S2,S3 | | | [HIGH] most context-split key |
| J-KEY-09 | Escape stacking order — 10-level precedence (no central stack) | workout.js:1747-1772; per-overlay handlers | S3 | | | [HIGH] 5 independent listeners; main mis-handling risk |
| J-KEY-10 | Welcome Escape absorbs exclusively (stopImmediatePropagation) | welcome.js:706-748 | S2,S3 | | | z60 topmost |
| J-KEY-11 | Builder Escape: 1st deselect, 2nd back-to-library | workout-builder.js:724-740 | S2,S3 | | | global+picker handlers defer via isBuilderMode |
| J-KEY-12 | Picker schedule-mode Escape/Backspace → return to planner | workout-picker.js:1432-1443 | S2,S3 | | | only picker state where own handler closes on Esc |
| J-KEY-13 | Picker search Escape → clear search (no close) | workout-picker.js:1393-1398 | S2,S3 | | | HUD Esc defers here |
| J-KEY-14 | Planner calendar Escape → no-op (never closes) | workout-planner.js:1316-1319 | S2,S3 | | | |
| J-KEY-15 | Planner detail Escape/Backspace → exit detail only | workout-planner.js:1309-1312 | S2,S3 | | | |
| J-KEY-16 | Settings Escape: logs→main, else close (uncoordinated) | settings.js:613-624 | S2,S3 | | | [HIGH] separate listener, can co-fire over picker |
| J-KEY-17 | Modal stacking suppresses HUD keys (`isAnyModalOpen`) | workout.js | S2 | | | welcome-active suppresses everything |
| J-KEY-18 | Picker keydown bails in builder mode / meta-ctrl-alt | workout-picker.js:1364-1420 | S2 | | | /,z,d checked before input early-return |
| J-KEY-19 | Planner `?`/`/` keyup → hide hotkey list (if held) | workout-planner.js:1280-1283,1457-1466 | S2 | | | |

---

## Edge / Error / Guard

| ID | Journey / interaction / state | Legacy code (file:line) | Source scour(s) | New-app impl (file:line or GAP) | Status | Notes/severity |
|---|---|---|---|---|---|---|
| J-ERR-01 | FSA unsupported (pick root) → compat alert, returns null | storage.js:499,498-505 | S3,S4 | | | "requires File System Access… chrome://flags" |
| J-ERR-02 | Folder picker not in build → alert | settings.js:305 | S4 | | | "not available in this build" |
| J-ERR-03 | Root folder permission denied → alert | storage.js:512 | S4 | | | "Permission was not granted…" |
| J-ERR-04 | Root folder choose failed (non-Abort) → alert | storage.js:537,314 | S4 | | | AbortError silent |
| J-ERR-05 | No root dir before picking workout → alert + open Settings | workout.js:219 | S4 | | | [HIGH] ensureRootDirConfiguredForWorkouts |
| J-ERR-06 | FSA permission helper (`ensureDirPermission` prompt→request) | storage.js:310-317 | S3,S4 | | | [HIGH] re-auth pattern, invisible until op fails |
| J-ERR-07 | No history folder (move-to-trash) → alert | planner-analysis.js:310 | S4 | | | |
| J-ERR-08 | No trash folder (history) → alert | planner-analysis.js:316 | S4 | | | |
| J-ERR-09 | History src permission revoked → alert re-authorize | planner-analysis.js:327 | S4 | | | |
| J-ERR-10 | Trash permission revoked (history) → alert | planner-analysis.js:333 | S4 | | | |
| J-ERR-11 | History trash move failure → alert, returns false | planner-analysis.js:362 | S4 | | | |
| J-ERR-12 | No library folder (trash move) → alert | workout-picker.js:1596 | S4 | | | |
| J-ERR-13 | No trash folder (library) → alert | workout-picker.js:1604 | S4 | | | |
| J-ERR-14 | Library src permission revoked → alert | workout-picker.js:1617 | S4 | | | |
| J-ERR-15 | Library trash permission revoked → alert | workout-picker.js:1625 | S4 | | | |
| J-ERR-16 | Library trash move failure → alert | workout-picker.js:1661 | S4 | | | |
| J-ERR-17 | Delete workout — no library folder → alert | workout-picker.js:1674 | S4 | | | |
| J-ERR-18 | Builder unavailable on save → alert | workout-picker.js:1696 | S4 | | | |
| J-ERR-19 | Builder save — no intervals → alert | workout-picker.js:1715 | S4 | | | |
| J-ERR-20 | Builder save unexpected failure → alert | workout-picker.js:1753 | S4 | | | |
| J-ERR-21 | Save canonical — no library folder → alert | workout-picker.js:1787 | S4 | | | |
| J-ERR-22 | Save canonical — permission revoked → alert | workout-picker.js:1795 | S4 | | | |
| J-ERR-23 | Overwrite — move old to trash failed → alert, save aborted | workout-picker.js:1817,1814-1822 | S4 | | | [HIGH] move-old-to-trash-first prevents data loss |
| J-ERR-24 | Write new file failed → alert | workout-picker.js:1837 | S4 | | | |
| J-ERR-25 | Unsaved builder changes discard → confirm | workout-picker.js:1851 | S4 | | | OK=discard / Cancel=stay |
| J-ERR-26 | Compatibility alert — unsupported OS (iOS/Unknown) | settings.js:425-426,418,439 | S3,S4 | | | [HIGH] banner + auto-open |
| J-ERR-27 | Compatibility alert — unsupported browser (non-Chromium) | settings.js:427-428 | S3,S4 | | | |
| J-ERR-28 | Web Bluetooth not detected (settings status, red) | settings.js:405-415,651-655 | S3,S4 | | | advisory only, doesn't block playback |
| J-ERR-29 | Missing root dir at startup (status, full welcome forced) | settings.js:285-300; workout.js:205 | S3,S4 | | | |
| J-ERR-30 | Bike connect throws if no BT → status error | ble-manager.js:1007 | S4 | | | |
| J-ERR-31 | HRM connect throws if no BT → status error | ble-manager.js:1049 | S4 | | | |
| J-ERR-32 | FIT parse error in planner detail → stays in calendar silently | workout-planner.js:757-760 | S4 | | | [HIGH] only console.warn, no alert |
| J-ERR-33 | Metrics — empty segments → returns early (no chart/metrics) | workout-metrics.js:248 | S4 | | | |
| J-ERR-34 | Four-state chart empty overlay machine (connect→select→start→resume) | workout.js:843-869,897-905 | S3,S4 | | | [HIGH] directional arrows; easy to flatten |
| J-ERR-35 | Install PWA + offline (SW register, precache, network/cache strategy) | workout.js:1808-1815; service-worker.js:106-229 | S1(J7) | | | extension page skips SW |
| J-ERR-36 | SW activate deletes old caches, claims clients | service-worker.js:133-148 | S1(J7) | | | velodrive-cache-vN |
| J-ERR-37 | UNCONFIGURED — no folder state (forces full welcome) | storage.js:204-209; workout.js:184-238 | S3 | | | |
| J-ERR-38 | CONFIGURED state (folder name shown, picker unlocked) | settings.js:280-285; storage.js:204-209 | S3 | | | |
| J-ERR-39 | WEB vs PWA-installed detection | workout.js:152-205 | S3 | | | standalone / navigator.standalone / chrome-extension: |
| J-ERR-40 | Native dialog mode (confirm/alert/prompt — not themeable) | workout.js:1645; workout-engine.js:461 | S3,S4 | | | OS chrome, ignores app theme |

---

## Summary

- **Onboarding / Welcome:** 13
- **Config / Settings:** 22
- **Hardware / BLE:** 19
- **Ride Execution:** 35
- **Free-ride / Manual:** 12
- **Library / Picker:** 30
- **Builder:** 39
- **Planner / History:** 34
- **Import:** 18
- **Dark-mode rendering:** 19
- **Hotkeys / Escape-context:** 19
- **Edge / Error / Guard:** 40

**Total: 300 rows.**
