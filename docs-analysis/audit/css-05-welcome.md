# CSS Coverage Audit — `docs/welcome.css`

**Scope:** `docs/welcome.css` (495 lines) — welcome/tour overlay. The legacy CSS is
re-hosted verbatim and global in the new app (`web/src/styles/welcome.css` is
byte-identical), so rules are IDENTICAL. This audit checks **element/selector
coverage**: does the NEW DOM emit a matching element so each rule applies?

**Cross-refs:**
- Legacy DOM: `docs/index.html:57-114`; legacy JS: `docs/welcome.js`.
- New DOM: `web/src/ui/WelcomeView.svelte`, `web/src/ui/welcome-scene.ts`.
- `welcome-active` body guard: `web/src/ui/App.svelte:85-89`; targets
  `.page-root` (`web/src/ui/HudView.svelte:33`) and `.bottom-nav`
  (`web/src/ui/BottomNav.svelte:150`).

**Intentional behavioral differences (NOT bugs — per task brief):**
- New app does NOT use the first-paint body guard (`<body class="welcome-active">`
  is set in `docs/index.html:57` on boot; the new app starts with welcome at
  `'none'` and toggles the class reactively in `App.svelte:88`). The selector
  still resolves correctly when welcome is opened.
- Slide/scene ANIMATIONS are reduced to instant for deterministic pixel-diff. The
  new app marks scenes `welcome-scene--steady` immediately (`WelcomeView.svelte:79`)
  and never emits the per-step transition state classes. Animation/transition
  selectors therefore have no matching state-toggled element — marked intentional.

---

