# CSS Coverage Audit — `docs/workout-base.css`

Scope: every selector/rule in `docs/workout-base.css` (1052 lines). The file is re-hosted byte-identical at `web/src/styles/workout-base.css` (verified `diff` → IDENTICAL), so the *rules* are the same. This audit checks **element/selector coverage**: does the new app's DOM emit an element with the same class/id/structure so each rule actually applies, including states (`:hover`, `:active`, `.disabled`, `.visible`, `.connected/.connecting/.error`, theme variants, `@media`).

New-app HUD DOM lives in:
- `web/src/ui/HudView.svelte` (`.page-root`)
- `web/src/ui/StatCards.svelte` (`.top-panel`, `.stat-card`, …)
- `web/src/ui/LiveChart.svelte` (`#chartPanel`/`.chart-panel`, `#chartSvg`, empty overlay, `#chartTooltip`)
- `web/src/ui/BottomNav.svelte` (`.bottom-nav` + all controls)
- `web/src/ui/StatusOverlay.svelte` (`#statusOverlay`/`#statusText`)
- `web/src/core/chart.ts` (SVG draw; no `.chart-tooltip` interaction)
- `web/src/app/theme.ts` (applies `:root.theme-light` / `:root.theme-dark`)

Legend: **OK** = matching element/state exists. **PARTIAL** = element exists but differs / state never produced. **GAP** = no matching element (dead CSS) or missing element/state.

---

## Design tokens & themes (`:root`, `@media dark`, `:root.theme-light/.theme-dark`)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 1 | `:root` | 1–89 | document root custom props | `<html>` (global) | OK | All tokens consumed by re-hosted CSS; global. |
| 2 | `@media (prefers-color-scheme: dark) :root` | 91–173 | root in dark OS pref | `<html>` | OK | Applies whenever OS = dark and no explicit theme class wins. |
| 3 | `:root.theme-light` | 175–245 | `html.theme-light` | `web/src/app/theme.ts:27-28` adds `theme-light` | OK | Theme class applied to `documentElement`. |
| 4 | `:root.theme-dark` | 247–315 | `html.theme-dark` | `web/src/app/theme.ts:26-27` adds `theme-dark` | OK | Dark theme reachable via Settings (`SettingsView.svelte:497`). Not exercised by light-mode screenshots. |
| 5 | `*` (box-sizing) | 317–319 | all elements | all | OK | Global. |
| 6 | `html, body` | 321–327 | document html/body | host page | OK | Global reset. |
| 7 | `body` | 329–344 | `<body>` | host page | OK | Global. |
| 8 | `button, input, select, textarea` | 346–352 | form controls | nav buttons / `#manualInput` | OK | Applies to all controls in BottomNav. |
| 9 | `a` | 354–357 | anchors | — | GAP (Low) | No `<a>` in HUD region (legacy region 115–345 had none either). Dead within this view; may apply elsewhere in app. |
| 10 | `a:hover` | 359–362 | anchor hover | — | GAP (Low) | Same as #9. |
| 11 | `@media dark { a, a:hover }` | 364–372 | anchors in dark | — | GAP (Low) | Same as #9. |

## Page root & panels (`.page-root`, `.top-panel`, user-select)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 12 | `.page-root` | 374–381 | riding view container | `HudView.svelte:33` `.page-root` | OK | Same class. |
| 13 | `.top-panel, .top-panel *, .chart-panel, .chart-panel *` (user-select) | 384–392 | HUD + chart no-select | `StatCards.svelte:57` `.top-panel`, `LiveChart.svelte:77` `.chart-panel` | OK | Both present. |
| 14 | `.top-panel` (grid) | 396–403 | 2×3 stat grid | `StatCards.svelte:57` | OK | Same class/structure (6 `.stat-card`). |

