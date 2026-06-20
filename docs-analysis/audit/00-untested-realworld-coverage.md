# Untested real-world logic — coverage map

The UI is verified (visual diff + behavior e2e). What the hermetic harness
*cannot* exercise is the logic that touches the real world: Bluetooth hardware,
wall-clock-driven workout behavior, trainer control, audio, wake lock, and
persistence across real reloads. This document enumerates those areas, maps each
to the legacy (`legacy/`) and new (`web/src/`) code, and flags what is and isn't
covered by existing tests. It is the input to the per-category adversarial review
(`00-realworld-adversarial-review.md`).

Existing automated coverage (for reference): `unit/engine-state.test.ts`,
`unit/text-event-audio.test.ts`, `unit/web-file-store.test.ts`,
`parity/fit.parity.test.ts`, `harness/ftms.selftest.test.ts`, `e2e/ble.new.spec.ts`,
plus the UI e2e specs. None of these drive real hardware, real timers at scale,
or a real reload.

| # | Category | Legacy source | New source | Tested today | Key UNTESTED behaviors to review |
|---|----------|---------------|------------|--------------|----------------------------------|
| C1 | **BLE device lifecycle & connectivity** | `ble-manager.js` | `ports/web/WebBluetoothTransport.ts` | parse self-test; thin `ble.new` e2e | Scan/connect/disconnect; **auto-reconnect timers + exponential backoff**; dual device (bike + HR) independence; `suppressAutoReconnectOnce` flags; GATT teardown; permission/`NotFoundError`/user-cancel; reconnect of *saved* devices on boot |
| C2 | **FTMS / ERG trainer control (output)** | `ble-manager.js` (control-point encode), `workout.js`/`workout-engine.js` (when to send) | `WebBluetoothTransport.ts` (`setErgTarget`/resistance + throttle), `core/engine.ts` (send decisions), `ports/TrainerTransport.ts` | encoding self-test; some engine unit | **ERG send throttle (≥10s / `lastErgSendTs`)**; clamp 0–2000 W; resistance ×10 scaling; **forced re-send on resume / mode switch**; dedupe identical targets; erg↔resistance mode switching |
| C3 | **Live sensor data ingestion (input)** | `ble-manager.js` (`parseIndoorBikeData`, HR parse), `workout.js` | `WebBluetoothTransport.ts` (parse + emit), `core/engine.ts` (sample → state) | parse self-test | Flag-driven field offsets; **HR-from-bike vs HR-strap precedence**; null/stale/zero handling; sample → `liveSamples` buffering; units (speed, cadence /2, power signed) |
| C4 | **Engine auto-behaviors** | `workout-engine.js`, `workout.js` | `core/engine.ts` (`tick`, auto-pause/resume) | `engine-state.test.ts` (partial) | **Autostart threshold** `max(75, 0.5·ftp·startPct/100)`; **auto-pause** `zeroPowerSeconds≥1`; grace 15s; **auto-resume ≥0.9·target**; manual-pause block 10s; free-ride interactions; boundary/off-by-one |
| C5 | **Workout lifecycle (start/finish/end/restart)** | `workout-engine.js`, `workout.js` | `core/engine.ts` (`startWorkout`, finish, `onWorkoutEnded`) | `engine-state.test.ts` (partial) | End-of-workout finalize; **finalize finished ride on restore**; autostart-next-after-finish; restart after finish; `autoStartSuppressed` lifecycle; beep gates; the 9 previously-fixed bugs staying fixed |
| C6 | **In-ride manual actions** | `workout.js` | `core/engine.ts`, `ui/HudView.svelte`, `ui/App.svelte` | thin (UI e2e) | Manual pause/resume; **skip segment**; manual ERG ± bounds + throttle interaction; **FTP change mid-ride** (recompute); sound toggle; action gating while paused/starting |
| C7 | **Persistence & ride recording** | `storage.js`, `fit-file.js` | `ports/web/WebFileStore.ts`, `core/fit.ts`, `core/engine.ts` (save triggers) | file-store unit (partial), FIT parity | **Active-state save/restore across reload**; `.fit` write on finish; selectedWorkout persistence; settings/schedule/handles; stats cache; save debounce timing; partial-write/error handling |
| C8 | **Audio, wake lock & backgrounding** | `beeper.js`, `workout.js` | `core/beeper.ts`, `ui/App.svelte`, `ui/HudView.svelte` | `text-event-audio.test.ts` (partial) | Countdown beep sequence + timing; cue-beep gating; AudioContext lifecycle/resume-on-gesture; **wake lock acquire/release**; **tab backgrounding → tick drift (P6)**; visibility handling |

## Review method

For each category, two adversarial subagents:
- **Regression lens** — line-by-line diff of the legacy implementation vs the new
  one, hunting for behavior that was present/correct in legacy and is
  missing/changed/wrong in the new code.
- **Edge-case lens** — reasons from first principles about the new code alone:
  boundary conditions, races, ordering, null/stale inputs, timer/clock issues.

Findings are compiled into `00-realworld-adversarial-review.md`, each annotated
with a main-agent recommendation on whether it is valid and worth fixing.
