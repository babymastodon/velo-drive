# Bug hunt: auto-start / end-of-workout / next-workout transitions

Read-only audit of the LEGACY workout state machine (`docs/workout-engine.js`, driven by
`docs/workout.js`) for genuine logic defects in **auto-start**, **end-of-workout / finish**, and
**transition to a next workout**, plus confirmation of whether the NEW rewrite
(`web/src/core/engine.ts` + `web/src/state/engine.svelte.ts` + `web/src/ui/*.svelte`) reproduces
each. Scope is bugs (wrong/unintended behavior), NOT parity gaps. No code was changed.

## State-machine map (legacy `docs/workout-engine.js`)

Flags that gate the lifecycle and what sets/clears them:

| Flag | set true | cleared / reset |
|---|---|---|
| `autoStartSuppressed` | `endWorkout` :518 | `startWorkout` :466 only (NOT persisted, NOT cleared by `setWorkoutFromPicker`) |
| `workoutStarting` | `startWorkout` :469 | `beginRun`/countdown onDone :490; `endWorkout` :539 |
| `workoutRunning` | `setRunning(true)` via countdown onDone :491 | `endWorkout` :537; `setRunning(false)` |
| `workoutPaused` | auto-pause/manual-pause `setPaused(true)` | `setPaused(false)`; `endWorkout` :538 |
| `elapsedSec` | ticker +1 :354 | `beginRun` :475; `endWorkout` :540; `setWorkoutFromPicker` :745 |
| `liveSamples` | ticker push :378 | `beginRun` :474; `endWorkout` :542; `setWorkoutFromPicker` :747 |

Auto-start (`maybeAutoStartFromPower` :284) is gated by, in order: `power>0`, `!autoStartSuppressed`,
`!workoutRunning && !workoutStarting`, `elapsedSec===0 && liveSamples.length===0`, `canonicalWorkout`
present. The ONLY flag that `endWorkout` leaves "sticky" across a load-new-workout is
`autoStartSuppressed`; every other gate is cleared by both `endWorkout` and `setWorkoutFromPicker`.

The new app is a near-verbatim port, so each legacy defect below is reproduced unless noted.

## Findings table

| # | Buggy flow | Legacy root cause (file:line) | Wrong vs intended | Severity | New-app reproduced? (file:line) | Proposed fix |
|---|---|---|---|---|---|---|
| 1 | Finish a workout, then load/select a NEW workout (same session) → it never auto-starts when you pedal | `endWorkout` sets `autoStartSuppressed=true` (`docs/workout-engine.js:518`); `setWorkoutFromPicker` (`:728-756`) resets `elapsedSec`/`liveSamples` but NEVER clears `autoStartSuppressed`; only `startWorkout` (`:466`) clears it | Wrong: auto-start stays armed-off after a fresh workout is selected. Intended: a newly selected workout should auto-start on pedaling exactly like the first one of the session | High | YES — `web/src/core/engine.ts:645` (set), `:836-856` `setWorkoutFromPicker` never clears it. Called from `PickerView.svelte:304` and `PlannerView.svelte:763` | In `setWorkoutFromPicker` add `this.autoStartSuppressed = false;` alongside the other resets (~`engine.ts:847`) |
| 2 | Load a workout whose `rawSegments` is empty (`[]`), then pedal (or press Start) | `maybeAutoStartFromPower` destructures `rawSegments[0]` with no length check (`docs/workout-engine.js:291`); `beginRun`/countdown onDone reads `rawSegments[0]` (`:476`). Empty array → `undefined[1]` → TypeError | Wrong: throws inside the bike-sample handler on every sample (and on Start), breaking the ride. Intended: empty/invalid workout should be rejected or no-op | Med–High | YES — `engine.ts:388-389` (`rawSegments[0]!` then `first[1]`) and `engine.ts:622` (`beginRun`). Empty `rawSegments:[]` is reachable via `PlannerView.svelte:759` (`entry.rawSegments \|\| []`) → `setWorkoutFromPicker`, which only checks `Array.isArray`, not length (`engine.ts:841`) | Reject empty workouts in `setWorkoutFromPicker` (`if (!canonical.rawSegments.length) { alertUser(...); return; }`) and/or guard `maybeAutoStartFromPower`/`beginRun` with `if (!first) return;` |
| 3 | Any finish (natural completion or Stop) leaves the trainer holding the last ERG/resistance target | `endWorkout` (`docs/workout-engine.js:514-553`) stops the ticker and clears state but never sends a trainer release/stop; last `sendTrainerState` was the final segment's ERG watts | Surprising-but-consistent: after finish the trainer keeps applying the last target until something else sends a new state. Legacy behaves identically, so this is a latent design gap, NOT a regression | Low (intended-ish) | YES — `engine.ts:643-680` `endWorkout` likewise sends no release | If desired, send a neutral state on finish (e.g. resistance 0 / erg release) in `endWorkout`; otherwise document as expected. Marked uncertain — may be intentional to avoid abrupt resistance drop |
| 4 | Press Space during the start countdown | During countdown `workoutStarting=true`, so `startWorkout`'s first branch is skipped; falls through to the pause/resume else-branch and flips `workoutPaused` while `workoutRunning` is still false (`docs/workout-engine.js:500-511`) | Mildly wrong: a stray `workoutPaused` toggle mid-countdown, but `beginRun` immediately overwrites it via `setRunning(true)`+`setPaused(false)` (`:491-492`), so it self-heals. No lasting effect | Low | YES — `engine.ts:605-616` then `beginRun` :636-637. App.svelte Space handler `:298` calls `startWorkout()` unconditionally | Optional: early-return in `startWorkout` when `workoutStarting` is true. Low priority — self-healing |