## Stat cards (`.stat-card`, `.stat-label`, `.stat-value`, cadence indicator)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 15 | `.stat-card` | 405–414 | each stat tile | `StatCards.svelte:58,64,72,78,86,94` | OK | 6 cards, same `data-key`s. |
| 16 | `.stat-label` | 416–425 | stat label text | `StatCards.svelte:59,65,…` | OK | |
| 17 | `.stat-value` | 427–433 | value wrapper | `StatCards.svelte:60,66,…` | OK | |
| 18 | `.stat-value span` | 435–439 | numeric span (color/tabular) | `StatCards.svelte:61,67,…` spans | OK | Note: new app also sets inline `style="color:{color}"` on each span — overrides `--stat-number-color`, but that mirrors legacy JS which also set per-zone color. Selector still matches. |
| 19 | `.stat-cadence-indicator` | 441–446 | cadence arrow span | `StatCards.svelte:98-103` `#stat-cadence-indicator` | OK | Same id+class. |
| 20 | `.stat-cadence-indicator--visible` | 448–450 | arrow when shown (margin) | `StatCards.svelte:102` `class:…--visible={!!indicator}` | OK | Toggled when `cadenceIndicator()` (`hud-format.ts:100`) returns `▾`/`▴`. Visible-state CSS reachable; NOT exercised by static screenshots (needs cadence delta >5 rpm). |
| 21 | `.stat-lg` (referenced by JS sizing, no own rule) | n/a | larger time cards | `StatCards.svelte:66,88` `.stat-value.stat-lg` | OK | `.stat-lg` has no CSS rule in this file (only JS reads it for font sizing, `StatCards.svelte:37`). Class present; nothing to "cover" CSS-wise. |

