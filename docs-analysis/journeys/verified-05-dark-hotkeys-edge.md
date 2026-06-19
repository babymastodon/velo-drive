# Verified — Dark-mode / Hotkeys-Escape / Edge-Error-Guard (areas 5)

Read-only verification of three known-weak areas against the new app (`web/src`) vs legacy (`docs`). Status legend: **OK** = faithful; **PARTIAL** = present but degraded/diverges; **GAP** = not implemented; **WRONG** = implemented incorrectly.

Central routing files:
- `web/src/ui/App.svelte` — global keymap + Escape router (onKeydown, lines 167-264; ensureRootDirConfigured 269-282; openPicker/openPlanner guards 286-301).
- `web/src/state/ui.svelte.ts` — overlay model + `handleEscape()` (93-109) + `registerOverlayKeyHandler` (27-30).
- `web/src/state/dialog.svelte.ts` — themed promise-based alert/confirm/prompt (replaces native dialogs).
- `web/src/state/theme.svelte.ts` — `themeVersion()` MutationObserver redraw trigger.

---

## Hotkeys / Escape-context

| ID | New-app impl | Status |
|---|---|---|
| J-KEY-01 | App.svelte:167-212 — bails on meta/ctrl/alt (168), `pickerBuilderMode` (177), routes to overlay handler when overlay open (184-209), `isEditable` guard (212) before global keys. Welcome suppresses all keys (no handler, branch returns at 208). | OK |
| J-KEY-02 | App.svelte:218-223 — `e.code === 'Space'` start/pause, only with `vm.canonicalWorkout`. Suppressed when overlay open (early return at 209) / editable. | OK |
| J-KEY-03 | App.svelte:255-259 `w` → openPicker; openPicker (286-292) bails if workoutRunning/Paused/Starting + ensureRootDirConfigured. | OK |
| J-KEY-04 | App.svelte:250-254 `s` → ui.open('settings'). Always available (no overlay). | OK |
| J-KEY-05 | App.svelte:260-263 `c` → openPlanner; openPlanner (296-301) bails during active workout. | OK |
| J-KEY-06 | App.svelte:241-248 `e`/`r` set free-ride mode, gated on `active && isFreeRideActive`. In picker `e`=edit (PickerView:753-761); in builder e/r=insert Endurance/Recovery (BuilderView:806-813). Context-split handled by overlay routing. | OK |
| J-KEY-07 | App.svelte:229-238 ↑/k/↓/j manual ±10, gated on `vm.isFreeRideActive`. Picker j/k=row move (772-781); builder j/k=power. Context-split via routing. | OK |
| J-KEY-08 | App.svelte:179-197 — Escape routed to active overlay handler first; if consumed, stop; else `ui.handleEscape()`. | OK (see J-PLAN-10 note) |
| J-KEY-09 | Single central router (App.svelte) + per-overlay handlers via `overlayKeyHandlers` registry. Replaces legacy's 5 independent document listeners with one ordered dispatch. Cleaner than legacy. | OK |
| J-KEY-10 | WelcomeView:153-157 Escape closes; welcome is active overlay so App routes ALL keys to it and never falls through (App:202-209). `stopImmediatePropagation` not needed — there is no second listener. | OK |
| J-KEY-11 | BuilderView:843-856 — Escape: deselect block/text-event first (844-850), else onRequestBack (851-855). App bails entirely in `pickerBuilderMode` (App:177) so it never closes the picker on builder Escape. | OK |
| J-KEY-12 | No picker schedule-mode. Scheduling handled inline in PlannerView (writes schedule.json directly; PlannerView:14-20 comment). No picker→planner Escape/Backspace round-trip exists. | GAP (by design; see Gaps) |
| J-KEY-13 | PickerView:719-728 — Escape in search clears searchTerm (returns true → no close); empty search blurs + returns false (App closes). Mirror handler onModalKeydown:806-810 (redundant but idempotent). | OK |
| J-KEY-14 | PlannerView:788-790 — handlePlannerKey returns false for Escape on calendar; App falls to `ui.handleEscape()` → `close()`. Legacy planner's OWN listener no-ops, but legacy HUD dispatcher (workout.js:1761-1769) calls `planner.close()`. Net legacy behavior = closes. New app matches. | OK |
| J-KEY-15 | PlannerView:782-785 — detail Escape/Backspace → exitDetail (returns true). `ui.plannerDetailOpen` (891-893) + handleEscape guard (104-106) prevent closing whole planner from detail. | OK |
| J-KEY-16 | No settings overlay key handler. App routes Escape to (absent) handler → falls to `ui.handleEscape()`: settings+logsOpen → close logs (return to main, ui.svelte:95-98); else close. | OK |
| J-KEY-17 | App.svelte:202-209 — any open overlay suppresses global HUD keys. Welcome has a handler that swallows nav keys (splash) and the branch returns regardless of handler result, so welcome suppresses everything. | OK |
| J-KEY-18 | PickerView:694-783 — handlePickerKey bails on builderMode (697) + meta/ctrl/alt (698); `/`,`z`,`d` allowed before the INPUT/SELECT early-return (745). | OK |
| J-KEY-19 | `?`-held hotkey-list overlay + `/`-keyup reveal NOT implemented in planner. PlannerView:21 comment: "the `?`-held hotkey overlay [is] dropped." | GAP |

