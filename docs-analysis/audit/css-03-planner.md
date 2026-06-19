# CSS Coverage Audit — `docs/workout-planner.css`

Scope: every selector/rule in `docs/workout-planner.css` (572 lines). The legacy
CSS is re-hosted verbatim and globally in the new app, so the rules are byte-identical;
this audit checks **element/selector coverage** — for each selector, does the NEW DOM
produce a matching element so the rule actually applies?

Cross-references:
- Legacy markup: `docs/index.html` planner region (lines 703-890) + JS-built rows/cards/detail in `docs/workout-planner.js`.
- New markup: `web/src/ui/PlannerView.svelte`.
- New charts: `web/src/core/chart.ts` (`drawMiniHistoryChart` L1370, `drawPowerCurveChart` L1507, `drawWorkoutChart` L260).

Status legend: **OK** = new DOM produces a matching element; **PARTIAL** = element exists but a state/variant is unreachable; **GAP** = no matching element in the new DOM.

---

## Header / chrome / layout

| # | Selector | css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|----------|--------------------------|---------------------------------|--------|-------|
| 1 | `:root { --planner-row-height }` | 1-3 | Document root var | Global (re-hosted), consumed by `.planner-week-row` | OK | Var used at PlannerView.svelte via `.planner-week-row` (L970). |
| 2 | `.workout-planner-overlay` | 5-7 | `#workoutPickerOverlay` overlay | OverlayModal `overlayClass=… workout-planner-overlay` (PlannerView.svelte:879) | OK | |
| 3 | `.workout-planner-modal` | 9-13 | `#workoutPickerModal` | `class="… workout-planner-modal"` (PlannerView.svelte:886) | OK | |
| 4 | `.workout-planner-header` | 15-23 | `<header class="workout-planner-header planner-only">` (index.html:703) | header (PlannerView.svelte:891) | OK | |
| 5 | `.workout-planner-left` | 25-29 | div (index.html:704) | div (PlannerView.svelte:892) | OK | |
| 6 | `.workout-planner-title` | 31-40 | `.workout-planner-title` (index.html:722) | div (PlannerView.svelte:906) | OK | |
| 7 | `.workout-planner-selected` | 42-58 | `#plannerSelectedDateLabel` (index.html:724) | div (PlannerView.svelte:908) | OK | |
| 8 | `.workout-planner-actions` | 60-67 | div (index.html:729) | div (PlannerView.svelte:911) | OK | |
| 9 | `.workout-planner-header .picker-close-btn` | 69-73 | `#workoutPlannerCloseBtn.picker-close-btn` (index.html:785) | button (PlannerView.svelte:945) | OK | |
| 10 | `.planner-schedule-btn` | 75-77 | `#plannerScheduleBtn` (index.html:768) | button (PlannerView.svelte:932) | OK | Conditionally rendered via `{#if showScheduleBtn}` (L929); selector still applies when present. |
| 11 | `.workout-planner-body` | 79-85 | `<div class="workout-planner-body planner-only">` (index.html:796) | div (PlannerView.svelte:957) | OK | |

## Calendar grid

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 12 | `.planner-calendar` | 87-97 | div (index.html:797) | div (PlannerView.svelte:958) | OK | |
| 13 | `.planner-calendar-header` | 99-107 | `#plannerCalendarHeader` (index.html:798) | div (PlannerView.svelte:959) | OK | |
| 14 | `.planner-day-head` | 109-117 | 7 day-name divs (index.html:799-805) | 7 divs (PlannerView.svelte:960-966) | OK | |
| 15 | `.planner-day-head:first-child` | 119-121 | first day-name div | first div (PlannerView.svelte:960) | OK | |
| 16 | `.planner-calendar-body` | 123-131 | `#plannerCalendarBody` (index.html:807) | div bound `calendarBodyEl` (PlannerView.svelte:968) | OK | |
| 17 | `.planner-week-row` | 133-140 | JS-built rows (workout-planner.js) | `{#each weeks}` div (PlannerView.svelte:970) | OK | New app renders fixed 16-week window vs legacy recycling (documented simplification); selector applies identically. |
| 18 | `.planner-week-row:last-child` | 142-144 | last JS row | last `{#each}` row | OK | |

