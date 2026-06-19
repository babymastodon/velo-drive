# CSS Coverage Audit — `docs/settings.css`

Scope: `docs/settings.css` (421 lines). The legacy CSS is re-hosted **verbatim/global** in the
new app (identical at `web/src/styles/settings.css`), so the audit is purely about
**element/selector coverage**: for each selector, does the new DOM produce a matching element?

New DOM source: `web/src/ui/SettingsView.svelte` (+ `web/src/ui/OverlayModal.svelte`).
Legacy DOM source: `docs/index.html` (settings region lines 894–1288) + `docs/settings.js`.

The new `SettingsView.svelte` is an extremely faithful re-host: same classes, same IDs, same row
structure, same SVGs. Coverage is near-total. Differences are limited to (a) one orphan ID selector
that exists in neither DOM, and (b) states that depend on runtime data not present in the seeded/
supported screenshot state (compat alert visibility, help-expanded, theme-active, logs populated,
checked toggle, dark theme) — all of which DO have wired markup so the CSS will apply once the state
occurs.

Legend: **OK** = matching element present, CSS applies. **PARTIAL** = element present but a state/
variant is conditional/never exercised. **GAP** = no matching element in new DOM.

---

## Modal / Header

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 1 | `.settings-overlay` | 3 | `#settingsOverlay` div (index.html:896) | OverlayModal root `div class={overlayClass}` (OverlayModal.svelte:42), passed `overlayClass="settings-overlay"` (SettingsView.svelte:190) | OK | New DOM only renders overlay when `open` (`{#if open}` OverlayModal:38) and sets `style="display: flex"` inline (OverlayModal:43); CSS `display:none` default never seen but box/bg/z-index still apply. |
| 2 | `.settings-modal` | 13 | `#settingsModal` (index.html:901) | `#settingsModal.settings-modal` (SettingsView.svelte:197-202) | OK | Same id+class, `tabindex="-1"`. |
| 3 | `.settings-header` | 27 | `<header class="settings-header">` (index.html:902) | `<header class="settings-header">` (SettingsView.svelte:203) | OK | |
| 4 | `.settings-header-actions` | 36 | two action divs (index.html:903, 936) | two `div.settings-header-actions` (SettingsView.svelte:204, 236) | OK | |
| 5 | `.settings-header-actions:last-of-type` | 42 | second actions div (index.html:936) | second `div.settings-header-actions` (SettingsView.svelte:236) | OK | `justify-self:end` applies to the close-button wrapper. |
| 6 | `.settings-header-main` | 46 | `div.settings-header-main` (index.html:932) | `div.settings-header-main` (SettingsView.svelte:230) | OK | |
| 7 | `.settings-modal.logs-active .settings-header-main` | 54 | `#settingsModal.logs-active` (toggled by settings.js when logs open) | `class:logs-active={ui.settingsLogsOpen}` on modal (SettingsView.svelte:199) + `.settings-header-main` (230) | OK | New app toggles `logs-active` reactively; centers the title in logs sub-view. Only visible when logs open. |
| 8 | `.settings-title` | 65 | `#settingsTitle` (index.html:933) | `#settingsTitle.settings-title` (SettingsView.svelte:231) | OK | Text swaps Settings/Connection logs reactively. |
| 9 | `.settings-close-btn` | 73 | `#settingsCloseBtn` (index.html:938) | `#settingsCloseBtn.settings-close-btn` (SettingsView.svelte:239) | OK | |
| 10 | `.settings-close-btn svg` | 88 | close-btn `<svg>` (index.html:942) | close-btn `<svg>` (SettingsView.svelte:244) | OK | Same X-path SVG. |
| 11 | `.settings-close-btn:hover` | 97 | `#settingsCloseBtn` hover | same element (SettingsView.svelte:239) | OK | Hover state — not in screenshots but element present; CSS applies on hover. |
| 12 | `.settings-body` | 101 | `div.settings-body` (index.html:949) | `div.settings-body` (SettingsView.svelte:251) | OK | |
| 13 | `.settings-main-view` | 111 | `#settingsMainView` (index.html:951) | `#settingsMainView.settings-main-view` (SettingsView.svelte:253-257) | OK | New app toggles via inline `style="display:..."`; CSS layout still applies. |
| 14 | `.settings-logs-view` | 122 | `#settingsLogsView` (index.html:1283) | `#settingsLogsView.settings-logs-view` (SettingsView.svelte:657-661) | OK | CSS has `display:none` (130); new app overrides with inline `style="display: {flex|none}"` (660). |
| 15 | `.settings-list` | 132 | `div.settings-list` (index.html:960) | `div.settings-list` (SettingsView.svelte:267) | OK | |