---

## Edge / Error / Guard

| ID | New-app impl | Status |
|---|---|---|
| J-ERR-01 | WebFileStore.ts:223-231 pickRootDir — `showDirectoryPicker` absent → `alert('Selecting a data folder requires File System Access support.')`, returns null. Native alert (not themed). | PARTIAL |
| J-ERR-02 | Same FSA-unsupported path (no separate "not available in this build" — the SettingsView Choose-folder calls the same pickRootDir). | PARTIAL |
| J-ERR-03 | WebFileStore.ts:238-243 — `ensureDirPermission` fails → `alert('Permission was not granted to the selected folder.')`, returns null. | OK (native) |
| J-ERR-04 | WebFileStore.ts:259-262 — AbortError silent (returns null); other → `alert('Failed to choose folder.')`. | OK (native) |
| J-ERR-05 | App.svelte:269-282 ensureRootDirConfigured — no root → `dialogs.alert('Choose a VeloDrive folder first, then pick a workout.')` + forceHelpSection 'settingsFoldersHelp' + open settings. Themed dialog. | OK |
| J-ERR-06 | WebFileStore.ts:129-144 ensureDirPermission — query→short-circuit granted→request; denied→false. Re-auth before save/trash/schedule (352,392,630,647). | OK |
| J-ERR-07 | WebFileStore.deleteHistoryToTrash:646 — no history(src) dir → `return false`. NO user alert; caller (PlannerView:702) silently returns. Legacy alerted "No history folder…". | PARTIAL |
| J-ERR-08 | Same path (no trash dir → return false, no alert). | PARTIAL |
| J-ERR-09 | WebFileStore:647 — src permission revoked → ensureDirPermission false → return false, no alert. Legacy alerted "re-authorize". | PARTIAL |
| J-ERR-10 | Same (trash permission revoked → return false silently). | PARTIAL |
| J-ERR-11 | WebFileStore:667-668 — move failure → console.error + return false, no alert. | PARTIAL |
| J-ERR-12 | WebFileStore.deleteWorkoutToTrash → moveZwoFileToTrash:391 — no library(src) dir → return false, no alert. Caller PickerView:294 silent. | PARTIAL |
| J-ERR-13 | Same (no trash dir → return false, no alert). | PARTIAL |
| J-ERR-14 | WebFileStore:392 — src permission revoked → return false, no alert. | PARTIAL |
| J-ERR-15 | Same (trash permission revoked → return false, no alert). | PARTIAL |
| J-ERR-16 | WebFileStore:418-419 — trash move failure → console.error + false, no alert. | PARTIAL |
| J-ERR-17 | Same no-library-folder path (return false, no alert). | PARTIAL |
| J-ERR-18 | PickerView onBuilderSave:628-631 — builder unavailable / `!validation.ok` → silent return (validation shows inline red borders + status text, no alert). | OK |
| J-ERR-19 | onBuilderSave:633-635 — no blocks → silent return; validateForSave already flags "Workout code is empty." inline (BuilderView:1066). | OK |
| J-ERR-20 | WebFileStore.saveWorkout:377-379 — unexpected failure → console.error + false; PickerView:645 silent return, no alert. | PARTIAL |
| J-ERR-21 | WebFileStore.saveWorkout:347-348 — no zwo dir → return false, no alert. | PARTIAL |
| J-ERR-22 | WebFileStore.saveWorkout:352 — permission revoked → return false, no alert. | PARTIAL |
| J-ERR-23 | WebFileStore.saveWorkout:359-369 — overwrite moves old file to trash FIRST; if move fails `return false` (save aborted, no data loss). Data-loss guard PRESERVED. Only the user-facing alert is dropped. | PARTIAL |
| J-ERR-24 | saveWorkout:371-379 write failure → console.error + false, no alert. | PARTIAL |
| J-ERR-25 | PickerView:419-423 maybeHandleUnsavedBeforeLeave → `dialogs.confirm('Discard unsaved changes?', {okLabel:'Discard', cancelLabel:'Keep editing'})`. Themed. | OK |
| J-ERR-26 | compat.ts:85-89 compatMessage — unsupported OS (iOS/Unknown) → message; SettingsView:130 compatAlertText; boot auto-open App.svelte:137-143 (isPlatformIncompatible). | OK |
| J-ERR-27 | compat.ts:91-93 — non-Chromium browser → message. | OK |
| J-ERR-28 | SettingsView btAvailable (138) via isWebBluetoothAvailable; boot auto-open on missingBt (App:136). Advisory; doesn't block. | OK |
| J-ERR-29 | App.svelte:128-143 maybeAutoOpenSettings (missingRootDir) + maybeShowWelcome forces full tour (102). | OK |
| J-ERR-30 | engine.ts:535-539 startWorkout — no workout → **native** `alert('No workout selected. Choose a workout first.')`. Reachable via Space hotkey. Not themed. | PARTIAL |
| J-ERR-31 | engine.ts:784-787 setWorkoutFromPicker — running → **native** `alert('Please end your current workout first.')`. | PARTIAL |
| J-ERR-32 | PlannerView.openDetail:539-543 — FIT parse failures are dropped in listWorkouts/listHistory (console.warn, file skipped); `match` not found → return, stays in calendar, no alert. Matches legacy. | OK |
| J-ERR-33 | metrics/engine early-return on empty segments (no chart/metrics). LiveChart emptyKind → 'noWorkout'/'readyToStart'. | OK |
| J-ERR-34 | LiveChart.svelte:18-46 — full 4-state machine (resume/readyToStart/noWorkout/noBike) with directional arrows (arrowDir 44-46). Faithful. | OK |
| J-ERR-35 | main.ts:24-29 — `serviceWorker` register('sw.js'). | OK |
| J-ERR-36 | SW activate cache-cleanup — re-hosted legacy SW (web/legacy SW / sw.js). | OK (assumed re-host) |
| J-ERR-37 | UNCONFIGURED → forceFullWelcome (App:95-111) when missingRootDir. | OK |
| J-ERR-38 | SettingsView:104-125 — rootDirName shown; picker unlocked once configured (ensureRootDirConfigured passes). | OK |
| J-ERR-39 | App.svelte:62-71 isRunningAsPwa (display-mode standalone / navigator.standalone). | OK |
| J-ERR-40 | 5 native `alert()` remain: engine.ts:538,786; WebFileStore.ts:229,241,261. Render in OS theme, ignore app theme. All other dialogs use themed DialogStore. | PARTIAL |