## Detail per bug

### Bug 1 — Auto-start does not re-arm after a finish (the known bug; CONFIRMED + precise)

`endWorkout` deliberately sets `autoStartSuppressed = true` (`docs/workout-engine.js:518`,
new `engine.ts:645`) so the rider doesn't instantly re-auto-start the workout they just finished while
still coasting. The intent is that this suppression is lifted as soon as the rider *intentionally*
acts on a workout — which legacy only does in `startWorkout` (`:466`). The selection path
`setWorkoutFromPicker` (`:728-756`) resets `elapsedSec=0`, `currentIntervalIndex=0`, `liveSamples=[]`,
`zeroPowerSeconds=0`, the auto-pause/auto-resume timers, and recomputes `workoutTotalSec` — but it does
**not** touch `autoStartSuppressed`. So after a finish, selecting any new workout leaves
`maybeAutoStartFromPower` short-circuiting at `if (autoStartSuppressed) return;` (`:287`). Pedaling does
nothing; the rider must press Start manually. Manual Start still works (it clears the flag), so the
symptom is specifically "auto-start is dead until I press Start once."

Reproduce: pick workout A → pedal (auto-starts) → Stop/finish (or let it complete) → pick workout B →
pedal at/above threshold → nothing happens.

The new app reproduces it identically. Both call sites (`PickerView.svelte:304`,
`PlannerView.svelte:763`) just call `engine.setWorkoutFromPicker(...)`.

**Important nuance:** `autoStartSuppressed` is in-memory only — it is never written by
`persistActiveState`/`persistIdleState` and is not read by `init`/`restoreActiveState`. So a **page
reload** after finishing resets it to `false` (constructor default), and auto-start works again. The
bug is strictly a *same-session* defect. Fix: add `this.autoStartSuppressed = false;` to
`setWorkoutFromPicker` in `engine.ts` (~line 847). This is the cleanest single-line fix and matches the
"intentional workout action lifts suppression" intent.

### Bug 2 — Empty-`rawSegments` workout crashes auto-start and Start

`maybeAutoStartFromPower` (`docs/workout-engine.js:291`, `engine.ts:388-389`) does
`const [minutes, startPct] = canonicalWorkout.rawSegments[0]` after only checking that
`canonicalWorkout` exists. If `rawSegments` is `[]`, `rawSegments[0]` is `undefined` and the
destructure (legacy) / `first[1]` (new) throws a TypeError. Because this runs from the BLE
`handleBikeSample` path, it throws on every incoming power sample, breaking the live HUD. The same
unchecked `rawSegments[0]` is read in `beginRun`/countdown onDone (`:476` / `engine.ts:622`), so manual
Start also throws.

