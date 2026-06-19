# Workout State-Management Bug Hunt — Consolidated Findings & Decisions

Two read-only bug hunts of the LEGACY workout state machine (`docs/workout-engine.js` +
`docs/workout.js`) for genuine logic defects (NOT parity gaps), and whether the verbatim TS
rewrite (`web/src/core/engine.ts`) reproduced each. Detail: `bughunt-autostart-finish.md` +
`bughunt-pause-resume-state.md`. The rewrite is a deliberate verbatim port, so legacy defects
were carried forward — these are fixed in the NEW code only (legacy left as-is).

Decision key: **FIX** = real bug, fixed in the new engine. **SKIP** = intended behavior or a
high-risk/low-value change, documented and left as-is.

| # | Bug | Severity | Decision | New-app location |
|---|---|---|---|---|
| A1 | After a workout finishes, selecting a NEW workout never auto-starts (`autoStartSuppressed` set by `endWorkout`, never cleared by `setWorkoutFromPicker`; only `startWorkout` clears it). Same-session only (flag is in-memory; a reload re-arms it). **The user-reported bug.** | High | **FIX** | `engine.ts:645` set, `:836-856` load |
| A2 | An empty-`rawSegments` workout (reachable via the planner scheduled-load `entry.rawSegments \|\| []`, accepted by the `Array.isArray`-only check) makes `maybeAutoStartFromPower`/`beginRun` read `rawSegments[0]` → **TypeError on every bike sample + on Start**. | Med–High | **FIX** | `engine.ts:388-389,622`; load guard `:841` |
| A4 | Space during the 3-2-1 countdown flips a stray `workoutPaused` (overwritten by `beginRun`; self-heals). | Low | **FIX** (trivial) | `engine.ts:587` `startWorkout` |
| P1 | Resistance free-ride can be auto-paused but **never auto-resumed** — auto-resume is gated on `0.9×target` and resistance target is `null` → rider trapped until manual resume. | High | **FIX** | `engine.ts:494-496` |
| P2 | Changing FTP / manual ERG / free-ride mode **while paused** force-sends a fresh ERG/resistance load to the trainer (setters call `sendTrainerState(true)`; `desiredTrainerState` ignores `workoutPaused`). | Med | **FIX** | `engine.ts:804-827` setters, `:256-265` |
| P3 | After resume the target is **not force-re-sent**; re-application depends on the ≥10 s throttle + "target unchanged" → non-deterministic. | Low–Med | **FIX** (pairs with P2) | `engine.ts:498-500,605-610` |
| P4 | Auto-resume doesn't clear `manualPauseAutoResumeBlockedUntilMs` (manual resume does) → stale block ms in snapshots. | Low | **FIX** (symmetry) | `engine.ts:498` |
| P7 | Crash-restoring an already-finished ride (`elapsedSec ≥ workoutTotalSec`) never finalizes — the end check sits inside the `shouldAdvance` (running && !paused) block, skipped while the restored ride is paused. | Low | **FIX** | `engine.ts:758-761` restore, `:479` end-check |
| P8 | Crash-resume restores `pauseStartedAtMs` as an absolute ms from the prior session → the **entire app-closed gap is counted as paused time** and inflates the FIT `totalElapsedSec`. | Med | **FIX** | `engine.ts:787-790` restore |
| A3 | Any finish leaves the trainer holding the last ERG/resistance target (no release sent). Matches legacy (not a regression). | Low | **SKIP** | — |
| P5 | "15 s start grace" is effectively 14 ticks (`elapsedSec < 15`). Documented/pinned constant, faithfully ported. | Low | **SKIP** | — |
| P6 | Backgrounded/throttled tab: `elapsedSec`/`zeroPowerSeconds` count ticks, not wall-clock, so a frozen tab under-counts. Parity behavior; reconciling the core time source is high-risk. | Low–Med | **SKIP** | — |

## Skip rationale
- **A3 (trainer ERG hold after finish):** identical in legacy; releasing ERG on finish would change
  hardware behavior and risks an abrupt resistance drop — a product decision, not a defect introduced
  by the rewrite. Surfaced for the owner to decide; left as-is.
- **P5 (grace off-by-one):** the value 15 is a documented Part X constant pinned by engine tests;
  it's deterministic and faithfully ported. Changing it would diverge from the pinned spec for a 1-tick
  cosmetic difference.
- **P6 (background tick drift):** rides run foregrounded; switching the engine's time source from
  tick-count to wall-clock reconciliation is a large, behavior-shifting change that would churn the
  deterministic tick-based test suite for little real-world gain. Documented as a known limitation.
