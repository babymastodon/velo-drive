# Behavior Audit 02 — The Picker (Workout Library)

Legacy: `docs/workout-picker.js` (2121 lines)
New: `web/src/ui/PickerView.svelte` (847 lines), `web/src/ui/BuilderView.svelte`, `web/src/ports/web/WebFileStore.ts`, `web/src/core/{zwo,metrics,chart}.ts`, `web/src/state/ui.svelte.ts`, `web/src/ui/PlannerView.svelte`

Scope: every hotkey, DOM event listener, and user-facing function in the legacy picker, mapped to its new-code location (or **GAP**). The picker also hosts the workout builder and a planner "schedule mode"; both are audited (some builder/schedule items are known-deferred and marked).

Convention: `currentFtp` in the new code derives from `store.vm.currentFtp` reactively (`PickerView.svelte:51`); the legacy `getCurrentFtp()` callback is replaced by this `$derived`. Picker auto re-renders on FTP change via Svelte reactivity, so legacy `syncFtpChanged` (line 1979) is implicit.

---

## Table

| # | Legacy item | docs/workout-picker.js:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| **HOTKEYS — setupHotkeys (1310-1492)** | | | | | | |
| 1 | `/` focus + select search | 1372-1377 | Focus search input, select text | PickerView.svelte:380-385 | OK | Guards: not builder, no meta/ctrl/alt |
| 2 | search-focused `Enter` → expand first result + focus Select btn | 1379-1392 | Blur search, expand first visible, focus its select button | PickerView.svelte:386-391 | PARTIAL | Expands first result but does NOT move focus to the `.select-workout-btn` (legacy focuses it for keyboard select). |
| 3 | search-focused `Escape` → clear + blur | 1393-1398 | Clear search value, blur, re-render | PickerView.svelte:392-396 | OK | |
| 4 | `z` focus zone filter + showPicker | 1402-1407 | Focus zone select, open native dropdown | — | **GAP** | No `z` hotkey; falls through. Native select keyboard nav also gone (#7). |
| 5 | `d` focus duration filter + showPicker | 1409-1414 | Focus duration select, open dropdown | — | **GAP** | No `d` hotkey. |
| 6 | INPUT/TEXTAREA guard (return) | 1416 | Ignore keys while typing | PickerView.svelte:399 | OK | New also lumps SELECT into the same early-return. |
| 7 | SELECT handling: j/k/arrows nav, Enter blur | 1417-1430 + handleSelectNav 1311-1334 | Arrow/j/k change select option + fire change; Enter blurs | PickerView.svelte:399 (`tag === 'SELECT'` → return) | **GAP** | New code returns immediately for SELECT — no custom j/k/arrow option-cycling and no Enter-to-blur. Relies on native select behavior only. |
| 8 | `Escape` (schedule mode) → close returnToPlanner | 1432-1438 | In schedule mode, Esc returns to planner | — | **GAP** | Schedule-mode hosting not ported (see #38). PickerView has no Escape handler at all; Escape is handled globally by `ui.handleEscape()` (ui.svelte.ts:43). |
| 9 | `Backspace` (schedule mode) → close returnToPlanner | 1439-1443 | Esc-equivalent in schedule mode | — | **GAP** | Schedule-mode not ported. |
| 10 | `Enter` → select expanded workout (or schedule it) | 1445-1466 | Selects expanded row; in schedule mode calls onScheduleSelected | PickerView.svelte:401-409 | PARTIAL | Browse-select path OK (`doSelect`). Schedule branch absent (schedule-mode not hosted). |
| 11 | `e` → open expanded workout in builder | 1468-1478 | Edit expanded row in builder (guarded `!scheduleMode`) | — | **GAP** | No `e` hotkey in new keymap. Edit only via per-row button (PickerView.svelte:737). |
| 12 | `j` / `ArrowDown` → move expansion +1 | 1480-1484 | Cycle expanded row down (wraps) | PickerView.svelte:410-414 (`movePickerExpansion(1)`) | OK | Logic mirrors legacy movePickerExpansion (PickerView.svelte:360-367). |
| 13 | `k` / `ArrowUp` → move expansion −1 | 1486-1490 | Cycle expanded row up (wraps) | PickerView.svelte:415-419 | OK | |
| 14 | meta/ctrl/alt guard | 1367 | Ignore modified keys | PickerView.svelte:375 | OK | |
| 15 | `isBuilderMode` guard (builder owns keymap) | 1366 | Skip picker keymap in builder | PickerView.svelte:374 | OK | |
| 16 | `isPickerOpen` guard | 1365 | Only handle when open | PickerView.svelte:372 (`if (!open) return`) | PARTIAL | Listener is bound to the modal element's `onkeydown` (PickerView.svelte:447) rather than `document`, so it only fires when focus is inside the modal. Legacy listens on `document`. Likely fine since modal traps focus, but global keys (j/k when nothing focused) require focus to be in modal. |
| **SORTING — setupSorting (1290-1308)** | | | | | | |
| 17 | header click → toggle dir / switch key (default dir per key) | 1294-1305 | Click `th[data-sort-key]` toggles asc/desc; new key resets dir (kjAdj→asc else desc) | PickerView.svelte:206-213 (`onSort`) + headers 649-655 | OK | Same default-direction rule. |
| 18 | updateSortHeaderIndicator (sorted-asc/desc class) | 559-571, 1307 | Adds CSS class to active header | PickerView.svelte:214-217 (`sortClass`) applied in `<th class=...>` | OK | |
| 19 | persist sort on header click | 1304 | savePickerState after sort | — | **GAP** | No picker-state persistence at all (see #34). |
| **DOM LISTENERS** | | | | | | |
| 20 | search input `input`/`change`/`search` → re-render + highlight + persist | 2054-2070 | Live filter as user types | PickerView.svelte:488 (`bind:value={searchTerm}`) drives `$derived` visibleItems | PARTIAL | Re-render + active-highlight (`picker-search-active` 475) OK reactively; persist missing (#34). |
| 21 | search clear button (`.picker-search-clear`) → clear + focus + re-render | 2071-2079 + 222-223 | X button clears search | PickerView.svelte:490-501, onclick 496 | OK | Visibility toggled by `class:visible={!!searchTerm.trim()}`. |
| 22 | zone filter `change` → re-render + highlight + persist | 2081-2087 | Filter by zone | PickerView.svelte:503-517 (`bind:value={zoneValue}`, `picker-filter-active`) | PARTIAL | Filtering OK; persist missing (#34). |
| 23 | duration filter `change` → re-render + highlight + persist | 2089-2095 | Filter by duration bucket | PickerView.svelte:518-535 (`bind:value={durationValue}`) | PARTIAL | Persist missing (#34). |
| 24 | sortable header click listeners | 1293-1306 | (see #17) | PickerView.svelte:649-655 onclick | OK | |
| 25 | row click → toggle expand | 724-727 | Collapsed row click expands/collapses | PickerView.svelte:664 (`onclick={() => toggleExpand(title)}`) + 219-221 | OK | |
| 26 | expanded-row collapse-hit overlay click | 745-749 | Invisible band collapses without affecting layout | PickerView.svelte:682-689 | OK | |
| 27 | Select button click → doSelectWorkout | 851-874 | Save selected workout, notify, close | PickerView.svelte:744-752 → `doSelect` 223-227 | OK | `doSelect` calls `fileStore.putSetting('selectedWorkout', ...)`, `engine.setWorkoutFromPicker`, `ui.close()`. Legacy used `saveSelectedWorkout` + `onWorkoutSelected` callback + `close()`. |
| 28 | Delete button click → deleteWorkoutFile (→trash) | 802-805, 1668-1690 | Confirm, move .zwo to trash dir, rescan | PickerView.svelte:708-719 → `onDelete` 229-240; trash move WebFileStore.ts:227-254 | PARTIAL | Core flow OK. Legacy gives distinct alerts for "no library folder", "no trash folder", and per-permission failures (1595-1629, 1672-1678); new `deleteWorkoutToTrash` silently returns false on any missing dir/permission (WebFileStore.ts:231,250). Confirm dialog uses `dialogs.confirm` (good). |
| 29 | Clone button click → clone + auto-name + save + rescan + expand | 819-831, buildCopyTitle 1032-1043 | "X Copy", "X Copy (2)"… then saveCanonicalWorkoutToZwoDir + rescan | PickerView.svelte:720-731 → `onClone` 265-272, `buildCopyTitle` 242-249, `cloneCanonical` 251-263 | OK | Auto-naming identical. Save via `fileStore.saveWorkout`. |
| 30 | Visit-website button click → window.open(sourceURL) | 768-788 | Open source URL new tab (only if sourceURL) | PickerView.svelte:694-707 | OK | |
| 31 | Edit button click → openWorkoutInBuilder | 845-848, 1155-1179 | Load workout into builder | PickerView.svelte:732-743 → `onEdit` 306-314 | PARTIAL | Enters builder + loads workout (via `requestAnimationFrame` + `builderApi.loadCanonicalWorkout`). But no baseline/dirty tracking (`setBuilderBaselineFromCurrent`, legacy 1170) — unsaved-changes detection not ported (#36). |
| 32 | Add-workout button (`#pickerAddWorkoutBtn`) → startBuilderFromScratch | 2008-2013, 1235-1257 | New blank workout in builder | PickerView.svelte:537-549 onclick `onCreateWorkout` 301-305 | PARTIAL | Enters builder with default workout. Legacy `restorePersistedStateOrDefault` (restores in-progress draft) not ported — always starts default (#37). |
| 33 | Empty-state add button (`#pickerEmptyAddBtn`) | 2029-2034 | Same as add-workout from empty state | PickerView.svelte:640-642 onclick `onCreateWorkout` | OK | Empty-state message text differs slightly ("No workouts found. Add your first workout." vs legacy "No .zwo files found…" summary). |
| 34 | persistPickerState / restorePickerStateIntoControls / loadPickerState / savePickerState | 1496-1525 | Persist search/zone/duration/sort across sessions, restore on open | — | **GAP** | No picker-state persistence in new code (grep: no loadPickerState/savePickerState). Filters/search/sort reset to defaults each session. |
| 35 | updateFilterHighlights | 1527-1544 | Toggle active classes on search/zone/duration | PickerView.svelte:475, 506, 521 (reactive `class:` directives) | OK | |
| **CORE FUNCTIONS** | | | | | | |
| 36 | computeVisiblePickerWorkouts — search grammar `30-45`/`<40`/`>60`/`45(±5)`, zone+dur filter, sort | 376-490 | Parse search tokens into duration range; filter; sort | PickerView.svelte:88-168 (`visibleItems` `$derived.by`) | OK | Line-for-line port: compactRange regex (109), `<`/`>` (115-124), ±5 approx (125-133), min>max swap (136-140), haystack = title+zone+source (142). Sort block 158-167 identical. |
| 37 | getCanonicalZone (inferZoneFromSegments) | 364-366 | Derive zone label | PickerView.svelte:74-76 (`getZone`) → `core/metrics.inferZoneFromSegments` | OK | |
| 38 | getDurationBucket filtering | 396-399 | Bucket by durationMin | PickerView.svelte:93-97 → `core/metrics.getDurationBucket` | OK | |
| 39 | renderWorkoutPickerTable (collapsed + expanded rows, stats chips, mini chart) | 645-1002 | Build table DOM, expanded stat chips, full-width chart | PickerView.svelte:646-815 (`{#each visibleItems}`) | OK | Collapsed row 663-677; expanded header/actions 679-754; stat chips 756-795; chart `use:miniChart` 807. Stat tooltips ported into chip `title=` (772,778,790). |
| 40 | renderMiniWorkoutGraph (expanded chart, RAF, scrollIntoView) | 981-1001 | Render SVG mini chart + smooth-scroll expanded row into view | PickerView.svelte:423-431 (`miniChart` action) → `core/chart.renderMiniWorkoutGraph` | PARTIAL | Chart render OK. `scrollIntoView({block:'nearest', behavior:'smooth'})` of newly-expanded row (legacy 992-1001) NOT ported. j/k navigation may scroll a far row off-screen without it. |
| 41 | formatPickerDuration | 600-609 | totalSec else durationMin*60 → mm:ss | PickerView.svelte:178-184 | OK | |
| 42 | zoneClassFromLabel / createZoneCell | 611-643 | Zone dot color class | PickerView.svelte:185-194 (`zoneDotClass`) + inline cell 666-670 | OK | |
| 43 | createStatChip + STAT_TOOLTIPS | 574-598 | Stat chip with tooltip | PickerView.svelte:756-795 (inline) | OK | |
| 44 | movePickerExpansion | 1259-1275 | Cycle expanded title across visible items | PickerView.svelte:360-367 | OK | |
| 45 | summary "N of M shown" / "No .zwo files…" | 654-671 | Footer summary text | PickerView.svelte:170-174 (`summaryText`) | OK | |
| 46 | scanWorkoutsFromDirectory | 87-107 | Iterate dir, parse .zwo → CanonicalWorkout | WebFileStore.ts:206-225 (`listWorkouts`) | OK | |
| 47 | rescanWorkouts (ensureDirPermission, scan, restore state) | 1548-1573 | Permission check + scan + restore + render | PickerView.svelte:70-72 (`rescan`) + `$effect` 62-68 | PARTIAL | Rescans on open. No `ensureDirPermission` re-prompt; no state restore (#34). `listWorkouts` returns [] if no dir (no error UI). |
| 48 | doSelectWorkout (save selected, notify, close) | 1575-1579 | Persist + hand to engine + close | PickerView.svelte:223-227 | OK | |
| 49 | open(workoutTitle) — rescan, conditional filter-clear, expand target | 1881-1921 | Open picker, optionally focus a title; clear filters only if hidden | PickerView.svelte:62-68 (`$effect` on `open`) | PARTIAL | Opens + rescans + clears expansion. The "open to a specific workoutTitle, clear filters only if hidden" path (1896-1909) is NOT ported — picker can't be opened focused on a title. |
| 50 | resetPickerFilters | 1583-1589 | Clear search/zone/dur + persist | — | **GAP** | No reset-filters function (only used by open-to-title path #49 and not exposed). |
| 51 | sanitizeZwoFileName (encodeURIComponent) | 1766-1768 | Title → safe filename | WebFileStore.ts:47-49 | OK | |
| 52 | saveCanonicalWorkoutToZwoDir (overwrite→trash, write, alerts) | 1783-1845 | Save .zwo, move existing to trash first | WebFileStore.ts:256-271 (`saveWorkout`) | PARTIAL | Writes file. Does NOT move an existing same-name file to trash before overwrite (legacy 1805-1823) — new `getFileHandle({create:true})` silently overwrites. Also drops all the user-facing alerts (no-folder / no-permission / write-fail). |
| 53 | moveWorkoutFileToTrash (timestamped name, 120-char cap, alerts) | 1591-1666 | Copy to trash with ISO-stamp suffix, delete src | WebFileStore.ts:227-254 | PARTIAL | Stamped name ported (240-241). 120-char filename cap (legacy 1644-1647) NOT ported. Copies via `text()` not the File blob (fine for .zwo). All alerts dropped (silent false). |
| 54 | close({returnToPlanner, cancelSchedule}) | 1936-1977 | Unsaved-changes guard, exit builder, schedule callbacks, hide overlay | PickerView.svelte:351-357 (`onClose`) + ui.close() | PARTIAL | In builder mode → back-to-library; else `ui.close()`. No unsaved-changes guard (#36); no schedule callbacks (#38). |
| 55 | overlay backdrop pointerdown/up → close (picker-mode only) | 2036-2052 | Click outside modal closes | OverlayModal.svelte (host) | OK | Handled by shared `OverlayModal` (PickerView wraps in it, 434-440). |
| 56 | close button (`#workoutPickerCloseBtn`) click | 1997-2001 | Close picker | PickerView.svelte:606-616 onclick `onClose` | OK | |
| 57 | back-to-planner button (`#pickerBackToPlannerBtn`) | 2002-2006, 220 | Schedule-mode return to planner | — | **GAP** | Schedule-mode not hosted (#38). |
| 58 | theme-change listener → re-render SVGs | 2097-2106, 1986-1993 | Re-render charts on OS theme toggle | — | **GAP** (Low) | No prefers-color-scheme listener; expanded chart won't recolor live on theme change (re-expands fix it). |
| **BUILDER HOST (in-picker)** | | | | | | |
| 59 | enterBuilderMode (hide filters, show builder buttons, title) | 1181-1212 | Switch UI into builder | PickerView.svelte:289-294 (`enterBuilderMode`) + `class:--builder` 444 + per-button `style:display` | OK | Filter/button visibility driven by `builderMode` reactive flags. |
| 60 | exitBuilderMode (restore filters, reset status) | 1214-1233 | Leave builder | PickerView.svelte:295-299 | OK | |
| 61 | builderSaveBtn click → saveCurrentBuilderWorkoutToZwoDir | 2022-2027, 1692-1759 | Validate, rename→trash old, save, reopen library | PickerView.svelte:589-604 onclick `onBuilderSave` 328-349 | PARTIAL | Validates (`validateForSave`), saves, rescans, expands. Title-rename moves old file to trash (342) — OK. But validation failure shows no message (legacy assumes builder alerts); no "no intervals" alert; reopen-library behavior differs (just rescan + expand). |
| 62 | builderBackBtn click → handleBackToLibrary (unsaved guard) | 2015-2020, 1277-1286 | Back with unsaved-changes confirm | PickerView.svelte:451-463 / 559-561? onclick `onBuilderBack` 324-326 | PARTIAL | Just `exitBuilderMode()` — no unsaved-changes confirm (#36), no clearPersistedState. |
| 63 | builderTrainerDayBtn → prompt URL → parseTrainerDayUrl → load | 275-303 | Import workout from TrainerDay URL | PickerView.svelte:559-572 (button rendered, **no onclick**) | **GAP** | Button is dead. `parseTrainerDayUrl`/scrapers not ported to `web/src` (grep: no scrapers in core). |
| 64 | builderUploadBtn → file input (.zwo/.fit) → parse → load | 305-359 | Upload local .zwo/.fit into builder | PickerView.svelte:574-587 (button rendered, **no onclick**) | **GAP** | Button dead. No file input element, no `normalizeUploadedWorkout`/`buildSegmentDescription` (legacy 492-557). `parseFitFile` exists in core (`core/fit.ts`) but is unused here. |
| 65 | normalizeUploadedWorkout / buildSegmentDescription | 492-557 | Default title/source/description for uploaded file | — | **GAP** | Depends on #64. |
| 66 | builder status display (updateBuilderStatus, tones) | 1117-1131 | Status pill ok/error/neutral | PickerView.svelte:551-557 + `onBuilderStatusChange` 316-319 | OK | |
| 67 | builder shortcuts footer (updateBuilderShortcuts, hasSelection) | 1133-1153 | Footer hints change with selection | PickerView.svelte:827-844 + `onBuilderUiStateChange` 320-322 | OK | Both branch texts ported verbatim. |
| 68 | handleBuilderChange / dirty tracking (canonicalEquals, baseline) | 1045-1099 | Track unsaved edits | — | **GAP** | No `onChange`/dirty tracking wired from BuilderView; `hasUnsavedBuilderChanges` concept absent. |
| 69 | clearPersistedBuilderState / restorePersistedStateOrDefault | 1101-1108, 1242-1245 | Persist/restore in-progress builder draft | — | **GAP** | BuilderApi (BuilderView.svelte:5-10) has no persist/restore methods. Draft not preserved across close. |
| 70 | maybeHandleUnsavedBeforeLeave (confirm discard) | 1847-1869 | Confirm before discarding edits | — | **GAP** | Not ported (#36). |
| **SCHEDULE MODE** | | | | | | |
| 71 | openScheduleMode({dateKey, entry, editMode}) | 1923-1934 | Open picker in "pick a workout to schedule" mode | — | **GAP (deferred)** | Replaced by a separate planner flow: `PlannerView.onScheduleDay` (PlannerView.svelte:664-687) schedules the *currently-selected* workout directly into schedule.json — no picker handoff. Documented as intentional (PlannerView.svelte:17-20). |
| 72 | "Schedule Workout" select button branch | 854-867 | Per-row schedule action | — | **GAP (deferred)** | See #71. |
| 73 | scheduleUnscheduleBtn (Unschedule) | 224-234, 1931 | Remove schedule from edit mode | PlannerView.svelte:689-699 (`onDeleteScheduled`) | PARTIAL (relocated) | Unschedule lives in planner per-card delete, not the picker. |
| 74 | onScheduleSelected / onScheduleCanceled / onScheduleUnschedule callbacks | 204, 859, 1455, 1954 | Picker↔planner schedule wiring | — | **GAP (deferred)** | Wiring replaced by planner-local schedule.json writes (#71). |
| 75 | syncScheduleUi (title/back-to-planner visibility) | 249-258 | Toggle schedule chrome | — | **GAP (deferred)** | Schedule chrome not in picker. |
| 76 | controls `.picker-schedule-mode` class toggling | 1930, 1975 | CSS for schedule mode | — | **GAP (deferred)** | |
| **PUBLIC API / misc** | | | | | | |
| 77 | getWorkoutPicker singleton | 72-77 | Singleton accessor | n/a (Svelte component instance) | OK | Architectural; not a behavior. |
| 78 | syncFtpChanged | 1979-1983 | Re-render on FTP change | PickerView.svelte:51 (`$derived currentFtp`) reactive | OK | Implicit via reactivity. |
| 79 | createIconSvg (edit/delete/link/clone icons) | 110-185 | Inline SVG icons | PickerView.svelte (inline `<svg>` per button) | OK | Hand-inlined in markup. |

---

## Gaps

Only PARTIAL/GAP rows, with severity and what's missing.

### High

- **#63/#64/#65 — TrainerDay import + file Upload are dead buttons.** The `Import TrainerDay` and `Upload File` buttons render in builder mode (PickerView.svelte:559-587) but have **no `onclick`**. `parseTrainerDayUrl`/scrapers were never ported to `web/src` (no scrapers module in `core/`); `normalizeUploadedWorkout`/`buildSegmentDescription` absent. `core/fit.ts` exists but is unwired. Users cannot import from TrainerDay or upload .zwo/.fit into the builder. *Missing: file `<input>` + handlers, scraper port, upload normalization.*
- **#52 — saveWorkout overwrites without trashing the existing file.** Legacy moves an existing same-named .zwo to trash *before* writing (workout-picker.js:1805-1823); new `WebFileStore.saveWorkout` (256-271) uses `getFileHandle({create:true})` which silently overwrites. Combined with clone/save this risks **data loss with no undo** (no trash copy). *Missing: pre-overwrite trash move + the no-folder/no-permission/write-fail alerts.*
- **#34/#19 — No picker-state persistence.** `loadPickerState`/`savePickerState`/`persistPickerState`/`restorePickerStateIntoControls` (1496-1525) have no equivalent. Search text, zone/duration filters, and sort key+dir reset every time the picker opens. *Missing: persist on every filter/sort change + restore on open.*
- **#68/#69/#70/#36 — Builder unsaved-changes safety net is gone.** No dirty tracking (`handleBuilderChange`/`canonicalEquals`/baseline), no persisted draft (`restorePersistedStateOrDefault`/`clearPersistedState`), no discard-confirm (`maybeHandleUnsavedBeforeLeave`). Back/Close/Edit while mid-edit **silently discards work** with no prompt and no recovered draft. *Missing: BuilderApi dirty/persist methods + confirm-on-leave.*

### Med

- **#7 — SELECT (zone/duration) keyboard nav lost.** New keymap returns immediately for SELECT targets (PickerView.svelte:399); legacy supports j/k/↑/↓ to cycle options and Enter-to-blur (handleSelectNav 1311-1334). Keyboard-only users lose smooth filter cycling.
- **#4/#5 — `z` and `d` filter-focus hotkeys missing.** No quick-focus for zone/duration selects.
- **#11 — `e` edit hotkey missing.** Cannot open the expanded workout in the builder from the keyboard; only the per-row Edit button works.
- **#49/#50 — Open-to-specific-title path missing.** `open(workoutTitle)` (1881-1921) focused/expanded a given workout and cleared filters only if it was hidden; `resetPickerFilters` (1583) supports that. Not ported — e.g. "edit then reopen library on that workout" can't re-focus it; the saved row is expanded by `onBuilderSave` (PickerView.svelte:348) but the open-from-elsewhere case is unsupported.
- **#28/#53 — Trash/delete error messaging dropped.** `deleteWorkoutToTrash` returns `false` silently on missing library/trash dir or denied permission; legacy shows specific actionable alerts (1595-1629). Also the 120-char trash-filename cap (1644-1647) is not enforced.
- **#2 — search-Enter doesn't move focus to Select button.** Legacy focuses `.select-workout-btn` so a second Enter rides the workout (1387-1391); new only expands the first result.
- **#61 — Builder save validation/no-intervals feedback missing.** On `validateForSave` failure or empty segments, new code silently returns (PickerView.svelte:330-335) with no user-facing message.

### Low

- **#40 — Expanded row no longer scrolls into view.** Legacy smooth-scrolls the newly-expanded/navigated row (`scrollIntoView`, 992-1001); j/k navigation can leave the expanded row off-screen.
- **#58 — No live theme re-render.** OS dark/light toggle won't recolor the open expanded chart until it is re-expanded.
- **#16 — Keymap bound to modal, not document.** Picker keys require focus inside the modal; legacy listened on `document`. Likely benign (focus is trapped) but a behavioral difference.
- **#33 — Empty-state copy differs** ("No workouts found. Add your first workout." vs legacy summary text).

### Deferred (intentional, per code comments)

- **#71–#76 — Picker schedule-mode is not hosted.** The picker↔planner "schedule this workout" handoff (openScheduleMode, onScheduleSelected/Canceled/Unschedule, schedule chrome, Esc/Backspace schedule guards #8/#9) is replaced by a self-contained planner flow that schedules the currently-selected workout straight into schedule.json (`PlannerView.onScheduleDay`:664-687; unschedule via `onDeleteScheduled`:689-699). PlannerView.svelte:17-20 documents this as intentional. The picker therefore never enters schedule mode; legacy schedule-only behaviors are absent by design.