This is reachable: `setWorkoutFromPicker` validates only `Array.isArray(canonical.rawSegments)`
(`:734` / `engine.ts:841`), not length. The new planner's `onLoadScheduled`
(`PlannerView.svelte:755-763`) constructs a canonical with `rawSegments: entry.rawSegments || []`, and
the legacy `onScheduledLoadRequested` (`docs/workout.js:1479-1494`) similarly can yield `rawSegments:
[]` when an entry has no segments. With such a workout loaded, `workoutTotalSec` computes to 0, so even
if Start didn't throw, the completion check `workoutTotalSec > 0 && elapsedSec >= workoutTotalSec`
(`:386` / `engine.ts:479`) is never true and the ride would run forever — but in practice the crash
fires first. Fix: reject zero-length `rawSegments` in `setWorkoutFromPicker`, and defensively
`if (!first) return;` in `maybeAutoStartFromPower` and `beginRun`. Severity is mid-high because it's a
hard crash on a user-reachable (if uncommon) data shape; uncertain how often real scheduled entries are
empty.

### Bug 3 — Trainer left at last ERG/resistance target after finish (intended-but-surprising)

`endWorkout` never issues a trainer release. The final `sendTrainerState(false)` in the last tick
(`:376` / `engine.ts:469`) set the trainer to the final segment's ERG watts (or free-ride
resistance), and finish just clears app state. The trainer therefore keeps holding that load until the
next `setTrainerState` (e.g. selecting a free-ride or starting another workout). This is consistent
between legacy and new, so it is **not a port regression** — I'm flagging it as a latent design choice,
not a defect introduced by the rewrite. Whether to send a neutral release on finish is a product
decision; some apps intentionally avoid an abrupt resistance drop. Marked uncertain.

### Bug 4 — Space during the start countdown briefly toggles `workoutPaused` (self-healing)

While the 3-2-1 countdown runs, `workoutStarting=true` and `workoutRunning=false`. The Space key and
the play/pause buttons all call `startWorkout()` unconditionally (legacy `:1669`; new
`App.svelte:298`, `BottomNav` start handlers). In `startWorkout`, the
`!workoutRunning && !workoutStarting` branch is skipped (starting is true), and execution falls into
the resume/pause `else` (`:500-511` / `engine.ts:605-616`). Since `workoutRunning` is still false,
`setPaused` records nothing meaningful but does set `workoutPaused`. When the countdown's `onDone` fires,
`beginRun` calls `setRunning(true)` (forces `workoutPaused=false`) then `setPaused(false)`
(`:491-492` / `engine.ts:636-637`), overwriting the stray flag. Net effect is a transient and the ride
starts correctly. Low severity; flagged for completeness. Note the dedicated Stop button is gated on
`workoutRunning` (`BottomNav.svelte:41`), so Stop is NOT reachable during the countdown — there is no
"finish during countdown" path from the UI.

## Things checked and found CLEAN (not bugs)

- **Double-finish race.** `endWorkout` has no `if (!workoutRunning) return` guard, but the natural-
  completion path calls `await this.endWorkout()` from the tick after `stopTicker()` runs synchronously
  inside `endWorkout` (`:528`/`:653`), so the ticker cannot re-enter. The Stop button is hidden once
  `workoutRunning` flips false, so a user-driven second finish during the `saveWorkoutFile` await is not
  reachable from the UI. No double-save observed via reachable paths.
- **Finishing while auto-paused / manually paused.** `endWorkout` correctly closes an open pause window
  (`pauseStartedAtMs` → `totalPausedMs`, `:521-524`/`:648-651`) before clearing flags. Correct.
- **Crash-resume.** `init`/`restoreActiveState` restores a mid-ride as `workoutRunning=true,
  workoutPaused=true`; auto-start is gated off by `workoutRunning` and `elapsedSec>0`, so no spurious
  auto-start. `autoStartSuppressed` defaults false on reload (see Bug 1 nuance) — correct for resume.
- **Auto-start threshold.** `threshold = max(75, 0.5*startTarget)`; `power >= threshold` (inclusive).
  `ftp=0` falls back to `DEFAULT_FTP` (`:292`/`engine.ts:390`); `startPct` missing falls back to 50.
  Power exactly at threshold auto-starts (inclusive `>=`) — intended.
- **Next-workout auto-advance.** None exists in either codebase; `onWorkoutEnded` opens the planner to
  the saved ride but the rider must select the next workout manually. No auto-advance bug class.
