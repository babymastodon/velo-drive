# Per-Journey Verification — Consolidated Defects & Fix List

5 read-only verification slices over the 300-row `journeys.md` (detail in
`verified-01..05-*.md`). Overall: the recent fix waves wired the large majority faithfully;
the **core ride state machine, vim keymap, clipboard, validation, trash-first saves, and the
central hotkey router are all verified correct.** Below are the genuine remaining defects, deduped
and cross-checked across slices, with severity.

## Cross-check resolution
- **Planner calendar Escape "closes the planner"** — flagged WRONG by the planner slice, but the
  hotkeys slice found legacy's HUD-level Escape dispatcher (`workout.js:1761-1770`) **did** close it
  (the planner's own no-op listener never ran). New behavior = **correct**. NOT a defect.

## Fix list (prioritized)

### HIGH
| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | **`pickRootDir` never seeds the 6 default workouts** → fresh user gets an EMPTY library (J-CFG-17) | `WebFileStore.pickRootDir` | port `maybeSeedDefaultWorkouts`/`copyDefaultWorkoutsToDir` (storage.js:446-487); bundle the default `.zwo` as assets |
| 2 | **Broken post-ride flow** (J-PLAN-34/J-RIDE-26): `onWorkoutEnded` opens planner but never (a) removes the completed *scheduled* entry, (b) auto-opens the ride detail — `ui.pendingHistoryFile` is set but **no component reads it** | `app.ts`, `App.svelte`, `PlannerView.svelte` | port `removeScheduledByTitle`; make PlannerView open the detail for `pendingHistoryFile` |
| 3 | **Chart theme-redraw holes** (J-DARK-06, J-CFG-13): (a) no `prefers-color-scheme` listener → Auto-mode OS flip never redraws any chart; (b) picker/builder mini-charts don't subscribe to `themeVersion` (stale on manual toggle) | `state/theme.svelte.ts`, picker/builder charts | add a `matchMedia('(prefers-color-scheme: dark)')` listener that bumps `themeVersion` + re-applies auto theme; subscribe picker/builder charts to `themeVersion` |

### MEDIUM
| # | Defect | Where | Fix |
|---|---|---|---|
| 4 | **Picker empty-search Escape closes the picker** (P-1); legacy always clear+blur (consumes Esc), never closes from the field | `PickerView.svelte:719-728` | Escape in the focused search always consumes (clear if non-empty + blur), never falls through to close |
| 5 | **Sound default mismatch** (J-CFG-15): boot defaults `soundEnabled=false` (muted) but the toggle defaults true (shows ON) | `app.ts` vs `SettingsView.svelte` | align default to legacy `true` (audible) |
| 6 | **Splash welcome no 1.1s auto-close** (J-WEL-03) | welcome boot path | add the `playSplash(1100)` auto-dismiss |
| 7 | **Text-event audio cues never fire during a ride** (J-RIDE-10) | `engine.ts` tick + `beeper.ts` | add `playTextEventTaps` + a runtime active-text-event hook (fire-once like legacy) |
| 8 | **`theme-color` meta static `#222`** (J-DARK-11) — browser chrome stays dark in light mode | `index.html` / theme code | light/dark theme-color (media or dynamic on theme change) |
| 9 | **Silent file-op failures** (J-ERR-07..24): ~17 ops `return false` with only console logging (no-folder, permission-revoked, save-fail, trash-move-fail). Data-loss guard preserved; only the alerts are gone | `WebFileStore` callers | surface themed Dialog alerts for the key ones (no-folder, permission, save/delete fail) |
| 10 | **Boot auto-open planner for today's scheduled ride** (J-RIDE-34) | `App.svelte` boot | port `maybeOpenPlannerForTodaySchedule` (suppressed if active/already-loaded) |
| 11 | **5 native `alert()`s remain** (engine ×2 reachable via Space, WebFileStore ×3) — unthemed (J-DARK-12) | engine/WebFileStore | route through the themed DialogStore (or a log+toast for engine) |

### LOW (optional)
- Beep fidelity: `playBeepPattern`=3 plain beeps, `playDangerDanger`=1 beep vs legacy scheduled pattern + siren/honk (J-RIDE-20).
- `j`/`k` don't navigate a focused `<select>`'s options (P-2); connecting-tooltip progression (J-BLE-09); scroll-into-view when keyboard-nav past the 16-week window (J-PLAN-04); splash opens one help section vs two (J-CFG-02); draft-persist failure swallowed (B-3).

## Deferred (intentional — not defects)
Extension scrape pipeline (TrainerRoad/WhatsOnZwift scrapers + scrape-on-focus + partial-failure
alerts; the new app is the PWA, not the extension), block-reorder drag, text-event drag,
picker schedule-mode round-trip, deep-scroll calendar recycling, `?`-held hotkey overlay.
