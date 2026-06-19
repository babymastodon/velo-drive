# Buttons & Views Audit — Legacy VeloDrive vs. New Rewrite

> **Read-only audit.** No code was changed; this markdown is the deliverable.
> **Legacy oracle:** `/home/babymastodon/code/velo-drive/docs` (static `index.html` + ES-module `*.js`).
> **New app:** `/home/babymastodon/code/velo-drive/web/src` (Svelte 5 + TS).
> Companion to the existing `behavior-*`, `css-*`, and `journeys/scour-*` docs; this one is the
> exhaustive **view-by-view / button-by-button** parity matrix and isolates the user-reported
> "Select a workout" divergence and the **missing page**.

## TL;DR — the user's two reports, resolved

1. **The missing page is the SCHEDULE-MODE PICKER** — the workout *library, opened from the
   planner in "Schedule Workout" / "Edit Schedule" mode* (legacy `workout-picker.js:1923-1934 openScheduleMode`,
   DOM `index.html:347-695`, wired `workout.js:1430-1471`). In the new app it **does not exist**:
   `PlannerView.svelte:13-21` documents it was deliberately dropped and replaced by a one-line
   confirm dialog. There is **no way to browse-and-pick an arbitrary workout for a calendar day**
   in the new app.
2. **"Select a workout" behaves EXTREMELY differently** in exactly that planner context. In legacy,
   the planner **Schedule workout** button (and Enter-on-empty-day, and the per-card Edit pencil)
   **re-opens the full workout library** so you choose *any* workout, with search/filter/sort/expand,
   each row's CTA relabeled **"Schedule Workout"**. In the new app, those same controls instead pop a
   **confirm dialog that schedules whatever workout is currently loaded on the HUD**
   (`PlannerView.svelte:679-702 onScheduleDay`). The HUD's own "Select a workout" affordance text and
   overlay are otherwise faithful — the divergence is entirely the planner→picker handoff. Full
   detail in **§ "Select a workout" — full divergence** below.

Secondary missing pieces in the planner: **drag-and-drop reschedule** and the **`?`-held hotkey
overlay** (both dropped, `PlannerView.svelte:21`).

---

## TABLE 1 — VIEWS / PAGES / SCREENS

Every distinct thing the old app can SHOW. "Legacy loc" cites where it is built/shown.

