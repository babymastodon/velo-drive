# Scour 04 — Edge Cases / Error / Empty / Permission / Guard States

Read-only scour of the legacy VeloDrive app (`/home/babymastodon/code/velo-drive/docs`).
Perspective: every error path, empty state, guard, confirm, alert, and edge case. Line numbers are `file:line`.

Modal verbs: **alert()** = blocking info dialog (OK only); **confirm()** = OK/Cancel; **prompt()** = text input.

---

## A. Native dialogs — `alert()` / `confirm()` / `prompt()`

| Edge/error/guard | Trigger | What the user sees (alert/empty/state) | Recovery | Legacy code (file:line) |
|---|---|---|---|---|
| No history folder (move-to-trash) | Delete a history workout from planner detail, but no root/history dir handle saved | `alert` "No history folder configured.\n\nOpen Settings and choose a VeloDrive folder first." | Open Settings, pick folder | `planner-analysis.js:310` |
| No trash folder (history) | Move history file to trash but no trash dir handle | `alert` "No trash folder is configured.\n\nOpen Settings and pick a VeloDrive folder so the trash folder can be created." | Re-pick VeloDrive folder (recreates trash) | `planner-analysis.js:316` |
| History src permission revoked | `ensureDirPermission(srcDir)` returns false on trash move | `alert` "VeloDrive does not have permission to modify your history folder.\n\nPlease re-authorize the folder in Settings." | Re-authorize in Settings | `planner-analysis.js:327` |
| Trash permission revoked (history) | `ensureDirPermission(trashDir)` false | `alert` "VeloDrive does not have permission to write to your trash folder.\n\nPlease re-authorize the VeloDrive folder in Settings." | Re-authorize | `planner-analysis.js:333` |
| History trash move failure | Exception while copying/removing the FIT file | `alert` "Moving this workout to the trash folder failed. See logs for details." Returns false (no calendar change) | Retry; check console | `planner-analysis.js:362` |
| Folder picker not in build | `handleChooseRootDir` and `pickRootDir` is not a function | `alert` "Folder selection is not available in this build." | None (build limitation) | `settings.js:305` |
| Folder choose failed (settings) | `pickRootDir()` throws (non-abort) | `alert` "Failed to choose VeloDrive folder." | Retry | `settings.js:314` |
| No root dir before picking workout | Click workout name / press W with no root dir handle | `alert` "Choose a VeloDrive folder first, then pick a workout." then **auto-opens Settings modal** | Pick folder in Settings | `workout.js:219` (guard `ensureRootDirConfiguredForWorkouts`) |
| Scrape import failed | Just-scraped flag set but `last.success` false | `alert` "Failed to import workout \"{title}\".\nDetails: {error}" | Re-scrape from source site | `workout.js:1150` |
| Save scraped workout to library failed | `saveCanonicalWorkoutToZwoDir` throws on imported workout | `alert` "Failed to save imported workout \"{title}\" to your workout folder.\n\nCheck console for details." | Check console; re-import | `workout.js:1161` |
| Imported but picker won't open | `openPickerWithGuard` throws after import | `alert` "Workout \"{title}\" was imported, but could not be displayed in the picker.\n\nCheck console for details." (workout still imported) | Manually open picker | `workout.js:1175` |
| Imported but engine load failed | `engine.setWorkoutFromPicker` throws (only when no active workout) | `alert` "Workout \"{title}\" was imported, but could not be loaded as the current workout.\n\nCheck console for details." | Select workout manually | `workout.js:1196` |
| Unexpected scrape-handling failure | Any uncaught error in `handleLastScrapedWorkout` | `alert` "A newly imported workout was detected, but an unexpected error occurred.\n\nCheck console for details." | Reload | `workout.js:1205` |
| Failed to clear scrape flag | `clearJustScrapedFlag()` throws in finally | `alert` "Imported workout handled, but failed to reset scrape state.\n\nCheck console for details." | Reload (flag may re-trigger) | `workout.js:1214` |
| Can't change selection while running | Click workout name label while `vm.workoutRunning` | `alert` "End the current workout before changing the workout selection." (picker NOT opened) | End/stop workout first | `workout.js:1514` |
| Bike connect — no Web Bluetooth | Click bike-connect button when `navigator.bluetooth.getDevices` missing | `alert` "Your browser doesn't support Bluetooth. Let's open Settings for options." then **opens Settings** | Switch to Chrome / supported OS | `workout.js:1531` |
| HRM connect — no Web Bluetooth | Click HRM-connect button when BT unavailable | `alert` "Your browser doesn't support Bluetooth. Let's open Settings for options." then **opens Settings** | Same as above | `workout.js:1552` |
| End-workout confirm | Click stop button during active workout | `confirm` "End current workout and save it?" — Cancel keeps running; OK ends + saves | Cancel to continue | `workout.js:1647` |
| Start with no workout | `engine.startWorkout()` when `canonicalWorkout` is null (e.g. Space key / start button) | `alert` "No workout selected. Choose a workout first." | Select a workout | `workout-engine.js:461` |
| Load workout while running | `setWorkoutFromPicker` called while running/paused/starting | `alert` "Please end your current workout first." (selection rejected) | End workout first | `workout-engine.js:730` |
| FSA unsupported (pick root) | `pickRootDir` and `"showDirectoryPicker" in window` false | `alert` compat message: "Selecting a data folder requires File System Access support... latest Google Chrome... chrome://flags/#file-system-access-api to Enabled." Returns null | Use Chrome; enable flag | `storage.js:499` |
| Root folder permission denied | After `showDirectoryPicker`, `ensureDirPermission(root)` false | `alert` "Permission was not granted to the selected folder." Returns null | Re-pick and grant | `storage.js:512` |
| Root folder choose failed | `showDirectoryPicker` throws non-AbortError (AbortError = silent cancel) | `alert` "Failed to choose folder." | Retry | `storage.js:537` |
| TrainerDay URL parse failed (builder) | Paste invalid/unreachable TrainerDay URL in builder | `prompt` first ("Paste TrainerDay workout URL..."); on parse failure `alert` with the scraper's error string | Re-enter valid URL | `workout-picker.js:279` (prompt), `:285` (alert) |
| Builder file upload parse error | Upload .zwo/.fit that fails to parse or has no `rawSegments` | `alert` "Unable to load workout file." | Upload a valid file | `workout-picker.js:340` |
| No workout library folder (trash move) | Move a library .zwo to trash with no zwo dir handle | `alert` "No workout library folder configured.\n\nOpen Settings and choose a VeloDrive folder first." | Pick folder | `workout-picker.js:1596` |
| No trash folder (library) | Trash move, no trash dir handle | `alert` "No trash folder is configured.\n\nOpen Settings and pick a VeloDrive folder so the trash folder can be created." | Re-pick folder | `workout-picker.js:1604` |
| Library src permission revoked | `ensureDirPermission(zwoDir)` false on trash move | `alert` "VeloDrive does not have permission to modify your workout library folder.\n\nPlease re-authorize the folder in Settings." | Re-authorize | `workout-picker.js:1617` |
| Library trash permission revoked | `ensureDirPermission(trashDir)` false | `alert` "VeloDrive does not have permission to write to your trash folder.\n\nPlease re-authorize the VeloDrive folder in Settings." | Re-authorize | `workout-picker.js:1625` |
| Library trash move failure | Exception copying/removing the .zwo | `alert` "Moving this workout to the trash folder failed. See logs for details." (returns false) | Retry | `workout-picker.js:1661` |
| Delete workout — no library folder | `deleteWorkoutFile` with no zwo dir handle | `alert` "No workout library folder configured.\n\nOpen Settings and choose a VeloDrive folder first." | Pick folder | `workout-picker.js:1674` |
| Delete workout confirm | Delete a library workout (folder present) | `confirm` "Move workout file \"{fileName}\" to the trash folder?" | Cancel to keep | `workout-picker.js:1681` |
| Builder unavailable on save | `saveCurrentBuilderWorkoutToZwoDir` with no `workoutBuilder` | `alert` "Workout builder is not available. See logs for details." | Reload | `workout-picker.js:1696` |
| Save builder workout — no intervals | Builder `getState()` has empty `rawSegments` | `alert` "This workout has no intervals to save." | Add intervals | `workout-picker.js:1715` |
| Builder save unexpected failure | Uncaught error in `saveCurrentBuilderWorkoutToZwoDir` | `alert` "Unexpected failure while saving workout.\n\nSee logs for details." | Check console | `workout-picker.js:1753` |
| Save canonical — no library folder | `saveCanonicalWorkoutToZwoDir`, no zwo dir handle | `alert` "No workout library folder configured.\n\nOpen Settings and choose a VeloDrive folder first." | Pick folder | `workout-picker.js:1787` |
| Save canonical — permission revoked | `ensureDirPermission(zwoDir)` false | `alert` "VeloDrive does not have permission to write to your workout library folder.\n\nPlease re-authorize the folder in Settings." | Re-authorize | `workout-picker.js:1795` |
| Overwrite — move old to trash failed | Saving over an existing file, but moving the old one to trash fails | `alert` "Failed to move existing workout \"{fileName}\" to trash.\n\nThe workout was NOT saved." (save aborted) | Resolve trash issue; retry | `workout-picker.js:1817` |
| Write new file failed | `createWritable`/`write`/`close` throws on the new .zwo | `alert` "Saving workout \"{fileName}\" failed while writing the file.\n\nSee logs for details." | Check disk/permission | `workout-picker.js:1837` |
| Unsaved builder changes discard | Leave builder (back/exit) while `hasUnsavedBuilderChanges` | `confirm` "You have unsaved changes. Exit and discard them?\n\nOK = Discard changes and leave\nCancel = Stay and keep editing" | Cancel to keep editing | `workout-picker.js:1851` |
| Delete history detail confirm | Delete from planner detail view | `confirm` "Move workout \"{title or fileName}\" to the trash folder?" | Cancel to keep | `workout-planner.js:508` |
| Delete scheduled (cell) confirm | Delete first item in a day cell that holds a scheduled entry | `confirm` "Delete scheduled workout \"{title}\" on {dateKey}?" | Cancel to keep | `workout-planner.js:573` |
| Delete history (cell) confirm | Delete first item in a day cell that holds history | `confirm` "Move workout \"{title or fileName}\" to the trash folder?" | Cancel to keep | `workout-planner.js:590` |
| Scrape failed — open VeloDrive anyway | Extension content page receives `VD_SCRAPE_FAILED_PROMPT` | `confirm` "VeloDrive could not scrape this workout [from {source}].\n\nError: {error}\n\nDo you still want to open VeloDrive?" (defaults to open if confirm throws) | Cancel = stay on site; OK = open app | `content.js:172` |