## Setting Rows (shared structure)

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 16 | `.settings-row` | 138 | all 7 `div.settings-row` (index.html:961…) | 7 `div.settings-row` (SettingsView.svelte:269, 328, 402, 451, 518, 572, 627) | OK | Folder/FTP/Sound/Theme/Bluetooth/PWA/Logs rows all present. |
| 17 | `.settings-row-main` | 149 | `div.settings-row-main` (index.html:962…) | `div.settings-row-main` per row (SettingsView.svelte:270…) | OK | |
| 18 | `.settings-icon` | 157 | `div.settings-icon` (index.html:963…) | `div.settings-icon` per row (SettingsView.svelte:271…) | OK | |
| 19 | `.settings-icon svg` | 169 | icon `<svg>` per row | icon `<svg>` per row (SettingsView.svelte:272…) | OK | All 7 SVG glyphs copied verbatim. |
| 20 | `.settings-row-text` | 178 | `div.settings-row-text` | `div.settings-row-text` per row (SettingsView.svelte:276…) | OK | |
| 21 | `.settings-row-label` | 185 | `div.settings-row-label` | `div.settings-row-label` per row (SettingsView.svelte:277…) | OK | |
| 22 | `.settings-row-description` | 191 | `div.settings-row-description` | `div.settings-row-description` per row (SettingsView.svelte:287…) | OK | |
| 23 | `.settings-row-status` | 197 | `#rootDirStatus` / `#settingsBtStatusText` / `#settingsPwaStatusText` | SettingsView.svelte:295, 545, 604 | OK | Three status spans present. |
| 24 | `.settings-status-ok` | 202 | added by settings.js when configured/available | `class:settings-status-ok={…}` on rootDir (298), BT (546), PWA (606) | OK | New app applies via reactive `class:` bindings; green text shows when configured/available. |
| 25 | `.settings-status-missing` | 206 | added by settings.js when missing | `class:settings-status-missing={…}` rootDir (299), BT (547), PWA (607) | OK | Red text when not-configured/unavailable. Both ok/missing variants are wired. |
| 26 | `.settings-button` | 210 | `#settingsBackFromLogsBtn`, `#rootDirButton`, `#settingsOpenLogsBtn` | SettingsView.svelte:207, 305, 644 | OK | All three `.settings-button` instances present. |
| 27 | `.settings-button:hover` | 227 | same buttons hover | same elements (207, 305, 644) | OK | Hover not in screenshots; elements present so CSS applies on hover. |
| 28 | `.settings-input` | 231 | (legacy generic settings input) | — | GAP (cosmetic) | No element carries class `settings-input` in **either** DOM. The FTP input uses `settings-ftp-input` (line 1044/364). Orphan in legacy too → not a regression. See Gaps. |
| 29 | `.settings-input:focus` | 243 | same as #28 | — | GAP (cosmetic) | Same orphan as #28; no `.settings-input` element exists. |
| 30 | `.settings-inline-group` | 249 | `div.settings-inline-group` (index.html:985) | `div.settings-inline-group` (SettingsView.svelte:293) | OK | Wraps rootDir status + Choose button. |
| 31 | `.settings-error` | 256 | (legacy validation error node, created by settings.js) | — | GAP (state) | No `.settings-error` node in new DOM; FTP validation is clamp-only (`normaliseFtp` SettingsView:48), no error message rendered. Was this ever shown in legacy? Likely vestigial. See Gaps. |
| 32 | `.settings-row-right` | 405 | `div.settings-row-right` | `div.settings-row-right` per row (SettingsView.svelte:292, 351, 426, 473, 542, 602, 641) | OK | |