| View/screen | Legacy loc (file:line) | How it's triggered | New-app component (file:line) | Present? | Notes (divergence) |
|---|---|---|---|---|---|
| **HUD / riding base view** (stat cards + chart panel + bottom nav) | `index.html:116-344`; render `workout.js:505-597,1090-1107` | Always rendered (base layer) | `HudView.svelte:34-52` (`StatCards` + `LiveChart` + `BottomNav`) | OK | Faithful re-host; same ids/classes. |
| HUD chart **empty-state: "Connect your bike"** (+ left arrow) | `index.html:156-201`; `workout.js:847-869` | No bike connected | `LiveChart.svelte:33-45,100-128` | OK | `emptyKind='noBike'`, left arrow. |
| HUD chart **empty-state: "Select a workout"** (no arrow shown→right) | `workout.js:862` | Bike connected, no workout | `LiveChart.svelte:36-46` (`noWorkout`, arrow right) | OK | Message string matches. |
| HUD chart **empty-state: "Pedal to start workout"** (+ right arrow) | `workout.js:858-860` | Bike+workout, idle, elapsed 0 | `LiveChart.svelte:22-27,38` (`readyToStart`) | OK | — |
| HUD chart **empty-state: "Pedal to resume"** (no arrow) | `workout-engine.js:361-373`; `workout.js` paused overlay | Auto/manual paused | `LiveChart.svelte:18-21,44-46` (`resume`) | OK | — |
| HUD **center coaching title** (segment instruction / look-ahead / cadence coaching) | `index.html:260-269`; `workout.js:505-573` | While running/starting | `BottomNav.svelte:233-245` + `hud-coaching.ts` | OK | Ported (Maintain/Ramp/Free ride/Speed up/Slow down). |
| HUD **free-ride mode toggle + manual controls** (ERG/Resistance, −/input/+) | `index.html:273-305`; `workout.js:957-1043` | Workout active **and** free-ride segment | `BottomNav.svelte:248-293` | OK | Same gating/clamps. |
| **3-2-1 countdown overlay** ("3/2/1/Start") | `index.html:1291`; `beeper.js:477-522` | `startWorkout()` | `StatusOverlay.svelte` (Beeper drives DOM) | OK | Beeper re-host (`core/beeper.ts`). |
| **"Workout Paused" / "Resumed" flash overlay** | `beeper.js showPausedOverlay`; `index.html:1291` | Pause/resume | `StatusOverlay.svelte` | OK | Same `#statusOverlay/#statusText`. |
| **Welcome tour — splash slide** (icon-only, 1.1s auto-dismiss in PWA) | `index.html:59-94`; `welcome.js:778-780` | First-run as configured PWA | `WelcomeView.svelte:21-30,128-141` | OK | Splash + 1100ms timer. |
| **Welcome tour — slide 2 "Ride structured workouts"** (trainer scene) | `welcome.js` slides; `img/trainer.svg` | Full tour | `WelcomeView.svelte:31-38` + `welcome-scene.ts` | OK | Scene re-host. |
| **Welcome tour — slide 3 "Local data / offline"** (browser scene) | `welcome.js`; `img/browser.svg` | Full tour | `WelcomeView.svelte:42-48` | OK | — |
| **Welcome tour — slide 4 "Community workouts / build your own"** (builder scene) | `welcome.js`; `img/builder.svg` | Full tour | `WelcomeView.svelte:49-57` | OK | — |
| **Picker — workout LIBRARY** (table, search, filters, sort, expand) | `index.html:347-695`; `workout-picker.js` browse | `W` key / click name label / chart "Select a workout" | `PickerView.svelte:844-1272` | OK | Faithful; same ids. |
| Picker — **expanded row** (stats chips + description + mini chart + actions) | `workout-picker.js:745-985` | Click a row | `PickerView.svelte:1104-1238` | OK | — |
| Picker — **empty-state** ("No workouts found / + Add workout") | `index.html:641-647`; `workout-picker.js:2029-2034` | 0 workouts | `PickerView.svelte:1062-1069` | OK | — |
| **In-place BUILDER** (segment editor + chart + toolbar) | `index.html:374-612` + `workout-builder.js` | Create/Edit in picker | `PickerView.svelte:1044-1059` → `BuilderView.svelte` | OK | Fully implemented (`BuilderView.svelte` 1296 LOC). The `PickerView.svelte:1-9` header comment "builder is DEFERRED / no-op" is **stale/incorrect** — it is wired and working. |
| **Picker — SCHEDULE mode** ("Schedule Workout" library to pick a workout for a calendar day) | `index.html:347-372` (`#pickerBackToPlannerBtn`); `workout-picker.js:1923-1934 openScheduleMode`, `:854-874`, `:1919`; wired `workout.js:1454-1469` | Planner "Schedule workout" / Enter on empty future day / day-cell `e` | **— none —** | **MISSING** | **The user's missing page.** Replaced by a confirm dialog (`PlannerView.svelte:679-702`) that schedules the *currently-loaded HUD workout*; you cannot browse/pick another workout for a day. |
| **Picker — SCHEDULE-EDIT mode** ("Edit Schedule" + "Unschedule" button) | `workout-picker.js:1923-1934` (`editMode`), `:224-234,1931 scheduleUnscheduleBtn`; `index.html` reused | Edit pencil on a future scheduled card | **— none —** | **MISSING** | Replaced by `PlannerView.svelte:759-786 onEditScheduled` (a confirm dialog: replace-with-current-HUD-workout or remove). No re-browse. |
| **Planner — CALENDAR** (infinite week scroll, day cells, history/scheduled cards) | `index.html:703-892`; `workout-planner.js` | `C` key / calendar btn / post-ride | `PlannerView.svelte:919-1117` | PARTIAL | Calendar/cards faithful **but** scroll is a fixed 16-week window, not legacy infinite recycle (`PlannerView.svelte:14-18`); drag-reschedule dropped. |
| **Planner — RIDE DETAIL** (stat chips + power curve + planned-vs-actual chart) | `index.html:817-862`; `workout-planner.js openDetailView`; `planner-analysis.js` | Click a history card / Enter on a past day | `PlannerView.svelte:1119-1155` | OK | Stats + power curve + detail chart all ported. |
| Planner — **`?`-held hotkey overlay** (`#plannerHotkeyList`) | `index.html:872-879`; `workout-planner.js:929-940,1445-1466` | Hold `?` | **— none —** (static prompt only) | **MISSING** | `PlannerView.svelte:1159` keeps the "Press ? for shortcuts" prompt but the list never renders; `?`/`/` do nothing. |
| **Settings — main view** (folder/FTP/sound/theme/BT/PWA/logs rows) | `index.html:894-1288`; `settings.js` | `S` key / gear / auto-open | `SettingsView.svelte:255-656` | OK | Faithful re-host. |
| Settings — **compatibility alert banner** | `index.html`; `settings.js:132-186,418-440` | Unsupported OS/browser | `SettingsView.svelte:260-267` | OK | Driven by `compat.ts`. |
| Settings — **per-row help blurbs** (folders/FTP/sound/env/PWA) | `index.html` per row; `settings.js:501-525` | Help toggle | `SettingsView.svelte:318-327,393-401,442-450,556-571,616-626` | OK | — |
| **Settings — LOGS sub-view** (connection log text) | `index.html:904-930`; `settings.js:556-566` | "View logs" | `SettingsView.svelte:658-670` | OK | Auto-scroll preserved. |
| **Native confirm/alert/prompt dialogs** (unthemed OS chrome) | `window.confirm/alert/prompt` (45 sites) | Various | `Dialog.svelte` + `state/dialog.svelte.ts` | OK (improved) | New app uses a themed in-app `Dialog`; intentional upgrade, not a gap. |
| **Crash-recovery RECOVERED-PAUSED** (resume an interrupted ride) | `workout-engine.js:606-675`; `workout.js:867-869` | Reload mid-ride | `core/engine.ts` + `state/engine.svelte.ts` | OK | Engine-level; UI follows VM. |

