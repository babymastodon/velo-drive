# Interaction Flash / Flicker / Redraw Re-Audit (animations ENABLED)

**Goal:** find flashes, flickers, stale-frame artifacts, janky/wrong transitions, and
redraw glitches — the class behind the "builder workout-viz flashing when clicked/edited"
report that a prior agent could not reproduce.

**Why this run is different from the old gate.** The hermetic e2e fixtures
(`tests/e2e/fixtures.ts:311-318`) inject
`*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;}`
before every screenshot, so **every** flash/flicker/transition was invisible to the
baseline gate. This audit drives the SAME hermetic env (page-env clock + FTMS sim +
seeded library, forced-dark on a light OS) **without** that kill-switch, so transitions
actually run and a stray frame is observable.

**Method / tooling.** Throwaway probe `web/tests/e2e/flash-probe.new.spec.ts`
(+ `web/pw-probe.config.ts`, run standalone to bypass the flaky legacy-baseline dep):

1. **CDP `Page.startScreencast`** (JPEG, everyNthFrame:1) records every *distinct* painted
   frame across each interaction; frames dumped to `web/visual-report/flash-audit/<case>/`.
   Each frame is luma/white-fraction analyzed in-page (offscreen-canvas) to flag a frame
   that deviates >18 luma from the case median (a flash). NOTE: the screencast **dedups
   identical frames**, so a low frame count is itself evidence of *few distinct paints*
   (no flicker storm), and a true 1-frame flash would surface as an extra distinct frame.
2. **In-page rAF/poll samplers** (real-timer, test-driven) that read the *computed*
   `fill` / `fill-opacity` / `filter` of every `.wb-block-segment` / `.wb-block-band`
   across ~22 frames after a trigger. If a CSS transition tweens, the series shows >2
   distinct consecutive values ("drift"). This is the decisive builder-flash test — it
   sees a tween even if the screencast deduped it.
3. A picker-expand poll that reads whether the expanded row's mini-chart `<svg>` exists
   frame-by-frame (catches the rAF-deferred render gap).

Console transcript: `web/visual-report/flash-audit/00-console.log`.
All interactions captured in **forced dark** (`<html class="theme-dark">` on a light OS),
plus light-mode builder controls, to expose any stale-palette frame.

> Repo note: a concurrent process kept `git clean`-ing untracked files under
> `web/visual-report/` and the repo root mid-run; evidence was generated to `/tmp/flash-audit`
> and copied into `web/visual-report/flash-audit/` as the final step. If the frames are
> missing, re-run: `FLASH_OUT=/tmp/flash-audit npx playwright test --config=pw-probe.config.ts`.

---

## Enumerated transition/animation surfaces (what was driven)