## Day cell

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 19 | `.planner-day` | 146-155 | JS cell div | `<div class={cell.classes}>` with base `planner-day` (PlannerView.svelte:974, classes built L358) | OK | |
| 20 | `.planner-day:first-child` | 157-159 | first cell in row | first `{#each week}` cell | OK | |
| 21 | `.planner-day-content` | 161-169 | content wrapper | div (PlannerView.svelte:982) | OK | |
| 22 | `.planner-day-number` | 171-177 | day-number div | div (PlannerView.svelte:986) | OK | |
| 23 | `.planner-day.has-month-label` | 179-181 | cell w/ month label | `has-month-label` pushed into classes (PlannerView.svelte:359) | OK | Empty rule (comment only) — class present either way. |
| 24 | `.planner-month-label` | 183-193 | month-label div | `{#if cell.monthLabel}` div (PlannerView.svelte:984) | OK | |
| 25 | `.planner-day:hover` | 341-343 | cell hover | div (PlannerView.svelte:974) | OK | Hover state reachable. |
| 26 | `.planner-day.suppress-hover:hover:not(.is-selected):not(.is-today)` | 345-348 | cell during drag-reschedule | — | **GAP** | `suppress-hover` is added only by legacy drag handlers (workout-planner.js:323,479). Drag-and-drop is dropped (PlannerView.svelte:21). No element ever gets this class. Deferred. |
| 27 | `.planner-day.suppress-hover:hover.is-selected` | 350-353 | same (drag, selected) | — | **GAP** | Same — drag affordance deferred. |
| 28 | `.planner-day.suppress-hover:hover.is-today:not(.is-selected)` | 355-358 | same (drag, today) | — | **GAP** | Same — drag affordance deferred. |
| 29 | `.planner-day.is-selected` | 360-363 | selected cell | `is-selected` pushed when `selectedDate` matches (PlannerView.svelte:361) | OK | Reached via click `selectDay` (L979) + arrow/hjkl `moveSelection` (L840). |
| 30 | `.planner-day.is-selected:hover` | 365-368 | selected cell hover | same cell + `:hover` | OK | |
| 31 | `.planner-day.is-selected:hover:has(.planner-workout-card:hover)` | 370-373 | selected cell, card hovered | selected cell with `.planner-workout-card` child (PlannerView.svelte:990) | OK | Requires a card present; reached on days with history/scheduled cards. |
| 32 | `.planner-day.is-today:not(.is-selected)` | 375-378 | today cell, not selected | `is-today` pushed when `isToday` (PlannerView.svelte:360) | OK | On open, today == selected (onOpen L211); reachable by moving selection off today. |
| 33 | `.planner-day.is-today:not(.is-selected):hover` | 380-383 | today cell hover | same | OK | |
| 34 | `.planner-day.is-today:not(.is-selected):hover:has(.planner-workout-card:hover)` | 385-388 | today cell, card hovered | today cell w/ card child | OK | Requires a card on today. |

## Month boundary

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 35 | `.planner-day.month-top-boundary` | 390-392 | JS boundary cell | `month-top-boundary` pushed (PlannerView.svelte:369) | OK | Boundary logic mirrors legacy workout-planner.js:1130. |
| 36 | `.planner-day.month-left-boundary` | 394-396 | JS boundary cell | `month-left-boundary` pushed (PlannerView.svelte:365) | OK | Mirrors js:1117. |
| 37 | `.planner-day.month-bottom-boundary` | 398-400 | JS boundary cell | `month-bottom-boundary` pushed (PlannerView.svelte:375) | OK | Mirrors js:1144. |