---

## B. Guards / gating (no dialog or non-native UI)

| Edge/error/guard | Trigger | What the user sees | Recovery | Legacy code (file:line) |
|---|---|---|---|---|
| FSA permission helper | Any folder op via `ensureDirPermission` | Returns false if handle missing query/request methods or perm denied; calling code shows its own alert. `requestPermission` re-prompts only when state is "prompt" | Re-grant on next prompt | `storage.js:310-317` |
| `showDirectoryPicker` needs gesture | Picker invoked outside a user gesture | Browser throws SecurityError → caught as generic "Failed to choose folder." | Invoke from a click | `storage.js:508`, `:534-537` |
| Compatibility alert — unsupported OS | Settings opened on iOS / unknown OS (`detectOs().supported` false) | In-page banner: "{os} does not support Web Bluetooth. Please use Linux, Windows, macOS, or Android." `startupNeedsAttention.incompatiblePlatform=true` → Settings auto-opens | Switch device | `settings.js:425-426`, `:439`, `:418` |
| Compatibility alert — unsupported browser | Non-Chromium browser (`detectBrowser().supported` false) | Banner: "{browser} does not support Web Bluetooth. Open VeloDrive in Google Chrome to pair your bike." | Use Chrome | `settings.js:427-428` |
| Web Bluetooth not detected (settings) | `isWebBluetoothAvailable()` false | Status text "Web Bluetooth not detected." (red); `missingBtSupport=true` → Settings auto-opens at startup | Switch browser/OS | `settings.js:405-415`, `:651-655` |
| Missing root dir at startup | `loadRootDirHandle` returns null / errors | Status "Error loading folder" (red) or missing; `missingRootDir=true` → Settings auto-opens; full welcome forced | Pick folder | `settings.js:285-300`, `workout.js:205` |
| Settings auto-open on attention | Any of missingRootDir / missingBtSupport / incompatiblePlatform | Settings modal auto-opens with the relevant help sections shown | Address each | `settings.js:650-655` |
| Calendar blocked while running | Click calendar button while workout active | Click is a no-op (planner not opened) | Stop workout | `workout.js:1620` |
| Manual controls gated | +/- manual erg/resistance buttons when no active free-ride workout | Click is a no-op | Start a free-ride workout | `workout.js:1588-1592` |
| Past-date scheduling rejected | Drag/move a scheduled card onto a past date (`isPastDate(toDate)`) | `moveScheduledEntry` returns false — drop rejected, card stays | Drop on today/future | `workout-planner.js:226` |
| Schedule button hidden on past dates | Select a past day in planner | Schedule (+) button hidden (`display:none`) — can't schedule into the past | Select today/future | `workout-planner.js:903-904` |
| Schedule add gated to non-past | `addScheduledForSelectedDate` etc. on past date | Early return, no schedule created | Pick future date | `workout-planner.js:988`, `:1007`, `:1340`, `:1361` |
| History detail gated to past/today | `openDetailView` for a future date | Returns false — detail view not opened (future days have no history) | n/a | `workout-planner.js:631` |
| Bike connect throws if no BT | `connectBikeViaPicker` when `!navigator.bluetooth` | Throws "Bluetooth not available in this browser." → caller sets bike status "error" | Use Chrome | `ble-manager.js:1007` |
| HRM connect throws if no BT | `connectHrViaPicker` when `!navigator.bluetooth` | Throws "Bluetooth not available..." → HR status "error" | Use Chrome | `ble-manager.js:1049` |
| Bike picker cancel/fail | User cancels native BLE chooser or pairing fails | Caught in workout.js, logged, bike status set to "error"; auto-reconnect rescheduled if it was a connect failure | Retry connect | `ble-manager.js:1019-1027`, `:1041-1044`; `workout.js:1540` |
| Auto-reconnect skipped (no getDevices) | `getDevices` unavailable on reconnect tick | Silent skip — no auto-reconnect | Manual connect | `ble-manager.js:939` |
| Scrape concurrency guard | `handleLastScrapedWorkout` re-entered while running | Early return (no double-import) | n/a | `workout.js:1124` |
| Builder name-required validation | Save builder workout with empty Name | No alert; inline: field gets `wb-input-error` class, status bar "Name is required." (red); save blocked | Enter a name | `workout-builder.js:1085`, `:1109-1110` |
| Builder source-required | Save with empty Author/Source | Status "Author / Source is required." + red field; save blocked | Enter source | `workout-builder.js:1086-1090` |
| Builder description-required | Save with empty Description | Status "Description is required." + red field; save blocked | Enter description | `workout-builder.js:1092-1096` |
| Builder empty-code | Save with zero blocks | Status "Workout code is empty."; save blocked | Add intervals | `workout-builder.js:1098-1102` |
| ZWO course-data empty | TrainerRoad `courseData` empty/not array | Scraper returns `[null, "This TrainerRoad workout doesn't contain interval data VeloDrive can read."]` | Pick another workout | `scrapers.js:330` |
| Course segments empty | `courseData` array empty in validator | Returns `[[], "Invalid courseData: array is empty"]` | n/a | `scrapers.js:158` |