---

## TABLE 2 — BUTTONS / CONTROLS

One row per clickable button / icon-button / link / toggle / stepper / nav control across **all** views.
"Parity": OK = same; GAP = present but reduced/altered; WRONG = wired to the wrong action; MISSING = absent.

### 2.1 HUD / bottom nav

| Button/control | View | Legacy loc + handler | Action | New-app loc + handler | Parity | Notes |
|---|---|---|---|---|---|---|
| Bike connect (`#bikeConnectBtn`) | HUD | `index.html:208-220`; `workout.js:1525-1544` | Web-BT picker to pair trainer | `BottomNav.svelte:168-178,88-91` | OK | No-BT → alert + open Settings preserved. |
| HRM connect (`#hrConnectBtn`) | HUD | `index.html:223-236`; `workout.js:1546-1565` | Pair HR strap; battery label | `BottomNav.svelte:180-199,92-95` | OK | — |
| HR battery label (`#hrBatteryLabel`) | HUD | `index.html:234`; `workout.js:664-670` | Display % / `.battery-low` ≤20 | `BottomNav.svelte:191-198` | OK | Display-only. |
| Settings (`#settingsBtn`) | HUD | `index.html:239-245`; `settings.js:530-534` | Open settings | `BottomNav.svelte:201-214` | OK | — |
| Calendar (`#calendarBtn`) | HUD | `index.html:247-257`; `workout.js:1615-1625` | Open planner; hidden while active | `BottomNav.svelte:216-230,39` | OK | Hidden during active workout preserved. |
| **Workout-name label (`#workoutNameLabel`)** | HUD | `index.html:307-309`; `workout.js:1508-1520` | Click → open picker focused on current; "Click here to select a workout" when empty | `BottomNav.svelte:295-308,59-63` | OK | Text + click + W-key + active-guard all match. |
| Center title (`#workoutTitleCenter`) | HUD | `index.html:260-269` | Display-only running title | `BottomNav.svelte:233-245` | OK | — |
| ERG button (`#modeToggle [data-mode=erg]`) | HUD free-ride | `index.html:275-281`; `workout.js:1567-1580` | Free-ride → ERG | `BottomNav.svelte:256-262,96-98` | OK | — |
| Resistance button (`[data-mode=resistance]`) | HUD free-ride | `index.html:282-288` | Free-ride → resistance | `BottomNav.svelte:263-269` | OK | — |
| Manual − (`.control-btn[data-delta=-10]`) | HUD free-ride | `index.html:293`; `workout.js:1582-1599` | −10 W/% | `BottomNav.svelte:278,99-102` | OK | — |
| Manual + (`[data-delta=10]`) | HUD free-ride | `index.html:304` | +10 W/% | `BottomNav.svelte:292` | OK | — |
| Manual input (`#manualInput`) | HUD free-ride | `index.html:296-302`; `workout.js:996-1043` | Commit on Enter/blur, clamped | `BottomNav.svelte:280-289,124-152` | OK | Same clamps (ERG 50…2.5×FTP, res 0–100). |
| Start (`#startBtn`) | HUD | `index.html:312-320`; `workout.js:1627-1631` | `startWorkout()` | `BottomNav.svelte:310-319,68-70` | OK | — |
| Play/resume (`#playBtn`) | HUD | `index.html:323-327`; `workout.js:1633-1637` | Resume | `BottomNav.svelte:321-330` | OK | — |
| Pause (`#pauseBtn`) | HUD | `index.html:330-334`; `workout.js:1639-1643` | Pause | `BottomNav.svelte:332-341` | OK | — |
| Stop (`#stopBtn`) | HUD | `index.html:337-341`; `workout.js:1645-1651` | confirm("End… and save it?") → `endWorkout()` | `BottomNav.svelte:343-352,72-76` | OK | Uses themed `dialogs.confirm`. |
| Stat cards (×6) | HUD | `index.html:117-149` | Display-only (font auto-size) | `StatCards.svelte:57-105` | OK | `adjustStatFontSizes` ported. |

### 2.2 Settings overlay