## Overlay

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 1 | `.welcome-overlay` | 5 | `#welcomeOverlay` (index.html:59) | `WelcomeView.svelte:199-200` | OK | Class + id identical |
| 2 | `.welcome-shell` | 17 | `.welcome-shell` (index.html:66) | `WelcomeView.svelte:208` | OK | |
| 3 | `@media (max-width:720px) .welcome-shell` | 28-32 | same | same | OK | Same element; media query applies |
| 4 | `.welcome-overlay:not(.welcome-overlay--visible) .welcome-nav` | 169 | overlay before `--visible` added (welcome.js:659) | `WelcomeView.svelte` always renders with `--visible` (200) | PARTIAL | New overlay only ever mounts WITH `--visible`, so the `:not(--visible)` branch never matches. Hides nav during pre-show fade in legacy; new app skips that phase. Intentional (instant). |
| 5 | `.welcome-overlay--hiding` | 452 | overlay during fade-out (welcome.js:610) | none | GAP (intentional) | New app unmounts via `{#if open}` (WelcomeView.svelte:197) instead of a `--hiding` fade class. No element ever carries `--hiding`. |
| 6 | `.welcome-overlay--hiding .welcome-shell` | 462 | same | none | GAP (intentional) | Same as #5 — no `--hiding` state. |
| 7 | `.welcome-shell` (transition opacity 200ms) | 458-460 | `.welcome-shell` | `WelcomeView.svelte:208` | OK (inert) | Selector matches; transition only triggers via `--hiding`, which never appears (#6). |

## Title / Header

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 8 | `.welcome-header` | 113 | `<header class="welcome-header">` (index.html:79) | `WelcomeView.svelte:230` | OK | |
| 9 | `.welcome-title` | 121 | `#welcomeTitle` (index.html:80) | `WelcomeView.svelte:231` | OK | id + class identical |
| 10 | `@media .welcome-title` (font 26px) | 483-485 | same | same | OK | |

## Scene

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 11 | `.welcome-main` | 132 | `<main class="welcome-main">` (index.html:83) | `WelcomeView.svelte:234` | OK | |
| 12 | `.welcome-scene-wrapper` | 222 | `.welcome-scene-wrapper` (index.html:84) | `WelcomeView.svelte:235` | OK | |
| 13 | `@media .welcome-scene-wrapper` | 491-494 | same | same | OK | |
| 14 | `.welcome-scene` | 236 | `#welcomeScene` (index.html:86) | `WelcomeView.svelte:236` | OK | id + class identical |
| 15 | `.welcome-scene-root` | 246 | svg built in welcome.js:126 | `welcome-scene.ts:92` (`svg.classList.add('welcome-scene-root')`) | OK | |
| 16 | `.welcome-scene-root .scene-piece` | 254 | wrappers, welcome.js:146 | `welcome-scene.ts:106` (`addDelay` adds `scene-piece`) | OK | base `opacity:0` applies |
| 17 | `.scene-asset` | 293 | welcome.js:211/285 | `welcome-scene.ts:138,188` | OK | |
| 18 | `.scene-enter-grow/.scene-enter-fly` (class on root) | 96 (added via `scene-enter-${type}`) | welcome.js:130 | `welcome-scene.ts:96` | OK | Root carries `scene-enter-*`/`scene-steady-*`/`scene-exit-*` classes |

## Scene animation hooks (state-toggled)

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 19 | `.scene-enter-grow.welcome-scene--enter .scene-piece` | 260 | `--enter` state class (welcome.js:379) | none — new app never adds `welcome-scene--enter` | GAP (intentional) | Animations reduced to instant; new app jumps straight to `--steady`. |
| 20 | `.scene-enter-fly.welcome-scene--enter .scene-piece` | 265 | same | none | GAP (intentional) | Same. |
| 21 | `.scene-steady-float.welcome-scene--steady .scene-piece` | 270 | `--steady` (welcome.js:385) | `WelcomeView.svelte:79` adds `welcome-scene--steady` | PARTIAL (intentional) | The `--steady` class IS emitted, but only `scene-steady-none` layout is used for splash; non-splash scenes default `steadyType='float'` (scene-scene.ts:94) so this rule's `opacity:1` applies. `animation: scene-float` runs but is neutralized by the harness disabling animations. |
| 22 | `.scene-steady-none.welcome-scene--steady .scene-piece` | 276 | splash steady | `welcome-scene.ts:96` (`scene-steady-none` for splash) + `--steady` (WelcomeView:79) | OK | `opacity:1; animation:none` — applies for splash scene; deterministic. |
| 23 | `.scene-exit-fade.welcome-scene--exit .scene-piece` | 281 | `--exit` (welcome.js exit path) | none — `welcome-scene--exit` never added | GAP (intentional) | No exit animation in new app. |
| 24 | `.scene-exit-rise.welcome-scene--exit .scene-piece` | 287 | same | none | GAP (intentional) | Same. |
| 25 | `@keyframes scene-enter-grow/fly/float/exit-fade/exit-rise` | 299-370 | referenced by 19-24 | only `scene-float` (via #21) / `scene-steady-none` no-anim | PARTIAL (intentional) | Keyframes are global and valid; only consumed where the state class appears. enter/exit keyframes unused because their state classes (#19-24) are never set. |

## Body / slides

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 26 | `.welcome-slide` | 60 | `.welcome-slide ...` (index.html:76-77) | `WelcomeView.svelte:223-224` | OK | Base transition selector; element present |
| 27 | `@media .welcome-slide` | 478-481 | same | same | OK | |
| 28 | `.welcome-slide--animating` | 70 | welcome.js animate path | none | GAP (intentional) | New app never adds `--animating`; slide transitions instant. |
| 29 | `.welcome-slide--animating-out-forward` | 74 | welcome.js:552 | none | GAP (intentional) | Same. |
| 30 | `.welcome-slide--animating-out-backward` | 80 | welcome.js:551 | none | GAP (intentional) | Same. |
| 31 | `.welcome-slide--animating-in-forward` | 86 | welcome.js:555 | none | GAP (intentional) | Same. |
| 32 | `.welcome-slide--animating-in-backward` | 92 | welcome.js:554 | none | GAP (intentional) | Same. |
| 33 | `.welcome-slide--animating-in-*.welcome-slide--active` | 98-102 | welcome.js:582 | none — `welcome-slide--active` never added | GAP (intentional) | New app has a single persistent slide div (`WelcomeView.svelte:223`); no clone/swap, so `welcome-slide--active` is never emitted. |
| 34 | `.welcome-slide-clone` | 104 | clone node (welcome.js slide swap) | none | GAP (intentional) | New app re-renders one slide div in place; no clone element. |
| 35 | `.welcome-body` | 374 | `#welcomeBody` (index.html:93) | `WelcomeView.svelte:241` | OK | id + class identical |
| 36 | `@media .welcome-body` | 487-489 | same | same | OK | |
| 37 | `.welcome-body-line` | 393 | spans built in welcome.js | `WelcomeView.svelte:122` (`bodyHtml` wraps each line) | OK | `<span class="welcome-body-line">` emitted via `{@html}` |
| 38 | `.welcome-title, .welcome-body` (transition) | 398-402 | both elements | both present (231, 241) | OK | |
| 39 | `.welcome-text-hidden .welcome-title` | 404 | slide w/ `welcome-text-hidden` (index.html:77) | `WelcomeView.svelte:227` (`class:welcome-text-hidden`) | OK | |
| 40 | `.welcome-text-visible .welcome-title` | 409 | slide w/ `welcome-text-visible` (welcome.js:521) | `WelcomeView.svelte:228` (`class:welcome-text-visible`) | PARTIAL | New app only sets `welcome-text-visible` when `slide.id === 'splash'` (WelcomeView:228). On non-splash slides neither hidden nor visible class is set, so title sits at its default (no `--visible` transform). Legacy applied `--visible` on every slide reveal (welcome.js:521,525). Cosmetic; default style already shows title. |
| 41 | `.welcome-text-hidden .welcome-body` | 414 | same | `WelcomeView.svelte:227` | OK | |
| 42 | `.welcome-text-visible .welcome-body` | 419 | same | `WelcomeView.svelte:228` | PARTIAL | Same as #40 — `welcome-text-visible` only on splash. |

## Nav arrows

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 43 | `.welcome-nav` | 149 | `#welcomePrevBtn/#welcomeNextBtn` (index.html:97/106) | `WelcomeView.svelte:245,259` | OK | |
| 44 | `.welcome-nav span` | 200 | `<span>❮/❯</span>` (index.html:102/111) | `WelcomeView.svelte:256,270` | OK | |
| 45 | `.welcome-nav:hover` | 206 | nav buttons hover | same elements | OK | Hover pseudo applies to identical buttons |
| 46 | `.welcome-nav:disabled` | 211 | nav `disabled` attr (legacy could disable) | NOT emitted — new app uses `style="visibility:hidden"` for prev at index 0 (WelcomeView:250), never `disabled` | PARTIAL | The `:disabled` style branch never triggers; new app hides prev arrow via inline `visibility` instead of `disabled`. Visually equivalent (both hide), but the dimmed-disabled appearance (`opacity:0.4`) is unreachable. |
| 47 | `.welcome-nav-prev` | 192 | `.welcome-nav-prev` (index.html:98) | `WelcomeView.svelte:246` | OK | |
| 48 | `.welcome-nav-next` | 196 | `.welcome-nav-next` (index.html:107) | `WelcomeView.svelte:260` | OK | |
| 49 | `.welcome-nav-hidden` | 216 | welcome.js:518/522 toggles | none — new app uses inline `visibility` (WelcomeView:250) | GAP (intentional/refactor) | New app never adds `welcome-nav-hidden`; prev-arrow hiding done via `style="visibility:..."`. Rule resolves to no element. Functionally covered by inline style. |
| 50 | `.welcome-slide--splash .welcome-nav` (boot anim) | 174-178 | splash slide nav | `WelcomeView.svelte:225` (`welcome-slide--splash`) + nav present | OK (inert) | Element match exists; `welcome-nav-boot` keyframe animation runs but is neutralized by disabled-animation harness. |
| 51 | `@keyframes welcome-nav-boot` | 180-190 | referenced by #50 | via #50 | OK (inert) | Valid; consumed by #50, animation disabled in harness. |

## Buttons (close)

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 52 | `.welcome-close-btn` | 36 | `#welcomeCloseBtn` (index.html:67) | `WelcomeView.svelte:210` | OK | id + class identical |
| 53 | `.welcome-close-btn:hover` | 53 | close btn hover | same element | OK | |

## Splash / icon-only

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 54 | `.welcome-slide--icon-only .welcome-main` | 426 | `.welcome-slide--icon-only` (index.html:77) | `WelcomeView.svelte:226` (`class:welcome-slide--icon-only`) | OK | Added when `slide.kind==='splash'` |
| 55 | `.welcome-overlay--splash-only .welcome-nav/.welcome-close-btn/.welcome-header/.welcome-body` | 430-435 | `--splash-only` toggled (welcome.js:473) | `WelcomeView.svelte:201` (`class:welcome-overlay--splash-only={splashMode}`) | OK | All four descendant targets present |
| 56 | `.welcome-overlay--splash-only .welcome-shell` | 437 | same | `WelcomeView.svelte:201,208` | OK | |
| 57 | `.welcome-overlay--splash-only .welcome-slide` | 443 | same | `WelcomeView.svelte:201,223` | OK | |
| 58 | `.welcome-overlay--splash-only .welcome-main` | 448 | same | `WelcomeView.svelte:201,234` | OK | |

## welcome-active body guard

| # | Selector | css:line | Targets (legacy) | New element | Status | Notes |
|---|----------|----------|------------------|-------------|--------|-------|
| 59 | `body.welcome-active .page-root` | 467 | `<body class="welcome-active">` boot (index.html:57) + `.page-root` (index.html:116) | `App.svelte:88` toggles `welcome-active`; `.page-root` = `HudView.svelte:33` | OK (reactive, not first-paint) | New app toggles the class reactively when welcome opens, not on boot. Selector + both elements present → rule applies when active. First-paint guard intentionally absent (new app never shows welcome on boot). |
| 60 | `body.welcome-active .bottom-nav` | 468 | same body + `.bottom-nav` (index.html bottom nav) | `App.svelte:88` + `.bottom-nav` = `BottomNav.svelte:150` | OK (reactive) | Same as #59. Both targets present. |

---

## Gaps

Severity scale: **High** = visible structural divergence in the rendered/tested
state; **Low** = inert / intentional / cosmetically equivalent.

### Real structural gaps (non-intentional)

| Sev | # | Selector | Issue |
|-----|---|----------|-------|
| Low | 40, 42 | `.welcome-text-visible .welcome-title/.welcome-body` | New app sets `welcome-text-visible` ONLY on the splash slide (`WelcomeView.svelte:228`). On the 3 content slides neither text-state class is set, so title/body render at their CSS default (already opacity:1, no transform). Legacy applied `--visible` on every reveal (welcome.js:521,525). No visible difference in the steady render, but the reveal-state class is structurally absent on content slides. |
| Low | 46 | `.welcome-nav:disabled` | New app never emits a `disabled` nav button; the first-slide prev arrow is hidden via inline `style="visibility:hidden"` (`WelcomeView.svelte:250`) rather than `disabled`. The `:disabled { opacity:0.4 }` dimmed appearance is unreachable. Hover state (#45) on a non-disabled prev arrow could theoretically still fire, but the button is `visibility:hidden` so it is not interactable — net equivalent. |
| Low | 49 | `.welcome-nav-hidden` | Refactored away — same inline-visibility approach replaces the class. Rule matches nothing but functionality is preserved. |
| Low | 4 | `.welcome-overlay:not(--visible) .welcome-nav` | New overlay always mounts with `--visible` (`WelcomeView.svelte:200`), so the pre-show "hide nav" branch never matches. No pre-show fade phase in the new app. |

### Intentional (animation/transition reductions — per brief, NOT bugs)

| # | Selector | Reason |
|---|----------|--------|
| 5, 6 | `.welcome-overlay--hiding[ .welcome-shell]` | New app unmounts via `{#if open}` instead of a fade-out class. |
| 19, 20, 23, 24 | `.scene-enter-*/.scene-exit-* .welcome-scene--enter/--exit .scene-piece` | Scene enter/exit state classes never added; scenes jump to `--steady` (`WelcomeView.svelte:79`). Animations disabled for deterministic pixel-diff. |
| 21, 25 | `scene-steady-float` / enter+exit `@keyframes` | Steady class IS emitted; float animation neutralized by harness. enter/exit keyframes unconsumed. |
| 28-34 | `.welcome-slide--animating-*`, `--active`, `-clone` | New app renders one persistent slide div in place (no clone/dual-slide swap), so slide transition + clone classes are never emitted. |
| 50, 51 | `.welcome-slide--splash .welcome-nav` boot anim + `@keyframes welcome-nav-boot` | Element matches; animation neutralized by disabled-animation harness. |

### Intentional — body guard

| # | Selector | Reason |
|---|----------|--------|
| 59, 60 | `body.welcome-active .page-root/.bottom-nav` | New app does NOT set `welcome-active` as a first-paint boot guard (legacy hardcodes it on `<body>` to prevent flash). It toggles reactively in `App.svelte:88` when welcome opens. Both descendant targets (`.page-root` in HudView, `.bottom-nav` in BottomNav) exist, so the rule fully applies whenever welcome is active. |

---

## Summary

- **Total selectors/rules audited:** 60.
- **OK (incl. inert keyframes that are valid + element-matched):** 38.
- **PARTIAL:** 6 (#4, #21, #25, #40, #42, #46) — most are intentional
  animation/refactor differences; only the text-visible state classes (#40/#42)
  and the unreachable `:disabled` style (#46) reflect a genuine, low-severity
  structural divergence.
- **GAP:** 16 — **all intentional**: 14 are animation/transition/slide-clone
  reductions for deterministic pixel-diff, 2 are the `--hiding` fade-out (replaced
  by Svelte unmount). Zero unexplained GAPs.

**Top real gaps (all Low severity):**
1. `.welcome-text-visible` reveal class set only on splash, not the 3 content
   slides (#40/#42) — no visible effect in the steady render, but a structural
   divergence from legacy's per-slide reveal.
2. `.welcome-nav:disabled` / `.welcome-nav-hidden` styling unreachable — new app
   hides the first-slide prev arrow with inline `visibility` instead of a
   class/attribute (#46/#49). Functionally equivalent.

**No high-severity coverage gaps.** Every selector whose CSS would visibly affect
the deterministic (animation-disabled) render has a matching element in the new
DOM: overlay, shell, header/title, scene (root/wrapper/scene/pieces/assets),
body + body-line, prev/next/close buttons, splash-only descendant rules, and the
`welcome-active` body guard (both `.page-root` and `.bottom-nav` targets present).