---

## C. Empty states (no dialog — in-page UI)

| Edge/error/guard | Trigger | What the user sees | Recovery | Legacy code (file:line) |
|---|---|---|---|---|
| Empty workout library (picker) | Picker opens with 0 `.zwo` files | Summary "No .zwo files found in this folder yet." + empty-state panel "No workouts found. Add your first workout." with an Add button (`#pickerEmptyState`/`#pickerEmptyAddBtn`); hidden in builder mode | Click Add to create one | `workout-picker.js:652-659`; HTML `index.html:634-644` |
| Chart overlay — connect bike | No bike connected | Centered overlay "Connect your bike" with left arrow (toward connect btn) | Connect bike | `workout.js:859`, `:903` |
| Chart overlay — select workout | Bike connected, no workout selected | Overlay "Select a workout" with right arrow | Pick workout | `workout.js:862`, `:901` |
| Chart overlay — ready to start | Workout selected, not pedaling | Overlay "Pedal to start workout" with right arrow | Start pedaling | `workout.js:865`, `:899` |
| Chart overlay — resume | Paused workout | Overlay "Pedal to resume" (no arrow) | Resume pedaling | `workout.js:868`, `:897` |
| Chart overlay hidden | Active running workout | Overlay `display:none` | n/a | `workout.js:846-847`, `:905` |
| Picker detail — no structure | Selected workout has no parseable interval structure | Detail pane text "No workout structure available." (`picker-detail-empty`) | Pick another | `workout-chart.js:1133`, `:1147` |
| Picker detail desc empty | Workout has no description | Description column rendered with `picker-detail-empty` class (blank styling) | n/a | `workout-picker.js:958` |
| Builder empty status | Builder opened with no elements | Status "Empty workout. Add elements to begin." (neutral) | Add elements | `workout-builder.js:1587` |
| Builder stats blank | No metrics / zero total seconds | All stat values show "--" | Add intervals | `workout-builder.js:1173-1180` |
| Empty schedule/history day | Planner day cell with no scheduled or history entries | Cell renders blank (no cards); after delete, `historyIndex`/`historyData`/`scheduledMap` entries pruned when length 0 | Schedule/ride to fill | `workout-planner.js:521-531`, `:602-612` |
| Metrics — empty segments | `rawSegments` empty/not array in metrics calc | Returns early (no chart/metrics computed) | n/a | `workout-metrics.js:248` |