| Button/control | Legacy loc + handler | Action | New-app loc + handler | Parity | Notes |
|---|---|---|---|---|---|
| Close (`#settingsCloseBtn`) | `index.html:937`; `settings.js:536-540` | Close settings | `SettingsView.svelte:239-249` | OK | — |
| Back-from-logs (`#settingsBackFromLogsBtn`) | `index.html:904-930`; `settings.js:562-566` | Return from logs | `SettingsView.svelte:207-229,186-188` | OK | — |
| Click-outside backdrop | `settings.js:542-554` | pointerdown+up on backdrop → close | `OverlayModal.svelte:28-35` | OK | Same gesture. |
| Help toggles (folders/FTP/sound/env/PWA) | `settings.js:501-525` | Show/hide help blurb | `SettingsView.svelte:145-147` (`toggleHelp`) | OK | — |
| Choose folder (`#rootDirButton`) | `index.html:987`; `settings.js:568-572` | Pick root dir handle | `SettingsView.svelte:305-313,124-127` | OK | FSA via port. |
| FTP − (`[data-ftp-delta=-10]`) | `index.html:1034`; `settings.js:589-597` | −10 W (clamp 50–500) | `SettingsView.svelte:355-363,64` | OK | — |
| FTP + (`[data-ftp-delta=10]`) | `index.html:1057` | +10 W | `SettingsView.svelte:380-388` | OK | — |
| FTP input (`#settingsFtpInput`) | `index.html:1042`; `settings.js:574-587` | Commit on Enter/blur | `SettingsView.svelte:365-377,67-76` | OK | — |
| Sound toggle (`#settingsSoundCheckbox`) | `index.html:1097`; `settings.js:599-603` | Save sound on/off | `SettingsView.svelte:429-438,89-94` | OK | — |
| Theme Auto/Dark/Light (`[data-theme-mode]`) | `index.html:1132-1160`; `settings.js:605-610` | Apply + persist theme | `SettingsView.svelte:482-514,101-104` | OK | — |
| View logs (`#settingsOpenLogsBtn`) | `index.html:1270`; `settings.js:556-560` | Open logs sub-view | `SettingsView.svelte:644-652,180-185` | OK | — |
| BT / PWA status text | `index.html:1187,1239`; `settings.js:404-452` | Display-only | `SettingsView.svelte:545-552,605-612` | OK | — |

### 2.3 Picker — LIBRARY mode

| Button/control | Legacy loc + handler | Action | New-app loc + handler | Parity | Notes |
|---|---|---|---|---|---|
| Search input (`#pickerSearchInput`) | `index.html:434`; `workout-picker.js:401-462` | Token + duration-range filter | `PickerView.svelte:892-899,146-226` | OK | Grammar (`60`,`60-90`,`<30`,`>90`,`90m`) ported. |
| Search clear (`.picker-search-clear`) | `index.html:439`; `workout-picker.js:2071-2079` | Clear + refocus | `PickerView.svelte:900-911` | OK | — |
| Zone filter (`#pickerZoneFilter`) | `index.html:456`; `workout-picker.js:391-393` | Filter by zone | `PickerView.svelte:913-928,149` | OK | — |
| Duration filter (`#pickerDurationFilter`) | `index.html:465`; `workout-picker.js:395-399` | Filter by bucket | `PickerView.svelte:929-947,151-155` | OK | — |
| Sort headers (`th[data-sort-key]` name/if/tss/duration/kjAdj) | `index.html:650-680`; `workout-picker.js:1290-1308` | Set sort key; toggle asc/desc | `PickerView.svelte:1074-1080,264-275` | OK | Default `kjAdj` asc; Zone/Source not sortable. |
| Row (collapsed) click | `workout-picker.js:724-727` | Expand row | `PickerView.svelte:1089,277-279` | OK | — |
| Expanded collapse hit | `workout-picker.js:745-750` | Collapse | `PickerView.svelte:1107-1114` | OK | — |
| "Visit website" | `workout-picker.js:768-788` | Open `sourceURL` | `PickerView.svelte:1119-1132` | OK | — |
| "Delete" | `workout-picker.js:791-805` | confirm → move .zwo to trash | `PickerView.svelte:1133-1144,287-298` | OK | — |
| "Clone" | `workout-picker.js:808-831` | Clone "Copy", save, expand | `PickerView.svelte:1145-1156,323-330` | OK | — |
| "Edit" | `workout-picker.js:834-848` | Open in builder | `PickerView.svelte:1157-1168,467-478` | OK | — |
| **"Select workout"** | `workout-picker.js:851-874` | Select + close (library) | `PickerView.svelte:1169-1178,281-285` | OK | Library CTA. In schedule mode legacy relabels this "Schedule Workout" → **see §missing**. |
| Create workout (`#pickerAddWorkoutBtn`) | `index.html:478`; `workout-picker.js:2008-2013` | `startBuilderFromScratch()` | `PickerView.svelte:949-961,457-466` | OK | — |
| Empty-state add (`#pickerEmptyAddBtn`) | `index.html:641`; `workout-picker.js:2029-2034` | New builder | `PickerView.svelte:1065-1067` | OK | — |
| Close (`#workoutPickerCloseBtn`) | `index.html:614`; `workout-picker.js:1997-2001` | Close (unsaved-builder confirm) | `PickerView.svelte:1030-1040,654-660` | OK | — |
| Footer hint (library) | `index.html:688-695` | Display-only | `PickerView.svelte:1244-1251` | OK | — |
| **Back to calendar (`#pickerBackToPlannerBtn`)** | `index.html:356-372`; `workout-picker.js:2002-2006` | `close({returnToPlanner:true})` | **— none —** | **MISSING** | Only exists in schedule mode, which is gone. |

