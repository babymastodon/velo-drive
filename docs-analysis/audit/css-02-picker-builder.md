# CSS Coverage Audit — `docs/workout-picker.css` (picker library + workout builder)

Scope: `docs/workout-picker.css` (1349 lines). The legacy CSS is re-hosted verbatim/global, so the rules are byte-identical; this audit checks **element/selector coverage** — does the NEW DOM emit a matching element so each rule applies?

New DOM sources cross-referenced:
- `web/src/ui/PickerView.svelte` (modal/header/controls/table/rows/expanded/footer; re-hosts legacy `#workoutPickerOverlay` / `#workoutPickerModal`)
- `web/src/ui/BuilderView.svelte` (`wb-*` stats/toolbar/chart-card/block-editor/text-event/meta)
- `web/src/core/chart.ts` — `renderMiniWorkoutGraph` (expanded-row mini chart) + `renderBuilderWorkoutGraph` (builder chart: bands, segments, drag handles, text-event markers, insert line)

Status legend: **OK** = matching element exists in new DOM; **PARTIAL** = element exists but a variant/state/modifier is never produced; **GAP** = no matching element in the in-scope new DOM.

---

## Picker: overlay / modal / mode toggles

| # | Selector | css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|----------|--------------------------|---------------------------------|--------|-------|
| 1 | `.workout-picker-overlay` | 3 | `#workoutPickerOverlay` | OverlayModal `overlayClass="workout-picker-overlay picker-mode"` (PickerView.svelte:817) | OK | Rendered by OverlayModal wrapper. |
| 2 | `.workout-picker-overlay:not(.planner-mode) .planner-only` | 13 | planner-only nodes hidden in picker mode | PickerView.svelte:817 (no `planner-mode` class) — no `.planner-only` descendants emitted | PARTIAL | New overlay is never `.planner-mode` (always picker-mode), and no element carries `.planner-only`. Rule is inert: nothing to hide. Acceptable — planner-mode picker is out of the Svelte scope. |
| 3 | `.workout-picker-overlay.planner-mode .picker-only` | 17 | picker-only nodes hidden in planner mode | header/root/table/footers carry `picker-only` (PickerView.svelte:829,1016,1031,1214,1223) | PARTIAL | `.picker-only` IS emitted, but the `.planner-mode` ancestor never is, so this hide-rule never fires. Inert by design. |
| 4 | `.workout-picker-modal` | 21 | `#workoutPickerModal` | `#workoutPickerModal` (PickerView.svelte:822) | OK | Same id+class. |
| 5 | `.workout-picker-modal--builder .workout-picker-title` | 72 | title hidden in builder mode | `class:workout-picker-modal--builder={builderMode}` (824) + title (847) | OK | Toggled by `builderMode`. |
| 6 | `.workout-picker-modal:not(.--builder) .picker-footer-builder` | 612 | hide builder footer in library mode | `#builderFooter.picker-footer-builder` (1223) | OK | Modifier toggled at 824. |
| 7 | `.workout-picker-modal.--builder .picker-footer-builder` | 617 | show builder footer in builder mode | same (1223) | OK | — |
| 8 | `.workout-picker-modal.--builder .workout-picker-table-wrapper, .picker-footer-library, .workout-picker-summary, .picker-empty-state` | 1337 | hide library chrome in builder mode | wrapper(1031), footer-library(1214), summary(1220), empty-state(1033) | OK | All four targets present; modifier at 824. |

## Picker: header / title / controls

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 9 | `.workout-picker-header` | 38 | `header` | `<header class="workout-picker-header picker-only">` (829) | OK | — |
| 10 | `.workout-picker-title` | 52 | `#workoutPickerTitle` | `#workoutPickerTitle` (847) | OK | — |
| 11 | `.workout-picker-header-main` | 63 | title wrapper | div (846) | OK | — |
| 12 | `.workout-picker-header-actions` | 76 | back-btn wrapper | div (830) | OK | Contains builder back-btn. |
| 13 | `.workout-picker-controls` | 82 | controls wrapper | div (852) | OK | — |
| 14 | `.workout-picker-summary` | 340 | `#pickerSummary` | `#pickerSummary.workout-picker-summary` (1220) | OK | Lives inside footer (legacy parity). |

