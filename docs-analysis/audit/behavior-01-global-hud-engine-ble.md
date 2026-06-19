# Behavior Audit 01 — Global Shell + HUD/Riding View + Engine + BLE

Read-only behavior audit. Legacy: `docs/` (vanilla JS). New rewrite: `web/src/` (TS + Svelte 5).
Scope: global shell, HUD/riding view, workout engine, BLE manager.

Line numbers are real lines read in each file at audit time.

---

## A. Global shell — DOM event listeners (workout.js)

| # | Legacy item (event/key/fn) | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| A1 | `DOMContentLoaded` → `initPage()` | workout.js:1799 | Boot the page | `main.ts:13` mounts `App`; `App.svelte:26` `$effect` calls `bootApp()` | OK | Equivalent boot path |
| A2 | `window.addEventListener("load")` → register service worker | workout.js:1809-1815 | PWA service-worker registration (guarded against `chrome-extension:`) | — | **GAP** | No service-worker registration anywhere in `web/src`. PWA offline support not reproduced. |
| A3 | `window.addEventListener("resize")` → `adjustStatFontSizes` + `drawChart` + planner rerender | workout.js:1778-1784 | Re-fit stat fonts, redraw chart, redraw planner charts on resize | StatCards `$effect` resize → `adjustStatFontSizes` (StatCards.svelte:50-54); LiveChart redraws via `$effect` (LiveChart.svelte:64-71) | PARTIAL | Stat-font resize OK; LiveChart does NOT listen to `resize` (only redraws on VM change), so chart does not re-fit on window resize. Planner rerender out of this scope. |
| A4 | `window.addEventListener("focus")` → `handleLastScrapedWorkout()` | workout.js:1786-1790 | On window focus, check for a just-scraped workout and import it | — | **GAP** | No focus listener and no scrape import flow at all. |
| A5 | `await handleLastScrapedWorkout()` on boot | workout.js:1792, 1122-1221 | Import just-scraped workout: save to ZWO dir, open picker, load into engine, alert on failure | PickerView has `engine.setWorkoutFromPicker` (PickerView.svelte:225) but no scrape-detection/import | **GAP** | Whole scraped-workout import pipeline absent (`wasWorkoutJustScraped`, `loadLastScrapedWorkout`, `clearJustScrapedFlag`). |
| A6 | `await maybeOpenPlannerForTodaySchedule()` on boot | workout.js:1793, 1292-1315 | Auto-open planner if today has a scheduled workout not already loaded | — | **GAP** | No auto-open-planner-for-today on boot. (Planner UI exists but is not auto-opened.) |
| A7 | `primeAudioContext()` + `pointerdown`/`keydown` once warm-up | workout.js:240-258, 1329 | Warm up the AudioContext on first user gesture | — | **GAP** | No audio priming on first gesture; Beeper lazily creates AudioContext on first `playBeep` only (beeper.ts:52-62). May incur first-cue latency / autoplay block. |
| A8 | `matchMedia("(prefers-color-scheme: dark)")` `change` → `rerenderThemeSensitive` | workout.js:1402-1406 | Re-render chart/stats when OS theme flips (auto mode) | — | **GAP** | No matchMedia listener. Auto-theme OS change won't re-tint stats/chart live. |
| A9 | `MutationObserver` on `<html>` class/data-theme → `rerenderThemeSensitive` | workout.js:1407-1415 | Re-render when theme attribute changes | — | **GAP** | No MutationObserver. Svelte reactivity re-derives `statColor` on VM change, but a pure theme attribute flip (no VM change) won't force a chart/stat repaint. |
| A10 | `isRunningAsPwa()` display-mode/standalone/extension detection | workout.js:152-182 | Detect PWA install for welcome flow | `SettingsView.svelte:133` uses `matchMedia('(display-mode: standalone)')` | PARTIAL | Detection exists in Settings; not wired into a welcome force-full decision in shell (welcome flow out of this area's deep scope). |

## B. Global hotkeys / keystrokes (workout.js keydown, lines 1653-1773)

Guard context for B-keys (unless noted): `!isWelcomeActive`, no meta/ctrl/alt, target not INPUT/TEXTAREA/SELECT, no modal open.

| # | Legacy key | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| B1 | global guard: skip if `isWelcomeActive` | workout.js:1654 | Suppress all hotkeys during welcome | App.svelte:65 `if (ui.activeOverlay !== 'none') return` (welcome is an overlay) | OK | Equivalent: any active overlay suppresses non-Escape keys. |
| B2 | global guard: skip on meta/ctrl/alt | workout.js:1655 | Ignore modified keys | App.svelte:54 `if (e.metaKey||e.ctrlKey||e.altKey) return` | OK | |
| B3 | global guard: skip when target INPUT/TEXTAREA/SELECT | workout.js:1664, 1675-1677 | Don't hijack typing | App.svelte:46-51,65 `isEditable()` (also checks `isContentEditable`) | OK | New version slightly broader (contentEditable). |
| B4 | `Space` (code) → `engine.startWorkout()` if a workout is selected | workout.js:1663-1671 | Start/toggle workout via spacebar | — | **GAP** | No Space handler in App.svelte `onKeydown`. Start/pause via spacebar not reproduced. |
| B5 | `ArrowUp`/`k` → +10 manual; `ArrowDown`/`j` → -10 manual (only when `isFreeRideActive`) | workout.js:1679-1692 | Adjust ERG watts / resistance ±10 via keys | — | **GAP** | No arrow/j/k manual-adjust hotkeys. Only the on-screen ± buttons exist (BottomNav.svelte:185,197). |
| B6 | `w` → open picker if no active workout | workout.js:1694-1701 | Open workout picker | App.svelte:74-77 → `openPicker()` (App.svelte:87-92, guards active workout) | OK | |
| B7 | `e` → `setFreeRideMode("erg")` when freeride active | workout.js:1703-1715 | Switch to ERG mode | — | **GAP** | No `e` hotkey. ERG/Resistance switch only via on-screen mode toggle (BottomNav.svelte:168). |
| B8 | `r` → `setFreeRideMode("resistance")` when freeride active | workout.js:1717-1729 | Switch to resistance mode | — | **GAP** | No `r` hotkey. |
| B9 | `s` → `openSettingsModal()` | workout.js:1731-1735 | Open settings | App.svelte:69-73 → `ui.open('settings')` | OK | |
| B10 | `c` → open planner if no active workout | workout.js:1737-1744 | Open calendar/planner | App.svelte:79-82 → `openPlanner()` (App.svelte:96-101, guards active workout) | OK | |
| B11 | `Escape` → picker/planner/detail dispose ladder | workout.js:1747-1772 | Builder-mode no-op; picker search clear vs close; planner detail exit vs close; else close picker | App.svelte:56-62 → `ui.handleEscape()` (ui.svelte.ts:43-51) | PARTIAL | New version closes the single active overlay (with a settings-logs sub-step). It does NOT replicate: leave picker open when search focused, exit planner *detail* before closing planner, or builder-mode no-op. Those nuances live inside the respective views (mostly out of this area, but the ladder is simplified). |

## C. Bottom-nav / HUD buttons & controls (workout.js init wiring)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| C1 | `workoutNameLabel` click → guard running + open picker | workout.js:1508-1519 | Click name to pick workout; alert if running | BottomNav.svelte:201-211 `onclick={onOpenPicker}` (+keydown Enter/Space) | PARTIAL | Opens picker (guarded by `openPicker` in App). No "End current workout first" alert when running; legacy alerts (workout.js:1513-1515). New just silently no-ops. |
| C2 | `bikeConnectBtn` click → BT-support check, `connectBikeViaPicker`, error status | workout.js:1525-1544 | Connect trainer | BottomNav.svelte:79 `onclick={onConnectBike}` → `transport.connectBikeViaPicker().catch(()=>{})` (BottomNav.svelte:57-59) | PARTIAL | Connect call present. Missing: `navigator.bluetooth.getDevices` support check + "browser doesn't support Bluetooth" alert + open Settings fallback; error swallowed silently (no error status set on failure beyond transport's own emit). |
| C3 | `hrConnectBtn` click → BT-support check, `connectHrViaPicker`, error status | workout.js:1546-1565 | Connect HRM | BottomNav.svelte:91 `onclick={onConnectHr}` → `transport.connectHrViaPicker().catch(()=>{})` (BottomNav.svelte:60-62) | PARTIAL | Same gaps as C2 (no support check/alert/Settings fallback). |
| C4 | `modeToggle` click (delegated `.mode-toggle-button`) → `setFreeRideMode` | workout.js:1567-1580 | Switch ERG/resistance, with same-mode no-op + log | BottomNav.svelte:163-176 per-button `onclick={() => onSetMode(...)}` → `engine.setFreeRideMode` | OK | Engine already no-ops on same mode (engine.ts:752-754). |
| C5 | `manualControls` click (delegated `.control-btn`, `data-delta`) → adjust erg/resistance, guarded by active+freeride | workout.js:1582-1599 | ±10 buttons | BottomNav.svelte:185,197 `onclick={() => onManualDelta(±10)}` → `onManualDelta` (BottomNav.svelte:66-69) | OK | Buttons only rendered when `freeRideUiActive` (BottomNav.svelte:183), preserving the guard. |
| C6 | `manualInputEl` keydown Enter → save + blur | workout.js:1601-1608, 1012-1043 | Commit typed manual value on Enter (normalize/clamp, diff→adjust) | BottomNav.svelte:186-194 `<input value={manualValue}>` | **GAP** | The manual `<input>` is read-only display: no `keydown`/Enter handler, no `blur` handler, no `handleManualInputSave`. Typed values are never committed to the engine. |
| C7 | `manualInputEl` blur → save | workout.js:1610-1612 | Commit typed manual value on blur | — | **GAP** | Same as C6 — no blur commit. |
| C8 | manual value normalization (erg clamp 50..2.5×FTP; resistance 0..100) | workout.js:996-1010 | Clamp typed values | — | **GAP** | Not ported (no input commit path). Engine `adjustManualErg` clamps 50..1500 on delta only (engine.ts:770-771). |
| C9 | `calendarBtn` click → open planner if not active | workout.js:1615-1625 | Open calendar | BottomNav.svelte:126-133 `onclick={onOpenPlanner}` (App `openPlanner` guards active) | OK | |
| C10 | `startBtn` click → `engine.startWorkout()` | workout.js:1627-1631 | Start | BottomNav.svelte:217-222 `onclick={onStartLike}` → `engine.startWorkout()` | OK | |
| C11 | `playBtn` click → `engine.startWorkout()` (resume) | workout.js:1633-1637 | Resume | BottomNav.svelte:226-234 `onclick={onStartLike}` | OK | startWorkout multiplexes resume. |
| C12 | `pauseBtn` click → `engine.startWorkout()` (pause) | workout.js:1639-1643 | Pause | BottomNav.svelte:237-246 `onclick={onStartLike}` | OK | |
| C13 | `stopBtn` click → `confirm()` then `engine.endWorkout()` | workout.js:1645-1651 | End + save (with confirm) | BottomNav.svelte:248-257 `onclick={onStop}` → `void engine.endWorkout()` (BottomNav.svelte:54-56) | PARTIAL | No `confirm("End current workout and save it?")` — ends immediately without confirmation. |
| C14 | settings button (rendered via S key only in legacy; button in new) | — | Open settings | BottomNav.svelte:112-124 `#settingsBtn onclick={onOpenSettings}` | OK | New adds an explicit settings nav button (legacy used the `s` key / settings.js wiring). |

## D. HUD render layer (stats, title, chart, mode UI)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| D1 | `updateStatsDisplay` power | workout.js:778-783 | Power text, clamp negatives to 0, `--` when null | hud-format.ts `powerText` (131-135); StatCards.svelte:61 | OK | |
| D2 | target power (erg manual or workout target) | workout.js:785-796 | Target watts | hud-format.ts `computeTargetPower`/`targetPowerText` (70-76,147-150) | OK | |
| D3 | HR text | workout.js:798-799 | HR or `--` | hud-format.ts `hrText` (137-139) | OK | |
| D4 | cadence text | workout.js:801-805 | Cadence or `--` | hud-format.ts `cadenceText` (141-145) | OK | |
| D5 | cadence indicator ▾/▴ (|delta|>5) | workout.js:807-821 | Up/down triangle when cadence off-target | hud-format.ts `cadenceIndicator` (99-109); StatCards.svelte:98-103 | OK | |
| D6 | elapsed/interval time text | workout.js:823-828 | HH:MM:SS + MM:SS | hud-format.ts `formatTimeHHMMSS`/`formatTimeMMSS`; StatCards.svelte:67,89 | OK | |
| D7 | zone color tint of stat values (mix 30% black) | workout.js:830-835, 734-773 | Color all `.stat-value span` by zone | hud-format.ts `statColor` (112-129); StatCards applies per-span `style="color:"` | PARTIAL | Resistance-mode zone override (Recovery..Anaerobic by % bands, workout.js:743-750) is NOT ported — `statColor` only handles erg/workout path, falling back to `lastSamplePower`. Resistance free-ride coloring differs. |
| D8 | `adjustStatFontSizes` dynamic font fit | workout.js:578-597 | Scale stat values to fill cards | StatCards.svelte:25-41 (verbatim port) | OK | |
| D9 | `updateWorkoutTitleUI` name label vs running title | workout.js:505-574 | Name label / center title swap | BottomNav.svelte:142-152 title-center, 200-213 name label | PARTIAL | Title-center shows only the static workout title. Missing the rich live coaching: per-segment "Maintain/Ramp/Free ride … watts for … at … RPM" (workout.js:425-485,557), "In N - " next-segment lookahead (workout.js:543-557), and "Speed up/Slow down - target N RPM" cadence coaching after 5s out-of-band (workout.js:531-538). |
| D10 | cadence out-of-bounds tracking (`updateCadenceOutOfBoundsState`, 5s persistence) | workout.js:380-423, 56-58 | Track sustained off-cadence direction for coaching text | — | **GAP** | No cadence-coaching timer/state in new HUD. (Cadence ▾/▴ indicator D5 exists, but the timed "Speed up/Slow down" message does not.) |
| D11 | `buildWorkoutTooltip` (title hover) | workout.js:299-330 | Tooltip with duration/zone/IF/TSS/FTP/kJ/description | BottomNav.svelte:148 `title={titleText}` (just the title string) | PARTIAL | Title-center `title` attribute is just the workout name; rich tooltip not reproduced. |
| D12 | `drawChart` empty-state machine (none/noBike/noWorkout/readyToStart/resume) | workout.js:843-906 | Overlay message + arrow per state | LiveChart.svelte:16-44 (same priority order + messages + arrow dir) | OK | Faithful port incl. priority. |
| D13 | `drawChart` → `drawWorkoutChart` (live profile + samples) | workout.js:875-924 | Render workout profile + live trace | LiveChart.svelte:46-71 `redraw()` → `drawWorkoutChart` | PARTIAL | Redraws on VM change; but does NOT pass `textEvents` (legacy passes `vm.canonicalWorkout.textEvents`, workout.js:919) — workout text-event markers won't render on the live chart. Also no `tooltipEl`/`mode` passed. |
| D14 | chart redraw on bike connect/disconnect | workout.js:637-640 (`setBikeStatus` triggers `drawChart`) | Redraw empty-state when bike connects | LiveChart `bikeConnected` prop is reactive (HudView.svelte:26, LiveChart empty-state `$derived`) | OK | Reactivity covers it. |
| D15 | `applyModeUI` — mode toggle + manual controls visibility, input value sync | workout.js:957-994 | Show/hide mode toggle + manual controls; sync input unless focused; W unit | BottomNav.svelte:154-213 (`freeRideUiActive` drives display; `manualValue`/`manualUnit` derived) | PARTIAL | Visibility + unit OK. Legacy avoids overwriting the input while focused (workout.js:971-987); new binds `value={manualValue}` unconditionally — but since there's no input commit (C6/C7) this is moot/display-only. |
| D16 | `maybePlayTextEvent` — play taps when a text event becomes active | workout.js:1065-1086, 1051-1063 | Audio tap cue on text-event onset (dedupe by key) | — | **GAP** | No text-event audio cue (`Beeper.playTextEventTaps` not ported; beeper.ts has no such method). |
| D17 | `updateStatusOverlay` (no-op; driven by Beeper overlays) | workout.js:1047-1049 | Paused/Resumed overlays | beeper.ts `showPausedOverlay`/`showResumedOverlay` (107-130) — requires `#statusOverlay`/`#statusText` DOM | PARTIAL | Beeper methods exist but require `#statusOverlay`/`#statusText` elements; those are not present in `App.svelte`/`HudView.svelte` markup, so paused/resumed/countdown overlays render nothing (countdown still fires onDone). |
| D18 | `renderFromEngine` orchestrator (called on every state change) | workout.js:1090-1107 | Drive all HUD updates per VM | Svelte reactivity: `store.set` (engine.svelte.ts:17) → `store.vm` derived in components | OK | Push model replaced by reactive store. |

## E. Engine public methods + transitions (workout-engine.js)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| E1 | `getWorkoutEngine()` singleton | workout-engine.js:19-22 | Lazy singleton | `new WorkoutEngine({...})` per boot (app.ts:30) | OK | Class instance via composition root (DI). |
| E2 | `init({onStateChanged,onLog,onWorkoutEnded})` | workout-engine.js:606-675 | Wire callbacks, subscribe BLE samples, load selected + active state, restore/crash-recovery, resume paused | engine.ts `init` (682-712) + `restoreActiveState` (714-742) | PARTIAL | Engine port faithful. But app.ts:59-62 only passes `onStateChanged`+`onLog` — `onWorkoutEnded` is NOT wired, so legacy end-of-workout planner/history flow (workout.js:1368-1390) is lost. |
| E3 | crash recovery: resume mid-workout in paused state | workout-engine.js:643-672 | `workoutPaused = running ? true` + startTicker + setPaused(true) | engine.ts:728-729, 706-709 | OK | Verbatim. |
| E4 | `setMode(newMode)` (workout only) | workout-engine.js:681-689 | Force mode "workout", send trainer state | engine.ts `setMode` (744-750) | OK | |
| E5 | `setFreeRideMode("erg"/"resistance")` | workout-engine.js:691-700 | Switch freeride mode, send trainer state | engine.ts `setFreeRideMode` (752-761) | OK | |
| E6 | `setFtp(newFtp)` | workout-engine.js:702-709 | Update FTP, persist, force trainer send | engine.ts `setFtp` (763-768) | OK | New adds `setFtpInitial` (engine.ts:806-809) for boot without send. |
| E7 | `adjustManualErg(delta)` clamp 50..1500 | workout-engine.js:711-716 | Adjust ERG target | engine.ts `adjustManualErg` (770-775) | OK | |
| E8 | `adjustManualResistance(delta)` clamp 0..100 | workout-engine.js:718-723 | Adjust resistance | engine.ts `adjustManualResistance` (777-782) | OK | |
| E9 | `setWorkoutFromPicker(canonical)` guard active + reset | workout-engine.js:728-756 | Load workout, reset counters, persist idle | engine.ts `setWorkoutFromPicker` (784-804) | OK | |
| E10 | `startWorkout()` multiplex: countdown→begin / resume / pause | workout-engine.js:459-512 | Start (countdown→beginRun), resume, or pause | engine.ts `startWorkout` (535-566) + `beginRun` (568-590) | OK | Refactored into `beginRun` but behavior-identical. |
| E11 | `endWorkout()` save FIT + reset + onWorkoutEnded | workout-engine.js:514-553 | Stop ticker, save FIT, reset, callback | engine.ts `endWorkout` (592-629) | OK | Engine-side faithful (onWorkoutEnded callback fires; consumer unwired — see E2). |
| E12 | auto-start from power (threshold max(75,0.5×startTarget)) | workout-engine.js:284-305 | Pedal-to-start | engine.ts `maybeAutoStartFromPower` (367-385) | OK | |
| E13 | auto-pause: power 0 for ≥1s (outside grace) | workout-engine.js:360-374 | Auto-pause on stop pedaling | engine.ts `tick` (441-453) | OK | |
| E14 | auto-resume: power ≥90% target (unless manual-block window) | workout-engine.js:398-411 | Auto-resume on resumed pedaling | engine.ts `tick` (477-489) | OK | |
| E15 | `handleIntervalBeep` (danger@9s ≥1.2FTP, beep@3s) | workout-engine.js:307-337 | Interval transition cues | engine.ts `handleIntervalBeep` (387-414) | OK | |
| E16 | ticker (1s): advance, sample push, auto-pause/resume, end-on-complete, persist | workout-engine.js:341-415 | Main loop | engine.ts `startTicker`/`tick` (418-492) | OK | Uses injected timers (engine.ts:142-146). |
| E17 | `handleBikeSample` | workout-engine.js:557-565 | Update power/cadence/hrFromBike, maybe auto-start | engine.ts `handleBikeSample` (633-641) | OK | |
| E18 | `handleHrSample` | workout-engine.js:567-570 | Update HR | engine.ts `handleHrSample` (643-646) | OK | |
| E19 | `getViewModel()` shape | workout-engine.js:574-602 | VM for UI | engine.ts `getViewModel` (650-678) | OK | Same fields. |
| E20 | persistence: `scheduleSaveActiveState`/`persistActiveState`/`persistIdleState` | workout-engine.js:184-230 | Debounced state save + crash snapshot | engine.ts:261-311 | OK | |
| E21 | `saveWorkoutFile()` FIT build + write | workout-engine.js:232-280 | Write FIT to workout dir | engine.ts `saveWorkoutFile` (313-363) | OK | Gated by `shouldSaveFit` dep (engine.ts:318). |
| E22 | `setTrainerState`/`desiredTrainerState`/`sendTrainerState` | workout-engine.js:158-180 | Compute + send ERG/resistance | engine.ts:236-257 | OK | |

## F. BLE manager — events, methods, listeners (ble-manager.js)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| F1 | `init({autoReconnect})` → `maybeReconnectSavedDevicesOnLoad` | ble-manager.js:993-1004, 938-986 | Auto-reconnect saved devices via `getDevices()` | WebBluetoothTransport `init` (120-125) + `maybeReconnectSavedDevices` (133-162) | PARTIAL | Reconnect-on-load present, but device IDs come from `setSavedDeviceIds` (app.ts:56-57) instead of `loadBleDeviceIds` internally; saved IDs are NOT persisted on successful connect (see F9). |
| F2 | `connectBikeViaPicker()` | ble-manager.js:1006-1046 | requestDevice + connect + backoff bookkeeping | WebBluetoothTransport `connectBikeViaPicker` (164-174) | PARTIAL | Connects, but no cancel-pending-auto-reconnect, no suppress-on-cancel disconnect, no reschedule-on-failure. |
| F3 | `connectHrViaPicker()` | ble-manager.js:1048-1085 | Same for HRM | WebBluetoothTransport `connectHrViaPicker` (176-186) | PARTIAL | Same simplifications as F2. |
| F4 | `setTrainerState(state, opts)` throttle/clamp | ble-manager.js:1087-1090, 503-543 | ERG/resistance write with 10s throttle | WebBluetoothTransport `setTrainerState` (364-396) | OK | Throttle + clamp ported (sendErg 0..2000, resistance 0..100×10). |
| F5 | `getLastBikeSample()` | ble-manager.js:1092-1094 | Snapshot last sample | — | **GAP** | Not exposed (no consumer needs it in new app; minor). |
| F6 | `on(type, fn)` / `off(type, fn)` event API | ble-manager.js:1096-1104 | Subscribe/unsubscribe | WebBluetoothTransport `on`/`off` (110-118) | OK | |
| F7 | `characteristicvaluechanged` on Indoor Bike Data → `parseIndoorBikeData` → emit `bikeSample` | ble-manager.js:660-665, 352-413 | FTMS parse | WebBluetoothTransport:198-201, `parseIndoorBikeData` (224-263) | OK | Same flag-walk + scaling (cad/2, speed/100, int16 power). |
| F8 | `characteristicvaluechanged` on FTMS Control Point → log indication | ble-manager.js:639-654 | Log CP indication result codes | — | **GAP** | New code subscribes to CP notifications (WebBluetoothTransport:197) but registers NO `characteristicvaluechanged` listener for CP indications — result codes are not read/logged. |
| F9 | `characteristicvaluechanged` on HR Measurement → `parseHrMeasurement` → emit `hrSample` | ble-manager.js:827-829, 415-432 | HR parse | WebBluetoothTransport:272-275, `parseHrMeasurement` (304-314) | OK | |
| F10 | `gattserverdisconnected` (bike) → status error, null sample, schedule reconnect, suppress-once logic | ble-manager.js:704-738 | Disconnect handling + auto-reconnect | WebBluetoothTransport `onBikeDisconnect` (216-222) | PARTIAL | Emits error status + null bikeSample. Missing: exponential-backoff auto-reconnect scheduling, suppress-once-after-manual, retry messaging. |
| F11 | `gattserverdisconnected` (HR) → status error, null hr/battery, schedule reconnect | ble-manager.js:873-903 | HR disconnect | WebBluetoothTransport `onHrDisconnect` (298-302) | PARTIAL | Emits error + null hrBattery + null hrSample. No auto-reconnect scheduling/backoff. |
| F12 | `requestControl` + `startOrResume` handshake on connect (fatal) | ble-manager.js:667-678 | FTMS control handshake | WebBluetoothTransport `connectToBike` (205-208) | OK | |
| F13 | HR battery read (optional, non-fatal) → emit `hrBattery` | ble-manager.js:833-847 | Read battery % | WebBluetoothTransport `connectToHr` (277-292) | OK | |
| F14 | emitted events: `log`,`bikeStatus`,`hrStatus`,`bikeSample`,`hrSample`,`hrBattery` | ble-manager.js:38-45 | Event surface | WebBluetoothTransport `listeners` (68-75) | OK | Same six events. |
| F15 | per-device exponential backoff reconnect (`scheduleBikeAutoReconnect`/`scheduleHrAutoReconnect`, 1s→10s) | ble-manager.js:208-346 | Resilient reconnect with backoff + status messaging | — | **GAP** | Entire backoff/retry subsystem absent. New app reconnects once on load only; a mid-session drop is not auto-retried. |
| F16 | save device IDs after confirmed-desired connect | ble-manager.js:692, 861 | Persist bike/HR IDs to storage | — | **GAP** | New transport never calls a save; IDs are only loaded at boot (app.ts:56) and set via `setSavedDeviceIds`. A newly paired device is not persisted for next-load reconnect. |
| F17 | stale-device teardown (desired ID changed mid-connect) | ble-manager.js:681-689, 850-858 | Tear down if no longer desired | — | **GAP** | No staleness check; new `connectTo*` commits unconditionally. |
| F18 | BLE `log` event forwarded to settings log | workout.js:682 (`BleManager.on("log", logDebug)`) | Surface BLE logs in settings | app.ts:60 `onLog: () => {}` (engine logs dropped); transport `log` not subscribed | **GAP** | Transport emits `log` but nobody subscribes (app.ts only wires bikeStatus/hrStatus/hrBattery, app.ts:33-41). BLE/engine logs go nowhere. |

---

## Gaps

(PARTIAL/GAP rows only; severity = user-facing impact.)

### High
- **A2 — Service-worker registration (GAP):** no PWA/offline support; installed app won't work offline.
- **A4/A5 — Scraped-workout import on focus (GAP):** the entire "import just-scraped workout" pipeline is missing; a core ingestion path is gone.
- **B4 — Space to start/pause (GAP):** primary keyboard control for starting/pausing a ride is absent.
- **C6/C7/C8 — Manual input commit (GAP):** typing a watts/resistance value and pressing Enter/blur does nothing; the manual `<input>` is display-only.
- **C13 — Stop without confirm (PARTIAL):** ending a workout no longer asks "End current workout and save it?" — easy to end a ride by accident.
- **E2 — `onWorkoutEnded` not wired (PARTIAL):** end-of-workout planner/history open + scheduled-entry removal lost; finishing a workout has no follow-up UX.
- **F15 — BLE backoff auto-reconnect (GAP):** a mid-session trainer/HRM dropout is not retried; user must manually reconnect.
- **F16 — Persist paired device IDs (GAP):** newly paired devices aren't saved, so auto-reconnect-on-load can't find them next session.

### Med
- **B5/B7/B8 — Manual ±10 (arrows/j/k) and `e`/`r` mode hotkeys (GAP):** keyboard control of free-ride watts/resistance and mode switching removed (on-screen buttons remain).
- **D9/D10/D11 — Live coaching title + cadence "Speed up/Slow down" + rich tooltip (GAP/PARTIAL):** running HUD shows only the static workout name; per-segment instructions, next-segment lookahead, sustained-cadence coaching, and the detailed tooltip are gone.
- **D13 — Chart text-event markers (PARTIAL):** `textEvents` not passed to `drawWorkoutChart`; on-chart workout messages won't appear.
- **D16 — Text-event audio taps (GAP):** no audio cue when a text event fires.
- **D17 — Paused/Resumed/countdown visual overlays (PARTIAL):** Beeper overlay methods require `#statusOverlay`/`#statusText` DOM that the new HUD never renders, so those big on-screen messages don't show.
- **C2/C3 — Bluetooth-support check + Settings fallback (PARTIAL):** unsupported-browser alert and "open Settings" fallback dropped; failures silently swallowed.
- **D7 — Resistance-mode zone coloring (PARTIAL):** resistance free-ride stat coloring uses a different fallback than the legacy %-band zone override.
- **F8 — FTMS Control Point indication logging (GAP):** trainer command result codes no longer logged (harder to debug control failures).
- **F18 — BLE/engine log surfacing (GAP):** logs are dropped (`onLog: () => {}`); the settings log view has no data from this area.
- **A8/A9 — Live theme re-render (GAP):** OS-theme flip (auto) and `<html>` theme-attribute changes don't force a chart/stat repaint absent a VM change.

### Low
- **A3 — Chart resize re-fit (PARTIAL):** LiveChart doesn't re-fit on window resize (stat fonts do).
- **A6 — Auto-open planner for today's schedule (GAP):** boot doesn't surface today's scheduled workout.
- **A7 — Audio priming on first gesture (GAP):** possible first-cue latency / autoplay-policy delay.
- **B11 — Escape ladder nuances (PARTIAL):** picker-search-focused, planner-detail-exit, and builder-mode no-op steps simplified.
- **C1 — "End current workout first" alert on name-label click (PARTIAL):** silently no-ops instead of alerting.
- **D15 — Don't overwrite focused manual input (PARTIAL):** moot given no input commit path.
- **F1/F2/F3/F10/F11/F17 — Reconnect bookkeeping nuances (PARTIAL):** cancel-pending / suppress-once / stale-device teardown not reproduced (subsumed by the High F15/F16 gaps).
- **F5 — `getLastBikeSample()` (GAP):** not exposed; no current consumer.