### 2.4 In-place BUILDER toolbar

| Button/control | Legacy loc + handler | Action | New-app loc + handler | Parity | Notes |
|---|---|---|---|---|---|
| Back to library (`#workoutBuilderBackBtn`) | `index.html:374-400`; `workout-picker.js:2015-2020` | Confirm unsaved, exit builder | `PickerView.svelte:861-873,622-627` | OK | — |
| Save (`#workoutBuilderSaveBtn`) | `index.html:571-612`; `workout-picker.js:2022-2027` | Validate + save .zwo, reopen library | `PickerView.svelte:1013-1028,629-652` | OK | Rename → trash old, then save. |
| Import TrainerDay (`#workoutBuilderTrainerDayBtn`) | `index.html:501-535`; `workout-picker.js:275-303` | Prompt URL → parse → load | `PickerView.svelte:971-986,514-527` | OK | Uses themed prompt. |
| Upload file (`#workoutBuilderUploadBtn`) | `index.html:537-569`; `workout-picker.js:305-359` | Pick .zwo/.fit → load | `PickerView.svelte:988-1011,532-563` | OK | — |
| Builder status chip (`#workoutBuilderStatus`) | `index.html` | Display-only status | `PickerView.svelte:963-969` | OK | — |
| Block-insert palette (`.wb-code-insert-btn[data-key]`) | `workout-builder.js:338-368` | Insert block at cursor | `BuilderView.svelte` (palette) | OK | Implemented in BuilderView. |
| Move-left / Move-right (`.wb-block-move-btn`) | `workout-builder.js:142-159` | Reorder ±1 | `BuilderView.svelte` | OK | — |
| Delete-block (`.wb-block-delete-btn`) | `workout-builder.js:160-168` | Delete selected | `BuilderView.svelte` | OK | — |
| Undo / Redo (`.wb-toolbar-action-btn`) | `workout-builder.js:173-191` | Undo/redo (disabled state) | `BuilderView.svelte` | OK | — |
| Copy / Paste (toolbar) | `workout-builder.js:193-211` | Copy/paste selection | `BuilderView.svelte` | OK | — |
| Block steppers −/+ & number input | `workout-builder.js:2027-2073` | Edit dur/power/cadence/reps | `BuilderView.svelte` | OK | — |
| Text-event editor (dur/offset steppers, text input) | `workout-builder.js:428-467` | Edit cue | `BuilderView.svelte` | OK | — |
| Meta inputs (Name/Author/Description) | `workout-builder.js:75-96` | Edit metadata | `BuilderView.svelte` | OK | — |
| Builder chart drag gestures (power/duration/reorder/text) | `workout-builder.js:2385-2751` | Drag-edit | `BuilderView.svelte` | OK (verify) | Full drag engine ported; not re-walked here. |

### 2.5 Planner — calendar / detail

