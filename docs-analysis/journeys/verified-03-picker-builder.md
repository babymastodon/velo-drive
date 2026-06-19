# Verified-03 — Library/Picker + Builder (J-PICK-01…30, J-BLD-01…39)

Read-only verification pass against the new Svelte app (`web/src`) vs the legacy
vanilla-JS PWA (`docs/`). Each row lists the new-code implementation (file:line)
and a status: **OK** / **PARTIAL** / **GAP** / **WRONG**. Behavior was reviewed
against `docs/workout-picker.js`, `docs/workout-builder.js`,
`docs/builder-backend.js`, not just element presence.

Primary new-code files:
- `web/src/ui/PickerView.svelte`
- `web/src/ui/BuilderView.svelte`
- `web/src/core/builder-backend.ts`
- `web/src/core/chart.ts`
- `web/src/core/scrapers.ts`
- `web/src/core/metrics.ts`
- `web/src/ports/web/WebFileStore.ts`
- `web/src/state/ui.svelte.ts`
- `web/src/ui/App.svelte` (global key router / picker open-guard)

---

## Library / Picker

| ID | Journey | New-app impl (file:line) | Status | Notes |
|---|---|---|---|---|
| J-PICK-01 | Browse library — scan `.zwo`, render rows w/ metrics | `PickerView.svelte:127-143,1052-1083`; scan `WebFileStore.ts:317-339` | OK | 7 cols Name/Zone/Source/IF/TSS/Duration/kJ. IF `.toFixed(2)`, TSS `round`, kJ `round`+" kJ". Matches legacy 645-748. |
| J-PICK-02 | Folder-config gate — alert + open Settings | `App.svelte:269-292` (`ensureRootDirConfigured`+`openPicker`) | OK | "Choose a VeloDrive folder first, then pick a workout." + forces `settingsFoldersHelp`. Matches legacy intent. |
| J-PICK-03 | Expand/collapse row (toggle one) | `PickerView.svelte:276-278,1070,1088-1095` | OK | `toggleExpand` + collapse-hit zone. Matches 724-727,745-750. |
| J-PICK-04 | Search tokens + duration ranges | `PickerView.svelte:156-211` | OK | `60-90`/`>45`/`<40`/`90m`/`45` parsed; approx single number = ±5; range-swap; haystack = title+zone+source. Matches 401-462. |
| J-PICK-05 | Search clear button (visible non-empty) | `PickerView.svelte:881-892,866` | OK | `.visible` toggled on trimmed value. |
| J-PICK-06 | Zone filter dropdown | `PickerView.svelte:894-909,148`; hidden in builder `:898` | OK | exact-match filter, hidden in builder. |
| J-PICK-07 | Duration filter dropdown (buckets) | `PickerView.svelte:910-928,150-154`; `metrics.ts:410-421` | OK | `getDurationBucket` buckets 1-30…>240 match. Hidden in builder. |
| J-PICK-08 | Sortable headers (name/if/tss/duration/kjAdj) | `PickerView.svelte:263-274,1055-1061` | OK | default `kjAdj` asc; new-key default = `desc` except kjAdj=`asc`; toggle dir. Zone/source not sortable. Matches 1290-1308. |
| J-PICK-09 | `/` focus+select search | `PickerView.svelte:703-708` | OK | works regardless of focus (routed via overlay handler). |
| J-PICK-10 | Enter (search) → expand first, focus Select | `PickerView.svelte:710-718` | OK | blur, expand first visible, rAF focus `selectBtnEl`. Matches 1379-1392. |
| J-PICK-11 | Escape (search) → clear search, blur (no close) | `PickerView.svelte:719-728,800-811` | **PARTIAL/WRONG** | When search has text → clears, consumes. When search is EMPTY → blurs and returns `false`, so App falls through to `ui.handleEscape()` and **closes the picker**. Legacy (1393-1398) clears unconditionally and NEVER closes from the search box. See defect P-1. |
| J-PICK-12 | `z` focus+open zone filter | `PickerView.svelte:734-738,680-689` | OK | `focusAndOpenSelect` uses best-effort `showPicker()`. |
| J-PICK-13 | `d` focus+open duration filter | `PickerView.svelte:739-743` | OK | same pattern as `z`. |
| J-PICK-14 | ↑/↓/j/k navigate select options (select focused) | `PickerView.svelte:745` (bails on SELECT) | **PARTIAL** | New code returns `false` for any SELECT-focused target except the `z`/`d` re-open. Native arrow keys move the option, but **`j`/`k` do NOT navigate a focused select**, and no synthetic `change` is dispatched. Legacy `handleSelectNav` (1314-1362) handled j/k/arrows explicitly + dispatched `change`. See defect P-2. |
| J-PICK-15 | ↓/j ↑/k move row expansion (wraps) | `PickerView.svelte:662-669,772-781` | OK | `movePickerExpansion` modulo-wrap matches 1259-1275. |
| J-PICK-16 | Enter (table) → select expanded | `PickerView.svelte:763-771` | **PARTIAL** | Library path `doSelect` matches. Schedule-mode branch (`onScheduleSelected`) is absent — picker has no schedule mode (deferred). |
| J-PICK-17 | `e` → open expanded in builder | `PickerView.svelte:753-761` | OK | `onEdit(expanded.canonical)`; gated to non-search context. Matches 1468-1478. |
| J-PICK-18 | Select to ride (Select btn → engine load, close) | `PickerView.svelte:280-284,1150-1159` | OK | `putSetting('selectedWorkout')` + `engine.setWorkoutFromPicker` + `ui.close()`. Matches `doSelectWorkout` 1575. |
| J-PICK-19 | "Visit website" opens sourceURL | `PickerView.svelte:1100-1113` | OK | rendered only when `sourceURL`; `window.open(_,'_blank')`. Hidden-in-schedule is N/A (no schedule mode). |
| J-PICK-20 | Delete → confirm → trash + rescan | `PickerView.svelte:286-297`; `WebFileStore.ts:341-344,388-421` | OK | Confirm `Move workout file "{file}" to the trash folder?`; timestamped trash name `{base} ({ISO-with -}){ext}`, 120-char cap. Display name `encodeURIComponent(title)` matches `sanitizeZwoFileName` (`WebFileStore.ts:105-107`). Matches 1668-1690,1641-1647. |
| J-PICK-21 | Clone → "Copy (N)" dedupe, save, focus | `PickerView.svelte:299-329` | OK | `buildCopyTitle`: `"{t} Copy"` then `"{t} Copy (2)"`… exactly matches 1032-1043. Saves immediately, focuses clone. |
| J-PICK-22 | Edit → open in builder | `PickerView.svelte:466-477` | OK | `onEdit`: enter builder, set `builderOriginalTitle`, suppress-dirty load + baseline. Matches `openWorkoutInBuilder` 1155-1179. |
| J-PICK-23 | Create workout button | `PickerView.svelte:456-465,930-942`; hidden in builder `:935` | OK | `onCreateWorkout` → enter builder, restore draft-or-default. Matches 2008-2013/`startBuilderFromScratch`. |
| J-PICK-24 | Close picker (unsaved-builder confirm) | `PickerView.svelte:653-659,621-626,1011-1021` | OK | In builder mode close routes to `onBuilderBack` → unsaved guard; else `ui.close()`. |
| J-PICK-25 | Click-outside backdrop close (picker-mode only) | `OverlayModal.svelte` + `onClose` | OK (assumed) | OverlayModal handles backdrop pointerdown/up→close. Picker-only/planner-suppress nuance not re-verified here (OverlayModal common). |
| J-PICK-26 | Footer hint (key legend) | `PickerView.svelte:1225-1232` | OK | display-only. |
| J-PICK-27 | Picker state persisted/restored | `PickerView.svelte:81-113` | OK | persists searchTerm/zone/duration/sortKey/sortDir; restore suppresses re-save via `pickerStateReady`; duration validated against `VALID_DURATIONS`. Matches 1496-1533. |
| J-PICK-28 | Empty library panel + Add button | `PickerView.svelte:1043-1050,232` | OK | "No workouts found. Add your first workout." + add btn. |
| J-PICK-29 | Picker detail — no structure msg | mini-chart `chart.ts` renderMiniWorkoutGraph | PARTIAL | Picker only renders the mini-chart when a row is expanded; the legacy "No workout structure available." string for an empty-structure detail is not surfaced as text in PickerView. Low severity (empty `.zwo` won't list because `listWorkouts` requires `parseZwoXmlToCanonicalWorkout`). |
| J-PICK-30 | Empty description → blank styling | `PickerView.svelte:1204-1210` | OK | renders `(No description)` placeholder (legacy left blank; cosmetic divergence, acceptable). |

---

## Builder

| ID | Journey | New-app impl (file:line) | Status | Notes |
|---|---|---|---|---|
| J-BLD-01 | Build from scratch (seed warmup or restore draft) | `PickerView.svelte:456-494`; `BuilderView.svelte:1017-1033`; `builder-backend.ts:370-396` | OK | Default blocks warmup 600/0.5/0.85, steady 900/0.85, intervals 6/60/60/1.1/0.55, cooldown 600/0.55/0.5 — exact match. Draft restore via `BUILDER_STATE_KEY`. |
| J-BLD-02 | Edit existing (load canonical, suppress-dirty, baseline) | `PickerView.svelte:466-477`; `BuilderView.svelte:1076-1096` | OK | rename-moves-old-to-trash handled at save (`PickerView.svelte:636-643`). |
| J-BLD-03 | `handleAnyChange` recompute + persist draft + dirty | `BuilderView.svelte:67-70,404-409`; `canonicalEquals 356-394` | OK | onChange bump persists draft; dirty via `canonicalEquals` mirrors legacy. |
| J-BLD-04 | Save to `.zwo` (validate, rename→trash, write) | `PickerView.svelte:628-651`; `WebFileStore.ts:346-381,388-421` | OK | overwrite moves old→trash BEFORE write; rename moves original→trash. Matches 1692-1759,1805-1823. |
| J-BLD-05 | Validate-for-save (name/source/desc/≥1 block) | `BuilderView.svelte:1052-1075` | OK | red borders via `nameError/sourceError/descError`; first-error status; blocks save. |
| J-BLD-06 | Name-required inline validation | `BuilderView.svelte:1063,1068,1266` | OK | "Name is required." + `wb-input-error`. |
| J-BLD-07 | Source-required inline validation | `BuilderView.svelte:1064,1069,1270` | OK | "Author / Source is required." |
| J-BLD-08 | Description-required inline validation | `BuilderView.svelte:1065,1070,1279` | OK | "Description is required." |
| J-BLD-09 | Empty-code (zero blocks) validation | `BuilderView.svelte:1066`; `PickerView.svelte:633-635` | OK | "Workout code is empty." in validate; save also early-returns on empty rawSegments. |
| J-BLD-10 | Insertion-cursor movement (Ctrl+A/E, Home/End, g/$, h/l/←/→) | `BuilderView.svelte:760-763,874-883` | OK | Ctrl+A/E only when no selection; g/Home=-1, $/End=last, h/l clamp. Matches 525-538,796-843. |
| J-BLD-11 | Cursor power adjust j/k/↓/↑ (±5%, Shift×5) | `BuilderView.svelte:884-891`; `builder-backend.ts:1944-2016` | OK | `applyPowerUpdatesAroundCursor(prev,prev+1,delta)` adjusts block before+after cursor. Matches 844-864. |
| J-BLD-12 | Block-insert keys R/E/T/S/V/A/W/C/I/F/X (auto-select) | `BuilderView.svelte:142-153,800-813,278-285` | OK | zone powers 0.55/0.7/0.85/0.95/1.1/1.25; warmup 0.5→0.75, cooldown 0.75→0.5; intervals 6/60/60/1.1/0.55; key-insert `selectOnInsert:true`. Matches 638-681. |
| J-BLD-13 | Palette buttons (no auto-select) | `BuilderView.svelte:1203-1224,1211` | OK | `insertSpec(spec, false)`. Label collapse via `labelMode` (icon<950, short<1260). Matches 338-368. |
| J-BLD-14 | Undo/redo keys + toolbar | `BuilderView.svelte:753-756,1136-1141`; backend `716-742` | OK | Undo Ctrl/⌘+Z or bare U; Redo Ctrl/⌘+Shift+Z / Ctrl/⌘+Y / Shift+U. Toolbar disabled via `history.canUndo/canRedo`. Matches 541-559,173-191. |
| J-BLD-15 | Copy/Cut/Paste (Ctrl+C/X/V, P, Insert variants, y) | `BuilderView.svelte:767-776,793-798`; codec `builder-backend.ts:156-216` | OK | Ctrl/⌘+C/X/V, bare P paste, Ctrl+Insert copy, Shift+Insert paste, Shift+Delete cut, multi-select `y`=copy+deselect. ZWO XML / `VELO_TEXT_EVENTS:` formats. Matches 568-602,623-629. |
| J-BLD-16 | Shift+H/L/←/→ range-select extend | `BuilderView.svelte:780-788`; `builder-backend.ts:579-623` | OK | `shiftMoveSelection(direction)`. Matches 604-619. |
| J-BLD-17 | d/Delete/Backspace delete (text-event > block priority) | `BuilderView.svelte:815-841` | OK | text-event first; block: `d`=cut, Delete/Backspace=plain delete; cursor fallthrough (Backspace=block before cursor, Delete=block after). Matches 683-722. |
| J-BLD-18 | Builder Escape: deselect → else exit (unsaved confirm) | `BuilderView.svelte:843-856`; back→`PickerView.svelte:621-626`; gate `App.svelte:177`, `ui.svelte.ts:41` | OK | 2-level; `ui.pickerBuilderMode` makes App bail so global Esc never closes picker. Matches 724-740. |
| J-BLD-19 | Builder Enter: deselect / select block at cursor | `BuilderView.svelte:843-864` | OK | Enter with selection deselects; else selects block at clamped cursor. Matches 724-755. |
| J-BLD-20 | Builder Space: toggle insertion edge | `BuilderView.svelte:897-907,960-966` | OK | single + multi-select edge toggle; `stopPropagation` (won't start workout). Matches 770-788. |
| J-BLD-21 | Selected-block attr edit (h/l dur, j/k power, Shift×5) | `BuilderView.svelte:909-966` | OK | `isInsertionAtEndOfSelection` chooses ramp high/low + interval on/off. Matches 872-957. |
| J-BLD-22 | Move-left/right & delete-block toolbar | `BuilderView.svelte:1122-1135`; backend `1157-1175` | OK | move btns only when `selectionCount === 1`; delete btn when block editor shown. Matches 142-168. |
| J-BLD-23 | Block steppers −/+ & number input (dur/power/cadence/reps) | `BuilderView.svelte:970-996,1230-1253`; `getDurationStep 1012-1018` | OK | dynamic dur step (<60→5,<180→15,<600→30,else 60); cadence `allowEmpty` default 90. Matches 1733-1926,2027-2073. |
| J-BLD-24 | Text-event editor (duration / "Starts at" offset / cue) | `BuilderView.svelte:1165-1196` | OK | offset step 15; duration min 1; text input. Matches 428-467. |
| J-BLD-25 | Meta inputs (Name/Source/Description auto-grow) | `BuilderView.svelte:432-441,1261-1288` | OK | `autoGrow` on description; `wb-input-error` on failed save. Matches 75-96. |
| J-BLD-26 | Chart: click block/segment handle → select + cursor | `chart.ts:1548-1591`; `BuilderView.svelte:485-523` | OK | `onSelectBlock` + `onSetInsertAfterFromSegment`. Matches 2394-2436,2738-2751. |
| J-BLD-27 | Chart: click text-event marker → select | `BuilderView.svelte:547-560`; `chart.ts:1058,1077` | OK | text-event hit selects, deselects block. |
| J-BLD-28 | Chart: drag text-event marker (snap 15s, clamp) | `BuilderView.svelte:547-560` | **PARTIAL (deferred)** | Pointerdown on a text-event only SELECTS it; the drag-to-move-offset (snap 15s, clamp) is NOT implemented (code comment: "drag offset simplified to a click-select"). Known-deferred text-event drag. Legacy 2598-2605 snaps `round(timeSec/15)*15`. |
| J-BLD-29 | Chart: drag handle top → set power | `BuilderView.svelte:596-695` | OK | steady→powerRel; ramp thirds left/right/middle(both); interval even/odd on/off. Matches 2647-2679. |
| J-BLD-30 | Chart: drag handle right → set duration (snapped) | `BuilderView.svelte:697-719` | OK | steady/freeride/ramp→durationSec; interval even/odd on/off via per-rep scale math. Matches 2682-2715. |
| J-BLD-31 | Chart: drag handle move → reorder block | `BuilderView.svelte:562-639,641-732`; `chart.ts:1383` (`data-drag-handle='move'`) | **PARTIAL/GAP (deferred)** | A `move` drag handle is rendered, and `handleChartPointerDown` records `dragState` for any handle, but `handleChartPointerMove`/`Up` have NO `'move'` branch and never call `backend.reorderBlocks` / set `dragInsertAfterIndex`. So drag-reorder is a no-op (it just selects + sets cursor). `reorderBlocks` exists in backend (`1020-1044`) but is unused. Known-deferred block-reorder drag. Legacy 2607-2641,2738-2739. See defect B-1. |
| J-BLD-32 | Chart: drag threshold 4px (click vs drag) | `BuilderView.svelte:61,659-664` | OK | `DRAG_THRESHOLD_PX=4`; `didDrag` set on exceed. (Mostly informational since move-reorder unused; still gates top/right.) |
| J-BLD-33 | Chart: Shift+click range-select / click empty → cursor | `chart.ts:1544-1626`; `BuilderView.svelte:500-521` | OK | shift→range via `setSelectionFromCursors`; empty click→`onSetInsertAfter`. Matches 1367-1396. |
| J-BLD-34 | Back to library (unsaved confirm) | `PickerView.svelte:621-626,842-854`; `maybeHandleUnsavedBeforeLeave 417-428` | OK | confirm + clear draft + exit. |
| J-BLD-35 | Builder shortcut hint per selection state | `PickerView.svelte:1234-1251`; `onUiStateChange BuilderView.svelte:409-411` | OK | two hint variants by `builderHasSelection`. |
| J-BLD-36 | Builder empty status / blank stats | `BuilderView.svelte:453-462,191-213` | OK | "Empty workout. Add elements to begin." + "--" stats. |
| J-BLD-37 | Builder draft persist failure → silent | `PickerView.svelte:408` (`void fileStore.putSetting`) | PARTIAL | Persist is fire-and-forget (`void`), so a rejected putSetting is swallowed (no console.warn). Legacy logged `console.warn` (1162-1164). Editing continues either way; cosmetic-only. |
| J-BLD-38 | Format parsing ZWO↔canonical | `core/zwo.ts` (not in this scope) | OK (assumed) | `segmentsToBlocks`/`buildRawSegmentsFromBlocks` round-trip via zwo.ts; covered by builder-backend.test.ts per file header. |
| J-BLD-39 | Format parsing FIT↔canonical | `core/fit.ts` (upload path `PickerView.svelte:545-552`) | OK (assumed) | `parseFitFile(buf).canonicalWorkout`. Out of primary scope. |

---

## Import (picker-hosted subset)

| ID | Journey | New-app impl (file:line) | Status | Notes |
|---|---|---|---|---|
| J-IMP-11 | Import TrainerDay URL into builder | `PickerView.svelte:513-526`; `scrapers.ts:193-207` | OK | prompt text + example URL match; `parseTrainerDayUrl` → `loadIntoBuilder`. |
| J-IMP-12 | TrainerDay parse/HTTP errors | `scrapers.ts:137-166,193-206` | OK | 404/401-403/429/5xx/CORS/offline/invalid-URL status-specific strings preserved. |
| J-IMP-13 | File upload (.zwo/.fit, branch by ext) | `PickerView.svelte:536-562` | OK | ext split, fit→`parseFitFile`, else→`parseZwoXmlToCanonicalWorkout`; `normalizeUploadedWorkout` for title/source/desc. |
| J-IMP-14 | File upload parse error → alert | `PickerView.svelte:557-560` | OK | "Unable to load workout file." Matches 340. |

(J-IMP-11..14 are listed because they are wired through the picker/builder; the
extension-scrape rows J-IMP-01..10,15-18 are outside Picker/Builder scope.)

---

## Gaps & defects (PARTIAL / GAP / WRONG only)

### P-1 — Escape in empty picker search closes the picker  ·  **WRONG (medium)**
`PickerView.svelte:719-728`, `:800-811`; routed by `App.svelte:179-196`.
When the search box is focused and **already empty**, `handlePickerKey` blurs the
input and returns `false`. The App's Escape path then calls `ui.handleEscape()`,
which **closes the entire picker**. Legacy `setupHotkeys` (workout-picker.js
1393-1398) for Escape-in-search does `searchInput.value = ""; searchInput.blur();
renderWorkoutPickerTable();` and returns — it **never** closes the picker from the
search box (the picker closes only via close-btn / backdrop / non-search Escape).
Net effect: one extra Escape press (when the field is empty) closes the modal the
user is mid-search in. Low data risk, surprising UX. To match legacy, Escape in
the search box should always consume the key (clear + blur), never fall through.

### P-2 — `j`/`k` do not navigate a focused zone/duration filter  ·  **PARTIAL (low)**
`PickerView.svelte:745` (`if (tag === 'INPUT' || 'TEXTAREA' || 'SELECT') return false`).
Once a `<select>` (zone/duration filter) has focus, the new handler bails for all
keys except the `z`/`d` re-open (handled earlier at 734-743). Native arrow keys
still move the option, but the legacy `handleSelectNav` (1314-1362) ALSO mapped
`j`/`k` (and arrows) and explicitly dispatched a synthetic `change` event so the
table re-filtered. New code relies entirely on the browser's native select
behavior — `j`/`k` are inert on a focused select, and there's no guarantee the
`change`/persist fires until the select loses focus / value actually changes
(Svelte `bind:value` does fire on native change, so filtering still works via
arrows; only the `j`/`k` aliases and the forced dispatch are missing).

### P-3 — Picker has no schedule mode  ·  **PARTIAL (deferred)**
`PickerView.svelte` (no `scheduleMode` state anywhere). Affects J-PICK-16 (Enter
→ `onScheduleSelected`), J-PICK-19 hide-in-schedule, and the schedule-mode
Escape/Backspace→planner path (J-KEY-12, legacy 1432-1443). The picker is
library-only; scheduling a workout onto a day is the deferred planner
schedule-mode flow. Marked PARTIAL per the known-deferred picker schedule-mode
note.

### B-1 — Builder chart drag-to-reorder is a no-op  ·  **PARTIAL/GAP (deferred)**
`BuilderView.svelte:562-639` (pointerdown), `:641-720` (pointermove), `:722-732`
(pointerup); `chart.ts:1383` renders `data-drag-handle = 'move'`.
The chart emits a `move` handle and `handleChartPointerDown` accepts ANY handle
into `dragState`, but `handleChartPointerMove` only branches on `'top'` and
`'right'`, and `handleChartPointerUp` never calls `backend.reorderBlocks` or sets
`dragInsertAfterIndex`. So dragging a block's body does nothing beyond the
pointerdown's `setSelectedBlock` — no live drop indicator, no reorder. The backend
`reorderBlocks` (`builder-backend.ts:1020-1044`) is fully implemented but never
invoked from the UI. Legacy (workout-builder.js 2607-2641,2738-2739) computes
`dragInsertAfterIndex` on move and calls `reorderBlocks(blockIndex, …)` on up with
a live drop indicator. This is the known-deferred block-reorder drag → PARTIAL.
(Reordering is still possible via the move-left/right toolbar buttons — J-BLD-22.)

### B-2 — Text-event drag-to-move simplified to click-select  ·  **PARTIAL (deferred)**
`BuilderView.svelte:547-560`. Pointerdown on a text-event marker only SELECTS the
event (sets `selectedTextEventIndex`, deselects block) — there is no drag handler
to move the offset. Legacy (workout-builder.js 2598-2605) drags the marker with a
15s snap (`round(timeSec/15)*15`) and clamps to `[0, maxOffset]`. The offset is
still editable via the text-event editor's "Starts at" stepper (step 15,
J-BLD-24), so the value is reachable, just not by dragging. Known-deferred
text-event drag → PARTIAL.

### B-3 — Draft-persist failure swallowed silently (no warn)  ·  **PARTIAL (low/cosmetic)**
`PickerView.svelte:408` — `void fileStore.putSetting(BUILDER_STATE_KEY, current)`
is fire-and-forget; a rejected promise is unobserved. Legacy
`saveWorkoutBuilderState` was wrapped so a persist failure produced a
`console.warn` and editing continued (workout-builder.js 1162-1164). New code
also continues editing, but loses the diagnostic warn. No user-visible impact.

### P-4 — Picker "no structure" detail string not surfaced  ·  **PARTIAL (low)**
J-PICK-29. The expanded-row detail always renders the mini-chart
(`PickerView.svelte:1213-1215`) without the legacy "No workout structure
available." fallback text. In practice this is unreachable through normal listing
because `listWorkouts` (`WebFileStore.ts:317-339`) only surfaces files that parse
to a canonical workout with segments, so a structureless workout won't appear in
the table. Informational only.

---

## Summary counts

- Picker rows audited: **30** — OK: **24**, PARTIAL: **5** (J-PICK-11 also flagged
  WRONG, J-PICK-14, J-PICK-16, J-PICK-29, J-PICK-30 cosmetic), WRONG: **1**
  (J-PICK-11).
- Builder rows audited: **39** — OK: **35**, PARTIAL: **4** (J-BLD-28, J-BLD-31,
  J-BLD-37, + assumed-OK zwo/fit parsing out of scope).
- Import-via-picker rows (J-IMP-11..14): **4** — all OK.

**Top defects:**
1. **P-1 (WRONG)** — Escape in an empty picker search box closes the whole picker;
   legacy clears+blurs and never closes from search.
2. **B-1 (PARTIAL/deferred)** — builder chart drag-to-reorder is wired in the chart
   DOM + backend but never executed; reorder only via toolbar buttons.
3. **B-2 (PARTIAL/deferred)** — text-event marker drag is click-select only (no 15s
   snap move); offset still editable via stepper.
4. **P-2 (PARTIAL)** — `j`/`k` don't navigate a focused zone/duration filter (native
   arrows still work; legacy also bound j/k + forced a `change`).
5. **P-3 (PARTIAL/deferred)** — picker has no schedule mode (Enter→schedule,
   schedule Esc→planner).

No data-loss defects found: delete/clone/save trash-first semantics, rename→trash,
overwrite→trash, and the unsaved-changes guard all match legacy.