## History card

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 38 | `.planner-workout-card` | 195-207 | JS history card | `{#each history}` div (PlannerView.svelte:990) | OK | |
| 39 | `.planner-workout-card:hover` | 209-213 | card hover | same | OK | |
| 40 | `.planner-day.is-selected .planner-workout-card:hover` | 215-219 | card hover in selected day | card inside `is-selected` cell | OK | |
| 41 | `.planner-day.is-today:not(.is-selected) .planner-workout-card:hover` | 221-225 | card hover in today (not selected) | card inside `is-today` cell | OK | |
| 42 | `.planner-workout-card:active` | 227-231 | card active | same | OK | |
| 43 | `.planner-day.is-selected .planner-workout-card:active` | 233-237 | active in selected day | same | OK | |
| 44 | `.planner-day.is-today:not(.is-selected) .planner-workout-card:active` | 239-243 | active in today | same | OK | |
| 45 | `.planner-workout-header` | 276-280 | header div | div (PlannerView.svelte:999, 1052) | OK | Present in both history + scheduled cards. |
| 46 | `.planner-workout-name` | 282-286 | name div | div (PlannerView.svelte:1000, 1053) | OK | |
| 47 | `.planner-workout-stats` | 288-295 | stats container | div (PlannerView.svelte:1001, 1054) | OK | |
| 48 | `.planner-workout-stat-chip` | 297-300 | stat chip span | `<span class="planner-workout-stat-chip">` (PlannerView.svelte:1003, 1056) | OK | |
| 49 | `.planner-workout-chart` | 302-305 | chart wrapper | div (PlannerView.svelte:1010, 1063) | OK | |
| 50 | `.planner-workout-chart svg` | 307-311 | chart `<svg>` | `<svg use:historyChart>` / `use:scheduledChart` (PlannerView.svelte:1011, 1064) | OK | Rendered by `drawMiniHistoryChart` (chart.ts:1370). |

## Scheduled card

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 51 | `.planner-scheduled-top` | 245-252 | scheduled top row | div (PlannerView.svelte:1028) | OK | |
| 52 | `.planner-scheduled-tag` | 254-261 | "Scheduled" tag | div (PlannerView.svelte:1029) | OK | |
| 53 | `.planner-scheduled-tag-past` | 263-265 | past scheduled tag | `class:planner-scheduled-tag-past={past}` (PlannerView.svelte:1029) | OK | `past = isPastDate(cell.key)` (L1017). |
| 54 | `.planner-scheduled-missing .planner-workout-name` | 267-269 | missing-file card name | `class:planner-scheduled-missing={p.missing}` (PlannerView.svelte:1020) → name child (L1053) | OK | `p.missing = !cw` set in loadSchedule (L281). Reachable when a scheduled workout's file is absent from listWorkouts. |
| 55 | `.planner-scheduled-edit-btn` | 271-274 | edit/delete button | `<button class="nav-icon-button planner-scheduled-edit-btn">` (PlannerView.svelte:1032) | OK | |

> Note: `.planner-scheduled-card` itself has **no rule** in workout-planner.css (only a state modifier `.planner-scheduled-missing` and descendant selectors). The class is present on the card (PlannerView.svelte:1019), so the descendant/state selectors above all resolve. No standalone audit row needed.
> Note: `.planner-workout-stat-sep` (PlannerView.svelte:1005,1058) and `.planner-day-content.has-history` (PlannerView.svelte:982) are emitted by the new DOM but have **no rule** in workout-planner.css — not auditable selectors here (no coverage obligation).

## Footer / totals

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 56 | `.planner-footer` | 313-321 | `#plannerFooter` (index.html:870) | div (PlannerView.svelte:1114) | OK | |
| 57 | `.planner-footer-left` | 323-325 | left span container (index.html:871) | div (PlannerView.svelte:1115) | OK | |
| 58 | `.planner-footer-right` | 327-329 | right span container (index.html:882) | div (PlannerView.svelte:1118) | OK | |
| 59 | `.planner-footer-right, .planner-footer-left` | 331-336 | both containers | divs (PlannerView.svelte:1115,1118) | OK | |
| 60 | `.planner-footer-sep` | 338-340 | "·" separators | `<span class="planner-footer-sep">` (PlannerView.svelte:1120,1122) | OK | `#plannerAgg3/7/30` populated by `agg` derived (L387). |

