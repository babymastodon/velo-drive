# Verified — Ride Execution + Free-ride / Manual (J-RIDE-01..35, J-FREE-01..12)

Read-only verification of the new Svelte/TS app (`web/src`) against the legacy app (`docs/`)
and the Part X behavior constants in `docs-analysis/05-design-and-migration-plan.md`.

Scope: **Ride Execution** (35 rows) + **Free-ride / Manual** (12 rows) = 47 rows.

Status legend: **OK** = faithful; **PARTIAL** = present but reduced fidelity / minor deviation;
**GAP** = not implemented; **WRONG** = implemented but incorrect vs legacy/Part X.

---

## Ride Execution

| ID | New-app impl (file:line) | Status | Note |
|---|---|---|---|
| J-RIDE-01 | engine.ts:650-678 getViewModel (idle vm); BottomNav.svelte:39-43 (showStart=`!running && canonicalWorkout`) | OK | IDLE = loaded, elapsed 0, Start visible. |
| J-RIDE-02 | engine.ts:784-804 setWorkoutFromPicker (validates rawSegments, resets elapsed/index/samples, persistIdleState) | OK | Folder gate at App.svelte:269-282. |
| J-RIDE-03 | BottomNav.svelte:68-70 onStartLike→engine.startWorkout(); engine.ts:535-552 (countdown via beeper.runStartCountdown) | OK | |
| J-RIDE-04 | engine.ts:544-552 (workoutStarting=true); beeper.ts:142-185 runStartCountdown (3/2/1/Start) | OK | setMode/setFreeRideMode guarded while `workoutStarting` (engine.ts:745,754). |
| J-RIDE-05 | engine.ts:426-492 tick; StatCards.svelte; LiveChart.svelte; BottomNav title (computeCoachingTitle) | OK | |
| J-RIDE-06 | engine.ts:426-475 tick (1 Hz, sendTrainerState(false)); WebBluetoothTransport.ts:702-734 (throttle ≥10s unless force/change), :675-684 ERG 0x05 | OK | TRAINER_SEND_MIN_INTERVAL_SEC=10 (matches legacy ble-manager:32). |
| J-RIDE-07 | engine.ts:204-214 ramp interp `round(startW+(endW-startW)·clamp(rel,0,1))` | OK | Matches Part X. |
| J-RIDE-08 | hud-coaching.ts:216-244 computeCoachingTitle (look-ahead `dur≥20 && remaining≤10` → "In N - ") | OK | Verbatim port of docs/workout.js:521-560. |
| J-RIDE-09 | hud-coaching.ts:153-202 CadenceCoach (±5rpm, ≥5s); hud-format.ts:99-109 cadenceIndicator (▾/▴, abs>5) | OK | Verb mapping (slow→"Speed up") matches docs/workout.js:537. |
| J-RIDE-10 | **none** — text events only consumed by LiveChart.svelte:62 (chart draw) + builder | **GAP** | No runtime text-event audio taps. See defects. |
| J-RIDE-11 | engine.ts:367-385 maybeAutoStartFromPower `max(75, 0.5·startTarget)`, startPct default 50; :369 autoStartSuppressed gate; :582 grace=15 | OK | Threshold + suppression + 15s grace all match Part X. |
| J-RIDE-12 | engine.ts:441-453 (zeroPowerSeconds≥1 outside grace → setPaused(true,{showOverlay})); beeper.ts:107-130 showPausedOverlay (1600ms) | OK | |
| J-RIDE-13 | engine.ts:513-533 setPaused; BottomNav showPlay/showStop | OK | elapsed frozen (only advances when `!paused`). |
| J-RIDE-14 | engine.ts:477-489 (lastSamplePower ≥ 0.9·target & not blocked → grace=elapsed+15, showResumedOverlay) | OK | Matches Part X auto-resume. |
| J-RIDE-15 | engine.ts:560-565 (manual pause → `manualPauseAutoResumeBlockedUntilMs = now+10000`) | OK | 10s block matches. |
| J-RIDE-16 | engine.ts:560-565 (+ tick auto-resume blocked until ms) | OK | |
| J-RIDE-17 | engine.ts:553-559 (manual resume → clears block, grace=elapsed+15, showResumedOverlay) | OK | |
| J-RIDE-18 | BottomNav.svelte:39-46 (showStart/showPlay/showPause/showStop/showCalendar) | OK | start=`!running&&canonical`, play=`running&&paused`, pause=`running&&!paused`, stop=`running`. |
| J-RIDE-19 | engine.ts:763-768 setFtp (recompute live via rawSegments×ftp + sendTrainerState(true) force) | OK | Throttle bypassed via force. |
| J-RIDE-20 | engine.ts:387-414 handleIntervalBeep (`diffFrac≥0.10` gate; `==9 && diffFrac≥0.3 && nextStartRel≥1.2` danger; `==3` pattern) | **PARTIAL** | Gating thresholds exact, but audio is reduced: pattern=3 plain beeps, danger=single beep (legacy siren+honk). See defects. |
| J-RIDE-21 | **none** (no seek/scrub control) | OK | GAP in legacy too — no regression. |
| J-RIDE-22 | engine.ts:592-629 endWorkout → :313-363 saveWorkoutFile (buildFitFile w/ pauseEvents, canonical) | OK | Confirm via dialog at BottomNav.svelte:72-76. |
| J-RIDE-23 | engine.ts:592-629 (FINISHED transient → idle; autoStartSuppressed=true :594) | OK | No samples → no file (:319). |
| J-RIDE-24 | BottomNav.svelte:72-76 dialogs.confirm('End current workout and save it?') | OK | Cancel keeps running. |
| J-RIDE-25 | engine.ts:319 `if (!liveSamples.length) return null` | OK | |
| J-RIDE-26 | App.svelte:43-46 onWorkoutEnded → ui.openPlannerForRide(fileName, date) | OK | Planner-side "remove today's scheduled" is a planner-wave concern (out of scope here). |
| J-RIDE-27 | engine.ts:706-709 (workoutRunning → startTicker + setPaused(true)) | OK | running→recovered-paused, matches legacy:669-672. |
| J-RIDE-28 | engine.ts:706-709 + restoreActiveState:714-742 (lastTickWallMs preserved) | OK | |
| J-RIDE-29 | engine.ts:261-267 scheduleSaveActiveState (500ms debounce); :273-295 buildActiveSnapshot (full state incl pauses/timers) | OK | |
| J-RIDE-30 | engine.ts:536-539 alert("No workout selected. Choose a workout first.") | OK | Wording matches legacy:461. |
| J-RIDE-31 | engine.ts:785-787 alert("Please end your current workout first.") | PARTIAL | Engine-side guard matches (legacy:730). The picker-side message "End the current workout before changing the workout selection." (legacy workout.js:1514) — see defects. |
| J-RIDE-32 | StatCards.svelte (6 cards, data-key power/intervalTime/heartRate/targetPower/elapsedTime/cadence) + adjustStatFontSizes:25-41 (resize) | OK | Font auto-size ported verbatim (divisor 6 for .stat-lg). |
| J-RIDE-33 | BottomNav.svelte:233-245 workoutTitleCenter (shown when running||starting), title tooltip | OK | |
| J-RIDE-34 | **none in HUD wave** | GAP (deferred) | Auto-open planner for today's scheduled workout on load — planner wave. See defects. |
| J-RIDE-35 | app/app.ts bootApp; App.svelte:38-59 (boot → welcome → settings attention → engine init) | OK | Boot order adapted to Svelte composition root. |