## Picker: search box (+ states)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 15 | `.picker-search-wrap` | 93 | search wrapper | div.picker-search-wrap (854) | OK | — |
| 16 | `.picker-search-icon` | 101 | leading SVG | `<svg class="picker-search-icon">` (858) | OK | — |
| 17 | `.picker-search-wrap input[type="search"]` | 117,266 | `#pickerSearchInput` | `#pickerSearchInput type="search"` (863) | OK | — |
| 18 | `…input::-webkit-search-cancel-button` | 136 | native cancel X | same input | OK | UA pseudo on the same input. |
| 19 | `.picker-search-clear` | 140 | clear button | `button.picker-search-clear` (872) | OK | — |
| 20 | `.picker-search-clear svg` | 161 | clear icon | svg (878) | OK | — |
| 21 | `.picker-search-clear:hover/:active/:focus` | 166 | clear interactions | same button | OK | States reachable. |
| 22 | `.picker-search-clear.visible` | 176 | shown when query present | `class:visible={!!searchTerm.trim()}` (873) | OK | — |
| 23 | `.picker-search-wrap.picker-search-active .picker-search-clear` | 182 | active-search clear shown | `class:picker-search-active` (855) | OK | Toggled on the wrap. |
| 24 | `.picker-search-wrap:focus-within …` | 188 | focus ring | wrap+input/icon | OK | `:focus-within` reachable. |
| 25 | `.picker-search-wrap.picker-search-active .picker-search-icon/input` | 194 | CTA-colored active search | wrap active (855) | OK | — |
| 26 | `…active .picker-search-clear` | 201 | clear color when active | same | OK | — |
| 27 | `…active input::placeholder` | 205 | placeholder color | same input | OK | — |
| 28 | `…active input:-webkit-autofill…` | 210 | autofill override | same input | OK | UA state on same input. |
| 29 | `.picker-search-wrap.picker-search-active:focus-within …` | 334 | active + focus | same | OK | — |
| 30 | `.workout-picker-controls > input[type="search"]` | 251 | a **direct-child** bare search input | search input is nested in `.picker-search-wrap`, NOT a direct child (854→863) | GAP | Legacy also wraps it (`#pickerSearchInput` inside `.picker-search-wrap`), so the `>` child combinator never matched in legacy either. Dead rule in both. Severity: none (legacy-dead). |

## Picker: filter selects (+ active/hover/focus)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 31 | `.workout-picker-controls select` | 273 | zone/duration selects | `#pickerZoneFilter` (883), `#pickerDurationFilter` (899) | OK | — |
| 32 | `select.picker-filter-active` | 297 | highlighted active filter | `class:picker-filter-active={!!zoneValue / !!durationValue}` (886,902) | OK | — |
| 33 | `select.picker-filter-active` bg-image (white chevron) | 301 | active chevron | same | OK | Inline data-URI; applies. |
| 34 | `.workout-picker-controls select option` | 307 | `<option>` | options (891-916) | OK | — |
| 35 | `select:hover` | 312 | hover | same selects | OK | — |
| 36 | `input[type="search"]:focus, select:focus, input[type="number"]:focus` | 316 | focus reset | search + selects present; **no `input[type=number]`** lives directly under `.workout-picker-controls` | PARTIAL | search/select branches OK; the `input[number]` branch has no target inside `.workout-picker-controls` (builder steppers live in `.wb-block-editor`, not here). Number branch inert. |
| 37 | `select.picker-filter-active:focus` | 324 | active+focus | same | OK | — |
| 38 | `select.picker-filter-active:hover` | 329 | active+hover | same | OK | — |

## Picker: table / sort headers

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 39 | `.workout-picker-table-wrapper` | 346 | scroll wrapper | div (1031) | OK | — |
| 40 | `.workout-picker-table` | 356 | `<table>` | table (1041) | OK | — |
| 41 | `.workout-picker-table thead` | 362 | sticky head | thead (1042) | OK | — |
| 42 | `th, td` (padding/border) | 370 | header+body cells | th/td (1044-1071) | OK | — |
| 43 | `.workout-picker-table th` | 378 | header cells | th (1044-1050) | OK | — |
| 44 | `th[data-sort-key]` | 387 | sortable headers | `th data-sort-key="name|if|tss|duration|kjAdj"` (1044,1047-1050) | OK | 5 sortable th present (Zone/Source th have no data-sort-key — matches legacy). |
| 45 | `th[data-sort-key]:hover` | 391 | underline on hover | same | OK | Hover reachable. |
| 46 | `th[data-sort-key]::after` | 395 | sort-arrow slot | same | OK | Empty content placeholder. |
| 47 | `th.sorted-asc::after` (▲) | 401 | ascending arrow | `class={sortClass(key)}` → `'sorted-asc'` (1044,271-274) | OK | Emitted when active+asc. |
| 48 | `th.sorted-desc::after` (▼) | 405 | descending arrow | `sortClass` → `'sorted-desc'` | OK | Emitted when active+desc. |
| 49 | `tbody tr:last-child td` | 409 | last-row border off | tbody rows (1054+) | OK | Structural; applies to last `<tr>`. |

