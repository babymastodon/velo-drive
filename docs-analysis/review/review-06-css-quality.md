# Review 06 — CSS Quality / Factoring / Simplicity

READ-ONLY review. **No code changed.** Lens = QUALITY · FACTORING · SIMPLICITY.

Scope: `web/src/styles/*.css` — `index` (18), `workout-base` (1190), `workout-picker`
(1349), `workout-planner` (583), `settings` (421), `welcome` (495). Total 4056 lines.

Builds on the selector-coverage audit (`docs-analysis/audit/00-css-gap-summary.md` +
`css-01..05-*.md`), which asked "does each re-hosted rule still match an element?" This
review asks the orthogonal question: **is the CSS itself clean, or spaghetti, and what
render-preserving cleanup is worth doing given the parity tension?**

---

## TL;DR

The CSS is **mostly clean and well-tokenized — not spaghetti** — but it carries one large,
structural wart: **theme-token quadruplication in `workout-base.css`** (~290 token
declarations for only **79 unique tokens**, redeclared across 4 theme contexts), plus a
matching ~9 per-rule dark-mode clusters that each get written 3–4×. Everything else is
small: a handful of dead rules, some copy-pasted button/state bodies, 13 raw `!important`,
and a few un-tokenized scrim/shadow alphas.

The standout fact: **`settings.css`, `welcome.css`, and `workout-picker.css` have ZERO
theme-override blocks** — they theme entirely through `--var` tokens and "just work" in
dark mode. They are the proof that the duplication in `workout-base` (and the one cluster
in `workout-planner`) is *avoidable in principle*. The duplication exists only because (a)
a few rules hard-code a palette instead of referencing a token, and (b) the theme
mechanism leaves **Auto mode class-less**, forcing every palette to be declared once for
`@media (prefers-color-scheme: dark)` *and* again for the manual `.theme-dark`/`.theme-light`
classes.

**Verdict (full version at the bottom):** worth doing the **zero-risk dead-rule deletions
now** (~70 lines, no parity divergence worth worrying about). The big theme-system collapse
(~250–300 lines) is **feasible and render-preserving but NOT worth it right now** — it
touches the exact dark-mode/forced-theme mechanism just stabilized in the last fixes, and
the visual-regression gate would still pass even if a subtle Auto-mode bug slipped through
(the gate renders a fixed theme, not the OS-flip path).

---

## Quantification up front

| Metric | Value | Notes |
|---|---|---|
| `--var` **definitions** | 290 (288 in base + 1 picker + 1 planner) | |
| **Unique** token names | **79** | so ~211 declarations are redeclarations |
| Theme contexts in `workout-base` | 4 | `:root` 77 · `@media dark :root` 73 · `:root.theme-light` 71 · `:root.theme-dark` 71 |
| Lines spent on the 4 token blocks (base 1–343) | **343** | for 79 tokens → ~4.3 lines/token |
| `@media (prefers-color-scheme: dark)` blocks | 11 | 10 in base + 1 planner |
| `:root.theme-dark` rule blocks | 15 | 13 base (root + per-rule) + 1 planner + the root |
| `:root.theme-light` rule blocks | 15 | mirror of above |
| Per-rule dark clusters in base (3–4× each) | ~9 | tooltip, nav hovers, control/playback/clicktoggle hovers, debug, status-overlay |
| Raw hex tokens total | 235 | the vast majority are **inside** the 4 token blocks (legit) |
| Raw hex **outside** token blocks (should-be-token) | ~21 in base + 2 settings + 1 welcome | mostly `.chart-tooltip`, status-dot states, `rgba(0,0,0,.35)` scrims |
| `!important` | 13 | picker 6 · planner 3 · welcome 1 · (settings 0, base 0) |
| Theme-override blocks in settings / welcome / picker | **0 / 0 / 0** | fully token-driven — the clean model |

---

## Findings table

Severity: **S**=structural/maintainability-heavy, **M**=medium, **L**=low/cosmetic.
"Render-preserving" = can be cleaned without changing rendered pixels (gate stays green).
"Parity" = how far it diverges from the byte-faithful legacy re-host.