| Button/control | Legacy loc + handler | Action | New-app loc + handler | Parity | Notes |
|---|---|---|---|---|---|
| Day cell click | `workout-planner.js:1269-1273` | Select day | `PlannerView.svelte:1017-1024,558-560` | OK | — |
| History card click | `workout-planner.js:315-318` | Open ride detail | `PlannerView.svelte:1032-1040,562-621` | OK | — |
| Scheduled card click (body) | `workout-planner.js:449-456` | Load/start it | `PlannerView.svelte:1059-1069,742-753` | OK | — |
| **Scheduled card Edit pencil (future)** | `workout-planner.js:388-398` → `onScheduledEditRequested` → `picker.openScheduleMode` | Re-open library in **Edit Schedule** mode | `PlannerView.svelte:1073-1093,759-786 onEditScheduled` | **WRONG** | New app pops a confirm dialog (replace-with-current-HUD-workout / remove); cannot browse for a replacement. |
| Scheduled card trash (past) | `workout-planner.js:380-387` | Remove scheduled entry | `PlannerView.svelte:1078,704-714` | OK | — |
| **Schedule workout (`#plannerScheduleBtn`)** | `index.html:767`; `workout-planner.js:1497-1504` → `requestSchedule` → `picker.openScheduleMode` | Open the library to **pick any workout** for the day | `PlannerView.svelte:972-985,679-702 onScheduleDay` | **WRONG** | Schedules the **currently-loaded HUD workout** via confirm; if none loaded → alert "Select a workout on the main screen first." No browse. **Core of the user report.** |
| Delete (detail) (`#plannerDeleteBtn`) | `index.html:730`; `workout-planner.js:1506-1510` | Trash current ride | `PlannerView.svelte:955-971,716-729` | OK | — |
| Close (`#workoutPlannerCloseBtn`) | `index.html:784`; `workout-planner.js:1469-1471` | Close planner | `PlannerView.svelte:986-996,731-737` | OK | — |
| Back (detail) (`#plannerBackBtn`) | `index.html:705`; `workout-planner.js:1473-1477` | Exit detail → calendar | `PlannerView.svelte:936-948,623-625` | OK | — |
| Click-outside backdrop | `workout-planner.js:1479-1495` | Close | `OverlayModal.svelte:28-35` | OK | — |
| Power-curve help icon | `index.html:822-847` | Native tooltip | `PlannerView.svelte:1138-1145` | OK | — |
| Footer aggregates 3/7/30 | `index.html:883-888`; `workout-planner.js:936-955` | Display-only sums | `PlannerView.svelte:1162-1166,411-460` | OK | — |
| Selected-date label | `index.html:724`; `workout-planner.js:805-810` | Display-only | `PlannerView.svelte:951-953,673-675` | OK | — |
| **Scheduled card DRAG (dragstart/dragover/drop)** | `workout-planner.js:457-471,985-1023` | Drag-reschedule to a future day | **— none —** | **MISSING** | Cards are not draggable; no drop targets. |
| **`?`-held hotkey list (`#plannerHotkeyList`)** | `index.html:872-879`; `workout-planner.js:929-940` | Show full hotkeys on hold | **— none —** | **MISSING** | Prompt text stays; list never appears. |

### 2.6 Picker — SCHEDULE mode (entirely missing in new app)

| Button/control | Legacy loc + handler | Action | New-app | Parity | Notes |
|---|---|---|---|---|---|
| Schedule-mode title "Schedule Workout"/"Edit Schedule" | `workout-picker.js:1925-1926` | Header relabel | none | MISSING | — |
| Per-row CTA "Schedule Workout" | `workout-picker.js:854-874` | Schedule that workout on the day | none | MISSING | Library row's "Select" becomes "Schedule Workout". |
| "Unschedule" button (edit mode) | `workout-picker.js:224-234,1931` | Remove the day's entry | none | MISSING | — |
| Back to calendar (`#pickerBackToPlannerBtn`) | `index.html:356-372` | `close({returnToPlanner:true})` | none | MISSING | Esc/Backspace also bound to this in schedule mode (`workout-picker.js:1432-1443`). |
| Create-workout button hidden in schedule mode | `workout-picker.js:1919` | UI gating | n/a | MISSING | — |

### 2.7 Welcome tour

| Button/control | Legacy loc + handler | Action | New-app loc + handler | Parity | Notes |
|---|---|---|---|---|---|
| Prev (`#welcomePrevBtn`) | `index.html:96-103`; `welcome.js:752-757` | Previous slide | `WelcomeView.svelte:260-273,112-116` | OK | Hidden on slide 0. |
| Next (`#welcomeNextBtn`) | `index.html:105-112`; `welcome.js:759-764` | Next / close on last | `WelcomeView.svelte:275-287,104-111` | OK | — |
| Close / "Skip intro" (`#welcomeCloseBtn`) | `index.html:67-74`; `welcome.js:766-771` | Close overlay | `WelcomeView.svelte:225-237,117-119` | OK | — |
| Click overlay (advance) | `welcome.js:686-704` | Next (full mode only) | `WelcomeView.svelte:155-163` | OK | Splash swallows clicks. |

### 2.8 Dialogs

| Control | Legacy loc | Action | New-app loc | Parity | Notes |
|---|---|---|---|---|---|
| confirm OK / Cancel | native `confirm()` | resolve true/false | `Dialog.svelte:45-60` | OK | Themed; Enter=OK, Esc=Cancel (`App.svelte:228-245`). |
| prompt input + OK/Cancel | native `prompt()` | resolve string/null | `Dialog.svelte:31-43` | OK | — |
| alert OK | native `alert()` | dismiss | `Dialog.svelte:54-60` | OK | — |

---

## "Select a workout" — full divergence (the user's report)

There are **two** "Select a workout" surfaces. One is faithful; the other is radically changed.

### A. HUD affordance — FAITHFUL
- **What it is:** the `#workoutNameLabel` pill at the right of the bottom nav. When no workout is
  loaded it reads **"Click here to select a workout"** (legacy `workout.js:514`), tooltip
  "Select a workout (W)" (`workout.js:1510`). The chart empty-state separately reads **"Select a
  workout"** (`workout.js:862`).