---

## D. Failure paths that DON'T alert (silent / status-only)

| Edge/error/guard | Trigger | What the user sees | Recovery | Legacy code (file:line) |
|---|---|---|---|---|
| FIT parse error in planner detail | `openDetailView` — `parseFitFile` or file read throws | **Stays in calendar** silently; `openDetailView` returns false, only `console.warn` | Re-click; check file | `workout-planner.js:757-760` |
| Default-workout seeding failures | Copying bundled .zwo into a fresh folder fails per-file | Silent (`console.error`), continues with others; returns count copied | n/a | `storage.js:473-478` |
| Default-workout inspect failure | Can't enumerate workouts dir during seed check | Silent (`console.error`), treats as no-existing | n/a | `storage.js:440-443` |
| Theme/localStorage failures | localStorage read/write throws | Silently ignored, falls back to IndexedDB/auto | n/a | `storage.js:338-339`, `:352-353` |
| Scrape CORS blocked (TrainerRoad) | TypeError online → CORS | Returns `[null, "TrainerRoad blocked this request. In Chrome, allow VeloDrive access to trainerroad.com in Extensions → Site Access."]` (surfaced later as scrape-failed alert) | Grant site access | `scrapers.js:308-312` |
| Scrape offline | TypeError offline | `[null, "You appear to be offline..."]` | Reconnect | `scrapers.js:315-319` |
| TrainerDay 404 / 401-403 / 429 / 5xx | HTTP status from TrainerDay fetch | Status-specific messages ("could not find that workout (404)", "permission denied", "rate limited", "server error") | Per message | `scrapers.js:474-489` |
| TrainerDay CORS / offline / invalid JSON | Fetch TypeError / bad body | "TrainerDay blocked this request..." / "You appear to be offline..." / Invalid JSON message | Per message | `scrapers.js:458-470`, `:492` |
| Builder state persist failure | `saveWorkoutBuilderState` throws | Silent `console.warn`; editing continues unsaved-to-storage | n/a | `workout-builder.js:1162-1164` |
| Welcome tour absent | No `#welcomeOverlay` in DOM | Tour disabled (`setWelcomeActive(false)`), app continues | n/a | `workout.js:1225-1227` |