| # | Finding | Location (file:line) | Sev | Render-preserving cleanup? + est. line reduction + parity tradeoff |
|---|---|---|---|---|
| 1 | **Theme-token quadruplication** — 79 unique tokens declared across `:root` + `@media dark` + `.theme-light` + `.theme-dark`. `:root.theme-light` is a near-verbatim copy of base `:root` (color tokens only). | workout-base.css:1–343 | **S** | YES but mechanism-touching. Collapsing to 2 contexts saves **~250–300 lines**. Parity: HIGH divergence + touches just-fixed dark path. See deep-dive. |
| 2 | **Per-rule dark clusters written 3–4×** — same selector re-declared for `@media dark`, `.theme-dark`, `.theme-light` (the forced-theme parity pattern). ~9 clusters. | base: `.chart-tooltip` 499/515/528/535; nav hovers 697/703/709/714; `.nav-icon-button.active` 719/724/729/733; `.control-btn:hover` 807/811/817/821; `.playback-button:hover` 877/881/887/891; `.inline-clicktoggle` 914/922/932/940; `.status-overlay` 1047/1064/1074/1079 | **S** | YES — most of these exist **only because the rule hard-codes a palette instead of a token** (see #3). Tokenize → the dark variants vanish. Saves **~120 lines** in base. Parity: medium (these *are* the legacy parity-fix blocks). |
| 3 | **`.chart-tooltip` hard-codes hex 4×** despite `--tooltip-bg/-text/-border/-shadow` tokens existing for exactly this. | base:499–540 (defs at 31–34, 122–125, 207–210, 292–295) | M | YES, high-value. Replace 4 palette copies with one rule referencing the existing tokens → drop 3 of the 4 blocks (**~24 lines**). Zero render change. Parity: low — legacy left it un-tokenized, but this is an obvious oversight. |
| 4 | **Dead `.debug-*` block** — header literally says "no longer used, retained for reference". Quadruplicated like everything else (base + @media + theme-dark + theme-light). | base:948–1043 | **S** | YES — pure delete. Audit (`00-css-gap-summary`) already flagged it. **~95 lines** removable, no element matches it in legacy either. Parity: cosmetic only. **No-brainer.** |
| 5 | **Exact duplicate declarations inside one block** — `--freeride-fill`/`--freeride-stripe` set twice in the `@media dark` `:root`. | base:154–155 **and** 158–159 | L | YES — delete lines 158–159 (the later wins; identical value). **2 lines.** Zero risk. **No-brainer.** |
| 6 | **`.status-overlay` double-sets `opacity`+`transition`** in one rule (two transition values; the second wins). Copy-paste artifact. | base:1055–1058 | L | YES — delete the first `opacity:0;transition:opacity .2s ease-out` pair. **2 lines.** Parity: legacy bug too. **No-brainer.** |
| 7 | **No-op `@media dark` block for links** — sets `a`/`a:hover` to the *same* `var(--text-muted)`/`var(--text-main)` already set by the base rule. Does nothing. | base:392–400 | L | YES — delete entirely (**9 lines**). Zero render change. **No-brainer.** |
| 8 | **`#chartTooltip` not wired** (hover engine missing) — CSS present, JS never attaches mousemove. (From coverage audit, real gap #1.) | base:.chart-tooltip 499 | M | Not a cleanup — it's a *behavior* gap. Out of scope here; noted for completeness. |
| 9 | **`body.wb-dragging` orphan** — grabbing-cursor rule, JS never toggles the class. | workout-picker.css:1307–1309 | L | Either delete (cleanup) or wire (behavior). As CSS cleanup: ~3 lines, zero render change. |
| 10 | **CTA-button body copy-pasted 3×** — `.select-workout-btn`, `.picker-empty-add-btn`, `.picker-add-btn` share `--cta-*` bg/hover/active/`scale(.97)`; comments admit "match select-workout-btn". | picker:653–678, 740–754, 758–783 | M | YES — collapse to a `.cta-btn` + modifiers. **~30 lines.** Parity: medium (diverges from legacy class names; needs DOM class changes too, so more than pure-CSS). |
| 11 | **Toolbar/insert button bodies repeat 3×** — `.wb-toolbar-action-btn`, `.wb-block-delete-btn`, `.wb-block-move-btn` virtually identical incl. `:hover{background:var(--hover-medium)}`. | picker:1042–1055/1057, 1148–1161/1163, 1236–1249/1251 | M | YES — shared class. **~30 lines.** Parity: needs DOM changes; medium. |
| 12 | **Search-input rule duplicated** — `.picker-search-wrap input[type=search]` declared twice; 2nd only re-sets the 4 border-radii. Plus the `:-webkit-autofill` selector listed twice in one group. | picker:117–134 & 266–271; autofill 210 & 215 | L | YES — delete the redundant override + the dup autofill selector. **~8 lines.** Parity: cosmetic. **Near-no-brainer.** |
| 13 | **Likely-legacy `.picker-detail`/`.picker-graph`** — superseded by `.picker-expanded-*` layout; still referenced by a `@media(max-width:800px)` block, so verify DOM before deleting. | picker:560–577, 687–696 | M | Maybe — needs DOM confirmation. If unused, **~25 lines.** Parity: cosmetic. |
| 14 | **Picker `!important` specificity war** — `.picker-search-clear:hover/:active/:focus` forces `background`/`background-color`/`border-color` `!important` to beat the search-active CTA background. The genuine smell among picker's 6 `!important`. | picker:169–171 | M | Refactor needs care (it's fighting real cascade). Not a quick win; flag as the one true specificity hack. |
| 15 | **Picker mode-visibility `!important` ×2** — `.planner-only`/`.picker-only` hidden via `display:none !important`. Hammer, but a deliberate mode utility. | picker:14, 18 | L | Could be `[data-mode]` attribute selectors instead of `:not()` + `!important`; not worth the churn. |
| 16 | **Inline SVG caret hard-codes `stroke='%23fff'`** — the active-filter white chevron baked into a data-URI, while every other caret goes through `--select-arrow`. Inconsistent. | picker:301–304 | L | Tokenizable but fiddly (data-URI). Low value. |
| 17 | **Planner `.planner-day:hover` triplicated** — `@media dark` + `.theme-dark` + `.theme-light`. Exists because hover *strengthens* `--hover-light`→`--hover-medium` (different token), not swaps one. | workout-planner.css:548–563 | M | YES — introduce a `--day-hover-bg` token (light=`--hover-light`, dark=`--hover-medium`) and the whole cluster collapses to `1` rule. **~13 lines.** Parity: medium — adds a token legacy lacks. Cleanest single fix in planner. |
| 18 | **Planner empty rule** — `.planner-day.has-month-label` has a comment-only body. | workout-planner.css:179–181 | L | YES — delete. **3 lines.** **No-brainer.** |
| 19 | **Planner hover/active state matrix copy-pasted** — `is-selected`/`is-today` × `:hover`/`:active` × `:has()` variants restate the same `bg`+`box-shadow` pair ~8×; `.suppress-hover` restates them again. | workout-planner.css:215–243, 345–388 | M | Partial — a `--selected-bg`/`--today-bg` pair (mostly already tokens) + grouping selectors could cut ~15 lines. The `:has()` chains (370, 385) are brittle. Parity: medium. |
| 20 | **Planner display `!important` ×3** — `.planner-detail-mode` state toggle forces `display` on calendar/footer/detail/back-btn. | workout-planner.css:523, 527, 539 | L | Classic state-machine override; avoidable with single visibility source but low-risk as-is. Mixes `#id` + class selectors (526, 538). |
| 21 | **Settings dead rules** (audit-confirmed) — `.settings-input` (+`:focus`) and `#settingsBtStatusCta` match no element in legacy either. | settings.css:231–247, 415–417 | L | YES — pure delete. **~20 lines.** Parity: cosmetic. **No-brainer.** |
| 22 | **Un-tokenized scrim/shadow alphas** — `rgba(0,0,0,0.35)` for overlay bg + modal shadow; same value appears as picker modal scrim too. No `--overlay-scrim`/`--modal-shadow` token. | settings.css:9, 19; picker:9, 27 | L | Tokenizable, but the value is identical across light/dark so it's not a theming bug — purely a "magic constant" smell. ~0 line change, mild clarity win. |
| 23 | **Welcome `var()` fallback is near-black** — `var(--bg, #0c0c0c)`; if base CSS ever fails to load, welcome flashes near-black instead of the light `#f4f4f4`. | welcome.css:12 | L | Cosmetic/defensive; harmless in practice. Note only. |
| 24 | **Welcome slide-animation transition copy-pasted 2×2** — `out-forward/out-backward` share a bezier, `in-forward/in-backward` another; the `transition:` line is duplicated. | welcome.css:74–96 | L | YES — shared base + per-direction `transform`. **~10 lines.** Parity: medium (timing is animation-faithful; touch carefully). |
| 25 | **Welcome reaches into base elements** — `body.welcome-active .page-root`/`.bottom-nav { visibility:hidden }` styles elements that live in `workout-base`. Cross-file reach-in. | welcome.css:467–472 | L | Borderline file-org issue; it's welcome-state-driven so co-locating in welcome is defensible. Leave. |
| 26 | **Welcome stale comment** — comment says "60%" but code is `min(70vw,70vh)`. Doc rot. | welcome.css:220 vs 224 | L | Comment-only fix. Zero render impact. |
| 27 | **Builder bundled into picker file** — `workout-picker.css` is 1349 lines covering *two* features (picker modal + full workout builder, `.wb-*` from ~785 on). | workout-picker.css | L (org) | Splitting `.wb-*` into `workout-builder.css` improves navigation; pure `@import` reshuffle, render-preserving. Parity: low (legacy was one file, but this is an org-only move). |

---

## Theme-system simplification (deep-dive: the token quadruplication)

### What's there now

`workout-base.css` declares the palette **four times**:

```
:root { … 77 tokens (light) … }                         /* lines 1–90   */
@media (prefers-color-scheme: dark) { :root { … 73 … } } /* lines 92–176 */
:root.theme-light { … 71 tokens (copy of base light) … } /* lines 178–261*/
:root.theme-dark  { … 71 tokens (dark) … }               /* lines 263–343*/
```

Plus ~9 **per-rule** clusters (tooltip, hovers, debug, status-overlay) each written for
`@media dark` + `.theme-dark` + `.theme-light` — another ~120 lines.

### Why it's structured this way (the root cause)

The theme is applied by **`web/src/app/theme.ts`** (`applyThemeMode`) and the anti-FOUC
inline script in **`web/index.html:17–20`**. Both do the same thing:

```js
root.classList.remove("theme-light", "theme-dark");
if (mode === "dark")  root.classList.add("theme-dark");
else if (mode === "light") root.classList.add("theme-light");
// mode === "auto"  →  NO CLASS ADDED  (only data-theme="auto")
```

So in **Auto mode the `<html>` carries no theme class**, and the *only* source of dark
colors is the `@media (prefers-color-scheme: dark)` block. The two `:root.theme-*` blocks
exist purely to **override that @media block** when a user force-selects a theme that
contradicts the OS (e.g. manual Light on a dark OS, or manual Dark on a light OS where
@media-dark never fires). The big explanatory comments at base:249–260, 336–342, 523–540,
1071–1082 are all variations of this forced-theme parity story — and those are exactly the
dark-mode fixes that landed recently.

Specificity confirms the precedence: `:root` = (0,1,0); `:root.theme-dark` = (0,2,0), so a
present theme class always beats both base and the `@media` block. Source order
(light → @media-dark → theme-light → theme-dark) is therefore irrelevant for correctness;
the class wins whenever present.

### Before → after sketch

The collapse: make **Auto mode resolve to an explicit class** so the cascade has exactly
**two** palette contexts and the `@media` blocks become dead.

```js
// theme.ts applyThemeMode — Auto resolves the OS preference to a class:
const resolved = next === 'auto'
  ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : next;
root.classList.toggle('theme-dark',  resolved === 'dark');
root.classList.toggle('theme-light', resolved === 'light');
root.dataset.theme = next;           // keep 'auto' for the OS-flip listener
```

The matchMedia OS-flip listener already exists (`state/theme.svelte.ts:54–69`) and already
calls `applyThemeMode('auto')` on flip — so re-resolving on OS change is *already wired*;
it just needs to set a class now instead of relying on @media. The inline anti-FOUC script
(`index.html:17–20`) must mirror the same `matchMedia(...).matches` resolution so first
paint picks the class too.

Then the CSS collapses to:

```
:root,
:root.theme-light { … 77 light tokens … }   /* one light context  */
:root.theme-dark  { … 71 dark  tokens … }    /* one dark  context  */
/* DELETE every @media (prefers-color-scheme: dark) block (11 of them) */
/* per-rule clusters: tokenize the hard-coded ones (#3) so their dark
   variants disappear entirely; the rest reduce to one .theme-dark rule */
```

### Estimated reduction & risk

| | Lines today | After | Saved |
|---|--:|--:|--:|
| 4 root token blocks (base 1–343) | 343 | ~150 (light + dark only) | **~190** |
| 11 `@media dark` blocks (base + planner) | ~140 | 0 | **~120** |
| Re-tokenize `.chart-tooltip` + hover clusters | — | folds into above | — |
| **Net (with some overlap)** | | | **~250–300 lines** |

**Risk: MEDIUM-HIGH, and the gate won't catch the failure mode.**

- It rewrites the precise mechanism (`theme.ts` + inline bootstrap + the forced-theme
  parity rules) that the **recent dark-mode fixes** stabilized. Those fixes are the
  comments at base:249, 336, 523, 1071 and the planner:558 cluster.
- The visual-regression gate **diffs rendered pixels under a fixed theme** — it does *not*
  exercise the "Auto mode + OS flips light↔dark" path, nor "manual toggle contradicting the
  OS." A regression in exactly the case this refactor changes could ship green.
- First-paint FOUC risk: the inline script must read `matchMedia().matches` synchronously
  and get it right, or Auto users see a flash of the wrong theme on every load.
- `data-theme="auto"` semantics must be preserved for the OS-flip listener (keep
  `dataset.theme = 'auto'`, only the *class* resolves) — easy to break.

**Recommendation:** defer the full collapse. If pursued later, do it behind explicit tests
for (a) Auto + simulated OS flip, (b) manual-light-on-dark-OS, (c) first-paint class — the
three cases the pixel gate won't cover. The **safe subset worth doing now** is #3
(tokenize `.chart-tooltip`, ~24 lines), #4 (`.debug-*` delete, ~95 lines), #5/#6/#7 (dup
lines, ~13), which together remove ~130 lines with **no mechanism change** and no
plausible render divergence.