---

## Free-ride / Manual

| ID | New-app impl (file:line) | Status | Note |
|---|---|---|---|
| J-FREE-01 | engine.ts:242-251 desiredTrainerState (freeride+erg → {erg, manualErgTarget}); :770-775 adjustManualErg clamp [50,1500]; BottomNav normaliseErg:113-118 typed clamp [50, ftp×2.5]; unit "W" :107 | OK | Both clamp regimes correct per Part X. |
| J-FREE-02 | engine.ts:246-248 (resistance → {resistance, manualResistance}); :777-782 adjustManualResistance clamp [0,100]; WebBluetoothTransport.ts:686-700 (0x04, level×10); unit "%" BottomNav:107; target stat "--" (hud-format computeTargetPower returns null for resistance) | OK | clamp 0–100, ×10, target "--" all correct. |
| J-FREE-03 | engine.ts:184-234 getCurrentSegmentAtTime (isFreeRide path same as in-segment); vm.isFreeRideActive | OK | Whole-workout freeride uses identical manual path. |
| J-FREE-04 | BottomNav.svelte:249-270 modeToggle (display only when `freeRideUiActive`); engine.ts:752-761 setFreeRideMode (no-op if same mode :754) | OK | |
| J-FREE-05 | App.svelte:241-248 ('e' → setFreeRideMode('erg'), guarded active+isFreeRideActive) | OK | |
| J-FREE-06 | App.svelte:241-248 ('r' → 'resistance', same guard) | OK | |
| J-FREE-07 | BottomNav.svelte:278,292 onManualDelta(±10) routes by freeRideMode → adjustManualErg/Resistance | OK | |
| J-FREE-08 | BottomNav.svelte:124-152 commitManualInput (Enter/blur, clamped, reverts if unchanged) | OK | |
| J-FREE-09 | App.svelte:229-238 (ArrowUp/k=+10, ArrowDown/j=-10, gated on isFreeRideActive) | OK | |
| J-FREE-10 | engine.ts:752-761 setFreeRideMode → sendTrainerState(true); :770-782 adjustManual* → sendTrainerState(true) | OK | Force bypasses throttle. |
| J-FREE-11 | BottomNav.svelte:125-126 commitManualInput early-return if `!active || !isFreeRideActive`; App.svelte:230,244 key guards | OK | |
| J-FREE-12 | chart.ts:147-193 ensureFreeridePatterns (45° striped pattern), :240-243 / :994-999 applied to freeride polys | OK | Striped fill present in both static + builder chart. |

