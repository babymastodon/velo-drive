# Behavior Audit 04 — Workout Builder

Legacy: `docs/workout-builder.js` (2791), `docs/builder-backend.js` (1789).
New: `web/src/ui/BuilderView.svelte` (1127), `web/src/core/builder-backend.ts` (2009), `web/src/core/chart.ts` (1599), `web/src/ui/PickerView.svelte` (846, builder host).

Scope: vim keymap (`handleBuilderShortcuts`, docs lines 498–958), pointer/drag handlers, toolbar buttons, stepper fields, backend mutations/undo-redo/clipboard/text-event/validate.

Note on backend: `core/builder-backend.ts` is a near-complete port — multi-select (`shiftMoveSelection`, `setSelectionFromCursors`, `setSelectionRange`, `getSelectionSnapshot`, `clampCursorIndex`), clipboard helpers (`buildRawSegmentsFromBlocks`, `getTextEventsForSelection`, `insertTextEventsAtInsertionPoint`, `segmentsToBlocks`), `reorderBlocks`, anchoring, and validate-equivalents all EXIST and are exported. The gaps are almost entirely in **BuilderView.svelte / PickerView.svelte not wiring those backend functions to keys/handlers/buttons**.

---

## Keymap — `handleBuilderShortcuts` (docs/workout-builder.js:498–958)