---

## Summary

- **Native dialogs: 41** — `alert()` ×33, `confirm()` ×7, `prompt()` ×1. Spread across `workout-picker.js` (15), `workout.js` (8 alerts + 1 confirm), `planner-analysis.js` (5), `workout-planner.js` (3 confirms), `storage.js` (3), `settings.js` (2), `workout-engine.js` (2), `content.js` (1 confirm).
- **Non-dialog guards: ~25** — FSA permission re-grant, OS/browser compat banners, Web-Bluetooth gating, past-date scheduling rejection (3 distinct spots: move, button-hide, add-guard), can't-select/calendar/manual-while-running, scrape concurrency guard, builder inline field validation (4 rules), BLE connect throws.
- **Empty states: ~12** — empty library panel, 4-way chart overlay state machine (`Connect bike → Select workout → Pedal to start → Pedal to resume`), "No workout structure available", empty builder/stats, pruned empty calendar days.
- **Silent failure paths: ~10** — most notable: **FIT parse error stays in calendar with only a console.warn**; scraper returns structured `[null, message]` tuples (15+ distinct messages) that only surface later via the scrape-failed alert.

**Highest-impact behaviors a rewrite is most likely to drop:**
1. **The four-state chart empty overlay with directional arrows** (`workout.js:843-869`) — a subtle UX state machine keyed on bike+workout+pedaling, easy to flatten into one generic placeholder.
2. **Folder-permission re-auth flow** — the `ensureDirPermission` "prompt → requestPermission" pattern (`storage.js:310-317`) and its 6+ distinct "re-authorize the folder in Settings" alerts on every file op (save/delete/trash, both library and history). Permission revocation is invisible until an op fails.
3. **Past-date scheduling rejection in 3 independent places** (move `:226`, button visibility `:903`, add-guards `:988/:1007/:1340/:1361`) using `isPastDate` vs `isPastOrTodayDate` — the today-boundary semantics differ between scheduling (future only) and history detail (past-or-today).
4. **Settings auto-open on startup attention** (`settings.js:650-655`) driven by `startupNeedsAttention` {missingRootDir, missingBtSupport, incompatiblePlatform} — plus the compat banner OS/browser detection (`detectOs`/`detectBrowser`).
5. **Scrape error tuple vocabulary** — 15+ user-friendly CORS/offline/HTTP-status strings in `scrapers.js` that map to the single `workout.js:1150` "Failed to import" alert; the detail strings are load-bearing for self-service recovery.
6. **Overwrite-on-save safety: move-old-to-trash-first**, abort save if that move fails (`workout-picker.js:1814-1822`) — prevents data loss; easy to replace with a naive overwrite.
7. **"Imported but ..." partial-success alerts** (`workout.js:1175/:1196`) — the import is kept even when the picker/engine step fails; a rewrite may treat these as total failures and discard the import.
