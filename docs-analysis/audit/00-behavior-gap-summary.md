# Behavior Audit — Consolidated Gap Summary & Fix Plan

Per-area detail (every item, exact legacy→new line): `behavior-01..05-*.md`.

## Totals
| Area | Items | OK | PARTIAL | GAP | Deferred |
|---|--:|--:|--:|--:|--:|
| 01 Global/HUD/engine/BLE | 62 | 33 | 18 | 11 | — |
| 02 Picker | 79 | 37 | 18 | 24 | 6 |
| 03 Planner | 88 | 38 | 13 | 37 | 12 |
| 04 Builder | 140 | 99 | 16 | 25 | (drag) |
| 05 Settings/Welcome | 81 | 53 | 18 | 10 | (anim) |
| **Total** | **~450** | **~260** | **~83** | **~107** | **~30** |

**Pattern:** core logic ported faithfully; ~30–40% of *interaction handlers* (keys, input commits, onclicks, cues) unwired. Backends mostly exist → most fixes are re-wiring.

## Fix waves (prioritized; each fix gets a behavior test)

### Wave 1 — HUD / global (core ride usability) — HIGH
- Global hotkeys (no overlay open): **Space** start/pause, `e`/`r` mode, `j`/`k`/↑/↓ manual ±10, `w`/`c`/`s` already partial. *(01 §B)*
- **Manual ERG/resistance input commit** (Enter/blur → `engine.adjustManualErg`/`Resistance`/typed value). *(01 D, BottomNav.svelte:186)*
- **Stop confirm()** before endWorkout. *(01, BottomNav.svelte:54)*
- **StatusOverlay** component: 3-2-1 countdown, "Paused"/"Resumed", text-event cues (currently invisible). *(01 D)*
- **onWorkoutEnded** → open planner to the saved ride. *(01, app.ts:59)*
- Live coaching cues: per-segment "Maintain/Ramp … for … at … RPM", "In N -" lookahead, "Speed up/Slow down" cadence; pass chart `textEvents`. *(01 D)*

### Wave 2 — Picker — HIGH/MED
- Picker keymap: `z`/`d` open filters, `e` edit, SELECT j/k/↑/↓ nav, search-Enter→focus Select. *(02)*
- Filter/sort **state persistence** across opens (load/savePickerState). *(02)*
- **saveWorkout trash-then-write** (verify vs builder's claim; no silent overwrite). *(02)*
- Builder **unsaved-changes guard** + draft persist/restore + discard confirm. *(02, 04)*
- **Import:** TrainerDay URL + file Upload (.zwo/.fit) — dead buttons. *(02, 04)*

### Wave 3 — Planner — HIGH/MED
- Planner keymap: h/j/k/l+arrows day nav, Enter open/load/schedule, `e` edit, `d`/Delete delete. *(03)*
- **Escape**: detail → calendar (not close-all); calendar Escape closes planner. *(03, ui.svelte.ts:43)*
- **Scheduled card click** → load/start workout. *(03, PlannerView.svelte:865)*
- Edit-scheduled (not delete-only); stats cache; detail-chart hover tooltip. *(03)*

### Wave 4 — Builder — MED
- **Clipboard** copy/cut/paste (Ctrl/Cmd+C/X/V, P, Insert/Delete variants, toolbar buttons) — backend exists, unwired. *(04)*
- **Multi-block selection** (Shift+nav, shift-click range) — backend exists, `shiftKey` dropped. *(04)*
- Cmd+A/E cursor-to-start/end; click-sets-insert-side. *(04)*
- (Deferred: block-reorder drag, text-event drag.)

### Wave 5 — Global/settings/welcome/BLE/PWA — MED
- **BLE auto-reconnect backoff** + paired device-ID persistence. *(01 F)*
- **Logs** wiring (onLog → settings logs view, selection-preserving). *(01, 05)*
- **Compatibility alert** (unsupported OS/non-Chrome) + **startup auto-open** when folder/BLE missing. *(05)*
- **Welcome keyboard nav** (arrows/PageUp-Down/Space/Enter). *(05)*
- **Service worker** registration (PWA/offline). *(01)*
- Scraped-workout import-on-focus pipeline. *(01)* *(extension-dependent; lower priority for PWA)*

## Out of scope / intentionally deferred
Picker schedule-mode handoff (replaced by planner-local schedule.json), block-reorder/text-event drag (click-select), welcome scene animations (instant for deterministic diff), deep-scroll calendar recycling.