---

## File organization

The base / picker / planner / settings / welcome split is **sensible** and the header
comment in `index.css` documents the global-cascade premise correctly. Two notes:

- **`.wb-*` builder rules bundled in `workout-picker.css`** (≈565 lines, finding #27) —
  the one file that bundles two features. A `workout-builder.css` split is a pure `@import`
  reshuffle, render-preserving, and would help navigation.
- **`welcome.css` reaches into `.page-root`/`.bottom-nav`** (base elements, finding #25) —
  borderline, but state-driven so defensible. No other rules are clearly in the wrong file.
  Shared inputs (`.settings-ftp-input`) correctly live in base and are reused — good
  cross-file factoring, not a smell.

---

## No-brainer (zero-risk) wins — do these regardless

Pure deletions / dedup that change **no rendered pixels** and need **no mechanism change**.
Parity divergence is cosmetic (the deleted rules match no element in legacy either, or are
exact in-block duplicates).

| # | What | Where | Lines |
|---|---|---|---|
| 4 | Delete dead `.debug-*` block (×4 theme variants) | base:948–1043 | ~95 |
| 7 | Delete no-op link `@media dark` block | base:392–400 | 9 |
| 5 | Delete duplicate `--freeride-*` lines | base:158–159 | 2 |
| 6 | Delete duplicate `opacity`/`transition` in `.status-overlay` | base:1055–1056 | 2 |
| 12 | Delete redundant search-input override + dup autofill selector | picker:266–271, 215 | ~7 |
| 18 | Delete empty `.planner-day.has-month-label` | planner:179–181 | 3 |
| 21 | Delete dead `.settings-input`/`#settingsBtStatusCta` | settings:231–247, 415–417 | ~20 |
| 26 | Fix stale "60%" comment | welcome:220 | 0 |
| — | **Total** | | **~138 lines** |

Higher-value-but-still-low-risk (no mechanism change, but touch a real rule):
**#3** tokenize `.chart-tooltip` (~24 lines, the cleanest single quality win in base).

---

## Verdict

**The CSS is clean, not spaghetti — with one structural exception.** Three of the five
stylesheets (`settings`, `welcome`, `picker`) theme entirely through `--var` tokens with
**zero** dark-mode override blocks; they are genuinely well-factored and demonstrate the
token layer works. `planner` is clean save one triplicated hover cluster. The smells are
ordinary: ~13 `!important` (only picker:169–171 is a real specificity war), some
copy-pasted button/state bodies, a few un-tokenized scrim alphas, and a scatter of dead
rules.

**The one structural problem is concentrated in `workout-base.css`:** the 4×
token-quadruplication (290 declarations / 79 tokens) plus ~9 per-rule dark clusters, ~460
lines that *could* be ~200. Its root cause is a deliberate design choice — Auto mode is
left class-less so it rides `@media`, which forces every palette to be declared once for
`@media` and again for the manual `.theme-*` classes.

**Is cleanup worth the parity divergence?**

- **Dead-rule deletions + `.chart-tooltip` tokenization (~160 lines): YES, now.** Zero
  render risk, the deleted rules don't match anything in legacy either, and the parity
  divergence is cosmetic. Net maintainability win for near-zero cost.
- **The full theme-system collapse (~250–300 lines): NOT NOW.** It is feasible and
  render-preserving in the steady state, but it rewrites the exact dark-mode / forced-theme
  / first-paint mechanism that was *just* stabilized, and the visual-regression gate
  **does not exercise** the Auto-OS-flip and contradicting-manual-toggle paths where a
  regression would hide. The line savings are real but the failure mode is invisible to the
  gate — a bad trade until that mechanism is covered by explicit theme tests. Park it as a
  documented future refactor (with the `theme.ts` + `index.html` bootstrap changes above),
  not a now-task.

In short: **harvest the ~160 lines of free dead-rule / tokenization wins; leave the
quadruplication structure in place** until the theme path has test coverage that the pixel
gate alone can't provide.
