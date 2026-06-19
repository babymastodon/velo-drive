# VeloDrive Rewrite — Code-Quality / Simplicity Review (Consolidated)

Five read-only reviews from different lenses (factoring, core detail, UI detail, libs/patterns,
adversarial) — detail in `review-01..05-*.md`. This doc merges + dedupes them, grades each finding,
and gives a fix-vs-damage recommendation. Adversarial claims are kept only where backed by cited
evidence; its overstated items (the deliberate de-proxy fix, the documented P6 TODO) are downgraded.

## Verdict

**The rewrite achieves its goal: lightweight, simple, well-encapsulated — not spaghetti.** All five
reviewers independently agreed. The layered DAG (`core → ui/state/ports → app`) is real and acyclic,
`core/` imports nothing upward, the engine is a clean DOM-free injected state machine, the state
stores are thin and single-purpose, and there are **zero runtime dependencies** — a genuine strength.
**No new library clears the bar** (charting, FIT, XML, idb, date-fns all lose to a small internal
helper or the status quo). Over-engineering is minimal: no DI container, no factory hierarchy; the
promise-dialog + modal-chrome + composition root are already the textbook lightweight solution.

The improvements below are **refactors within a sound structure**, not a re-architecture. The single
dominant smell — repeated across every reviewer — is **duplication of a tiny set of `RawSegment`
tuple helpers/constants** across many modules. That, plus a handful of dead-code deletes and moving
some domain logic out of the persistence adapter, is the bulk of the value.

## Strengths (leave alone — explicitly judged good)
- Acyclic layered DAG; `core/` is pure and platform-free; engine is a clean injected state machine.
- Thin signals-only state stores; centralized overlay-keymap routing; shared `OverlayModal` chrome;
  disciplined `$effect` use (all real imperative bridges, none that should be `$derived`).
- `builder-backend.ts` (2095) is a **cohesive** undo/redo state machine — large but not tangled; do
  not split for size's sake. `zwo.ts`/`fit.ts` are correctly-sized codecs. The `chart.ts → document`
  CSS-var coupling is a deliberate, behavior-pinned legacy choice.
- Promise-based `DialogStore`, `FileStore`/`TrainerTransport` ports (keep — they keep the engine
  platform-free even though single-impl), composition root in `app/`.

## Findings (deduped + graded)

Severity = maintainability/correctness impact. "Reviewers" = how many of the 5 independently raised it.