| Surface | Rule (file:line) | Fires on | Driven? |
|---|---|---|---|
| Builder chart segment fill | `workout-picker.css:1002` `.wb-block-segment{transition:fill 0.12s}` | fill change on a **persisted** node | yes (sampler) |
| Builder chart block band | `workout-picker.css:992` `.wb-block-band{transition:fill-opacity 0.14s}` | fill-opacity change on a persisted node | yes (sampler) |
| Builder block active filter | `workout-picker.css:1006` `.wb-block-segment.is-active{filter:…}` | select | yes (sampler) |
| Picker rows | `workout-picker.css:415` `.picker-row{transition:bg 0.12s, transform 0.06s}` | hover/active (keyed reuse on filter/sort) | yes (filter/sort) |
| Picker mini-graph | `workout-picker.css:992/1002` + `miniChart` rAF (`PickerView.svelte:819`) | row expand | yes (expand poll) |
| Select-workout CTA | `workout-picker.css:666` | hover/active | n/a (hover only) |
| HUD/nav interactive | `workout-base.css:379/607/685/760/907/986` `var(--interactive-transition)` (bg/color/border/shadow/**transform 0.14s**) | hover/active/select | yes (theme toggle, nav) |
| Status overlay | `workout-base.css:1056` **+1058** (two conflicting `transition`s) | countdown show/hide | attempted (see CnR) |
| Planner day / workout card | `workout-planner.css:154/205` | hover, month nav | yes (planner open) |
| Picker filter selects | `workout-picker.css:114/133` `transition:bg/border 0.24s` | filter active | yes (filter) |
| Welcome scenes | `welcome.css:65-95,176,261-290` (`@keyframes` enter/exit/float, nav-boot) | slide nav | not driven (welcome gated off in harness; see CnR) |
| Settings help fade | `settings.css:361` `@keyframes settingsHelpFadeIn 180ms` | help expand | not driven (low risk) |
| Chart empty overlay | `workout-base.css` `transition:opacity` | no-workout/show | covered by no-workout state |

Imperative redraws driven: builder full-rebuild (`chart.ts:1192 container.innerHTML=''`),
HUD live chart (`drawWorkoutChart` → `clearSvg` full teardown), picker mini-graph rAF,
theme toggle (charts re-read CSS vars at draw), modal open/close, planner mount.

---

## Findings table

| Interaction | Trigger | Theme | Frames captured | Artifact seen? | Root cause (file:line) | Severity |
|---|---|---|---|---|---|---|
| Builder select block | click unselected segment | dark | 2 (`builder-select-block0-dark-`) + 22 sampler | **No** | full rebuild `chart.ts:1192`; fresh nodes paint final → fill transition never fires (0 drift) | — |
| Builder switch selection | click a different segment | dark | 2 (`builder-switch-sel-0-2-dark-`) + sampler | **No** | same; 0 drift | — |
| Builder deselect | click empty | dark | sampler 22f | **No** | 0 drift | — |
| Builder edit power | +stepper ×4 | dark | 3 (`builder-edit-power-stepper-dark-`) + sampler | **No** | rebuild per edit; 0 drift | — |
| Builder edit duration | `d` key ×3 | dark | 3 (`builder-edit-dur-key-d-dark-`) | **No** | rebuild per edit | — |
| Builder insert block | insert vo2max | dark | 3 (`builder-insert-dark-`) | **No** | rebuild | — |
| Builder cut/paste | Ctrl+C / Ctrl+V | dark | 1 (`builder-copy-paste-dark-`) | **No** | rebuild | — |
| Builder undo/redo | undo then redo | dark | 3 (`builder-undo-redo-dark-`) | **No** | rebuild | — |
| Builder select/switch | click segment | **light** | 1–2 (`builder-select-light` not re-run; dark canonical) | **No** | — | — |
| HUD live chart | 6 ride ticks (1 s each) | dark | 1 (`hud-tick-dark`) | **No** | `drawWorkoutChart` full teardown; no stale frame | — |
| Theme toggle — HUD | light→dark→light | dark | 3 (`theme-hud`) | **No*** | chart re-reads CSS vars same frame; frame0 spike = pre-toggle baseline, not a flash | — |
| Theme toggle — Builder | light→dark→light | dark | 3 (`theme-builder`) | **No** | redraw on `themeAutoVersion`/version; clean | — |
| Theme toggle — Picker | light→dark→light | dark | 3 (`theme-picker`) | **No** | mini-graphs re-run via `chartRenderers`; clean | — |
| Modal — picker open | click workout name | dark | 2 (`modal-picker-open-dark`) | **No** | clean | — |
| Modal — picker close | Escape | dark | 3 (`modal-picker-close-dark`) | **No** | clean | — |
| Picker filter | type "vo2" | dark | 3 (`picker-filter-dark`) | **No** | keyed `{#each}` rows reuse; no transform reorder flash | — |
| Picker sort | header click | dark | 3 (`picker-sort-dark`) | **No** | clean | — |
| **Picker expand row** | click row | dark | 1 (`picker-expand-dark`) + 14-frame poll | **YES (minor)** | mini-chart renders **1 rAF after** the row mounts (`PickerView.svelte:819,828` `requestAnimationFrame(render)`) → ~10 ms window where the expanded row is shown with an empty graph host (`svgChildren=-1` at t=10 ms, `=3` from t≈19 ms) | **Low** |
| Status overlay countdown | start ride + step clock | dark | 3 (`status-overlay-dark`) | **No** (countdown did not trigger w/o pedaling power; static CSS smell found) | conflicting `transition`s `workout-base.css:1056/1058` (latent, not a flash) | **Low (latent)** |
| Planner open | calendar nav | dark | 2 (`planner-open-dark`) | **No** | mount paint clean | — |

\* The single luma "SPIKE" the analyzer flagged (theme-HUD frame0, luma 237.9, white 87 %)
is the screencast's **initial** frame — the light HUD captured *before* the toggle ran (the
recording starts before the in-page class flip). Frame 1 (t≈20 ms) is already fully dark
with correct dark chart-band colors and no stale-light element. Verified by reading
`theme-hud/000_*.jpg` (light) vs `001_*.jpg` (dark). Not a flash.

---

## Defects

### D1 — Picker expanded-row mini-chart paints one frame late (blank-graph flicker)  — Low

`PickerView.svelte:819` (`miniChart` Svelte action) renders the expanded workout's mini
power graph via `requestAnimationFrame(render)`, and again on `update` (line 828). So when a
row is expanded, Svelte mounts the expanded `<tr>` and its `.picker-graph` host **synchronously**,
but the SVG inside it is appended only on the *next* animation frame. The in-page poll caught
the gap directly:

```
mini-chart rAF poll (picker expand, dark):
    t=10ms  expanded=true  svgChildren=-1   <-- row visible, graph host has NO svg yet
    t=19ms  expanded=true  svgChildren=3    <-- svg appears
    t=30ms..136ms  expanded=true  svgChildren=3 (stable)
```

Evidence: `web/visual-report/flash-audit/picker-expand-dark/000_t0039ms.jpg` shows the
settled state (Freeride 30 expanded, hatched freeride band rendered). The screencast did not
emit a distinct frame for the ~10 ms empty-host window (sub-frame / often un-painted), so the
visible impact is a *very brief* graph pop-in on slow machines, not a hard flash.

**Root cause / fix sketch:** the rAF defer exists to read the host's measured width after
layout. It could render synchronously when the host already has a non-zero `clientWidth`
(it does, since the row is in the flow) and only defer the *first* mount if width is 0.
This is a latent-flicker cleanup, not a correctness bug.

### D2 — `.status-overlay` has two conflicting `transition` declarations (latent)  — Low

`workout-base.css:1055-1058`:

```css
.status-overlay {
  opacity: 0;
  transition: opacity 0.2s ease-out;   /* line 1056 — dead (overwritten) */
  opacity: 0;                          /* line 1057 — duplicate */
  transition: opacity 0.3s ease;       /* line 1058 — wins */
  …
}
```

The second `transition` (0.3 s ease) wins via cascade, silently killing the intended
0.2 s ease-out, and `opacity:0` is declared twice. No visible flash (the dark-theme
override re-asserts the dark background at equal-or-higher specificity, so the countdown
never reveals the base near-white `rgba(244,244,244,0.9)` wash in forced dark), but the
timing is ambiguous and the duplication is a porting smell. Mirrors legacy `index.html`
inline style — verify intended fade duration and de-dup.

---

## Could-not-reproduce (driven hard, observed CLEAN)

**The headline "builder workout-viz flashing when clicked/edited" — NOT reproduced.**
This corroborates the prior agent, but with stronger proof than a color-only scan:

- The builder chart redraw is a **full teardown + rebuild**: `renderBuilderWorkoutGraph`
  starts with `container.innerHTML = ''` (`chart.ts:1192`) and appends a brand-new `<svg>`
  with brand-new `<polygon class="wb-block-segment">` / `<rect class="wb-block-band">` nodes,
  all built synchronously inside one Svelte `$effect` (`BuilderView.svelte:466-496`). Because
  the nodes are **replaced**, the CSS `transition: fill 0.12s` (`workout-picker.css:1002`) and
  `transition: fill-opacity 0.14s` (`:992`) have **no prior value to tween from** — fresh
  elements paint at their final state. The in-page sampler confirms this: across SELECT,
  SWITCH-selection, DESELECT, and EDIT-power, **0 of ~12 segment/band fill series drifted**
  (each value either constant or a single instant step) over 21-22 sampled frames. The prior
  agent's `audit.new.spec.ts` builder test re-clicked the *same* segment (a no-op re-select)
  and only scanned for light-in-dark colors; the present sampler clicks *different* segments
  and watches the actual tween — still clean.
- Because `innerHTML=''` and the append happen in the same synchronous microtask, the browser
  never paints the empty-chart intermediate, so there is **no blank-frame flash** on rebuild
  either (the scroll position is preserved via `prevScrollLeft`, `BuilderView.svelte:475,495`).
- Frames: `builder-select-block0-dark-`, `builder-switch-sel-0-2-dark-`,
  `builder-edit-power-stepper-dark-`, `builder-edit-dur-key-d-dark-`, `builder-insert-dark-`,
  `builder-copy-paste-dark-`, `builder-undo-redo-dark-` — every captured frame is a clean
  dark chart (see e.g. `builder-switch-sel-0-2-dark-/000_t0011ms.jpg`: correct blue/green/
  orange zone fills, dark bg, no white wash, no stale palette).

Other surfaces driven and seen clean (frames listed):

- **HUD live chart on ride tick** (`hud-tick-dark`): full `clearSvg` teardown per tick, no
  stale or double-paint frame.
- **Theme toggle in HUD / Builder / Picker** (`theme-hud`, `theme-builder`, `theme-picker`):
  no stale-palette frame; charts re-read CSS vars and repaint in the same frame as the class
  flip. Verified the lone luma spike is the pre-toggle baseline, not a flash (see note above).
- **Picker filter & sort** (`picker-filter-dark`, `picker-sort-dark`): keyed `{#each (title)}`
  reuses `<tr>` nodes; no transform-reorder jank, no flash.
- **Modal open/close** (`modal-picker-open-dark`, `modal-picker-close-dark`): clean.
- **Planner open** (`planner-open-dark`): clean mount.

**Status-overlay countdown could not be driven to show** in this harness state: the start
button click did not begin a real ride because no pedaling power was streaming, so the
Beeper-owned `3-2-1` overlay never became visible (`status-overlay-dark/` holds only the
idle HUD). The existing `tests/e2e/status-overlay.new.spec.ts` triggers it via the FTMS sim;
that path was left to that spec. Static review of the overlay CSS surfaced D2 (above) but
no runtime flash.

**Welcome slide transitions/keyframes were not driven**: the harness seeds
`hasSeenWelcome=true` and force-hides the welcome overlay (`fixtures.ts:249-254`,
`reachRidingView` force-hide), so the `scene-enter/exit/float` `@keyframes` (`welcome.css`)
never mount in this env. This is a real coverage gap for the welcome carousel specifically —
recommend a dedicated welcome-animation probe that boots with the welcome gate ON.

---

## Reproduction

```bash
cd web
# standalone (skips the flaky legacy-baseline dependency); writes frames to /tmp then copy in.
FLASH_OUT=/tmp/flash-audit npx playwright test --config=pw-probe.config.ts
cp -r /tmp/flash-audit/* visual-report/flash-audit/
```

Throwaway artifacts (safe to delete): `web/tests/e2e/flash-probe.new.spec.ts`,
`web/pw-probe.config.ts`. No source code was modified.
```