## Picker: rows / zone dots

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 50 | `.picker-row` | 413 | collapsed data row | `<tr class="picker-row">` (1059) | OK | — |
| 51 | `.picker-row:hover` | 420 | row hover bg | same | OK | Hover reachable on collapsed rows. |
| 52 | `.picker-row:active` | 424 | row press scale | same | OK | — |
| 53 | `.picker-zone-cell` | 428 | zone cell flex | div.picker-zone-cell (1062) | OK | — |
| 54 | `.picker-zone-dot` | 434 | zone dot base | span.picker-zone-dot (1063, 1158) | OK | In row AND expanded stat chip. |
| 55 | `.picker-zone-dot-recovery` | 443 | recovery color | `zoneDotClass()` → `-recovery` (242-251, 1063) | OK | Mapped from zone label. |
| 56 | `.picker-zone-dot-endurance` | 447 | endurance color | `zoneDotClass` → `-endurance` | OK | — |
| 57 | `.picker-zone-dot-tempo` | 451 | tempo color | `-tempo` | OK | — |
| 58 | `.picker-zone-dot-threshold` | 455 | threshold color | `-threshold` | OK | — |
| 59 | `.picker-zone-dot-vo2` | 459 | vo2 color | `-vo2` | OK | — |
| 60 | `.picker-zone-dot-anaerobic` | 463 | anaerobic color | `-anaerobic` | OK | — |
| 61 | `.picker-zone-dot-unknown` | 467 | uncategorized | `zoneDotClass` default → `-unknown` (250) | OK | Reachable for unmapped zones. |

## Picker: expanded row

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 62 | `.picker-expanded-row td` | 471 | expanded row cell bg | `<tr class="picker-expanded-row"><td colspan=7>` (1074) | OK | — |
| 63 | `.picker-expanded` | 478 | expanded container | div.picker-expanded (1076) | OK | Also gets `.picker-expanded-layout`. |
| 64 | `.picker-expanded-collapse-hit` | 487 | top collapse hit-strip | div (1077) | OK | — |
| 65 | `.picker-graph-svg` | 496 | mini-chart `<svg>` | chart.ts:563 (`svg.classList.add('picker-graph-svg')`) — also builder svg 945 | OK | Emitted by renderMiniWorkoutGraph (+builder). |
| 66 | `.picker-expanded-layout` | 503 | column stack | (1076) | OK | — |
| 67 | `.picker-expanded-header` | 512 | header grid | div (1086) | OK | — |
| 68 | `.picker-expanded-title` | 521 | title | div (1087) | OK | — |
| 69 | `.picker-expanded-actions` | 527 | button row | div (1088) | OK | — |
| 70 | `.picker-expanded-main` | 535 | stats+desc row | div (1152) | OK | — |
| 71 | `.picker-expanded-main-left, -main-right` | 542 | columns | divs (1153,1194/1198) | OK | — |
| 72 | `.picker-expanded-main-left .wb-stats-row` | 551 | chips full width | `.wb-stats-row` inside left (1154) | OK | — |
| 73 | `.picker-expanded-chart` | 556 | chart row | div (1202) | OK | — |
| 74 | `.picker-graph` | 560 | chart host | `div.picker-graph use:miniChart` (1203) | OK | — |
| 75 | `.picker-detail` | 567 | (legacy detail col) | — | GAP | No `.picker-detail` element in new expanded markup; right column uses `.picker-expanded-main-right`. Legacy `.picker-detail` only used by the older expanded layout; new code uses the `-expanded-*` layout exclusively. Severity: low (cosmetic legacy leftover; also targeted by @media 692). |
| 76 | `.picker-detail-empty` | 575 | "no description" muted | `.picker-detail-empty` on main-right (1198) AND set by chart.ts:537,547 on empty mini-chart | OK | Class applied in two places. |
| 77 | `.picker-tooltip` | 579 | mini-chart tooltip div | chart.ts:611,1169 (`tooltip.className='picker-tooltip'`) | OK | Created (hidden; `display:none`) in both mini + builder charts. |