Additional Edge/Guard items from other sections relevant to this area:
- **J-RIDE-24** End-workout confirm — BottomNav:73 `dialogs.confirm('End current workout and save it?')`. **OK** (themed).
- **J-RIDE-30/31** — see J-ERR-30/31 (native alert). **PARTIAL**.
- **J-BLE-14/15** — BottomNav:80-87 ensureBluetooth → `dialogs.alert("Your browser doesn't support Bluetooth. Let's open Settings…")` + onOpenSettings. **OK** (themed).
- **J-PICK-02** — App.svelte:278 themed alert "Choose a VeloDrive folder first…". **OK**.
- **J-PICK-14 (file upload)** — PickerView:558 `dialogs.alert('Unable to load workout file.')`. **OK**.
- **J-PLAN-15/16** past-date scheduling reject — PlannerView:659,811,822 isPastDate guards; schedule btn hidden on past (showScheduleBtn:653). **OK** for click/key; drag-reschedule itself dropped (J-PLAN-14, see Gaps).
- **J-PLAN-31/32/33** delete confirms — PlannerView:667,682,695,866 themed confirms. **OK**.

---

## Dark-mode rendering

| ID | New-app impl | Status |
|---|---|---|
| J-DARK-01 | workout-base.css re-hosted: `@media (prefers-color-scheme:dark)` (91), `.theme-dark`, `.theme-light`. theme.ts:22-31 toggles classes + data-theme. | OK |
| J-DARK-02 | All overlay CSS re-hosted variable-driven (welcome/settings/picker/planner.css). | OK |
| J-DARK-03 | workout-base.css:94-96,144 — bg/surface/surface-elevated/nav all `#222222` in dark. Faithful legacy reproduction (legacy HIGH note carries over; not a new defect). | OK (faithful) |
| J-DARK-04 | Modal elevation lost (box-shadow on #222) — re-hosted CSS, same as legacy. | OK (faithful) |
| J-DARK-05 | New welcome uses `createScene` (welcome-scene.ts:136) with CSS-var colors (`color: var(--…)`), NOT legacy hardcoded near-black SVG linework. **Improved** over legacy low-contrast. | OK (improved) |
| J-DARK-06 | LiveChart.svelte:71-79 redraws on `themeVersion()`. PlannerView:528-532 redraws all registered charts on themeVersion. **BUT** PickerView mini-charts (use:miniChart, 814-822) and BuilderView chart ($effect 465-490) do NOT read themeVersion → stale colors on theme toggle while picker/builder open. ALSO no `prefers-color-scheme` OS-change listener → Auto-mode OS toggle never bumps version (no class mutation). | PARTIAL |
| J-DARK-07 | `--shade-bg` inversion driven by re-hosted CSS vars + chart reads at draw. Redraw gaps inherit J-DARK-06. | OK (CSS) |
| J-DARK-08 | Line color hues theme-specific via CSS vars; chart.ts getCssVar at draw. | OK |
| J-DARK-09 | Connection dots hardcoded grey/amber/green/red — re-hosted CSS. | OK (faithful) |
| J-DARK-10 | Battery-low orange #f57c00 color-only — re-hosted CSS. | OK (faithful) |
| J-DARK-11 | web/index.html:8 — single static `<meta name="theme-color" content="#222222">`, NO media query. Legacy had TWO (light #f4f4f4 + dark #222222, media-scoped). New app's browser chrome is dark even in light/OS-light mode. | WRONG |
| J-DARK-12 | 5 native alerts (J-ERR-40) render in OS theme. Most dialogs now themed (DialogStore). Partial mismatch remains. | PARTIAL |
| J-DARK-13 | status-overlay re-hosted (StatusOverlay.svelte + workout-base.css theme rules). | OK |
| J-DARK-14 | Hover overlays black-alpha↔white-alpha — re-hosted CSS @media dark (655,666,746,808,841). | OK |
| J-DARK-15 | chart-empty-overlay bg `--chart-empty-bg` — re-hosted; LiveChart renders the overlay (88-116). | OK |
| J-DARK-16 | Planner palette maroon/pink — workout-planner.css:548 @media dark. | OK |
| J-DARK-17 | Builder block active-filter / insert-line theme-specific — re-hosted CSS + chart.ts. | OK |
| J-DARK-18 | Tooltip dark bg #303030 — re-hosted workout-base.css:486 @media dark. | OK |
| J-DARK-19 | Manifest theme/bg #222222 — re-hosted webmanifest. | OK |

---

## Gaps & defects (PARTIAL / GAP / WRONG only)

### WRONG

1. **[MEDIUM] J-DARK-11 — `theme-color` meta missing light/dark split.** `web/index.html:8` has a single static `<meta name="theme-color" content="#222222">` with no `media` attribute. Legacy (`docs/index.html:37-46`) had TWO media-scoped metas: `#f4f4f4` for `(prefers-color-scheme: light)` and `#222222` for dark. Effect: in light mode (Auto+OS-light, or forced Light) the mobile/PWA browser chrome stays dark `#222222` instead of matching the light `#f4f4f4` surface. Visible mismatch on Android/PWA.

### PARTIAL — Dark-mode redraw

2. **[HIGH] J-DARK-06 — chart theme-redraw incomplete (two holes).**
   - **(a) No OS `prefers-color-scheme` listener.** Legacy `docs/workout.js:1402-1405` registers an `mql.addEventListener('change', rerenderThemeSensitive)` when `themePref === 'auto'`. The new app only has a MutationObserver on `<html>` class/data-theme (`theme.svelte.ts:24-33`). In **Auto** mode an OS dark/light toggle produces NO class mutation (data-theme stays "auto"), so `themeVersion` never bumps → HUD chart, planner charts, picker/builder charts all keep STALE palette colors until another redraw trigger. Legacy redrew immediately.
   - **(b) Picker mini-charts + builder chart don't subscribe to themeVersion.** `PickerView.svelte:814-822` (`use:miniChart`) and `BuilderView.svelte:465-490` ($effect deps `version` only) never read `themeVersion()`. Even a MANUAL Dark/Light toggle (which does bump version) leaves the open picker's expanded mini-chart and the builder chart stale. Legacy explicitly redrew these (`docs/workout-picker.js` theme observer; the new code's own `theme.svelte.ts:8-9` comment acknowledges this requirement but the components don't honor it). LiveChart (HUD) and PlannerView are correctly wired.

### PARTIAL — dropped user-facing alerts (file-op failures)

3. **[MEDIUM] J-ERR-07..J-ERR-24 — file-operation FAILURES no longer alert the user.** `WebFileStore.ts` swallows nearly all save/delete/trash/permission-revoked failures into `return false`/`return null` with only `console.error`/`console.warn` (lines 336,348,352,378,391-392,418,446,494,629-637,646-647,667-668). UI callers then silently `return` (`PickerView:294,326,645`; `PlannerView:690,702,705`). Legacy raised a specific `alert()` for each: no-history-folder (J-ERR-07), no-trash-folder (J-ERR-08), src-permission-revoked (J-ERR-09), trash-permission-revoked (J-ERR-10), trash-move-failure (J-ERR-11), no-library-folder (J-ERR-12/17/21), library permission-revoked (J-ERR-14/15/22), library trash-move-failure (J-ERR-16/24), unexpected save failure (J-ERR-20). On failure the new app appears to silently no-op (delete confirmed but file stays; save clicked but nothing written) with no feedback. Data integrity is preserved; only feedback is lost.

4. **[MEDIUM] J-ERR-23 — overwrite-to-trash failure aborts but is silent.** `WebFileStore.saveWorkout:366-369` correctly moves the existing same-name `.zwo` to trash first and ABORTS the save (`return false`) if the move fails (data-loss guard intact). But the legacy alert ("Could not move existing workout to trash; save aborted") is dropped, and `PickerView.onBuilderSave:645` silently returns — the user sees the save fail with no explanation.

### PARTIAL — native dialogs not themed

5. **[LOW] J-ERR-30/31/40 + J-DARK-12 — 5 native `alert()`s remain.** `engine.ts:538` ("No workout selected…", reachable via Space hotkey), `engine.ts:786` ("Please end your current workout first."), and `WebFileStore.ts:229/241/261` (folder picker errors). These render in OS chrome, ignoring the app theme — the exact dark-mode mismatch the spec flags (J-DARK-12). All other dialogs use the themed `DialogStore`. Inconsistent; the engine ones are user-reachable.

### GAP — dropped features (intentional simplifications)

6. **[MEDIUM] J-PLAN-14 / J-PLAN-15 — drag-and-drop reschedule dropped.** `PlannerView.svelte:21` comment: "Drag-and-drop reschedule … are dropped." Legacy let users drag a scheduled card to another day with future-only/today-allowed past-date rejection (`docs/workout-planner.js:457-471,985-1023`). The new app only supports schedule via the schedule button / Enter / `e` key. Reschedule now requires delete + re-schedule. (Click/key past-date guards themselves are intact — J-PLAN-16 OK.)

7. **[MEDIUM] J-KEY-19 / J-PLAN-11 — `?`-held hotkey-list overlay dropped.** `PlannerView.svelte:21` comment confirms. Legacy showed a held-`?` hotkey legend (hiding aggregates) with auto-repeat suppression (`docs/workout-planner.js:1275-1283,1445-1466`). No equivalent in the new planner.

8. **[LOW] J-KEY-12 — picker schedule-mode Escape/Backspace→planner round-trip gone.** The legacy picker had a dedicated schedule mode reached from the planner, whose Escape/Backspace returned to the planner (`docs/workout-picker.js:1432-1443`). The new app schedules inline in `PlannerView` (writes `schedule.json` directly, 14-20), so this round-trip and its keymap simply don't exist. Equivalent outcome via the inline schedule flow; the specific key path is absent. Note the new `onEditScheduled` (736-763) is a simplified confirm-based replace/remove rather than re-opening a full picker.

---

## Notes on items that LOOK like defects but are correct

- **J-KEY-14 / J-PLAN-10 (planner calendar Escape).** The journeys row says "NO-OP, never closes." That describes only the legacy planner's OWN listener; the legacy HUD `document` dispatcher (`docs/workout.js:1761-1769`) DOES call `planner.close()` when the planner is open and not in detail. So effective legacy behavior = Escape closes the planner. The new app closing it (App→handleEscape→close) MATCHES net legacy behavior. Not a defect.
- **J-DARK-05 / J-WEL-13.** The new welcome scenes are CSS-var-colored (`welcome-scene.ts`), fixing the legacy low-contrast near-black SVG linework in dark mode. Improvement, not a regression.
- **J-DARK-03 / J-DARK-04 (surface collapse, modal elevation).** Re-hosted unchanged from legacy CSS; the legacy HIGH severity carries over but these are faithful reproductions, not new defects.
- **Escape central routing (J-KEY-08/09).** The new app replaces legacy's 5 uncoordinated `document` listeners with a single ordered router (App.svelte) + per-overlay handler registry — structurally cleaner and verified correct for every disposition (builder-deselect-then-back, picker-search-clear, planner-detail-pop, settings-logs→main).