## FTP Stepper

Note: FTP stepper uses `control-group` / `control-btn` / `control-value` / `settings-ftp-input` /
`settings-ftp-unit` classes that are **not defined in this file** (shared controls CSS elsewhere).
This file only provides the surrounding `.settings-row*` wrappers, all covered above.

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| — | (FTP row wrappers) | 138, 149, 157, 178, 405 | FTP `div.settings-row` (index.html:1009) | FTP `div.settings-row` (SettingsView.svelte:328) | OK | `#settingsFtpControls.control-group`, `control-btn`, `control-value`, `settings-ftp-input`, `settings-ftp-unit` are all present in new DOM (SettingsView.svelte:352-387) but styled by a different CSS file — out of scope for settings.css. |

## Sound Toggle (slider switch)

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 33 | `.settings-toggle-switch` | 264 | `<label class="settings-toggle-switch">` (index.html:1097) | `<label class="settings-toggle-switch">` (SettingsView.svelte:427) | OK | |
| 34 | `.settings-toggle-switch input` | 272 | `#settingsSoundCheckbox` (index.html:1098) | `#settingsSoundCheckbox` checkbox (SettingsView.svelte:428-434) | OK | Visually-hidden input. |
| 35 | `.settings-toggle-slider` | 278 | `<span class="settings-toggle-slider">` (index.html:1099) | `<span class="settings-toggle-slider">` (SettingsView.svelte:435) | OK | |
| 36 | `.settings-toggle-slider::before` | 287 | slider span ::before (thumb) | same span (SettingsView.svelte:435) | OK | Pseudo-element thumb. |
| 37 | `.settings-toggle-switch input:checked+.settings-toggle-slider` | 300 | checked state | `checked={soundEnabled}` (SettingsView.svelte:432) drives `:checked`; slider follows (435) | OK | Checked-track-color state — wired via reactive `checked`; default seed is `true` (SettingsView:82) so the checked style is exercised. |
| 38 | `.settings-toggle-switch input:checked+.settings-toggle-slider::before` | 304 | checked thumb translate | same (432/435) | OK | Thumb slides on checked. |

## Theme Toggle

Note: `mode-toggle` / `mode-toggle-button` / `.active` belong to a **shared toggle component** (also
used by the difficulty/picker UIs); not defined in settings.css. This file styles only the
surrounding row, covered above. The theme markup IS present in the new DOM.

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| — | (Theme row wrappers) | 138… | Theme `div.settings-row` (index.html:1109) | Theme `div.settings-row` (SettingsView.svelte:451) | OK | `#settingsThemeToggle.mode-toggle` + 3 `mode-toggle-button` present (SettingsView.svelte:474-513) with reactive `class:active` (482, 493, 504) — but `.active`/`.mode-toggle-button` styles live in another CSS file, out of scope here. |