## Picker: footer / buttons

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 78 | `.picker-footer` | 594 | footers | `.picker-footer` (1214,1223) | OK | — |
| 79 | `.picker-footer span` | 604 | footer spans | spans (1215,1220,1225/1233) | OK | — |
| 80 | `.picker-footer-builder` | 608 | builder footer | `#builderFooter` (1223) | OK | — |
| 81 | `.picker-close-btn` | 621 | `#workoutPickerCloseBtn` | `#workoutPickerCloseBtn.picker-close-btn` (1001) | OK | — |
| 82 | `.picker-close-btn svg` | 639 | close icon | svg (1007) | OK | — |
| 83 | `.picker-close-btn:hover` | 648 | close hover | same | OK | — |
| 84 | `.select-workout-btn` | 653 | select-to-ride btn | `button.select-workout-btn` (1141) | OK | In expanded actions. |
| 85 | `.select-workout-btn:hover` | 671 | hover | same | OK | — |
| 86 | `.select-workout-btn:active` | 675 | press | same | OK | — |
| 87 | `.picker-add-btn` | 758 | `#pickerAddWorkoutBtn` + save btn | `#pickerAddWorkoutBtn.picker-add-btn` (920); `#workoutBuilderSaveBtn.picker-add-btn` (984) | OK | — |
| 88 | `.picker-add-btn:hover` | 776 | hover | same | OK | — |
| 89 | `.picker-add-btn:active` | 780 | press | same | OK | — |

## Picker: empty state

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 90 | `.picker-empty-state` | 718 | `#pickerEmptyState` | `#pickerEmptyState` (1033, only when `showEmptyState`) | OK | Only mounted when 0 workouts; inline `display:flex`. |
| 91 | `.picker-empty-message` | 736 | message text | div (1034) | OK | — |
| 92 | `.picker-empty-add-btn` | 740 | `#pickerEmptyAddBtn` | `#pickerEmptyAddBtn` (1035) | OK | — |
| 93 | `.picker-empty-add-btn:hover` | 752 | hover | same | OK | — |