## Chart panel (`.chart-panel`, `#chartSvg`, `.chart-tooltip`, empty state)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 22 | `.chart-panel` | 454–463 | chart container | `LiveChart.svelte:76` `#chartPanel.chart-panel` | OK | Same id+class. |
| 23 | `#chartSvg` | 465–469 | chart SVG | `LiveChart.svelte:112` `#chartSvg` | OK | Same id. |
| 24 | `.chart-tooltip` | 471–484 | hover tooltip div (`#chartTooltip`) | `LiveChart.svelte:118` `#chartTooltip.chart-tooltip` | PARTIAL | Element exists, but `drawWorkoutChart` (`chart.ts:260`) never attaches mousemove/populates `#chartTooltip` for the live HUD chart (legacy `workout.js:62,913` passed `tooltipEl: chartTooltip`). CSS applies to the element, but `display:none` is never lifted → tooltip never shown. Selectors below it (`@media dark .chart-tooltip`) likewise inert. |
| 25 | `@media dark { .chart-tooltip }` | 486–493 | tooltip in dark | `#chartTooltip` | PARTIAL | Element exists but never visible (see #24). |
| 26 | `.chart-empty-state` | 992–1006 | empty overlay | `LiveChart.svelte:84` `#chartEmptyOverlay.chart-empty-state` | OK | Same id+class; toggled via inline `display`. |
| 27 | `.chart-empty-message` | 1008–1016 | overlay headline | `LiveChart.svelte:87` `#chartEmptyMessage` | OK | Messages: noBike/noWorkout/readyToStart/resume (`LiveChart.svelte:31-41`). |
| 28 | `.chart-empty-arrow` | 1018–1023 | arrow SVG | `LiveChart.svelte:89` `#chartEmptyArrow.chart-empty-arrow` | OK | |
| 29 | `.chart-empty-arrow--left` | 1026–1029 | bike (left) variant | `LiveChart.svelte:91` `class:…--left` | OK | Set when `arrowDir==='left'` (noBike). |
| 30 | `.chart-empty-arrow--right` | 1032–1036 | workout (right, mirrored) | `LiveChart.svelte:92` `class:…--right` | OK | Set for noWorkout/readyToStart. |
| 31 | `.chart-empty-arrow-main` | 1038–1044 | arrow stroke paths | `LiveChart.svelte:100,104` | OK | Two paths, same class. |

## Bottom nav shell (`.bottom-nav`, title, nav-left/right)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 32 | `.bottom-nav` | 497–511 | fixed bottom navbar | `BottomNav.svelte:150` | OK | |
| 33 | `.workout-title-wrapper` | 513–522 | centered title holder | `BottomNav.svelte:215` | OK | |
| 34 | `.workout-title-center` | 524–533 | centered title text | `BottomNav.svelte:217` `#workoutTitleCenter` | OK | Shown while running/starting; toggled inline. |
| 35 | `.nav-left, .nav-right` | 535–541 | left/right groups | `BottomNav.svelte:151,229` | OK | |
| 36 | `.nav-right` (margin-left auto) | 543–545 | right group | `BottomNav.svelte:229` | OK | |
| 37 | `@media (max-width:800px) .bottom-nav` | 953–957 | mobile font size | `BottomNav.svelte:150` | OK | No-op rule (sets base font again) but selector matches. |

## Device groups & status dots (`.device-group`, `.icon-box`, `.status-dot`, battery)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 38 | `.device-group` | 547–561 | bike/HR buttons | `BottomNav.svelte:152,164` | OK | |
| 39 | `.device-label` | 563–570 | label text | `BottomNav.svelte:161,173` | OK | |
| 40 | `.device-battery` | 572–575 | HR battery % | `BottomNav.svelte:176` `#hrBatteryLabel.device-battery` | OK | |
| 41 | `.icon-box` | 577–589 | icon wrapper | `BottomNav.svelte:153,165` | OK | |
| 42 | `.icon-box svg` | 591–598 | icon glyph | `BottomNav.svelte:154,166` | OK | |
| 43 | `.status-dot` | 600–608 | connection dot (idle grey) | `BottomNav.svelte:159,171` | OK | Base/idle class. `dotClass('idle')` → `''` so dot uses base grey. |
| 44 | `.status-dot.connected` | 610–612 | green connected | `BottomNav.svelte:159,171` via `dotClass` | OK | `dotClass('connected')→'connected'` (`BottomNav.svelte:62`). |
| 45 | `.status-dot.connecting` | 614–616 | amber connecting | `dotClass('connecting')→'connecting'` | OK | State reachable; NOT in static screenshots (transient connect). |
| 46 | `.status-dot.error` | 618–620 | red error | `dotClass('error')→'error'` | OK | State reachable; NOT in static screenshots. |
| 47 | `.battery-low` | 622–624 | low-battery orange | `BottomNav.svelte:179` `class:battery-low={hrBatteryPercent<=20}` | OK | Reachable when HR battery ≤20%; not in static screenshots. |

## Nav icon buttons (`.nav-icon-button`, hover/active)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 48 | `.nav-icon-button` | 626–639 | settings button | `BottomNav.svelte:188` `#settingsBtn.nav-icon-button` | OK | |
| 49 | `.nav-icon-button svg` | 641–648 | settings glyph | `BottomNav.svelte:192` | OK | |
| 50 | `.nav-icon-button:hover, .device-group:hover` | 650–653 | hover bg | same elements | OK | Interactive state; not in screenshots. |
| 51 | `@media dark { …:hover }` | 655–660 | hover bg dark | same | OK | Dark + hover. |
| 52 | `.nav-icon-button.active` | 662–664 | active/pressed state | — | GAP (Med) | No element ever gets `.active` on a `.nav-icon-button` (settings button has no `class:active`; legacy toggled it when a panel was open). Dead state CSS in new app. |
| 53 | `@media dark { .nav-icon-button.active }` | 666–670 | active dark | — | GAP (Med) | Same as #52. |

## Mode toggle (`.mode-toggle`, buttons, hover/active)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 54 | `.mode-toggle` | 674–682 | ERG/Resistance toggle | `BottomNav.svelte:232` `#modeToggle.mode-toggle` | OK | Shown only when free-ride UI active (`freeRideUiActive`). |
| 55 | `.mode-toggle-button` | 684–696 | toggle buttons | `BottomNav.svelte:239,246` | OK | |
| 56 | `.mode-toggle-button:hover` | 698–700 | hover | same | OK | Interactive; not in screenshots. |
| 57 | `.mode-toggle-button + .mode-toggle-button` | 702–704 | divider between buttons | `BottomNav.svelte:245` (adjacent) | OK | Two adjacent buttons → adjacent-sibling matches. |
| 58 | `.mode-toggle-button.active` | 706–708 | selected mode | `BottomNav.svelte:240,247` `class:active` | OK | Toggled by `vm.freeRideMode`. Only visible during free-ride; not in static screenshots. |

## Manual controls (`.control-group`, `.control-btn`, value, ftp input)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 59 | `.control-group` | 712–721 | +/- stepper group | `BottomNav.svelte:255` `#manualControls.control-group` | OK | Free-ride only. |
| 60 | `.control-btn` | 723–735 | +/- buttons | `BottomNav.svelte:260,274` | OK | |
| 61 | `.control-btn:last-child` | 737–740 | "+" button border | `BottomNav.svelte:274` last child | OK | |
| 62 | `.control-btn:hover` | 742–744 | hover | same | OK | Interactive; not in screenshots. |
| 63 | `@media dark { .control-btn:hover }` | 746–750 | hover dark | same | OK | |
| 64 | `.control-value` | 752–761 | value/input wrapper | `BottomNav.svelte:261` | OK | |
| 65 | `.settings-ftp-input` | 961–969 | manual numeric input | `BottomNav.svelte:265` `#manualInput.settings-ftp-input` | OK | |
| 66 | `.settings-ftp-input::-webkit-*-spin-button` | 972–977 | hide spinners | `#manualInput` | OK | |
| 67 | `.settings-ftp-input[type="number"]` | 979–982 | number input | `#manualInput type=number` | OK | |
| 68 | `.settings-ftp-unit` | 984–988 | W/% unit label | `BottomNav.svelte:272` `#manualUnit.settings-ftp-unit` | OK | |

## Workout controls & playback (`.workout-controls`, `.playback-button`, `.inline-clicktoggle`)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 69 | `.workout-controls` | 763–770 | right control cluster | `BottomNav.svelte:230` `#workoutControls.workout-controls` | OK | |
| 70 | `.workout-controls #modeToggle` (display:none) | 772–774 | force-hide mode toggle | `BottomNav.svelte:232` `#modeToggle` inside `#workoutControls` | OK | Selector matches; new app overrides via inline `style="display:…"` (inline > stylesheet), same effective behavior as legacy JS. |
| 71 | `.playback-button` | 776–788 | calendar/start/play/pause/stop (`display:none` base) | `BottomNav.svelte:202,295,305,317,328` | OK | All 5 buttons carry `.playback-button`. |
| 72 | `.playback-button.visible` | 790–793 | shown variant | `class:visible` on all 5 (`BottomNav.svelte:203,296,307,318,329`) | OK | Toggled by `showCalendar/showStart/showPlay/showPause/showStop`. Visible-state reachable; static screenshots only exercise some (calendar/start). |
| 73 | `.playback-button svg` | 795–802 | button glyph | each button's `<svg>` | OK | |
| 74 | `.playback-button:hover` | 804–806 | hover | same | OK | Interactive; not in screenshots. |
| 75 | `@media dark { .playback-button:hover }` | 808–812 | hover dark | same | OK | |
| 76 | `.inline-clicktoggle` | 814–827 | workout name label | `BottomNav.svelte:280` `#workoutNameLabel.inline-clicktoggle` | OK | |
| 77 | `.inline-clicktoggle span` | 829–831 | label inner span | — | GAP (Low) | New app renders text node directly in `#workoutNameLabel` (`BottomNav.svelte:289`), no child `<span>`. Legacy also had no `<span>` wrapper here (text was direct) → rule was already inert in legacy; harmless. |
| 78 | `.inline-clicktoggle:hover` | 833–835 | hover | `#workoutNameLabel` | OK | Interactive; not in screenshots. |
| 79 | `.inline-clicktoggle:active` | 837–839 | pressed | `#workoutNameLabel` | OK | Active state; not in screenshots. |
| 80 | `@media dark { .inline-clicktoggle:hover/:active }` | 841–849 | dark hover/active | same | OK | |

## Status overlay (`.status-overlay`, `#statusText`)

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 81 | `.status-overlay` | 922–937 | countdown/paused overlay | `StatusOverlay.svelte:13` `#statusOverlay.status-overlay` | OK | Element re-hosted; Beeper drives show/hide by id (idle = `display:none`, opacity:0). State (visible/opacity:1) NOT in static screenshots. |
| 82 | `@media dark { .status-overlay }` | 939–944 | overlay dark | same | OK | |
| 83 | `#statusText` | 946–951 | overlay big text | `StatusOverlay.svelte:14` `#statusText` | OK | Driven by Beeper. |

## Debug overlay — retained-for-reference block

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 84 | `.debug-overlay` | 855–866 | (legacy debug panel) | — | GAP (Low) | Comment at 851 says "no longer used, retained for reference". No element in legacy `index.html` either, nor new app. Intentionally dead. |
| 85 | `.debug-header` | 868–874 | — | — | GAP (Low) | Same dead block. |
| 86 | `.debug-header-title` | 876–879 | — | — | GAP (Low) | Same. |
| 87 | `.debug-close-btn` | 881–890 | — | — | GAP (Low) | Same. |
| 88 | `.debug-log` | 892–903 | — | — | GAP (Low) | Same. |
| 89 | `@media dark { .debug-overlay, .debug-log, .debug-close-btn }` | 905–918 | — | — | GAP (Low) | Same. |

## Misc layout helpers

| # | Selector | css:line | Targets | New element | Status | Notes |
|---|----------|----------|---------|-------------|--------|-------|
| 90 | `#startBtn` (margin-left:auto) | 1046–1048 | start button position | `BottomNav.svelte:293` `#startBtn` | OK | |
| 91 | `#workoutNameLabel` (white-space) | 1050–1052 | name label nowrap | `BottomNav.svelte:278` `#workoutNameLabel` | OK | |

---

## Gaps (PARTIAL / GAP only)

### High
*(none)* — every visible structural element and `.visible`/state class that the new HUD actually reaches has a matching element. No High-severity dead visible-state CSS or missing element was found in the riding-view surface this file styles.

### Medium
| # | Selector | css:line | Severity | Issue |
|---|----------|----------|----------|-------|
| 24 | `.chart-tooltip` | 471–484 | Med | Element `#chartTooltip` exists (`LiveChart.svelte:118`) but the live HUD chart never populates/shows it — `drawWorkoutChart` (`chart.ts:260`) attaches no mousemove and never passes a `tooltipEl` (legacy `workout.js:62,913` did). The hover-tooltip feature is effectively dropped; CSS matches the element but its `display:none` is never lifted. |
| 25 | `@media dark .chart-tooltip` | 486–493 | Med | Inert for the same reason as #24. |
| 52 | `.nav-icon-button.active` | 662–664 | Med | No `.nav-icon-button` ever receives `.active` in the new app (settings button has no `class:active`; legacy toggled it for open panel state). Dead interactive-state rule. |
| 53 | `@media dark .nav-icon-button.active` | 666–670 | Med | Same as #52. |

### Low
| # | Selector | css:line | Severity | Issue |
|---|----------|----------|----------|-------|
| 9–11 | `a`, `a:hover`, `@media dark a` | 354–372 | Low | No `<a>` anchors in the HUD/nav region (legacy region had none either). Likely applies in other views; dead within this surface. |
| 77 | `.inline-clicktoggle span` | 829–831 | Low | `#workoutNameLabel` renders a bare text node, no child `<span>` (true in legacy too). Inert but harmless. |
| 84–89 | `.debug-*` block | 855–918 | Low | Explicitly "no longer used, retained for reference" (comment line 851). No element anywhere. Intentionally dead — candidate for deletion. |

### States reachable but NOT covered by static/pixel screenshots (verify behaviorally, not dead)
These all have matching elements/state-toggles and are **OK**, flagged only as a reminder they won't show in idle-light screenshots:
- `:hover` / `:active` on `.nav-icon-button`, `.device-group`, `.mode-toggle-button`, `.control-btn`, `.playback-button`, `.inline-clicktoggle` (#50,56,62,74,78,79).
- `.status-dot.connecting` / `.status-dot.error` (#45,46) — transient connection states (`dotClass`, `BottomNav.svelte:62`).
- `.battery-low` (#47) — needs HR battery ≤20% (`BottomNav.svelte:179`).
- `.stat-cadence-indicator--visible` arrows ▾/▴ (#20) — needs cadence delta >5 rpm (`hud-format.ts:100`).
- `.mode-toggle-button.active`, `.control-group`/`.control-btn`, `.settings-ftp-*` (#58–68) — free-ride UI only (`freeRideUiActive`).
- `.playback-button.visible` for play/pause/stop (#72) — running/paused states.
- Dark theme variants `:root.theme-dark` and all `@media (prefers-color-scheme: dark)` rules (#2,4,11,25,51,53,63,75,80,82) — reachable via Settings theme toggle / OS dark mode.
- `.status-overlay` visible/opacity:1 + `#statusText` (#81,83) — driven by Beeper during countdown/pause.