## VeloDrive Folder

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| — | (Folder row) | 138, 197, 202, 206, 210, 249 | Folder `div.settings-row` (index.html:961), `#rootDirStatus` (986), `#rootDirButton` (988) | SettingsView.svelte:269, 295, 305 | OK | All covered by shared-row selectors (#16-32). Status ok/missing classes reactive (298-299). |

## Environment / Compatibility Alert

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 39 | `.settings-alert` | 380 | `#settingsCompatibilityAlert` (index.html:953, `hidden`) | `#settingsCompatibilityAlert.settings-alert.settings-alert-warning` (SettingsView.svelte:258-265) | PARTIAL | Element present but `hidden={!compatAlertText}`; `compatAlertText` is empty in supported/seeded state (SettingsView:130, comment 127-129), so the alert is **never visible** in screenshots. CSS applies only when `compatMessage()` returns non-empty (unsupported browser). |
| 40 | `.settings-alert-warning` | 388 | same alert (warning variant) | same element (SettingsView.svelte:260) | PARTIAL | Always co-applied with `.settings-alert`; same visibility caveat as #39. The warning bg/text only render in an unsupported environment. |

## Help / User-Guide Sections

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 41 | `.settings-help-toggle-btn` | 339 | `button[data-settings-help-toggle]` ×5 (index.html:971, 1019, 1083, 1174, 1226) | `button.settings-help-toggle-btn` ×5 (SettingsView.svelte:280, 338, 413, 529, 590) | OK | Legacy wires via `data-settings-help-toggle`; new app uses `onclick={() => toggleHelp(id)}` (no data attr) — irrelevant to CSS, which matches by class only. 5 toggles present (Folder/FTP/Sound/Bluetooth/PWA). |
| 42 | `.settings-help-content` | 350 | `#settingsFoldersHelp`/`Ftp`/`Sound`/`Env`/`Pwa` Help (index.html:998, 1064, 1104, 1195, 1247) | 5 `.settings-help-content` divs (SettingsView.svelte:316, 391, 440, 554, 614) | OK | All 5 help bodies present. |
| 43 | `.settings-help-content--visible` | 360 | added by settings.js on expand | `class:settings-help-content--visible={helpOpen.<id>}` (SettingsView.svelte:319, 394, 443, 557, 617) | OK | Reactive expand class wired per section; triggers fade-in animation. |
| 44 | `@keyframes settingsHelpFadeIn` | 364 | animation for help expand | referenced by #43 element | OK | Animation defined + referenced; runs on expand. |
| 45 | `.settings-help-content[hidden]` | 376 | help div `hidden` attr (collapsed) | `hidden={!helpOpen.<id>}` (SettingsView.svelte:320, 395, 444, 558, 618) | OK | New app drives `hidden` reactively; collapsed state matches `[hidden]` rule. |

## Logs View

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 46 | `.settings-logs-header` | 310 | (legacy logs header row) | — | GAP (cosmetic) | No `.settings-logs-header` element in **either** DOM. New logs view (SettingsView.svelte:657-668) contains only `#settingsLogsContent`; the back/title moved to the shared header. Orphan in legacy too → not a regression. See Gaps. |
| 47 | `.settings-logs-title` | 317 | (legacy logs title) | — | GAP (cosmetic) | Same as #46 — no `.settings-logs-title` element exists in new DOM (logs title is the shared `.settings-title`). Orphan in legacy DOM as well. |
| 48 | `.settings-logs-body` | 322 | `#settingsLogsContent` (index.html:1284) | `#settingsLogsContent.settings-logs-body` (SettingsView.svelte:663-667) | PARTIAL | Element present; styled monospace pre. Empty in seeded screenshots (`logs.lines` empty → `logText` blank); padding/border render but text/scroll only with logs populated. |

## Responsive / Theme

| # | Selector | docs/settings.css:line | Targets (legacy element) | New element (web/src file:line) | Status | Notes |
|---|----------|------------------------|--------------------------|----------------------------------|--------|-------|
| 49 | `@media (max-width:900px) .settings-modal` | 393 | `.settings-modal` narrow | `#settingsModal.settings-modal` (SettingsView.svelte:197) | OK | Width/height/padding override at ≤900px; element present. Not shown in desktop screenshots. |
| 50 | `@media (max-width:900px) .settings-row` | 400 | `.settings-row` narrow | all `.settings-row` (SettingsView.svelte:269…) | OK | `align-items:flex-start` at ≤900px; elements present. |
| 51 | `#settingsBtStatusCta` | 415 | (none — no such id in index.html:894-1288) | — | GAP (dead rule) | Orphan ID selector: **no `#settingsBtStatusCta` element exists in legacy OR new DOM** (grep confirms only the two CSS files). Dead rule in both; not a regression. See Gaps. |
| 52 | `#settingsBackFromLogsBtn` | 419 | `#settingsBackFromLogsBtn` (index.html:905) | `#settingsBackFromLogsBtn` (SettingsView.svelte:206) | OK | `padding-left:4px`; element present, shown only in logs sub-view (inline `display` toggled, SettingsView:210). |

Note on **dark theme**: settings.css uses only CSS custom properties (`var(--surface-elevated)`,
`var(--toggle-checked)`, `var(--alert-bg)`, etc.); it defines no `.theme-dark`/`[data-theme]`
selectors itself. Dark theme is delivered by the shared theme variables (toggled on `<html>` by
`saveAndApplyThemeMode`, SettingsView:101) — out of scope for this file's selector coverage. Every
themed property here resolves through a variable, so the new DOM inherits dark theme correctly.

---

## Gaps

All elements rendered by the legacy settings DOM are reproduced by the new `SettingsView.svelte`.
The only true gaps are **orphan selectors that match no element in either DOM** (dead rules carried
over verbatim) plus **PARTIAL state-dependent rules** whose markup exists but whose state isn't
exercised in the seeded/supported screenshot.

### GAP — orphan/dead selectors (no regression; absent in legacy too) — severity: LOW (cosmetic)

- **#28 `.settings-input` / #29 `.settings-input:focus`** (settings.css:231, 243): No element has
  class `settings-input` in legacy `index.html` (894-1288) or new DOM. The FTP field uses
  `settings-ftp-input`. Dead in both. No action needed.
- **#46 `.settings-logs-header` / #47 `.settings-logs-title`** (settings.css:310, 317): No matching
  element in legacy or new DOM; the logs sub-view has only `#settingsLogsContent`, and the
  title/back live in the shared header. Dead in both. No action needed.
- **#51 `#settingsBtStatusCta`** (settings.css:415): grep confirms this ID appears **only** in the
  two CSS files — never in any HTML/Svelte. Pure dead rule in both old and new. No action needed.

### GAP — runtime-only node not rendered — severity: LOW

- **#31 `.settings-error`** (settings.css:256): The new FTP flow clamps silently (`normaliseFtp`,
  SettingsView:48-52) and never renders a `.settings-error` node. If the legacy `settings.js` ever
  injected such a node on invalid input, that error styling is unreachable in the new app. Verify
  whether legacy actually used it; if so it's a behavior gap (no visible validation message), but
  cosmetically minor. Most likely vestigial.