| ID | Finding | Location | Sev | Reviewers | Recommendation (fix? + tradeoff) |
|----|---------|----------|-----|-----------|----------------------------------|
| Q1 | **`RawSegment` tuple helpers/constants duplicated everywhere** — `getRawCadence` copy-pasted 4-6×, `isFreeRideSegment` 3× (+inlined), `FREERIDE_POWER_REL=0.5` 3×, duration formula `max(1,round(min*60))` ~12×, tuple hand-indexed (`seg[1]`,`seg[3]`) across ~10 files | engine, chart, metrics, hud-format, hud-coaching, zwo, builder-backend | **High** | 5/5 | **NO-BRAINER. Extract `core/segments.ts`** (~40-50 lines: accessors + `isFreeRideSegment`/`getRawCadence`/`segDurationSec` + the constant). Cuts **~80-140 lines**, kills drift. Tradeoff: low — but the tuple SHAPE is byte-locked to FIT/zwo parity tests, so wrap accessors around it; do NOT restructure the tuple. |
| Q2 | **Power-zone thresholds (60/76/90/105/119) duplicated** between `metrics.ts` and `chart.ts` | metrics.ts, chart.ts:~ | **High** | 2/5 | **NO-BRAINER (correctness).** Single source in `core/metrics.ts`, import in chart. Drift here = miscolored zones. Low risk. |
| Q3 | **Stale/false header comment** "the builder is DEFERRED … buttons no-op" | PickerView.svelte:7-9 | Low | 3/5 | **NO-BRAINER.** Delete/fix the comment — the builder is fully shipped (1296-line `BuilderView`). Zero risk. |
| Q4 | **Dead code:** doubled `this.bikeConnected=` (copy-paste bug), unused `DialogStore.resolvePrompt()`, dead `FREERIDE_POWER_REL_BUILDER` (chart:922), `void maxHr` (fit), unreachable branches in `getBlockDurationSec` | WebBluetoothTransport:451-452,471-472; dialog.svelte.ts; chart.ts:922; fit.ts; builder-backend | Low | 3/5 | **NO-BRAINER.** Delete. The doubled `bikeConnected` is an actual bug. Trivial. |
| Q5 | **Hand-rolled date-key (`YYYY-MM-DD`) formatter reimplemented 3×** — App.svelte ×2 duplicates `PlannerView.formatKey`; correctness-sensitive (schedule matching) | App.svelte, PlannerView.svelte | Med | 2/5 | **Worth it.** Extract `core/date-keys.ts`. A drift here silently breaks schedule matching. Low risk, small. |
| Q6 | **`isEditableTarget()` duplicated 4× (already drifted)** | App, Picker, Planner, Builder | Low | 2/5 | **Worth it.** One shared helper. Low risk. |
| Q7 | **chart.ts SVG-assembly boilerplate** — ~750-850 of 1934 lines are `createElementNS` sequences; grid/FTP loops + segment polygons copy-pasted; 5 renderers repeat scaffolding | chart.ts | Med | 3/5 | **Worth it.** Internal `svg-dom`/`chart-primitives` helper (~40-60 lines) → **~300-450 line cut, ZERO pixels changed**. Tradeoff: touches pixel-pinned code — extract helpers WITHOUT changing renderer geometry; lean on the visual gate. Do NOT add a charting lib (can't express drag handles / freeride hatch / `data-*` hit-testing). |
| Q8 | **Domain analytics live in the persistence adapter** — `WebFileStore` computes TSS/IF/power-curve/zones and enforces schedule business rules, and declares domain types the UI imports upward | WebFileStore.ts | Med | 2/5 | **Worth it.** Move ride-analytics → `core/history.ts`, schedule rules → `core/schedule.ts`; adapter does I/O only. Improves the layering; moderate effort, behavior-preserving (covered by planner tests). |
| Q9 | **Inline ride-math in the big views** — `PlannerView.openDetail` builds the whole `DetailState` (VI/EF/paused/HR-cad) inline; picker search-grammar + calendar-week builder inline | PlannerView.svelte:586-645; PickerView | Med | 2/5 | **Worth it** (pairs with Q8). Move derivations to `core/`. Low-med risk. |
| Q10 | **`hud-format` cadence helpers duplicated vs `hud-coaching` with O(n²) recompute** — `getRawCadence`/`getCurrentCadenceTarget` differ subtly; hud-format recomputes a total inside its loop | hud-format.ts:83-88, hud-coaching.ts | Med | 2/5 | **Worth it.** Folds into Q1 + a one-line hoist of the total. Low risk, removes a latent inefficiency + drift. |
| Q11 | **30s normalized-power rolling-window block byte-duplicated within `metrics.ts`** | metrics.ts | Med | 2/5 | **Worth it, carefully.** Correctness-critical — extract one helper, lean on the metrics parity tests. |
| Q12 | **WebBluetoothTransport ~40% bike/HR copy-paste** (already caused the Q4 doubled-assignment bug) | WebBluetoothTransport.ts | Med | 2/5 | **Judgment call.** A `DeviceChannel` abstraction cuts ~80-120 lines but adds one indirection to delicate BLE code. Do it only with the reconnect/parse tests green; otherwise just fix Q4. |
| Q13 | **`builder-backend` selection/cursor state machine** — ~23 interrelated mutable fields with implicit invariants; the single most complex region | builder-backend.ts | Med | 2/5 | **Mostly LEAVE** (cohesive, behavior-pinned undo/redo; decomposing is high-risk for low gain). BUT **fix the `'rampUp'/'rampDown'`-through-`BlockKind` cast** (Q14) — that part is a cheap clarity/correctness win. |
| Q14 | **Type lie:** `'rampUp'/'rampDown'` smuggled through `BlockKind` via `as BlockKind` | builder-backend.ts:~810-970 | Med | 2/5 | **Worth it.** Add the variants to the type (or a dedicated union). Low risk, removes unsafe casts. |
| Q15 | **Escape logic duplicated** across `App.svelte` and `UiStore.handleEscape` | App.svelte, state/ui.svelte.ts | Low-Med | 1/5 (adv) | **Assess.** The keymap routing was praised by the UI reviewer; the Escape disposition is split. Consider consolidating the disposition in one place. Low-med risk — verify against the escape-context tests. |
| Q16 | **Dual theme system** — `app/theme.ts` + `state/theme.svelte.ts`, two `$state` counters bumped by an observer/matchMedia installed as a getter side-effect | app/theme.ts, state/theme.svelte.ts | Low-Med | 1/5 (adv) | **Mostly LEAVE / lightly document.** The two counters intentionally mirror legacy's two redraw wirings (HUD+planner vs picker/builder) and keep the visual baselines valid; collapsing them risks the dark-mode parity we just fixed. Add a comment; don't merge without re-validating diffs. |
| Q17 | **de-proxy `JSON.parse(JSON.stringify())` at the persistence boundary** drops non-JSON fields silently | WebFileStore.ts:213 | Low | 1/5 (adv) | **Keep (deliberate), note the limit.** All settings values are plain JSON-safe data (handles use `saveHandle`); this is the fix for the `$state`-proxy `DataCloneError`. Optional hardening: `$state.snapshot()` at the `.svelte` call sites instead. Not a trap. |

## Library & pattern verdict
**Add zero dependencies.** The zero-runtime-dep philosophy holds — every candidate (charting lib,
FIT/XML parser lib, idb-keyval, date-fns) loses to a small internal helper. The high-leverage moves are
internal extractions, totaling an estimated **~500-750 line reduction** with no behavior change:
- `core/segments.ts` (Q1): ~80-140 lines.
- chart `svg-dom` helper (Q7): ~300-450 lines.
- `core/date-keys.ts` (Q5), shared `isEditableTarget` (Q6), `core/history.ts`/`schedule.ts` (Q8-Q9),
  `DeviceChannel` (Q12): the remainder.

## CSS Review (re-hosted legacy stylesheets, ~4056 lines)

Two reviewers (quality + adversarial). **Verdict: the CSS is clean, not spaghetti — with one
structural exception.** `settings.css`, `welcome.css`, and `workout-picker.css` theme entirely
through `--var` tokens with **zero** theme-override blocks (they get dark mode for free) — proving
the duplication elsewhere is avoidable. Caveat for all CSS work: the CSS is a **verbatim re-host**;
the visual gate diffs **pixels not text**, so render-preserving cleanup won't break it — but the gate
does **not** exercise the Auto-OS-flip / contradicting-manual-toggle theme paths, so a theme-structure
change could ship green-but-broken. That gap gates the big item below.

| ID | Finding | Location | Sev | Recommendation (+ tradeoff) |
|----|---------|----------|-----|-----------------------------|
| C1 | **Theme-token quadruplication** — 290 token declarations for only **79 unique tokens**, redeclared across `:root` / `@media dark` / `.theme-light` / `.theme-dark`; ~70 dark tokens duplicated near-verbatim between `@media-dark` and `.theme-dark`; ~9 per-rule dark clusters written 3-4×. Root cause: Auto mode is class-less so it rides `@media`, forcing every palette to be declared for both `@media` and the manual `.theme-*` classes. | workout-base.css:92-176 / 263-343 + clusters | **High** | **Defer the full collapse (~250-300 lines).** Fix = resolve auto→light/dark in JS and always set the `.theme-*` class, dropping the `@media` duplicates. Real win, but it changes the theme mechanism and the pixel gate can't catch an Auto-flip regression. **Prereq: add Auto-OS-flip + forced-theme test coverage first** (extend `audit.new.spec.ts`), THEN collapse. |
| C2 | **Dual-dark-source drift footgun** — the same dark values live in BOTH `@media-dark` and `.theme-dark`; the file carries **comment-tombstones** (base:249-253, 523-533, 1071-1077) documenting past bugs where one copy drifted from the other. (We added some of these twins in the forced-dark fix.) | workout-base.css | Med | Resolved by C1. Until then, **a real maintenance hazard** — any dark-token change must be made in two places. Worth at least a lint/comment guard. |
| C3 | **~95 lines of dead `.debug-*` CSS**, still fully re-themed across dark/light, squatting z-index:50 | workout-base.css:948-1043 | Low | **NO-BRAINER.** Delete (self-declared dead; the coverage audit confirmed unused). Render-preserving. |
| C4 | **`.chart-tooltip` hardcodes `#ffffff/#666666` 4×** while `--tooltip-*` tokens sit defined-but-unused (sibling `.picker-tooltip` uses them) | workout-base.css:505,515,528,535 | Low | **NO-BRAINER.** Tokenize — pure cleanup, identical render. |
| C5 | **`.status-overlay` declares `opacity`+`transition` twice in one rule** (two fade durations, only the 2nd live) | workout-base.css:1055-1058 | Low | **NO-BRAINER.** Delete the dead pair (the flash-audit D2 item). |
| C6 | **In-block + cross-file duplicate selectors** — a token tripled inside one `@media` block (base:154-159); autofill selector listed twice (picker:210==215); `input[type=search]` declared twice (picker:117,266); no-op link `@media` (base:392-400) | base, picker | Low | **NO-BRAINER.** Collapse the dupes; render-preserving. ~part of the ~160-line harvest. |
| C7 | **z-index soup** — 1/2/3/10/40/45/46/50/60/61 scattered across 5 files, no scale or token | all | Low | **Optional.** A `--z-*` token scale would document the stacking order; low value, low risk. |
| C8 | **`!important` (13 total)** mostly benign; only `picker:169-171` is a real specificity war | picker.css:169-171 | Low | **Optional.** Resolve the one real fight; leave the rest. |

**CSS recommendation:** harvest **~160 lines of zero-risk cleanup now** (C3, C4, C5, C6 — dead `.debug-*`, the double-transition, duplicate lines, tokenize the tooltip). **Defer the ~250-300-line theme collapse (C1)** until the Auto/forced-theme path has real test coverage the pixel gate can't provide — that prerequisite is itself a worthwhile task.

## Recommended order
1. **No-brainers (do now, ~zero risk):** Q1, Q2, Q3, Q4 (code) + C3, C4, C5, C6 (CSS) — kill the
   duplication + dead code + false comment + dead `.debug-*`/dup CSS (~160 CSS lines + ~150 code lines).
2. **High-value, low-med risk (worth a focused pass):** Q5, Q6, Q7, Q10, Q14.
3. **Layering improvements (behavior-preserving, moderate effort):** Q8, Q9, Q11.
4. **Gated bigger win:** C1 theme-token collapse (~250-300 CSS lines) — but FIRST add Auto-OS-flip +
   forced-theme test coverage (the pixel gate can't catch it), which closes C2's drift footgun too.
5. **Judgment calls (only if the area is being touched anyway):** Q12, Q13, Q15, Q16, Q17, C7, C8.

All refactors must preserve behavior: the engine is pinned by the magic-number/parity tests, the codecs
by differential tests, and the renderers + CSS by the visual gate (which diffs pixels, so render-
preserving cleanup stays green — except the Auto/forced-theme paths it doesn't exercise, see C1).
