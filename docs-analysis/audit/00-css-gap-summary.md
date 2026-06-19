# CSS Audit — Consolidated Summary & Fix Plan

Per-stylesheet detail (every selector → legacy element → new element, OK/PARTIAL/GAP):
`css-01..05-*.md`. The legacy CSS is re-hosted **verbatim/byte-identical and global**, so rules
are identical — these audits check **element/selector coverage**: does the new DOM produce a
matching element so each rule applies?

## Totals
| Stylesheet | Selectors | OK | PARTIAL | GAP | Real gaps |
|---|--:|--:|--:|--:|---|
| 01 workout-base | 91 | ~78 | 2 | 11 | chart tooltip, nav-icon `.active` (rest dead/`.debug-*`) |
| 02 picker+builder | 183 | 173 | 6 | 4 | `wb-dragging` cursor (rest orphan/inert) |
| 03 planner | 85 | 82 | 0 | 3 | none (3 = deferred drag `suppress-hover`) |
| 04 settings | 52 | 44 | 4 | 4 | none (4 = dead in legacy too) |
| 05 welcome | 60 | 38 | 6 | 16 | none (16 = intentional anim reductions) |
| **Total** | **~471** | **~415** | **~18** | **~38** | **4 real** |

**Conclusion:** CSS coverage is ~95% by construction (verbatim re-host + faithful DOM). The vast
majority of non-OK rows are **intentional** (welcome animations, dropped first-paint guard) or
**dead/orphan rules that match no element in legacy either** (`.debug-*`, `.settings-input`,
`#settingsBtStatusCta`, `.picker-detail`, `a/a:hover`, `suppress-hover`). Only **4 real gaps**.

## Real gaps to fix
| # | Gap | Severity | Fix | Visual-diff risk |
|---|---|---|---|---|
| 1 | **Chart hover tooltip** — `#chartTooltip`/`.chart-tooltip` re-hosted but `drawWorkoutChart`/detail chart never wire mousemove (`chart.ts`); legacy passed `tooltipEl` + attached hover. Shared: live HUD chart, planner detail chart. | Med | Port the segment/line hover engine into `chart.ts`; pass `tooltipEl`. | None (hover-only; static render unchanged) |
| 2 | **`.nav-icon-button.active`** (workout-base:662) — settings/calendar bottom-nav buttons never get `.active` for their open-panel state. | Low | `class:active={ui.activeOverlay==='settings'}` etc. in `BottomNav.svelte`. | None (only when overlay open, which dims the HUD anyway) |
| 3 | **`body.wb-dragging`** (workout-picker:1307) — builder move-drag never toggles `wb-dragging` on `<body>`, so the grabbing cursor never shows. | Low | toggle `document.body.classList` in builder pointerdown/up. | None |
| 4 | **Welcome first-slide prev arrow** hidden via inline `visibility:hidden` instead of `.welcome-nav-hidden`/`:disabled` class. | Low | use the class (functional-equivalent cleanup). | None (same rendered result) |

## Optional cleanup (not gaps)
Delete the dead `.debug-*` block (workout-base:851-918, marked "no longer used") and the orphan
rules above from the re-hosted CSS — purely cosmetic repo hygiene, no behavior/visual change. Left
as-is to keep the re-hosted CSS byte-identical to legacy (the audit's premise).