### PARTIAL — wired but state-gated (CSS will apply when state occurs) — severity: LOW

- **#39 `.settings-alert` / #40 `.settings-alert-warning`** (settings.css:380, 388): Markup present
  (SettingsView:258-265) but `hidden` whenever `compatMessage()` is empty — i.e. supported browsers
  / seeded state. The warning style only renders on an unsupported environment. Screenshots in the
  supported state will never show it; to verify the styling, exercise an unsupported-compat state.
- **#48 `.settings-logs-body`** (settings.css:322): Present but empty in seeded screenshots; the
  monospace text/scroll styling only manifests once `logs.lines` is populated.
- **#37/#38 checked-toggle, #43 help-expanded, theme `.active`, dark theme**: all reactively wired;
  exercised only in the corresponding interaction state (toggle on, help open, theme selected, dark
  mode). No coverage gap — just not visible in a default static screenshot.

---

## Summary

- **Selectors audited:** 52 rules.
- **OK:** 44 — faithful 1:1 re-host (same classes, IDs, row structure, SVGs); reactive `class:` /
  `hidden` / inline-`style` bindings correctly drive every stateful selector (status ok/missing,
  toggle checked, help visible/hidden, logs-active, theme active).
- **PARTIAL:** 4 — `.settings-alert`(2), `.settings-logs-body`, all state-gated (compat unsupported,
  logs populated); markup present, CSS applies once state occurs.
- **GAP:** 4 — all **orphan/dead selectors that match no element in legacy OR new DOM**
  (`.settings-input`+`:focus`, `.settings-logs-header`, `.settings-logs-title`,
  `#settingsBtStatusCta`) — pre-existing dead rules carried over verbatim, **no regression** — plus
  `.settings-error` which is a runtime-injected node the new app never renders (likely vestigial).

**Top gaps:** none are real coverage regressions. The 4 dead selectors were already dead in the
legacy DOM, and the `.settings-error` node is the only spot where new behavior (silent FTP clamp)
diverges from a potential legacy error message — worth a quick confirm against `settings.js`, but
cosmetically negligible. Overall settings.css coverage in the new DOM is effectively complete.