## Detail view

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 61 | `.planner-detail-view` | 402-408 | `#plannerDetailView` (index.html:813) | `{#if detail}` div (PlannerView.svelte:1077) | OK | New app conditionally mounts (legacy keeps it hidden via `display:none`); rule's `display:none` is overridden by inline `style="display: flex"` (L1077) + the detail-mode rule #79. |
| 62 | `.planner-detail-top` | 410-417 | div (index.html:817) | div (PlannerView.svelte:1078) | OK | |
| 63 | `.planner-detail-stats` | 419-428 | `#plannerDetailStats` (index.html:818) | div (PlannerView.svelte:1079) | OK | |
| 64 | `.planner-detail-date` | 430-437 | JS date line | `{#if detailDateLine}` div (PlannerView.svelte:1081) | OK | `detailDateLine` derived (L619). |
| 65 | `.planner-detail-stats .wb-stats-row` | 439-443 | stats row (JS) | `<div class="wb-stats-row">` (PlannerView.svelte:1083) | OK | `.wb-stat-chip` base styling lives in workout-base/picker CSS (out of scope). Chips at L1085 carry `title={s.title}` tooltips from STAT_TOOLTIPS (L585) — covers the tooltip state the screenshots don't show. |
| 66 | `.planner-detail-curve` | 445-456 | div (index.html:819) | div (PlannerView.svelte:1092) | OK | |
| 67 | `.planner-power-curve` | 458-464 | `#plannerPowerCurveSvg` (index.html:849) | `<svg class="planner-power-curve" use:powerCurveChart>` (PlannerView.svelte:1104) | OK | Rendered by `drawPowerCurveChart` (chart.ts:1507). |
| 68 | `.planner-detail-chart-panel` | 466-475 | `#plannerDetailChartPanel` (index.html:856) | div (PlannerView.svelte:1107) | OK | |
| 69 | `.planner-detail-chart` | 477-480 | `#plannerDetailChartSvg` (index.html:860) | `<svg class="planner-detail-chart" use:detailChart>` (PlannerView.svelte:1108) | OK | Rendered by `drawWorkoutChart` (chart.ts:260). |
| 70 | `.planner-curve-title-row` | 482-487 | div (index.html:820) | div (PlannerView.svelte:1093) | OK | |
| 71 | `.planner-curve-title` | 489-495 | "Power curve" title (index.html:821) | div (PlannerView.svelte:1094) | OK | |
| 72 | `.planner-curve-help` | 497-508 | help "?" circle (index.html:822) | div (PlannerView.svelte:1095) | OK | Carries `title=` tooltip (L1096) — covers the hover-tooltip state. |
| 73 | `.planner-curve-help svg` | 510-513 | help icon svg (index.html:828) | `<svg>` (PlannerView.svelte:1097) | OK | |
| 74 | `.planner-curve-help:hover` | 515-518 | help circle hover | same | OK | Hover reachable. |

## Detail-mode toggles (`.planner-detail-mode`)

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 75 | `.planner-detail-mode .planner-calendar, … .planner-footer, … .planner-schedule-btn` | 520-524 | modal in detail mode hides these | `class:planner-detail-mode={detailMode}` on modal (PlannerView.svelte:887) | OK | `.planner-schedule-btn` is `{#if showScheduleBtn}` and `showScheduleBtn` is false in detailMode (L633), so in practice it's already unmounted — the hide rule is redundant but harmless; calendar+footer always present and hidden. |
| 76 | `.planner-detail-mode #plannerDetailView` | 526-528 | show detail view | `#plannerDetailView` (PlannerView.svelte:1077, mounted only when `detail`) | OK | `display:flex !important` applies; element present in detail mode. |
| 77 | `.planner-detail-mode .workout-planner-title` | 530-532 | title (un-uppercase) | `.workout-planner-title` (PlannerView.svelte:906) | OK | In detail mode title renders empty string (L906) but element exists; rule applies. |
| 78 | `.planner-detail-mode .workout-planner-body` | 534-536 | body overflow hidden | `.workout-planner-body` (PlannerView.svelte:957) | OK | |
| 79 | `.planner-detail-mode #plannerBackBtn` | 538-540 | show back button | `#plannerBackBtn` (PlannerView.svelte:894) | OK | Element always present; new app also drives it via inline `style="display: …"` (L898) matching the rule. |
| 80 | `.planner-back-btn` | 542-546 | back button base | `class="… planner-back-btn"` (PlannerView.svelte:895) | OK | |