- **What it opens:** an **overlay** — `#workoutPickerOverlay` / `#workoutPickerModal`
  (`index.html:347`) in **library mode** (`picker-mode` class). NOT a full page; an absolutely-
  positioned modal over the dimmed HUD (`workout-base.css`/`workout-picker.css`).
- **Layout/sections:** header (title "Workout library" + search + zone filter + duration filter +
  "Create workout" + close) → sortable table (Name/Zone/Source/IF/TSS/Duration/kJ) → expandable
  rows (stat chips + description + mini chart + Visit/Delete/Clone/Edit/**Select workout**) →
  footer hint + summary.
- **New app:** **identical.** `BottomNav.svelte:59-63,295-308` renders the same "Click here to
  select a workout" text and opens `ui.open('picker')` → `PickerView.svelte` with the same
  classes/ids/sections. **No divergence here.**

### B. Planner "Schedule a workout for this day" — EXTREMELY DIFFERENT (this is the report)

**Legacy flow (browse-and-pick the library):**
1. In the planner, the user selects a future/today day and clicks **"Schedule workout"**
   (`#plannerScheduleBtn`, `index.html:767`), OR presses **Enter** on an empty future day
   (`workout-planner.js:1325-1346`), OR presses **`e`**, OR clicks a scheduled card's **Edit pencil**
   (`workout-planner.js:388-398`).
2. The planner calls `requestSchedule(dateKey)` / `onScheduledEditRequested(dateKey, entry)`
   (`workout-planner.js:868-872,394-396`), which the shell routes to
   **`picker.openScheduleMode({dateKey, entry, editMode})`** (`workout.js:1454-1469`).
3. `openScheduleMode` (`workout-picker.js:1923-1934`) **re-opens the full workout library** in a
   distinct mode: planner is hidden behind (`planner.hideModal()`), the modal gets
   `picker-schedule-mode`, the title becomes **"Schedule Workout"** (or **"Edit Schedule"**), a
   **"Back to calendar"** button appears (`#pickerBackToPlannerBtn`), "Create workout" is hidden
   (`:1919`), and every row's CTA is relabeled from "Select workout" to **"Schedule Workout"**
   (`workout-picker.js:854-874`). In edit mode an **"Unschedule"** button is added (`:224-234,1931`).
4. The user **browses/searches/filters/sorts the entire library and picks ANY workout** for that
   day; selecting fires `onScheduleSelected` which writes `schedule.json`. Escape/Backspace return
   to the calendar (`workout-picker.js:1432-1443`).

**New-app flow (schedule the currently-loaded workout only):**
1. The same controls exist (`PlannerView.svelte:972-985 #plannerScheduleBtn`,
   Enter-on-empty-day `:819-836`, Edit pencil `:1073-1093`).
2. But **none of them open the library.** "Schedule workout" calls **`onScheduleDay`**
   (`PlannerView.svelte:679-702`): it reads `store.vm.canonicalWorkout` (whatever is loaded on the
   HUD). If nothing is loaded it **alerts** "Select a workout on the main screen first, then
   schedule it." Otherwise it pops a **confirm** "Schedule "<title>" on <date>?" and writes
   `schedule.json`.
3. The Edit pencil calls **`onEditScheduled`** (`PlannerView.svelte:759-786`): a confirm to either
   **replace** the entry with the currently-loaded HUD workout or **remove** it — again no browse.
4. `PlannerView.svelte:13-21` states this is a deliberate "SIMPLIFICATION… instead of re-opening
   the picker in a schedule mode."

**Net effect for the user:** in legacy, scheduling a workout for a day is a rich "Select a workout"
library experience; in the new app the same buttons pop a yes/no dialog that can only schedule the
one workout already on the HUD. To schedule a *different* workout you must first go to the HUD,
open the picker, select it, then return to the planner and schedule — and even then you can only
ever place that one workout. **That is the "Select a workout behaves EXTREMELY differently" and the
"entire page/view is MISSING" (the schedule-mode picker).**

---

## Gaps

Ordered by severity (MISSING / WRONG / PARTIAL only).

### G1 — Schedule-mode picker is MISSING (the missing page) — **Critical**
- **Legacy behavior:** Planner "Schedule workout" / Enter-empty-day / `e` / Edit-pencil re-open the
  **full workout library** in `picker-schedule-mode` so the user browses/searches/filters and picks
  **any** workout to schedule on a day; edit mode adds an "Unschedule" button; "Back to calendar"
  returns.
- **Legacy LOC:** DOM `index.html:347-372` (`#pickerBackToPlannerBtn`); `workout-picker.js:1923-1934`
  (`openScheduleMode`), `:854-874` (row CTA "Schedule Workout"), `:224-234,1931` (Unschedule),
  `:1432-1443` (Esc/Backspace return); wiring `workout.js:1430-1471`; planner triggers
  `workout-planner.js:868-872,388-398,1325-1365,1497-1504`.
- **New app:** no schedule mode at all (`PlannerView.svelte:13-21,679-702,759-786`).
- **What's needed:** add a schedule-mode to `PickerView` (a `scheduleMode={dateKey,entry,editMode}`
  prop or a `ui.openPickerScheduleMode`), relabel the row CTA to "Schedule Workout", show
  Back-to-calendar + (edit-mode) Unschedule, hide Create-workout, and route the planner's
  `onScheduleDay`/`onEditScheduled` to it instead of the confirm dialogs. Writes the same
  `schedule.json`.

### G2 — Planner "Schedule workout" + Edit pencil are WRONG (schedule current HUD workout, not browse) — **Critical**
- **Legacy behavior:** open the library to pick any workout (see G1).
- **Legacy LOC:** `workout-planner.js:1497-1504` (`#plannerScheduleBtn`→requestSchedule),
  `:388-398` (Edit pencil→onScheduledEditRequested).
- **New app:** `PlannerView.svelte:679-702 onScheduleDay` (schedules `vm.canonicalWorkout`),
  `:759-786 onEditScheduled` (replace-with-current / remove).
- **What's needed:** repoint both to the schedule-mode picker from G1. (They are the entry points
  G1 must serve.)

### G3 — Drag-and-drop reschedule is MISSING — **Medium**
- **Legacy behavior:** drag a scheduled card onto a future day to move it (past dates reject;
  same-day no-op; today allowed); live `planner-drop-hover`/`planner-dragging` styling.
- **Legacy LOC:** `workout-planner.js:457-471` (dragstart payload), `:985-1000` (dragover/leave),
  `:1002-1023` (drop→`moveScheduledEntry`), `:223-258` (move logic).
- **New app:** cards are not draggable; no drop targets (`PlannerView.svelte:1059-1110` — no
  `draggable`/`ondragover`/`ondrop`).
- **What's needed:** add `draggable` + dragstart JSON payload to scheduled cards, and
  dragover/dragleave/drop handlers (future-only) to day cells calling a `moveScheduled` on the file
  store. Or accept as a documented downgrade.

### G4 — Planner `?`-held hotkey overlay is MISSING — **Low**
- **Legacy behavior:** holding `?` (Shift+/) hides the aggregate footer and reveals the full hotkey
  list (`↑↓←→/hjkl move • Enter open • e edit • d/Delete delete • drag to reschedule`); release
  restores the footer.
- **Legacy LOC:** DOM `index.html:872-879`; `workout-planner.js:929-940` (toggle render),
  `:1445-1466` (keydown/keyup on `?`/`/`).
- **New app:** static prompt "Press ? for shortcuts" remains (`PlannerView.svelte:1159`) but `?`/`/`
  do nothing and `#plannerHotkeyList` is never rendered.
- **What's needed:** add a `showHotkeys` state toggled on `?`/`/` keydown/keyup that swaps the
  footer-right aggregates for the hotkey list (and either drop the stale prompt or wire it).

### G5 — Planner calendar scroll is PARTIAL (fixed 16-week window, not infinite) — **Low**
- **Legacy behavior:** infinite vertical week-scroll that recycles rows on scroll near the buffer
  edges (`workout-planner.js:1248-1267`); keyboard selection auto-scrolls.
- **New app:** a fixed initial 16-week window (offsets −8..+7); deep scroll just stops
  (`PlannerView.svelte:13-18,323-408`). Initial render + scroll position are pixel-identical;
  only paging past the window is gone.
- **What's needed:** virtualized week recycling on scroll if multi-month browsing is required;
  otherwise document as an accepted simplification.

### G6 — Stale code comments (not a runtime gap, but misleading) — **Trivial**
- `PickerView.svelte:1-9` and `:332-337` claim the builder is "DEFERRED" / "no-op", but
  `BuilderView.svelte` (1296 LOC) is fully wired and functional. Update the comments so they don't
  misdirect future audits.

---

## Method / coverage notes
- Legacy DOM read from `docs/index.html` (HUD `116-344`, picker `347-695`, planner `703-892`,
  settings `894-1288`, welcome `59-114`). Legacy behavior cross-checked against
  `docs-analysis/journeys/scour-02-ui-controls.md` and `scour-03-states-modes.md` (already-verified
  control/state inventories) and the `behavior-0*` docs.
- New app read in full: `App.svelte`, `HudView`, `BottomNav`, `StatCards`, `LiveChart`,
  `StatusOverlay`, `PickerView`, `BuilderView` (size-verified), `PlannerView`, `SettingsView`,
  `WelcomeView`, `Dialog`, `OverlayModal`, and `state/ui.svelte.ts`.
- Builder chart drag gestures (Table 2.4 last row) were confirmed present by size/structure but not
  re-walked gesture-by-gesture; the existing `behavior-04-builder.md` covers that surface.