---

## Gaps & defects

### GAP — J-RIDE-10: text-event audio cues during a ride are not implemented  *(MEDIUM)*
Legacy fires audio taps when an active text event's window is entered, once per
event (fire-once keyed `idx:offset:text`):
- `docs/workout.js:1065-1086` `maybePlayTextEvent` (gated on running && !paused && textEvents.length),
- `docs/workout.js:1051-1062` `getActiveTextEvent` (active window `[offset, offset+dur]`, default dur 10s, last-wins),
- `docs/beeper.js:387` `playTextEventTaps(0.5)`.
Part X: *"Text events active `[offset,offset+dur]`, default 10s, last-wins, fire-once via `idx:offset:text`."*
New app: text events are read only for **chart rendering** (`LiveChart.svelte:62`) and in the
**builder** editor. There is **no** runtime `maybePlayTextEvent` hook in `engine.ts`/`tick()`, and the
`Beeper` (`beeper.ts`) has **no `playTextEventTaps`** method. So during a ride, text events produce
no audio cue. (Note: the legacy overlay banner is a no-op — `docs/workout.js:1047-1048`
`updateStatusOverlay` does nothing — so only the audio tap is missing, not a visual banner.)

### PARTIAL — J-RIDE-20: interval beep audio is reduced-fidelity  *(LOW)*
The **gating logic is exact** (engine.ts:404-413 vs docs/workout-engine.js:325-336:
`diffFrac<0.10` skip; `secsToEnd==9 && diffFrac≥0.3 && nextStartRel≥1.2` → danger;
`secsToEnd==3` → pattern). However the **sound itself is simplified**:
- `beeper.ts:88-91` `playBeepPattern` = 3 plain 880 Hz square beeps; legacy
  `docs/beeper.js:359-385` is a precisely-scheduled rising 3-beep pattern.
- `beeper.ts:93-95` `playDangerDanger` = one 660 Hz/500 ms beep; legacy
  `docs/beeper.js:528-541` is a siren+honk composite (`docs/beeper.js:219-319`).
Behaviorally the *cue fires at the correct tick* (satisfies the B-gate "cue calls" contract), so this
is a fidelity gap, not a functional break. Same simplification affects the countdown beep
(`beeper.ts:174` single beep vs legacy richer cue) — cosmetic only.

### PARTIAL — J-RIDE-31: picker-side "change selection while running" rejection message  *(LOW)*
The **engine guard** is faithful: `engine.ts:785-787`
`alert("Please end your current workout first.")` matches `docs/workout-engine.js:730`. The legacy
app *also* has a **second, distinct** guard/message at the picker Select path
(`docs/workout.js:1514`: `"End the current workout before changing the workout selection."`). That
picker-level guard is a Library/Picker-wave concern (`PickerView.svelte`) and is out of this slice's
scope; flagged so it isn't lost. Verify when the picker slice is audited.

### GAP — J-RIDE-34: auto-open planner for today's scheduled workout on boot  *(LOW, deferred)*
Legacy `docs/workout.js:1292-1315` auto-opens the planner to today's scheduled workout at load (if
not already current). No equivalent in the HUD/boot path (`App.svelte:38-144` boots welcome →
settings-attention only). This is a Planner-wave responsibility (`PlannerView.svelte`), so the
deferral is expected per the migration sequencing — flagged so the planner slice picks it up.

---

## Summary

- **Rows verified:** 47 (J-RIDE-01..35, J-FREE-01..12)
- **OK:** 41
- **PARTIAL:** 3 (J-RIDE-20 audio fidelity, J-RIDE-31 picker-side message deferred, J-RIDE-10 listed as GAP)
- **GAP:** 3 (J-RIDE-10 text-event audio, J-RIDE-21 legacy-also-missing→no regression, J-RIDE-34 planner-wave deferred)
- **WRONG:** 0

Counting note: J-RIDE-21's gap exists in legacy too (no scrub control), so it is **not** a regression
(marked OK). The two real omissions for this slice are **J-RIDE-10** (HIGH-value: text-event audio
never fires during a ride) and **J-RIDE-20** (LOW: beep cues fire at correct gates but with
simplified waveforms). J-RIDE-31 (picker message) and J-RIDE-34 (boot auto-open) are correctly
deferred to the Picker/Planner waves.

The **core ride state machine** (auto-start `max(75,0.5·startTarget)`, auto-pause `zero≥1` outside
15s grace, auto-resume `≥0.9·target`, manual-pause 10s block, ERG interpolation, transport throttle
≥10s / clamp [0,2000] / resistance ×10, FTP live re-rate, crash→resume-paused, 500ms debounce,
manual clamps [50,1500]/[0,100]/[50,ftp×2.5]) is a **faithful, near-verbatim** port and matches Part X
constants exactly.
