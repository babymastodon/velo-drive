# Bug Hunt — Workout State Management (pause/resume, ERG/target, FTP, free-ride, crash-resume)

Scope: genuine **logic defects** in the LEGACY VeloDrive workout state machine
(`docs/workout-engine.js`, `docs/ble-manager.js`, `docs/workout.js`) in the *broader*
state machine beyond autostart/finish (those are the companion agent's), and whether the
TypeScript rewrite (`web/src/core/engine.ts`, `web/src/ports/web/WebBluetoothTransport.ts`)
reproduced each. The rewrite is a deliberate **verbatim port** ("Behavior is preserved
verbatim" — engine.ts:4), so almost every legacy logic defect is carried forward.

Distinguishing bugs from intended behavior: I treat as a *bug* anything that produces
behavior a reasonable user would call wrong/unintended (e.g. an auto-paused free-ride that
can never auto-resume, the trainer receiving load while the rider is paused). I treat the
documented-and-deliberate magic-numbers (grace=15, block=10 s, ≥0.9×, ≥1 s) as intended,
and only flag *boundary/ordering* defects within them.

LOC for the new app are against the CURRENT `web/src/core/engine.ts` /
`WebBluetoothTransport.ts` (the journey docs cite stale line numbers).

| # | Buggy flow | Legacy root cause (file:line) | Wrong vs intended | Severity | New-app reproduced? (file:line) | Proposed fix |
|---|------------|-------------------------------|-------------------|----------|----------------------------------|--------------|
| 1 | Auto-paused **resistance** free-ride can NEVER auto-resume — rider must hit the button | `workout-engine.js:402-409` (`getCurrentTargetPower()` returns `null` for resistance free-ride; the `currentTarget && …` guard then fails) | Wrong: auto-pause fires in resistance mode (target-independent) but auto-resume is gated on a numeric target that is always `null` there → asymmetric, traps the rider in pause | High | YES — `engine.ts:494-496` (`currentTarget = getCurrentTargetPower()`; `if (!autoResumeBlocked && currentTarget && this.lastSamplePower)`) | For resistance free-ride, auto-resume on `lastSamplePower > 0` (or a small W floor), since there is no ERG target to compare against |
| 2 | Changing **FTP / manual ERG / free-ride mode** while **paused** immediately force-sends a new ERG/resistance load to the trainer | `workout-engine.js:702-723, 691-700` (setters call `sendTrainerState(true)` unconditionally) + `desiredTrainerState():165-174` never checks `workoutPaused` | Wrong vs intended "paused = no new load": the rewrite/legacy never release ERG on pause, AND a forced re-rate while paused pushes a fresh setpoint to the wheel while the rider is stopped | Med | YES — `engine.ts:815-820 setFtp`, `:822-827 adjustManualErg`, `:804-813 setFreeRideMode`, all `sendTrainerState(true)`; `desiredTrainerState():256-265` ignores paused | Gate the forced send on `!workoutPaused` (still update state + persist; let the next resume tick push the target), or explicitly hold/zero ERG while paused |
| 3 | After **resume** (manual or auto), the target is NOT force-re-sent; re-application depends on the 10 s throttle and "target unchanged" | `workout-engine.js:500-512` (manual resume) and `:398-411` (auto-resume) both call `setPaused(false)` with **no `sendTrainerState(force)`**; resume relies on next tick's `sendTrainerState(false)` | Wrong: if the held target equals `lastErgTargetSent` and <10 s elapsed in the trainer's clock, the post-resume tick's throttled send is suppressed → trainer keeps whatever it had through the pause; correct on most paths but fragile and order-dependent | Low–Med | YES — `engine.ts:498-500` (auto-resume), `:605-610` (manual resume): neither force-sends; tick `sendTrainerState(false)` at `:469` | On resume, `await sendTrainerState(true)` so the target is re-asserted deterministically |
| 4 | Auto-resume sets a new 15 s grace but **does not clear `manualPauseAutoResumeBlockedUntilMs`**; manual resume clears it but a subsequent auto-pause→auto-resume leaves a stale block timestamp | `workout-engine.js:406` (auto-resume sets only `autoPauseDisabledUntilSec`) | Mostly benign (block is wall-clock and usually already in the past), but the block field is never normalized to 0 after it expires, so persisted snapshots carry a stale future-looking ms across edge timings | Low | YES — `engine.ts:498` only sets `autoPauseDisabledUntilSec` | Set `manualPauseAutoResumeBlockedUntilMs = 0` in the auto-resume branch for symmetry with manual resume |
| 5 | 15 s start grace is effectively **14 s** (off-by-one): grace ends one tick early | `workout-engine.js:361` `inGrace = elapsedSec < autoPauseDisabledUntilSec` with `autoPauseDisabledUntilSec=15` → grace true for elapsed 1..14, false at 15 | Boundary: "15 s grace" actually protects seconds 1–14; deterministic, faithfully ported (so a parity-preserving "bug" not a divergence) | Low (intended-as-written) | YES — `engine.ts:456` `inGrace = this.elapsedSec < this.autoPauseDisabledUntilSec` | If a true 15-tick window is wanted use `<=`; otherwise leave as documented-intended |
| 6 | **Tab-throttled / backgrounded** ride: auto-pause and the timer both count ticks, not wall-clock; a 30 s background freeze advances `elapsedSec` and `zeroPowerSeconds` by far fewer than 30 | `workout-engine.js:344-414` ticker increments `elapsedSec += 1` and `zeroPowerSeconds++` per fired interval, never reconciling against `lastTickWallMs`/`Date.now()` | Wrong vs wall-clock: elapsed time and the 1 s/0 W auto-pause drift when `setInterval` is throttled; `lastTickWallMs` is captured but never used to correct elapsed | Low–Med | YES — `engine.ts:440-506` (`this.elapsedSec += 1`; `lastTickWallMs` set at `:441` but unused for catch-up) | Reconcile elapsed from wall-clock delta on each tick (advance by `round((now-lastTickWallMs)/1000)`), or accept as known parity behavior |
| 7 | Crash-resume of an **already-completed** workout (`elapsedSec >= workoutTotalSec`) never ends — sits paused at the end and only finishes if power triggers an auto-resume | `workout-engine.js:669-672` (restore → `startTicker()` + `setPaused(true)`); the end check `:386` lives inside the `shouldAdvance` (running & !paused) block, which is skipped while paused | Wrong: a finished-but-not-saved ride restored after reload is stuck; auto-resume can then push `elapsedSec` past total and trigger a late `endWorkout` (or never, if no power) | Low | YES — `engine.ts:758-761` restore path; end check at `:479` inside `shouldAdvance` | On restore, if `elapsedSec >= workoutTotalSec` immediately `endWorkout()` (or clamp + finalize) instead of arming a paused ticker |
| 8 | Crash-resume restores `manualPauseAutoResumeBlockedUntilMs` and `pauseStartedAtMs` as **absolute wall-clock ms from the prior session** | `workout-engine.js:653-660` restores both raw; `pauseStartedAtMs` then feeds `totalPausedMs += now - pauseStartedAtMs` on next resume/end | Wrong: `totalPausedMs` (used for FIT `totalElapsedSec`) gets inflated by the entire app-closed gap if the ride was paused at crash time; the block ms is harmless-but-meaningless across reload | Med | YES — `engine.ts:787-790` restores `manualPauseAutoResumeBlockedUntilMs` and `pauseStartedAtMs` verbatim | On restore, null out `pauseStartedAtMs` (the closed-app interval is not "paused riding") and reset the block to 0; recompute pause accounting from `pauseEvents` |

---

## Detail per bug

### 1 — Resistance free-ride auto-pause has no auto-resume (High)
**Flow:** Start/keep a *free-ride* segment in **resistance** mode. Stop pedaling → after ≥1 s of
0 W outside grace the engine auto-pauses (`workout-engine.js:367` → `setPaused(true,{showOverlay})`),
showing the Paused overlay. Resume pedaling hard. **Nothing happens** — the rider stays paused
until they manually tap Resume.

**Root cause:** Auto-resume is gated on a numeric ERG target:
`workout-engine.js:402-404` computes `currentTarget = getCurrentTargetPower()` and only resumes if
`currentTarget && lastSamplePower && lastSamplePower >= 0.9*currentTarget`. For a resistance
free-ride, `getCurrentSegmentAtTime` returns `target = null` (engine.ts:224-228 / workout-engine.js:130-133:
`isFreeRide ? (erg ? manualErgTarget : null) : …`). So `currentTarget` is always falsy and the
branch is skipped. Auto-pause, however, is **target-independent** (it only checks `lastSamplePower<=0`),
so resistance free-ride *can* be auto-paused but *cannot* be auto-resumed — an asymmetry.

**Wrong vs intended:** Intended behavior (per Part X "auto-resume ≥90%") presumes an ERG target.
The resistance branch silently loses the feature, trapping the rider. Manual resume still works.

**New app:** Reproduced verbatim at `engine.ts:494-496`.

**Fix:** In the paused branch, when `desiredTrainerState().kind === 'resistance'` (or `isFreeRideActive`
&& `freeRideMode==='resistance'`), auto-resume on `lastSamplePower > 0` (or a small floor like ≥ a few W)
instead of the `0.9×target` rule. Keep the ERG rule for ERG/structured segments.

### 2 — FTP / ERG / mode change while paused force-loads the trainer (Med)
**Flow:** Auto-pause (or manually pause) mid-ride. While paused, change FTP in settings, or tap the
ERG ± buttons, or flip the free-ride e/r toggle. Each setter calls `sendTrainerState(true)`
(`workout-engine.js:705, 714, 696`), which `desiredTrainerState()` (`:165-174`) computes from
`elapsedSec` **without consulting `workoutPaused`**, and `force:true` bypasses the throttle. The
trainer receives a fresh ERG setpoint / resistance level while the rider is stopped and the UI says
"Paused".

**Wrong vs intended:** A paused ride should not be pushing new load to the wheel. (Note the engine
never releases ERG on pause either — it relies on the rider simply not pedaling — so this compounds:
the held load can now *change* under the paused rider.)

**New app:** Reproduced — `engine.ts:815-820`, `:822-827`, `:804-813` all `sendTrainerState(true)`;
`desiredTrainerState():256-265` has no paused guard.

**Fix:** Either gate the forced send on `!this.workoutPaused` (state still updates + persists; resume
re-asserts the target — see bug 3 fix), or make pause explicitly hold/zero ERG.

### 3 — Resume does not force-re-send the target (Low–Med)
**Flow:** Manual or auto resume calls `setPaused(false)` only (`workout-engine.js:510/505` manual,
`:409` auto). No trainer send happens at resume; the next 1 Hz tick calls `sendTrainerState(false)`
(`:376`). The throttle (`ble-manager.js:510-514`) suppresses the send unless force / mode-change /
target-change / `≥10 s` since last send. If the held target is unchanged and <10 s of the transport's
`performance.now()` clock has elapsed, the resume tick's send is a no-op.

**Wrong vs intended:** On most paths the target was already correct so this is invisible, but it makes
"resume re-applies the target" non-deterministic and dependent on throttle timing — fragile, and the
root cause of why bug 2's fix needs a paired resume re-send.

**New app:** Reproduced — `engine.ts:605-610`/`498-500` resume without force-send; tick send at `:469`.

**Fix:** `await this.sendTrainerState(true)` immediately on both resume paths.

### 4 — Auto-resume leaves `manualPauseAutoResumeBlockedUntilMs` stale (Low)
**Flow:** Manual pause sets the 10 s block (`workout-engine.js:508`). Manual resume clears it (`:503`).
But **auto**-resume (`:406`) only updates `autoPauseDisabledUntilSec`, never the block. Since the block
is wall-clock and normally already in the past when auto-resume fires, this is benign, but the field is
never normalized to 0, so a persisted snapshot can carry a stale future-ish ms across reloads.

**New app:** Reproduced — `engine.ts:498` sets only `autoPauseDisabledUntilSec`.

**Fix:** Add `this.manualPauseAutoResumeBlockedUntilMs = 0;` in the auto-resume branch for symmetry.

### 5 — 15 s grace is 14 ticks (Low, intended-as-written)
`inGrace = elapsedSec < autoPauseDisabledUntilSec` with the value 15 protects elapsed seconds 1–14 and
ends at 15. It is deterministic and faithfully ported (`engine.ts:456`), and Part X documents the
constant, so this is a boundary nit, not a divergence. Flagged only for completeness; `<=` would give a
true 15-tick window.

### 6 — Tick-counted elapsed/auto-pause drift under throttling (Low–Med)
The ticker advances `elapsedSec += 1` and `zeroPowerSeconds++` per fired `setInterval`, never reconciling
against wall-clock. Browsers throttle background `setInterval` (≥1 s, often much coarser), so a backgrounded
ride under-counts elapsed time and delays the 1 s/0 W auto-pause. `lastTickWallMs` is captured each tick
(`workout-engine.js:344-345`) but only used for FIT end-time, never to catch elapsed up.

**New app:** Reproduced — `engine.ts:440-450`, `lastTickWallMs` at `:441` unused for catch-up.

**Fix:** Advance elapsed by `round((now - lastTickWallMs)/1000)` (and feed that into the 0 W counter), or
accept as documented parity behavior.

### 7 — Restoring a finished ride never finalizes (Low)
`init` restores a running ride as **paused** and arms the ticker (`workout-engine.js:669-672`). The
end-of-workout check (`:386` `elapsedSec >= workoutTotalSec → endWorkout()`) is inside the `shouldAdvance`
(running && !paused) block, which never runs while paused. So a ride that crashed at/after its end sits
paused at completion. It only ends if power ≥0.9×target triggers an auto-resume, after which the next tick
exceeds total and calls `endWorkout` — otherwise it lingers indefinitely.

**New app:** Reproduced — `engine.ts:758-761` restore; end check at `:479` inside `shouldAdvance`.

**Fix:** In restore, if `elapsedSec >= workoutTotalSec`, finalize immediately (`endWorkout()` / clamp +
save) rather than arming a paused ticker.

### 8 — Pause accounting inflated across crash-reload (Med)
Restore copies `pauseStartedAtMs` and `manualPauseAutoResumeBlockedUntilMs` straight from the persisted
snapshot (`workout-engine.js:653-660`). If the ride was paused when the app closed, `pauseStartedAtMs`
holds the pre-close timestamp; the *next* resume/end does `totalPausedMs += now - pauseStartedAtMs`
(`:445-446`/`:521-522`), so the **entire app-closed gap** (could be hours) is counted as paused time and
flows into the FIT `totalElapsedSec` (`saveWorkoutFile():248-251`). The block ms is harmless but
meaningless after reload.

**New app:** Reproduced — `engine.ts:787-790` restores both verbatim; accounting at `:575-576`/`:648-649`,
FIT total at `:347-350`.

**Fix:** On restore, set `pauseStartedAtMs = null` (the closed-app interval is not paused *riding*) and
reset `manualPauseAutoResumeBlockedUntilMs = 0`; if exact paused time matters, recompute it from
`pauseEvents`.

---

## Things checked and judged INTENDED (not bugs)
- **Auto-pause does not set the 10 s block** (only manual pause does) → auto-paused rides can auto-resume
  the next second; correct anti-trap design.
- **Anti-thrash:** inside grace `zeroPowerSeconds` is forced to 0 each tick (`workout-engine.js:364`), and
  auto/manual resume re-arms `autoPauseDisabledUntilSec = elapsedSec+15`, so resume can't immediately
  re-auto-pause. Works as intended.
- **Auto-resume blocked during the 10 s manual-pause window** (`now < blockedUntil`, `:400`) and manual
  resume clearing the block + arming grace (`:502-503`) — correct.
- **`setRunning(true)` bypasses `setPaused` pause-accounting** at start — harmless because
  `pauseStartedAtMs` is null at start.
- **FTP/manual/mode changes re-rate live** via `rawSegments×ftp` recompute — intended (only the
  *paused* force-send, bug 2, is questionable).
- **ERG clamp [0,2000] + resistance ×10/[0,100]** (`ble-manager.js:482/493`) faithfully ported.
- **Transport throttle initial state** differs cosmetically (legacy `lastErgSendTs=0` with
  `performance.now()`-seconds vs new `-Infinity`) but the first send always fires via the
  `lastTrainerMode !== 'erg'` clause, so no functional divergence.

## Uncertainties
- Bug 3's real-world impact depends on the trainer's behavior when it stops receiving ERG updates during a
  pause; I could not exercise hardware. The throttle logic and missing force-on-resume are confirmed in code.
- Bug 6's severity depends on whether the HUD relies on `requestAnimationFrame`/visibility handling
  elsewhere; I found none in the engine — `setInterval(…,1000)` is the only time source for `elapsedSec`.
- Bug 8: I did not confirm whether any caller proactively re-saves idle/clears `pauseStartedAtMs` between
  sessions; the engine's `init` does not, and `setWorkoutFromPicker` is blocked while a ride is
  running/paused, so a crashed-paused snapshot does reach the accounting code on the next resume/end.