| # | Legacy item (key/handler/fn) | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | input/textarea/select guard | workout-builder.js:503–509 | Ignore keys while typing in fields | BuilderView.svelte:635–638 | OK | Same guard incl. isContentEditable |
| 2 | `Ctrl/Cmd+A` (no selection) — cursor to start (insertAfter -1) | workout-builder.js:525–532 | Move insertion cursor before first block | **GAP** | GAP | New code returns on any meta+key after undo/redo (line 656); Cmd+A unhandled |
| 3 | `Ctrl/Cmd+E` (no selection) — cursor to end | workout-builder.js:533–538 | Move insertion cursor to last block | **GAP** | GAP | Same as #2 — meta+E not handled |
| 4 | `Ctrl/Cmd+Z` / `U` — undo | workout-builder.js:541–548 | Undo last change | BuilderView.svelte:651–652 | OK | Both forms handled |
| 5 | `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` / `Shift+U` — redo | workout-builder.js:550–559 | Redo | BuilderView.svelte:653–654 | OK | All three forms handled |
| 6 | `Ctrl/Cmd+C` — copy selection | workout-builder.js:568–572 | Copy blocks/text-event to clipboard (ZWO/JSON) | **GAP** | GAP | Falls through meta-guard at :656 and returns; copy never runs |
| 7 | `Ctrl/Cmd+X` — cut selection | workout-builder.js:573–577 | Copy then delete | **GAP** | GAP | Not wired |
| 8 | `Ctrl/Cmd+V` — paste | workout-builder.js:578–582 | Paste ZWO/text-events from clipboard | **GAP** | GAP | Not wired |
| 9 | `P` — paste (plain) | workout-builder.js:583–587 | Paste from clipboard | **GAP** | GAP | `p` not in insertMap; no paste path |
| 10 | `Ctrl/Cmd+Insert` — copy | workout-builder.js:565–566,588–592 | Copy | **GAP** | GAP | Insert-key clipboard absent |
| 11 | `Shift+Insert` — paste | workout-builder.js:561–562,593–597 | Paste | **GAP** | GAP | Absent |
| 12 | `Shift+Delete` — cut | workout-builder.js:563–564,598–602 | Cut | **GAP** | GAP | Absent |
| 13 | `Shift+H`/`Shift+L`/`Shift+ArrowLeft`/`Shift+ArrowRight` — extend selection (shiftMoveSelection) | workout-builder.js:604–619 | Grow/shrink multi-block selection by cursor | **GAP** | GAP | New keydown bails on any meta/ctrl/alt at :656 but Shift is allowed; however no Shift+H/L branch exists. `backend.shiftMoveSelection` exists (builder-backend.ts:493) but is never called from the UI |
| 14 | `Y` (multi-selection) — copy + deselect | workout-builder.js:623–629 | Copy multi-selection then clear | **GAP** | GAP | No `y` insert/copy branch (only redo via Ctrl+Y) |
| 15 | `R` — insert Recovery (Z1) | workout-builder.js:638–641 | Insert steady 55% 5min, select | BuilderView.svelte:664–671 (insertMap.r) | OK | insertSpec(spec,true) |
| 16 | `E` — insert Endurance (Z2) | workout-builder.js:642–645 | Insert steady 70% | BuilderView.svelte:665 (insertMap.e) | OK | Note: legacy Cmd+E was cursor-to-end (#3); bare E ok |
| 17 | `T` — insert Tempo (Z3) | workout-builder.js:646–649 | Insert steady 85% | BuilderView.svelte:665 | OK | |
| 18 | `S` — insert Threshold (Z4) | workout-builder.js:650–653 | Insert steady 95% | BuilderView.svelte:665 | OK | |
| 19 | `V` — insert VO2Max (Z5) | workout-builder.js:654–657 | Insert steady 110% | BuilderView.svelte:665 | OK | |
| 20 | `A` — insert Anaerobic (Z6) | workout-builder.js:658–661 | Insert steady 125% | BuilderView.svelte:666 | OK | |
| 21 | `W` — insert Warmup (rampUp) | workout-builder.js:662–665 | Insert contextual warmup ramp | BuilderView.svelte:666 | OK | backend buildContextualRampBlock used |
| 22 | `C` — insert Cooldown (rampDown) | workout-builder.js:666–669 | Insert contextual cooldown ramp | BuilderView.svelte:666 | OK | |
| 23 | `I` — insert Intervals | workout-builder.js:670–673 | Insert 6×60/60 1.1/0.55 | BuilderView.svelte:666 | OK | |
| 24 | `F` — insert Freeride | workout-builder.js:674–677 | Insert freeride 5min | BuilderView.svelte:666 | OK | |
| 25 | `X` — insert Text event | workout-builder.js:678–681 | Add text event at cursor, select it | BuilderView.svelte:666 → insertSpec→insertTextEvent (:262,270) | OK | |
| 26 | `D` (with selection) — cut | workout-builder.js:683,691–698 | `d` = cut selection (copy+delete) | BuilderView.svelte:673–680 | **PARTIAL** | New `d` calls `deleteSelected()` (plain delete) — legacy `d` does `cutSelectionToClipboard()`. No clipboard, so selection is lost not copied |
| 27 | `Delete`/`Backspace` (with selection) — delete | workout-builder.js:683,694–697 | Delete selected block(s) | BuilderView.svelte:673,680 | OK | |
| 28 | `Backspace` (no selection) — delete block before cursor | workout-builder.js:705–711 | Select prev block, delete | BuilderView.svelte:683–685 | OK | |
| 29 | `Delete` (no selection) — delete block after cursor | workout-builder.js:712–718 | Select next block, delete | BuilderView.svelte:686–688 | OK | |
| 30 | `D` (text-event selected) — delete text event | workout-builder.js:684–689 | Delete selected text event | BuilderView.svelte:674–678 | OK | |
| 31 | `Escape` (with selection) — deselect | workout-builder.js:724–733 | Clear block/text-event selection | BuilderView.svelte:694–700 | OK | |
| 32 | `Escape` (no selection) — back | workout-builder.js:735–740 | onRequestBack() | BuilderView.svelte:702–707 | OK | |
| 33 | `Enter` (with selection) — deselect | workout-builder.js:724–733 | Clear selection | BuilderView.svelte:694–700 | OK | |
| 34 | `Enter` (no selection) — select block at cursor | workout-builder.js:741–756 | Select block at insertion cursor | BuilderView.svelte:708–714 | OK | |
| 35 | `Space` (single selection) — switch insert side | workout-builder.js:770–778 | Toggle insertAfter to start/end of selected block | BuilderView.svelte:797–802 | **PARTIAL** | Single-selection case OK; multi-selection Space branch (legacy :779–784) missing |
| 36 | `Space` (multi selection) — switch insert side first/last | workout-builder.js:779–784 | Toggle insert to first-1 / last of range | **GAP** | GAP | New Space is only reached in single+block branch (:746 returns if !single); multi-select Space unhandled |
| 37 | `Home` (no selection) — cursor to start | workout-builder.js:796–800 | insertAfter -1 | BuilderView.svelte:725 | OK | merged with `g` |
| 38 | `End` (no selection) — cursor to end | workout-builder.js:802–806 | insertAfter last | BuilderView.svelte:726 | OK | merged with `$` |
| 39 | `g` (no selection) — cursor to start | workout-builder.js:808–813 | insertAfter -1 | BuilderView.svelte:725 | OK | |
| 40 | `$` (no selection) — cursor to end | workout-builder.js:814–819 | insertAfter last | BuilderView.svelte:726 | OK | |
| 41 | `H`/`ArrowLeft` (no selection) — cursor left | workout-builder.js:820–831 | Move insertion cursor -1 | BuilderView.svelte:727–730 | OK | |
| 42 | `L`/`ArrowRight` (no selection) — cursor right | workout-builder.js:832–843 | Move insertion cursor +1 | BuilderView.svelte:731–734 | OK | |
| 43 | `J`/`ArrowDown` (no selection) — power down around cursor | workout-builder.js:844–864 | applyPowerUpdatesAroundCursor -step | BuilderView.svelte:735–741 | OK | Shift scales ×5 (:719) |
| 44 | `K`/`ArrowUp` (no selection) — power up around cursor | workout-builder.js:844–864 | applyPowerUpdatesAroundCursor +step | BuilderView.svelte:735–741 | OK | |
| 45 | multi-selection guard (`!singleSelection` return) | workout-builder.js:868–870 | Block per-attr edits when multi-selected | BuilderView.svelte:746 | OK | `if (!single \|\| !block) return` |
| 46 | `H`/`ArrowLeft` (single sel) — duration down | workout-builder.js:930–938 | Decrease block/on duration (×5 w/ Shift) | BuilderView.svelte:783–786 | OK | |
| 47 | `L`/`ArrowRight` (single sel) — duration up | workout-builder.js:939–947 | Increase duration | BuilderView.svelte:787–790 | OK | |
| 48 | `J`/`ArrowDown` (single sel) — power down | workout-builder.js:948–952 | handlePowerChange -step (steady/ramp/interval; freeride no-op) | BuilderView.svelte:791–793 | OK | atEnd logic preserved |
| 49 | `K`/`ArrowUp` (single sel) — power up | workout-builder.js:953–957 | handlePowerChange +step | BuilderView.svelte:794–796 | OK | |
| 50 | window keydown listener registration | workout-builder.js:960 | Attach handler | BuilderView.svelte:945 `<svelte:window onkeydown>` | OK | |

---

## Pointer / Drag — `handleChartPointerDown/Move/Up` (docs/workout-builder.js:2385–2770)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 51 | `DRAG_THRESHOLD_PX = 4` | workout-builder.js:42 | Click-vs-drag threshold | BuilderView.svelte:50 | OK | |
| 52 | pointerdown: blur inputs | workout-builder.js:2386,2772 | blurBuilderInputs() | **GAP** | Low | New down has no blur-inputs step |
| 53 | pointerdown shiftKey → preventDefault, no drag | workout-builder.js:2387–2390 | Reserve shift+click | BuilderView.svelte:440–443 | OK | |
| 54 | text-event hit → setPointerCapture + drag offset | workout-builder.js:2398–2435 | Begin dragging text-event horizontally (snap 15s) | BuilderView.svelte:450–462 | **PARTIAL** | New code only selects the text event on pointerdown; no drag/offset adjust. Documented simplification (drag = click-select) |
| 55 | text-event drag move (snap to 15s, clamp) | workout-builder.js:2598–2605 | Update offsetSec while dragging | **GAP** | Med | No `handle==='text-event'` branch in new pointerMove |
| 56 | text-event pointerup: click vs drag → select | workout-builder.js:2723–2735 | Select if !didDrag | BuilderView.svelte:457 (down only) | PARTIAL | Selection happens on down, no up handling needed since no drag |
| 57 | block drag-handle resolution (data-drag-handle) | workout-builder.js:2437–2447 | Find top/right/move handle, blockIndex/segIndex | BuilderView.svelte:464–471 | OK | |
| 58 | maxY computation (getScaledMaxY, peak) | workout-builder.js:2467–2479 | Compute chart Y scale for power mapping | BuilderView.svelte:484–494 | OK | Identical formula |
| 59 | ramp 3-region detect (left/middle/right by x1..x2 thirds) | workout-builder.js:2482–2494 | Determine which ramp end to edit | BuilderView.svelte:498–510 | OK | Identical thirds logic |
| 60 | pointerdown selects block + sets insertAfter via computeInsertIndexFromPoint | workout-builder.js:2499–2508 | Select + set insertion side | BuilderView.svelte:512 (setSelectedBlock only) | **PARTIAL** | New down does NOT call computeInsertIndexFromPoint to set insert side; `computeInsertIndexFromPoint` is absent entirely |
| 61 | dragState capture (tStart/tEnd/blockStartSec/startLow/High/Power/onPower/offPower) | workout-builder.js:2513–2539 | Store drag baseline | BuilderView.svelte:514–532 | **PARTIAL** | New dragState omits tEnd, blockStartSec, startPower, startOnPower, startOffPower, ftp-derived blockTimings; recomputed in move instead |
| 62 | `handle==='top'` steady power drag | workout-builder.js:2647–2651 | Set powerRel from Y | BuilderView.svelte:570–574 | OK | |
| 63 | `handle==='top'` ramp left/right/middle drag | workout-builder.js:2653–2667 | Edit low/high/both (middle shifts both by delta) | BuilderView.svelte:575–587 | OK | Same midpoint delta math |
| 64 | `handle==='top'` intervals on/off power drag | workout-builder.js:2669–2679 | Edit on/off power by seg parity | BuilderView.svelte:588–592 | OK | New drops the `!== start` equality guard (harmless) |
| 65 | `handle==='right'` duration drag (steady/freeride/ramp) | workout-builder.js:2682–2694 | snapDurationSec(timeSec - tStart) | BuilderView.svelte:596–602 | OK | |
| 66 | `handle==='right'` intervals on/off duration drag (repIndex scale) | workout-builder.js:2696–2716 | Per-rep on/off duration math | BuilderView.svelte:603–617 | OK | blockStartSec recomputed inline; same formula |
| 67 | `handle==='move'` block reorder drag (insert preview) | workout-builder.js:2607–2642 | Live insert-after preview while dragging block body | **GAP** | Med | No `handle==='move'` branch in new pointerMove. `reorderBlocks` exists in backend (builder-backend.ts:934) but never invoked. Documented simplification (reorder drag = click-select). Move-block still possible via ◀ ▶ buttons |
| 68 | move reorder commit on pointerup | workout-builder.js:2738–2739 | reorderBlocks(from, insertAfter) | **GAP** | Med | New pointerup just clears dragState (:621–630); no reorder, no click-select-on-up, no computeInsertIndexFromPoint |
| 69 | pointerup click (!didDrag) → select block + set insert side | workout-builder.js:2740–2751 | Select + insert side on a click | BuilderView.svelte:621–626 | **PARTIAL** | Click-select already done in pointerDown (:512); up does not re-run computeInsertIndexFromPoint to set insertAfter side |
| 70 | timelineLock during right-drag | workout-builder.js:2544–2546,2757–2759 | Freeze timeline width while resizing | BuilderView.svelte:534,623 | OK | |
| 71 | setPointerCapture + pointermove/up/cancel listeners | workout-builder.js:2549–2551,2767–2769 | Register/cleanup drag listeners | BuilderView.svelte:535–537,627–629 | OK | |
| 72 | `wb-dragging` body class + drag dataset attrs | workout-builder.js:2542–2548,2761–2766 | Visual drag affordance | **GAP** | Low | New code sets no `wb-dragging` class or `data-drag-*` attrs |
| 73 | `computeInsertIndexFromPoint` (interval/segment midpoint → insert side) | workout-builder.js:1538–1574 | Map click-x to insert-after index | **GAP** | Med | Function not ported; affects #60/#69 — clicking a block doesn't set which side new inserts land |

---

## Toolbar buttons (`buttonSpecs` + actions) (docs/workout-builder.js:223–368, 142–219)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 74 | 11 insert buttons (recovery…textevent) render + click insert | workout-builder.js:223–368 | Insert block, selectOnInsert:false | BuilderView.svelte:124–137,1040–1060 (onclick insertSpec(spec,false)) | OK | All 11 specs identical incl. icons/zoneClass/shortLabel |
| 75 | responsive labels (updateSteadyLabels: <950 icon, <1260 short) | workout-builder.js:374–406 | Show/hide labels by width | BuilderView.svelte:78–99,1059 | OK | ResizeObserver port |
| 76 | move-left button (moveSelectedBlock -1) | workout-builder.js:142–150 | Move selected block left | BuilderView.svelte:961–963 | OK | shown only when single selection |
| 77 | move-right button (moveSelectedBlock +1) | workout-builder.js:151–159 | Move selected block right | BuilderView.svelte:964–966 | OK | |
| 78 | delete-block button | workout-builder.js:160–168 | deleteSelectedBlock | BuilderView.svelte:968–972 | OK | |
| 79 | undo button | workout-builder.js:173–181 | undoLastChange + disabled state | BuilderView.svelte:973–975 | OK | disabled bound to history.canUndo |
| 80 | redo button | workout-builder.js:183–191 | redoLastChange + disabled state | BuilderView.svelte:976–978 | OK | |
| 81 | copy button | workout-builder.js:193–201 | copySelectionToClipboard | BuilderView.svelte:979–981 | **GAP** | Button rendered + disabled-bound but has NO onclick — inert |
| 82 | paste button | workout-builder.js:203–211 | pasteFromClipboard | BuilderView.svelte:982–984 | **GAP** | Rendered but no onclick — inert |

---

## Stepper fields (`createStepperField` + `buildBlockFieldConfigs`) (docs/workout-builder.js:1725–2091)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 83 | steady fields: Duration / Power / Cadence | workout-builder.js:1733–1770 | Stepper configs for steady | BuilderView.svelte:224–227 | OK | |
| 84 | warmup/cooldown fields: Duration / Power Low / Power High / Cadence | workout-builder.js:1771–1822 | Ramp configs | BuilderView.svelte:228–232 | OK | |
| 85 | freeride field: Duration only | workout-builder.js:1823–1832 | Freeride config | BuilderView.svelte:233–234 | OK | |
| 86 | intervals fields: Reps/On/Power/Cad/Off/Power/Cad (hideLabel on power+cadence) | workout-builder.js:1833–1925 | 7 interval configs | BuilderView.svelte:235–244 | OK | hideLabel preserved |
| 87 | stepper +/- buttons (duration step via getDurationStep; allowEmpty fallback to defaultValue) | workout-builder.js:2027–2065 | Increment/decrement | BuilderView.svelte:807–823 (stepperAdjust) | OK | Same dynamic duration step + empty-fallback |
| 88 | input change/Enter commit (allowEmpty→null) | workout-builder.js:2067–2073 | Commit typed value | BuilderView.svelte:824–833,1082–1083 | OK | |
| 89 | stepper +/- titles per kind (duration/power/cadence/timestamp) | workout-builder.js:1999–2011 | Tooltips | BuilderView.svelte:834–840 (stepperTitle) | OK | |
| 90 | text-event Duration stepper (kind=duration) | workout-builder.js:428–438 | Edit text-event duration | BuilderView.svelte:1005–1015 | **PARTIAL** | New +/- use step of 1s (hardcoded), legacy uses getDurationStep(); input commit ok |
| 91 | text-event Offset stepper (kind=timestamp, step 15) | workout-builder.js:440–451 | Edit text-event start offset | BuilderView.svelte:1016–1026 | OK | step 15 |
| 92 | text-event Text input | workout-builder.js:453–467,492–496 | Edit cue text | BuilderView.svelte:1027–1030 | OK | |
| 93 | meta inputs: Name / Source / Description (input listeners) | workout-builder.js:75–98,486–490 | Edit meta, autoGrow desc | BuilderView.svelte:1101–1123 | OK | autoGrow port (:359) |
| 94 | hidden sourceURL input | workout-builder.js:82–84 | Carry URL through state | BuilderView.svelte:60 urlValue ($state) | OK | No DOM input; held in state |

---

## Backend functions (docs/builder-backend.js)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 95 | setDefaultBlocks (warmup/steady/intervals/cooldown) | builder-backend.js:161–187 | Default workout | builder-backend.ts (exported, called BuilderView.svelte:865) | OK | |
| 96 | recomputeDerived (segments+metrics+zone) | builder-backend.js:189–223 | Recompute on change | builder-backend.ts:307+ (BuilderView snapshot :143) | OK | |
| 97 | setSelectedBlock / deselectBlock | builder-backend.js:237–272 | Single selection | builder-backend.ts (used :320,:332) | OK | |
| 98 | setInsertAfterIndex / Override | builder-backend.js:153–155,274–289 | Insert cursor | builder-backend.ts (used throughout BuilderView) | OK | |
| 99 | setSelectionRange | builder-backend.js:291–317 | Shift-click range select | builder-backend.ts:414 | **PARTIAL** | Ported but NOT called by UI (no shift-click in chart, see #103) |
| 100 | setSelectionFromCursors | builder-backend.js:325–361 | Cursor-based multi-select | builder-backend.ts:451 | PARTIAL | Ported, only reachable via shiftMoveSelection which UI never calls |
| 101 | shiftMoveSelection | builder-backend.js:363–411 | Keyboard range grow/shrink | builder-backend.ts:493 | **GAP (unwired)** | Exists but no Shift+H/L key path (#13) |
| 102 | getSelectionSnapshot / getSelectedIndicesSorted | builder-backend.js:132–139,413–415 | Selection introspection | builder-backend.ts:255,exported | OK | |
| 103 | handleBlockSelectionFromChart shiftKey range | workout-builder.js:1362–1390 | Shift-click chart to extend selection | BuilderView.svelte:419–425 | **GAP** | New onSelectBlock ignores shiftKey (signature `(idx)` only); always single-select. chart.ts onSelectBlock may not pass shift |
| 104 | startHistoryGroup / recordHistorySnapshot | builder-backend.js:417–500 | Undo grouping | builder-backend.ts (used :321,:331) | OK | |
| 105 | undoLastChange / redoLastChange / resetHistory / getHistoryStatus | builder-backend.js:502–528 | Undo/redo stacks | builder-backend.ts (used :297,:302,:855) | OK | |
| 106 | createHistorySnapshot / applyHistorySnapshot (meta+blocks+textEvents+sel) | builder-backend.js:423–455 | Snapshot model | builder-backend.ts | OK | |
| 107 | buildBlockTimings / buildSegmentTimings | builder-backend.js:530–559 | Timeline math | builder-backend.ts (used in drag/insert) | OK | |
| 108 | buildRawSegmentsFromBlocks | builder-backend.js:561–588 | Blocks → ZWO raw segments | builder-backend.ts:695 | OK | |
| 109 | segmentsToBlocks (interval re-detection) | builder-backend.js:590–744 | Raw segments → blocks (merge repeated steady→intervals) | builder-backend.ts (used :928) | OK | |
| 110 | reorderBlocks | builder-backend.js:789–810 | Move block to position | builder-backend.ts:934 | **PARTIAL** | Ported but unwired (no move-drag, see #67/#68) |
| 111 | commitBlocks (+syncTextEventsToBlocks) | builder-backend.js:812–835 | Commit + re-anchor events | builder-backend.ts (used :928) | OK | |
| 112 | applyBlockAttrUpdate (+ramp kind flip +syncAdjacentRampLinks) | builder-backend.js:837–879 | Edit block attr | builder-backend.ts (used :257) | OK | |
| 113 | deleteSelectedBlock (multi) | builder-backend.js:881–914 | Delete selection, set next cursor | builder-backend.ts (used :289) | OK | |
| 114 | moveSelectedBlock | builder-backend.js:916–934 | Swap with neighbor | builder-backend.ts (used :293) | OK | |
| 115 | insertBlockAtInsertionPoint (+contextual ramp) | builder-backend.js:1393–1410,1522–1575 | Insert single block, contextual ramps | builder-backend.ts (used :266) | OK | buildContextualRampBlock ported |
| 116 | insertBlocksAtInsertionPoint (+adjacent ramp adjust +textEvents) | builder-backend.js:1412–1450 | Insert multiple + paste text events | builder-backend.ts | **PARTIAL** | Function ported; the paste path that supplies `textEvents` is unwired (no paste in UI) |
| 117 | adjustAdjacentRampsForSteady | builder-backend.js:1482–1520 | Snap ramps to inserted steady | builder-backend.ts | OK | |
| 118 | syncAdjacentRampLinks | builder-backend.js:1613–1640 | Keep touching ramp ends linked | builder-backend.ts | OK | |
| 119 | applyPowerUpdatesAroundCursor | builder-backend.js:1642–1712 | Power-edit blocks either side of cursor | builder-backend.ts (used :740) | OK | |
| 120 | text-event normalize/anchor (normalizeTextEvent, anchorTextEventToBlocks, resolveOffsetFromAnchor, findSegmentAtTime, findBlockById, syncTextEventsToBlocks) | builder-backend.js:1106–1308 | Anchor cues to segments so they follow edits | builder-backend.ts (used via setTextEvents/updateTextEvent) | OK | Full anchoring ported |
| 121 | addTextEvent / updateTextEvent / deleteTextEvent / getTextEvents / setTextEvents | builder-backend.js:87–130 | Text-event CRUD | builder-backend.ts (used :283,:309,:676,:929) | OK | |
| 122 | insertTextEventsAtInsertionPoint (paste) | builder-backend.js:1310–1342 | Paste text events at cursor | builder-backend.ts:1499 | PARTIAL | Ported, unwired (paste only) |
| 123 | buildTextEventsForInsertion / getTextEventsForSelection (copy) | builder-backend.js:1344–1385 | Slice/offset events for clipboard | builder-backend.ts:1568 | PARTIAL | Ported, unwired (copy only) |
| 124 | getCanonicalState (strip anchors, resolve) | builder-backend.js:48–57 | Export saveable workout | builder-backend.ts (used getState :879) | OK | |
| 125 | clampDuration/clampRel/clampRepeat/clampPowerPercent/snapPowerRel/snapDurationSec/getDurationStep | builder-backend.js:766–1097 | Value clamps & snapping | builder-backend.ts (used throughout) | OK | |
| 126 | getBlockDurationSec/SteadyPower/Cadence/RampLow/RampHigh/IntervalParts/getBlockStartEnd | builder-backend.js:936–995,1577–1611 | Block accessors | builder-backend.ts (used throughout) | OK | |

---

## Host / lifecycle (docs/workout-builder.js public API + PickerView)

| # | Legacy item | docs file:line | What it does | New impl (web/src file:line) | Status | Notes |
|---|---|---|---|---|---|---|
| 127 | getState (sync meta → canonical) | workout-builder.js:1010–1013 | Export workout | BuilderView.svelte:877–880 | OK | |
| 128 | validateForSave (name/source/desc/blocks + error styling) | workout-builder.js:1070–1132 | Validate before save | BuilderView.svelte:889–912 | OK | Same 4 checks + field error flags |
| 129 | clearState (reset + default blocks) | workout-builder.js:1034–1051 | New blank workout | BuilderView.svelte:881–883→initDefault | OK | |
| 130 | loadCanonicalWorkout | workout-builder.js:1057–1068 | Load workout into builder | BuilderView.svelte:913–933 | OK | |
| 131 | refreshLayout | workout-builder.js:993–996 | Recompute + autogrow | BuilderView.svelte:884–888 | OK | |
| 132 | restorePersistedStateOrDefault | workout-builder.js:1643–1656 | Restore from storage | **GAP** | Med | Not in BuilderApi; no persisted-state restore on mount |
| 133 | clearPersistedState | workout-builder.js:1600–1612 | Clear saved builder draft | **GAP** | Low | Absent |
| 134 | save-to-storage on every change (saveWorkoutBuilderState) | workout-builder.js:1155–1165, init load 966–989 | Auto-persist in-progress draft to IndexedDB | **GAP** | Med | New builder never persists draft; reload loses unsaved work. `loadWorkoutBuilderState`/`saveWorkoutBuilderState`/`clearWorkoutBuilderState` not imported anywhere in web/src |
| 135 | theme-change re-render (matchMedia) | workout-builder.js:998–1008 | Re-render chart on OS theme flip | **GAP** | Low | No matchMedia listener; chart re-renders only on version bump |
| 136 | ensureChartFocusVisible (auto-scroll to selection/cursor) | workout-builder.js:1247–1310 | Keep selected block/cursor in view | **GAP** | Med | Not ported; chart preserves scrollLeft only (BuilderView.svelte:416). Keyboard navigation off-screen won't auto-scroll |
| 137 | Back button (header) → onRequestBack | workout-builder.js (onRequestBack) | Return to library | PickerView.svelte:451–463 onclick onBuilderBack | OK | |
| 138 | Save button → validate + save file | n/a (host) | Save workout | PickerView.svelte:328–349,589–604 | OK | Incl. rename-to-trash |
| 139 | Import TrainerDay button | n/a (host) | Load workout from TrainerDay URL | PickerView.svelte:559–572 | **GAP** | Button rendered, NO onclick — inert |
| 140 | Upload File button (.zwo/.fit) | n/a (host) | Import file into builder | PickerView.svelte:574–587 | **GAP** | Button rendered, NO onclick — inert |

---

## Gaps

### High
- **Clipboard entirely missing (rows 6–12, 14, 26, 81, 82, 116, 122, 123).** No copy/cut/paste anywhere: `Ctrl/Cmd+C/X/V`, `P`, `Ctrl+Insert`/`Shift+Insert`/`Shift+Delete`, multi-select `Y`, and the toolbar Copy/Paste buttons (no onclick). The legacy `d` key cut-to-clipboard is downgraded to a plain delete (row 26 — data loss vs. copy). Backend ZWO/text-event encode/decode helpers exist but nothing calls them. Note: `web/src` has no `parseZwoXmlToCanonicalWorkout`/`canonicalWorkoutToZwoXml` import in BuilderView, so paste would also need that wiring.
- **Multi-block selection unreachable (rows 13, 36, 99–103).** `Shift+H/L/Arrows` (shiftMoveSelection) and shift-click range-select on the chart are not wired; the chart `onSelectBlock` callback drops the `shiftKey` flag. Backend supports it fully — pure UI gap. All multi-select-dependent features (multi Space, multi `Y` copy) are therefore dead.

### Med
- **Block-reorder drag (rows 67, 68, 73, 110).** `handle==='move'` live preview + pointerup `reorderBlocks` + `computeInsertIndexFromPoint` not ported. Documented simplification; move still possible via ◀ ▶ buttons. `backend.reorderBlocks` exists but unused.
- **Text-event drag (rows 54–56).** Dragging a cue horizontally to retime is gone; pointerdown only selects it. Documented simplification.
- **Cmd+A / Cmd+E cursor-to-start/end (rows 2, 3).** Meta+A/E early returns at BuilderView:656 before reaching these; cursor jump shortcuts lost (Home/End/g/$ still work).
- **Draft auto-persist + restore (rows 132, 134, 136).** No `saveWorkoutBuilderState`/restore — in-progress builder work is not persisted across reloads (legacy saved on every change). `ensureChartFocusVisible` auto-scroll also missing, so keyboard editing of off-screen blocks won't scroll them into view.
- **Import TrainerDay / Upload File (rows 139, 140).** Both header buttons are rendered but inert (no onclick). Documented as expected-inert.
- **Insert-side on click (rows 60, 69, 73).** Clicking a block no longer sets which side (`insertAfterOverrideIndex`) new inserts land on, because `computeInsertIndexFromPoint` wasn't ported; only plain block selection happens.

### Low
- Row 26 severity overlaps High (data-loss flavor) — listing the rest: pointerdown blur-inputs (52), `wb-dragging` class + `data-drag-*` attrs (72), text-event duration stepper uses fixed 1s step instead of dynamic getDurationStep (90), theme-change chart re-render (135), clearPersistedState (133).