## Media / theme queries

| # | Selector | css:line | Targets (legacy element) | New element | Status | Notes |
|---|----------|----------|--------------------------|-------------|--------|-------|
| 81 | `@media (prefers-color-scheme: dark) .planner-day:hover` | 548-552 | day cell hover in dark | `.planner-day` (PlannerView.svelte:974) | OK | Same element; theme-conditional override. |
| 82 | `@media (max-width: 900px) .workout-planner-modal` | 554-558 | modal at narrow width | modal (PlannerView.svelte:886) | OK | |
| 83 | `@media (max-width: 900px) .workout-planner-header` | 560-563 | header at narrow width | header (PlannerView.svelte:891) | OK | |
| 84 | `@media (max-width: 900px) .workout-planner-selected` | 565-567 | selected label narrow | div (PlannerView.svelte:908) | OK | |
| 85 | `@media (max-width: 900px) .workout-planner-actions` | 569-571 | actions narrow | div (PlannerView.svelte:911) | OK | |

---

## Gaps

| Severity | # | Selector | css:line | Why | Disposition |
|----------|---|----------|----------|-----|-------------|
| Low | 26 | `.planner-day.suppress-hover:hover:not(.is-selected):not(.is-today)` | 345-348 | `suppress-hover` only added by legacy drag-reschedule handlers (workout-planner.js:323,479); drag-and-drop is dropped in the new app (PlannerView.svelte:21). No element ever gets the class. | **Known-deferred** (drag-reschedule). Dead rule, no visual impact. |
| Low | 27 | `.planner-day.suppress-hover:hover.is-selected` | 350-353 | Same root cause. | **Known-deferred.** |
| Low | 28 | `.planner-day.suppress-hover:hover.is-today:not(.is-selected)` | 355-358 | Same root cause. | **Known-deferred.** |

No `@media`/theme/state GAPs. The hover/selected/today day-cell states (#25, #29-34), card hover/active (#39-44), missing-file scheduled card (#54), past-scheduled tag (#53), and the detail stat-chip + power-curve-help tooltips (#65, #72) — i.e. the states the screenshots don't exercise — all resolve to real new-DOM elements.

### Deferred-feature notes (not CSS gaps in this file)
- **`?` hotkey overlay:** `#plannerHotkeyList` (index.html:875) is absent from the new DOM (PlannerView.svelte renders only `#plannerHotkeyPrompt` at L1116). The list has no rule in workout-planner.css (styled inline `display:none` in legacy), so it produces **no** missing-selector GAP here — it's a content/feature deferral, audited under HTML/JS coverage, not CSS.
- **Deep-scroll recycling:** the new app renders the fixed 16-week window instead of recycling rows (PlannerView.svelte:14-17). No CSS selector depends on it; `.planner-week-row` coverage is unaffected.
- **Drag affordances:** rows #26-28 above (the only CSS-level consequence).

---

## Summary

- **85** auditable selectors/rules across 10 sub-areas (header/layout, calendar grid, day cell, month boundary, history card, scheduled card, footer/totals, detail view, detail-mode toggles, media/theme).
- **82 OK / 0 PARTIAL / 3 GAP** — all 3 GAPs are the `.suppress-hover` drag-reschedule hover rules (low severity, known-deferred dead rules; no visual regression).
- All hard-to-see states resolve to real elements: day-cell hover/selected/today (incl. dark-mode hover #81), card hover/active, past-scheduled line-through, missing-file error coloring, and the detail stat-chip / power-curve-help tooltips.
- Two new-DOM classes (`.planner-workout-stat-sep`, `.planner-day-content.has-history`) have no rule in this file and impose no coverage obligation.
- The `?` hotkey-overlay list and deep-scroll recycling are feature deferrals with **no** corresponding orphaned selector in workout-planner.css.