## Picker: responsive @media

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 94 | `@media(max-width:800px){.workout-picker-modal/.picker-graph/.picker-detail/.workout-picker-controls}` | 680 | small-screen layout | modal/graph/controls present; **`.picker-detail` absent** | PARTIAL | 3 of 4 targets present; `.picker-detail` (692) has no element (see #75). |
| 95 | `@media(max-width:1100px){.workout-picker-header/.workout-picker-controls}` | 704 | header stacking | both present (829,852) | OK | — |

---

## Builder: layout / cards

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 96 | `.workout-builder-root` | 787 | `#workoutBuilderRoot` | `#workoutBuilderRoot` (1015) | OK | — |
| 97 | `.workout-builder` | 793 | builder shell | div (1106) | OK | — |
| 98 | `.workout-builder-body` | 801 | body column | div (1107) | OK | — |
| 99 | `.wb-top-row` | 811 | meta/desc grid | div (1257) | OK | — |
| 100 | `@media(max-width:960px){.wb-top-row}` | 818 | stack meta/desc | same | OK | — |
| 101 | `.workout-builder-col` | 824 | (legacy column wrapper) | — | GAP | No `.workout-builder-col` element in BuilderView. Legacy `display:contents` wrapper unused in new markup. Severity: none (`display:contents` is a no-op pass-through). |
| 102 | `.wb-card` | 830 | card base | `.wb-card` ×5 (1109,1149,1162,1195,1258,1270) | OK | — |
| 103 | `.wb-chart-card` | 841 | chart card | div (1149) | OK | Also queried by chart.ts:902 for axis overlays. |
| 104 | `.wb-meta-fields` | 845 | name/source stack | div (1259) | OK | — |
| 105 | `.wb-description-card .wb-field-textarea` | 851 | desc taller | `.wb-description-card` (1270) + textarea (1273) | OK | — |
| 106 | `.wb-field` | 855 | field column | div (1260,1264,1271) | OK | — |
| 107 | `.wb-field-label` | 861 | field labels | label (1261,1265,1272) | OK | — |
| 108 | `.wb-field-input, .wb-field-textarea` | 866 | inputs | input.wb-field-input (1262,1266), textarea (1273) | OK | — |
| 109 | `.wb-field-textarea` | 876 | desc textarea | textarea (1273) | OK | — |
| 110 | `.wb-field-input` | 883 | text inputs | inputs (1262,1266) | OK | — |
| 111 | `.wb-field-input:focus, .wb-field-textarea:focus` | 888 | focus | same | OK | — |

## Builder: stats chips

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 112 | `.wb-stats-row` | 896 | chips row | div (1110); also picker expanded (1154) | OK | — |
| 113 | `.wb-stat-chip` | 905 | each chip | div ×6 (1111-1116); picker chips (1155+) | OK | — |
| 114 | `.wb-stat-label` | 918 | chip label | div (1111+, 1156) | OK | — |
| 115 | `.wb-stat-value` | 923 | chip value | div (1111+, 1157) | OK | — |
| 116 | `.wb-stats-card` | 1009 | stats card | `.wb-card.wb-stats-card` (1109) | OK | — |

## Builder: chart container / axis overlays

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 117 | `.wb-chart-container` | 929 | scroll host | `div.wb-chart-container` (1150) | OK | `scrollEl` parent in chart.ts:901. |
| 118 | `.wb-chart-mini-host` | 938 | chart host | `div.wb-chart-mini-host` (1151) | OK | — |
| 119 | `.wb-chart-mini-host svg` | 945 | chart svg | svg appended into host (chart.ts:1170) | OK | — |
| 120 | `.wb-chart-axis-overlay` | 951 | y/ftp overlay divs | chart.ts:1180,1205 (`.wb-chart-axis-overlay`) | OK | Built only when `scrollEl && chartCard` (1173). |
| 121 | `.wb-chart-axis-overlay--grid` | 958 | grid label overlay | chart.ts:1180 | OK | — |
| 122 | `.wb-chart-axis-overlay--ftp` | 962 | ftp label overlay | chart.ts:1205 | OK | — |
| 123 | `.wb-chart-axis-label` | 966 | a y-axis label | chart.ts:1191 | OK | One per grid step (1186-1195). |
| 124 | `.wb-chart-axis-label--ftp` | 975 | FTP label | chart.ts:1198 | OK | — |
| 125 | `.wb-chart-axis-label--duration` | 983 | total-duration label | chart.ts:1215 (only when `durationSec>0`) | OK | — |

## Builder: chart bands / segments (chart.ts SVG)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 126 | `.wb-block-band` | 991 | block highlight band rect | chart.ts:1037 (`band.classList.add('wb-block-band')`) | OK | One per block (1026-1041). |
| 127 | `.wb-block-band.is-active` | 995 | selected-block band fill | chart.ts:1039 (`if(selectedSet.has(index)) add('is-active')`) | OK | Reachable on block select / multi-select. |
| 128 | `.wb-block-segment` | 1000 | segment polygon | chart.ts:1092 (`poly.classList.add('wb-block-segment')`) | OK | — |
| 129 | `.wb-block-segment.is-active` | 1005 | selected segment filter | chart.ts:1094 (`if(selectedSet.has(idx)) add('is-active')`) | OK | Uses `--wb-block-active-filter`. |

## Builder: toolbar / action buttons

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 130 | `.wb-toolbar-card` | 1014 | toolbar card | `.wb-card.wb-toolbar-card` (1195) | OK | — |
| 131 | `.wb-code-toolbar` | 1022 | toolbar row | div (1196) | OK | — |
| 132 | `.wb-toolbar-actions` | 1033 | action-btn group | div (1118) | OK | Inside stats row (legacy parity). |
| 133 | `.wb-toolbar-action-btn` | 1042 | undo/redo/copy/paste | 4 buttons (1132,1135,1138,1141) | OK | — |
| 134 | `.wb-toolbar-action-btn:hover` | 1057 | hover | same | OK | — |
| 135 | `.wb-toolbar-action-btn:disabled` | 1061 | disabled undo/redo/copy | `disabled={!canUndo / !canRedo / !hasSelection}` (1132,1135,1138) | OK | Disabled state reachable (empty/no-selection). |
| 136 | `.wb-toolbar-action-btn svg` | 1066 | btn icons | svgs (1133+) | OK | — |

## Builder: block editor / fields / steppers

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 137 | `.wb-block-editor` | 1072 | `#…blockEditor` | `div.wb-block-editor` (1224, when `showBlockEditor`) | OK | — |
| 138 | `.wb-block-editor-fields` | 1081 | fields wrapper | div (1225) | OK | — |
| 139 | `.wb-block-field` | 1089 | one field | div (1227); also text-event editor (1164,1175,1186) | OK | — |
| 140 | `.wb-block-field--nolabel` | 1097 | label-less interval field | `class:wb-block-field--nolabel={cfg.hideLabel}` (1227) | OK | Reachable for interval power/cadence (`hideLabel:true`, BuilderView.svelte:256-260). |
| 141 | `.wb-block-field-label` | 1102 | field label | label (1229, 1165,1176,1187) | OK | — |
| 142 | `.wb-block-stepper` | 1109 | stepper group | `.control-group.wb-block-stepper` (1231,1166,1177) | OK | Note CSS only sets height; **`.control-group`/`.control-btn`/`.control-value` themselves are styled elsewhere (out of this file's scope).** |
| 143 | `.wb-block-stepper-input` | 1113 | stepper number input | `input.…wb-block-stepper-input` (1234,1169,1180) | OK | — |
| 144 | `.wb-block-field[data-kind="power"] .wb-block-stepper-input` | 1117 | power input width | `data-kind={cfg.kind}` → `power` (1227; cfg.kind='power' at 243,247-248,256,259) | OK | — |
| 145 | `[data-kind="cadence"] .wb-block-stepper-input` | 1121 | cadence width | `data-kind="cadence"` (244,249,257,260) | OK | — |
| 146 | `[data-kind="timestamp"] .wb-block-stepper-input` | 1125 | timestamp width | `data-kind="timestamp"` on text-event "Starts at" (1175) | OK | Only in text-event editor. |
| 147 | `[data-kind="repeat"] .wb-block-stepper-input` | 1129 | reps width | `data-kind="repeat"` via cfg.kind='repeat' (254) | OK | Intervals only. |
| 148 | `[data-kind="repeat"] .control-value` | 1133 | reps value pad | repeat field's `.control-value` (1233 under repeat-kind field) | OK | `.control-value` emitted; this rule only adds padding. |
| 149 | `[data-kind="repeat"]` (min-width) | 1138 | reps field width | same repeat field | OK | — |
| 150 | `.wb-block-unit` | 1142 | unit suffix (s/%/rpm) | `span.…wb-block-unit` (1244,1170,1181) | OK | Rendered only when `cfg.unit` truthy. |
| 151 | `.wb-block-delete-btn` | 1148 | delete-block btn | `button.wb-block-delete-btn` (1128, when `showBlockEditor`) | OK | — |
| 152 | `.wb-block-delete-btn:hover` | 1163 | hover | same | OK | — |
| 153 | `.wb-block-move-btn` | 1236 | move L/R btns | 2 buttons (1120,1123, when `selectionCount===1`) | OK | — |
| 154 | `.wb-block-move-btn:hover` | 1251 | hover | same | OK | — |

## Builder: text-event editor + chart markers

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 155 | `.wb-text-event-card` | 1167 | text-event editor card | `.wb-card.wb-text-event-card` (1162, when `selectedTextEvent`) | OK | — |
| 156 | `.wb-text-event-editor` | 1172 | editor row | div (1163) | OK | — |
| 157 | `.wb-text-event-editor .wb-block-field` | 1180 | duration/timestamp fields | `.wb-block-field` inside (1164,1175) | OK | — |
| 158 | `.wb-text-event-editor .wb-text-event-field` | 1184 | text field flexes | `.wb-block-field.wb-text-event-field` (1186) | OK | — |
| 159 | `.wb-text-event-input` | 1189 | `#wbTextEventInput` | `#wbTextEventInput.wb-text-event-input` (1188) | OK | — |
| 160 | `.wb-text-event-input:focus` | 1203 | focus | same | OK | — |
| 161 | `.wb-text-event` | 1208 | chart text-event marker `<g>` (ew-resize) | chart.ts:762 (`marker.classList.add('wb-text-event')`) | OK | Per text event (1159-1166 markers). |
| 162 | `.wb-text-event:hover rect` | 1212 | marker hover fill | marker `<g>` has child `rect` (chart.ts:790-799) | OK | Hover reachable on SVG marker. |
| 163 | `.wb-text-event.is-active rect` | 1219 | active marker fill | chart.ts:763 (`if(activeIndex===idx) add('is-active')`) | OK | — |
| 164 | `.wb-text-event:hover .wb-text-event-tick` | 1226 | hover tick | tick line (chart.ts:770 `add('wb-text-event-tick')`) | OK | — |
| 165 | `.wb-text-event.is-active .wb-text-event-tick` | 1231 | active tick | tick + is-active marker | OK | — |

## Builder: drag handles (chart.ts SVG) + insert line

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 166 | `.wb-drag-handle--top` | 1295 | top (power) handle ns-resize | chart.ts:1138 (`topHandle.classList.add('wb-drag-handle','wb-drag-handle--top')`) | OK | Non-freeride segments only (1098). |
| 167 | `.wb-drag-handle--right` | 1299 | right (duration) handle ew-resize | chart.ts:1134 (`rightHandle…add('wb-drag-handle--right')`) | OK | Every segment. |
| 168 | `.wb-drag-handle--move` | 1303 | segment body grab | chart.ts:1093 (`poly…add('wb-drag-handle','wb-drag-handle--move')`) | OK | On the segment polygon. |
| 169 | `body.wb-dragging .wb-drag-handle--move` | 1307 | grabbing cursor while dragging | `.wb-drag-handle--move` exists (1093), but **no code adds `wb-dragging` to `<body>`** | GAP | BuilderView drag engine (handleChartPointerDown/Move/Up, BuilderView.svelte:537-728) never toggles `document.body.classList.add('wb-dragging')`. So the grabbing cursor during a move-drag is missing. Severity: low-medium (cursor-only; functional drag still works). |
| 170 | `.wb-insert-line` (via dashed line) | 1247 *(class set in JS; no dedicated rule, only `--wb-insert-line` stroke)* | insert-after dashed line | chart.ts:1247 (`line.classList.add('wb-insert-line')`) | OK | Element emitted; styled inline via `--wb-insert-line` stroke. No CSS rule named `.wb-insert-line` exists in this file, so nothing to "miss" — listed for completeness. |

## Builder: code insert (toolbar) buttons + zone icon colors

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 171 | `.wb-code-toolbar-buttons` | 1255 | insert-button group | `div.wb-code-toolbar-buttons` (1198, when `showToolbarButtons`) | OK | — |
| 172 | `.wb-code-insert-btn` | 1261 | insert/back/save/td/upload/expanded-action btns | many: toolbar (1200), back (833), trainerday (943), upload (968), expanded visit/delete/clone/edit (1092,1105,1117,1129) | OK | Heavily reused. |
| 173 | `.wb-code-insert-btn--icon-only` | 1277 | icon-only insert btn | `class:wb-code-insert-btn--icon-only={labelMode==='icon'}` (1203) | OK | Reachable when toolbar width<950 (updateLabelMode 95-101). |
| 174 | `.wb-code-icon` | 1284 | btn icon | `svg.wb-code-icon` (toolbar 1210/1216, back 839, plus 927,950,975,992,1096,...) | OK | — |
| 175 | `.wb-code-insert-btn:hover` | 1291 | hover | same buttons | OK | — |
| 176 | `.wb-code-insert-btn.wb-zone-recovery .wb-code-icon` | 1311 | recovery icon color | `class="wb-code-insert-btn {spec.zoneClass}"` → `wb-zone-recovery` (1202; spec.zoneClass at 142) | OK | — |
| 177 | `.wb-zone-endurance .wb-code-icon` | 1315 | endurance icon | zoneClass `wb-zone-endurance` (143) | OK | — |
| 178 | `.wb-zone-tempo .wb-code-icon` | 1319 | tempo icon | (144) | OK | — |
| 179 | `.wb-zone-threshold .wb-code-icon` | 1323 | threshold icon | (145) | OK | — |
| 180 | `.wb-zone-vo2 .wb-code-icon` | 1327 | vo2 icon | (146) | OK | — |
| 181 | `.wb-zone-anaerobic .wb-code-icon` | 1331 | anaerobic icon | (147) | OK | — |
| 182 | `.builder-status` (+ `--ok/--error/--neutral`) | 222,237,242,247 | `#workoutBuilderStatus` | `#workoutBuilderStatus.builder-status builder-status--{tone}` (934) | OK | tone ∈ neutral/ok/error from `builderStatusTone`. |
| 183 | `.wb-input-error` | 1346 | invalid field highlight | `class:wb-input-error={nameError/sourceError/descError}` (1262,1266,1275) | OK | Set by validateForSave (1064-1066). |

---

## Gaps

PARTIAL/GAP findings, by severity. (Most are inert legacy rules whose ancestor/variant simply never occurs in the Svelte scope — true visual regressions are flagged.)

### Medium
- **#169 `body.wb-dragging .wb-drag-handle--move` (css:1307) — GAP, behavioral.** The builder drag engine in `BuilderView.svelte` (`handleChartPointerDown/Move/Up`, lines 537–728) never adds/removes the `wb-dragging` class on `<body>`. The move-drag handle therefore stays `cursor: grab` instead of switching to `grabbing` during an active block move. Functional drag works; only the grabbing cursor feedback is lost. This is the one rule with a real (cosmetic) regression. Fix: toggle `document.body.classList` in pointerdown/up.

### Low
- **#75 `.picker-detail` (css:567) — GAP.** New expanded-row markup uses the `.picker-expanded-main-right` layout exclusively; no `.picker-detail` element is emitted. Also drags in #94 (`@media max-width:800px` `.picker-detail` rule, css:692) which then has no target. Empty-state styling (`.picker-detail-empty`) is independently covered (#76). Purely a layout leftover; no visual impact since the new layout supplies its own column styles.

### None / inert (legacy-dead or no-op — listed for completeness)
- **#2, #3 `.planner-mode` / `.planner-only` rules (css:13,17).** New picker is always `picker-mode` and emits no `.planner-only` nodes; the planner-mode picker variant is out of the Svelte scope. Hide-rules never fire — no effect.
- **#30 `.workout-picker-controls > input[type="search"]` (css:251).** Direct-child combinator; the search input is nested inside `.picker-search-wrap` in BOTH legacy and new DOM, so this rule never matched in legacy either (dead in both).
- **#36 number-input branch of `…controls input[type="number"]:focus` (css:316).** No `input[type=number]` lives under `.workout-picker-controls` (builder steppers are in `.wb-block-editor`). Search/select branches OK; number branch inert (same as legacy).
- **#101 `.workout-builder-col` (css:824).** No matching element; rule is `display:contents` (a transparent pass-through) so absence is harmless.
- **#170 `.wb-insert-line`.** The element IS emitted (chart.ts:1247) but there is no CSS *rule* by that name in this file — styling is inline via `--wb-insert-line`. Nothing missed.

---

## Summary

- **Selectors/rules audited: 183** across picker (overlay, header, search, filters, table, sort headers, rows, zone dots, expanded row, footer, buttons, empty-state, responsive) and builder (layout, cards, stats chips, chart container/axis overlays, chart bands/segments, toolbar/action buttons, block editor/steppers, text-event editor + chart markers, drag handles, code-insert buttons + zone colors, status, error highlight).
- **OK: 173 · PARTIAL: 6 · GAP: 4.**
- **States the screenshots don't show are well covered:** expanded-row `:hover`/`:active` (#51,#52 OK); sort-header `:hover` + `.sorted-asc/desc` arrows (#45,#47,#48 OK); selected-block bands `.wb-block-band.is-active` + `.wb-block-segment.is-active` (#127,#129 OK); text-event marker `:hover`/`.is-active` rect+tick (#162–165 OK); disabled toolbar buttons `:disabled` (#135 OK); zone dot colors (#55–61 OK) and zone insert-icon colors (#176–181 OK); insert dashed line (#170 OK); search active/autofill states (#23–29 OK).
- **Only one real (cosmetic) regression:** **#169** — `body.wb-dragging` is never set, so the move-drag handle never shows the `grabbing` cursor. Recommend a one-line `body.classList` toggle in the BuilderView drag engine.
- All other PARTIAL/GAP items are **inert legacy rules** (planner-mode hide-rules, a dead `>`-combinator search rule, a `display:contents` wrapper, a number-input focus branch, and the `.picker-detail` layout leftover) — no visual impact in the picker/builder scope.
