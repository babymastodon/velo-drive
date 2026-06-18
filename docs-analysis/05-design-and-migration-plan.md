# VeloDrive — Target Design & Migration Plan (v5, UI/CSS-first)

> Authoritative spec for migrating VeloDrive from the vanilla-JS `docs/` app to **TypeScript + Vite +
> Svelte 5** (eventually Tauri). v5 re-centers on the real challenge: **the core logic is small and
> low-risk; the work and risk are the view/framework rewrite and getting the layout, CSS, and
> end-to-end behavior right.** Testing is matched to that — **visual/CSS correctness is a first-class
> gate**, verified by deterministic tooling **plus Claude-driven visual review**.
>
> Lineage: analysis in `01`/`02`; this file's v1–v4 explored a harness-first/parity approach.
> **v5 supersedes them.** Behavior constants in Part X. Changelog in Part IX.

---

## Part 0 — What this migration actually is (and what changed in v5)

Earlier versions over-invested in proving the *pure core* (parser/FIT/metrics/engine). That core is
**small, already DOM-free, and low-risk** to port — it becomes TypeScript with light edits and a few
cheap "old output == new output" tests. **It is not the challenge.**

The challenge is twofold:
1. **The view/framework rewrite** — rebuilding the UI (the 2k-LOC builder/picker/chart files, the
   HUD, the planner) in Svelte 5 without breaking behavior.
2. **Layout & CSS fidelity** — the rebuilt pages must *look* right: same design, spacing, theming,
   responsive/landscape behavior. This is explicitly a primary concern.

So v5's spine is: **(a) de-risk CSS by re-hosting it, not rewriting it; (b) gate the rewrite on three
matched checks — looks right / works right / computes right; (c) migrate view-by-view, shipping
behind the legacy app.** The behavioral harness (faked trainer/FS/clock) survives, but as one of
three gates, not the whole story — and **visual correctness gets equal billing**, including a Claude
visual-review tier.

---

## Part I — Goals & principles
**Goals:** (1) type-safe core (one workout model, killing the 3-representation bug class); (2)
well-factored views; (3) **faithful layout/CSS/design**; (4) **preserved end-to-end behavior**; (5)
Tauri-ready (two seams); (6) incremental & reversible (ship behind legacy, cut over per-view).

**Principles:**
- **Don't rewrite the CSS — re-host it.** The design *is* the existing stylesheets; keep them global
  and verbatim, and have new components reproduce the same class hooks + semantic DOM. Correctness by
  construction (Part II).
- **Three matched gates:** *looks right* (visual/CSS), *works right* (behavioral e2e), *computes
  right* (core). A view ships only when all three pass for it.
- **Assert at the right altitude:** by **`data-testid`/role**, not DOM structure or raw pixels;
  compare **resolved CSS + geometry + screenshots** for appearance, **outputs + displayed values +
  active view** for behavior.
- **Claude visual review is the judgment/triage tier** atop deterministic visual tooling.
- **Migrate in vertical slices**, ship behind legacy; `git`/Pages = rollback.
- **Keep the crown jewels as framework-agnostic TS** (engine/codecs/metrics/BLE parsers).

---

## Part II — Architecture (the CSS strategy is the headline)

### Keep CSS global & verbatim (the #1 de-risk)
The design lives in 5 stylesheets (~3.9k lines): ~76 `:root` design tokens, theme classes, dark-mode
`@media`, and **cross-component shared classes** (`settings-ftp-input` reused by HUD manual controls,
`.mode-toggle`, `.picker-only`/`.planner-only`). Strategy:
- **The design/token/theme/shared CSS stays a single global stylesheet, imported once, unchanged.**
- **Svelte hazard:** Svelte scopes `<style>` by default — moving this CSS into components **breaks**
  the global cascade and shared classes. Rule: global stylesheet (or `:global()`) for design/shared
  rules; scoped `<style>` only for genuinely component-local rules.
- New components **emit the same class names + semantic DOM** the CSS expects. Where old CSS relied on
  DOM *structure* (descendant/`nth-child` selectors), preserve that structure or refactor those few
  selectors to class-based.
- Net: you re-point new markup at the same CSS, so layout/styling is largely correct *before* any
  test runs. The tests (Part III.A) verify the new DOM hooks the CSS correctly.

### Layers, model, ports (brief — stable from prior versions)
```
views (Svelte 5)  →  state (signals; engine takes now/schedule as args)  →
core (TS, DOM-free: engine · metrics · model · codecs[zwo,fit] · ble-protocol)  →
ports (FileStore · TrainerTransport;  web + fake impls now, tauri later)
```
- **Model:** one typed `Workout { id; title; segments: Segment[]; textEvents }`, `Power =
  ramp|steady|freeride`; freeride control state (`freeRideMode`/`manualErgTarget`/`manualResistance`)
  lives in the engine VM. Codecs map legacy shapes at the boundary; round-trip is value-preserving
  (interval re-detection + `≤5` rule are `INTENTIONAL_DIFFS`). Identity = title-filename (stable ids
  deferred).
- **Ports** preserve existing behavior behind types: `TrainerTransport` (ERG throttle ≥10 s, clamp
  0–2000, resistance ×10, handshake, reconnect, disconnect→null-sample); `FileStore`
  (trash-then-write overwrite, `ensureAccess` permission state, seeding). Constants: Part X.
- **Engine:** keep tick-counting (`elapsedSec += 1`/tick, one sample/sec); inject `now`/`schedule`;
  non-overlapping ticks.

---

## Part III — Testing strategy (three matched gates)

### A. *Looks right* — layout / CSS / design (first-class gate)
Four layers, deterministic → judgment:

1. **Computed-style + geometry differential (the precise CSS gate).** For each semantic element (by
   `data-testid`), compare **legacy vs new** in each theme × viewport: `getComputedStyle`
   (color/background/font/spacing/`display`/`flex*`/`grid*`/border/radius) and `getBoundingClientRect`
   (position/size within tolerance). Exact, survives DOM differences, names the offending property.
   Deterministic; runs every commit.
2. **Screenshot visual regression (holistic backstop).** Playwright `toHaveScreenshot()` with **legacy
   renders as the baseline** (the design is being preserved). Reliability mechanics — mandatory:
   freeze the stepped clock + seeded data, **disable animations/transitions**, **mask live-updating
   regions** (power/time readouts), **pin font + viewport + DPR + headless Chromium**, set a small
   max-diff tolerance. Catches overlap/z-index/visual glitches the property check misses. Cheap; runs
   every commit.
3. **Claude visual review (judgment / triage tier).** A Claude agent is given the legacy and new
   screenshots (it reads PNGs directly) and returns a **structured verdict**: `match` or a list of
   issues with location + severity (misalignment, overflow, wrong spacing/color, broken dark mode,
   responsive break). Its two highest-value jobs:
   - **Holistic "does it actually look right / is the design equivalent despite different markup."**
   - **Triage:** decide whether a pixelmatch/geometry flag is a *real* regression or acceptable
     rendering noise — resolving the false-positive problem that makes pixel-diffing a rewrite
     painful.
   *How it runs:* at each view's migration milestone and to triage flags from layers 1–2 — **not** on
   every commit over hundreds of shots. *Honest limits:* not pixel-exact, not perfectly
   reproducible, can miss small (~few-px) shifts, has cost/latency at scale → it's the
   **judgment/triage tier, not the strict CI oracle**; layers 1–2 remain the deterministic gate.
4. **Layout invariants (explicit must-holds).** Geometry/computed-style assertions for structural
   truths: "6 stat cards equal width ±2px," "modal centered," "landscape two-column; stacks below
   breakpoint," "chart panel fills above bottom-nav, no overflow," "dark root bg `#222`."

**The matrix (run A across):** each view (HUD idle/mid-ride/paused/free-ride · picker
empty/populated/expanded · builder · planner calendar/detail · settings · welcome · dialogs ·
countdown overlay) × **light + dark** × **landscape + a narrow viewport** (planner `24vh` rows and the
JS-computed HUD font sizes make responsive break a real risk).

### B. *Works right* — end-to-end behavior (the scenario harness)
A self-contained harness drives the real app (legacy now, new per-slice) through scripted flows with
**everything faked** — FTMS trainer simulator, in-memory FS, stepped clock, audio recorder — and
asserts the **observable contract by `data-testid`/role**, never pixels/DOM:
- **Outputs/side-effects:** the `.zwo` saved, the `.fit` written on finish (parsed & checked),
  `schedule.json`; the ordered **trainer commands** the fake received; the **cue calls** (countdown,
  3 s/9 s beeps, text-event taps); persisted active-state.
- **Displayed values by meaning:** `getByTestId('stat-power').text`, target, elapsed, title, center
  cue.
- **State/visibility:** which controls show (Start↔Pause↔Resume↔Stop), which view/mode is active,
  Escape disposition (builder swallows / picker clears search / planner exits detail).
- **FTMS-sim grounding:** the sim is the inverse of `ble-manager.js`, so validate it against a small
  corpus of **real captured trainer traces** (one logging session) — not only its own round-trip —
  and validate generated `.fit` against the **Garmin FIT SDK**, so a self-consistent-but-wrong byte
  still gets caught.

The scenario + edge-case catalog is Part VII.

### C. *Computes right* — the small core (cheap, near-free)
Old-vs-new unit tests for the pure modules: `assert(newParse(z) ≡ legacyParse(z))` over the 41 `.zwo`
+ `fast-check` round-trips; engine logic vs the Part X constants; FIT round-trip + FIT-SDK check.
Fast, oracle-true, no browser. A safety net, not the focus.

### D. What the fakes can't cover → thin real-environment lane (blocking cutover gate)
A handful of Playwright tests against **real Chrome FSA** (user-activation permission gating,
non-atomic trash-then-write data-loss window, reload re-permissioning) + **real-trainer trace replay**
+ **real audio** + the **extension multi-process handoff**. Plus a **coverage-gap register**
enumerating what the hermetic harness does *not* cover. This lane (not just a signed checklist)
**gates cutover**.

---

## Part IV — Migration sequencing (vertical slices, ship behind legacy)

No big upfront lock. Build the new app fresh; migrate one area at a time; each slice ships behind the
legacy deploy when its three gates pass.

| Step | Work | Gate (all three for the slice) |
|---|---|---|
| **0 Toolchain + CSS re-host** | pnpm+Vite+TS strict+Vitest+Playwright; **import the legacy CSS as a global stylesheet, unchanged**; stand up the harness (shims+fakes, Part V) + visual pipeline (computed-style diff, screenshots, Claude-review hook) | smoke green; legacy CSS loads globally; harness drives one legacy ride |
| **1 Core port** | `core/{model,zwo,fit,metrics,engine}` to TS; unify model; read legacy `.zwo`/`.fit`/active-state | C: old-vs-new unit + FIT-SDK green |
| **2 HUD + ride** | HUD/StatusOverlay/Dialog in Svelte (same classes/test-ids); chart static/dynamic layer-split; signals store; ports wired to fakes | A+B+C for ride/free-ride/connectivity; visual matrix for HUD (incl. dark/landscape) |
| **3 Settings + Welcome** | smallest views first | A+B for settings/onboarding |
| **4 Picker** | library/search/sort/builder-host | A+B for library/import/build |
| **5 Planner** | calendar (data-level) + virtualization; ride detail | A+B for planner; calendar visual matrix |
| **6 Builder** | builder + its chart together (typed `data-*` drag contract) | A+B for build/edit |
| **7 Cutover** | vite-plugin-pwa; deploy beta; **real-environment lane (III.D) green**; flip; `docs/` = rollback | all gates + lane + Claude visual sign-off |
| **8 Tauri** *(optional)* | `TauriFileStore` + `TauriBleTransport` (btleplug) | port-level harness scenarios |

Each step is independently revertible; legacy `docs/` stays the production deploy until Step 7.

---

## Part V — Harness internals (shims + fakes)

**Minimal swappable shims** (added to a `legacy-shimmed/` copy; default-to-real; tracked as a patch;
proven non-altering by a pristine-vs-shimmed smoke): `ble-manager` reads injectable `bluetooth`;
`storage` reads injectable FS provider; `workout-engine` injectable `now`/`schedule`; `beeper`
injectable audio **and its timer cascade** (the `onDone` that starts a ride runs on beeper's
`setTimeout`); plus `new Date`. **Use a real virtual-time scheduler** (sinon-fake-timers style) owning
`setInterval/setTimeout/Date.now/performance.now/new Date` across engine + ble-manager + beeper, with
a microtask drain after each stepped tick (the tick is `async` and awaits BLE/FS).

**Fakes:** FTMS trainer simulator (GATT graph + Indoor-Bike-Data emit + Control-Point ERG response,
closed-loop; validated vs real traces), HR/battery sims, in-memory FileStore, audio recorder, fetch
fixtures. The new app reads the same injected env, so **one harness drives both apps**.

---

## Part VI — Component tree (target)
```
App
├── HudView   StatCards(power·target·cadence+arrows·hr·intervalTime·elapsed; data-testid'd; NOT live regions)
│    · LiveChart(static profile render-once + dynamic trace/position mutated 1 Hz)
│    · BottomNav(Bike+dot · Hr+dot+battery · Settings · Calendar · WorkoutControls[ModeToggle·ManualControls·Transport(start·resume·pause·stop)·titleCenter·nameLabel])
├── StatusOverlay (3-2-1 · Paused/Resumed · text-event cues; decoupled from beeper)
├── OverlayModal (shared chrome) → Welcome · Picker(→BuilderHost→Builder) · Planner(WeekCalendar·DayCell·RideDetail) · Settings
├── ChartTooltip/hover   └── DialogHost (promise confirm/alert)
```
Every element that a test or the CSS targets carries a stable **`data-testid`/class**. LiveChart:
render profile once, mutate only the trace polyline + position line at 1 Hz; memoized theme palette
(no `getComputedStyle` in the hot path). CSS: global tokens/shared classes; scoped only for local.

---

## Part VII — Scenario & edge-case catalog (behavior gate)
Each row = a harness scenario (trigger → observable assertion); **⚠ = edge/error**. Stage-gate: green
on legacy (capture), then on each new slice. (Constants: Part X.)
- **Ride:** fresh start→3-2-1→intervals→end→`.fit`; auto-start; ⚠auto-pause(≥1 s 0 W); ⚠auto-resume(≥90%); ⚠manual-pause-blocks-resume-10 s; FTP rescale; beeps(3 s/9 s gates); ⚠no-beep on <10%/freeride; cadence coaching(±5,5 s); text events(once,10 s); ⚠1 s segments; ⚠disconnect→null→pause; ⚠stop-no-samples→no-fit.
- **Free-ride:** ERG ± (⚠clamp 50-1500 keys vs 50-ftp×2.5 typed); resistance ×10; e/r only when isFreeRideActive; throttle ≥10 s.
- **Connectivity:** connect bike/HR; battery; ⚠low-battery; ⚠reconnect backoff; ⚠BLE-unsupported→settings; ⚠connect-fail→error dot.
- **Import:** ⚠scrape handoff (boot+focus, guard, flag); ⚠failure prompts; ⚠don't-auto-load-if-active; URL import; ⚠upload+parse-fail.
- **Build:** insert all types→Save `.zwo`; ⚠rename=trash+write; drag/snap/ramp-3-region; vim keys; undo/redo; ⚠validate; ⚠unsaved-discard; ⚠draft recovery; ⚠invalid-paste; clone auto-name.
- **Library:** search grammar+filters+sort+persist; expand; delete→trash; ⚠empty; ⚠permission-revoked; seeding.
- **Planner:** schedule (picker↔planner handoff); ⚠drag-reschedule/unschedule/edit; ⚠past-date reject; load-today; ⚠auto-open-on-boot; detail(stats/curve/chart); ⚠fit-parse-error; ⚠missing-file; totals; ⚠auto-close-on-active.
- **Onboarding/boot:** ⚠gating(full/splash/suppressed); ⚠settings-auto-open; FTP clamp; theme→chart re-render; ⚠logs append; ⚠root-dir guard.
- **Persistence:** ⚠crash→resume-paused; debounce; ⚠backward-read of legacy files.
- **Keyboard:** hotkeys+⚠suppression; ⚠Escape disposition.

---

## Part VIII — Risks & DoD
| Risk | Mitigation |
|---|---|
| CSS/layout breaks in the rewrite | re-host CSS global & verbatim; computed-style+geometry differential; screenshot regression; Claude visual review; layout invariants |
| Svelte scoping fragments the cascade | design/shared CSS stays global; structure-dependent selectors preserved/refactored |
| Pixel-diff false positives on a rewrite | tolerance+masking+pinned env; **Claude triages real-vs-noise** |
| Visual look not caught by behavior tests | visual gate is first-class and equal to behavior |
| FTMS sim circular / FIT self-consistent-wrong | real captured traces + Garmin FIT-SDK validation |
| Clock desync (5 time bases) | one virtual-time scheduler across engine+ble+beeper; microtask drain |
| Fakes hide real FSA/BLE/extension behavior | real-environment lane (III.D) + coverage-gap register, blocking cutover |
| Waterfall/abandonment | vertical slices, ship behind legacy; no upfront full lock |

**DoD per slice:** its A (visual matrix incl. dark+landscape) + B (catalog slice) + C green; Claude
visual review = match (or only approved diffs). **DoD cutover:** all slices green + real-environment
lane green + Claude visual sign-off; `docs/` retained one release. **DoD Tauri:** native build rides a
real trainer.

---

## Part IX — Changelog
| Version | Change |
|---|---|
| v1→v4 | analysis → modernization options → migration mechanics → harness-first (FTMS sim + scenario catalog) |
| v4→v5 | **re-centered on the real challenge: small core, big UI/framework + CSS/layout rewrite.** CSS re-hosted (global/verbatim) as the primary de-risk; **three matched gates** (looks/works/computes) with **visual/CSS correctness first-class**; **Claude visual-review tier** added (capability confirmed: reads PNGs, judges + triages); FTMS sim grounded by real traces + FIT-SDK; virtual-time scheduler; real-environment lane gates cutover; vertical-slice sequencing |

---

## Part X — Engine behavior & magic numbers (behavior-scenario spec)
> Cite these in B-gate scenarios. Source: `workout-engine.js`, `beeper.js`, `workout-metrics.js`,
> `ble-manager.js`, `workout.js`.

**Auto-start** `max(75, 0.5×ftp×(startPct||50)/100)`; guarded by `!autoStartSuppressed` (set on
finish, cleared on manual start). **Auto-pause** `zeroPowerSeconds≥1` outside grace. **Grace**
`autoPauseDisabledUntilSec=15` at start, `elapsedSec+15` on manual/auto resume; resets
`zeroPowerSeconds` to 0 inside grace. **Auto-resume** while paused if `lastSamplePower≥0.9×target`.
**Manual-pause blocks auto-resume 10 s** (`now+10000`). **Fresh-ride init runs inside
`runStartCountdown`'s `onDone`** (resets samples/elapsed, arms grace, setRunning, force-send) — the
audio fake **must** invoke it. **endWorkout** writes FIT only if samples; `autoStartSuppressed=true`.
**ERG target** per tick `round(startW+(endW−startW)·clamp(rel,0,1))`, recomputed live from
`rawSegments×ftp` (so `setFtp` re-rates instantly); freeride erg→`manualErgTarget`,
resistance→`{kind:resistance,value:manualResistance}`. **Segment dur** `max(1,round(min×60))`.
**Transport:** throttle ≥10 s unless force/change (per-mode caches, `performance.now`); ERG clamp
[0,2000]; resistance level [0,100]→×10; handshake requestControl+startOrResume (fatal); disconnect→
null sample; reconnect 1 s→×2→cap 10 s; hrFromBike fallback only. **Beeps:** non-freeride adjacent,
`diffFrac=|nextStartRel−currEndRel|/currEndRel≥0.10`; `secsToEnd==3`→pattern; `==9 && diffFrac≥0.3 &&
nextStartRel≥1.2`→danger. **Metrics:** segment rel midpoint `p0+dp×((i+0.5)/dur)`; NP=`(mean of
(30 s-avg)^4)^0.25`, denom `max(1,n−29)`, `n≤30` whole-array; IF=NP/FTP; TSS=`dur×IF²/36`;
kJ=`ftp×Σrel/1000` or `Σwatts/1000`; freeride excluded from work, counted in duration; zones
`<60/76/90/105/119`, `workFrac≥0.75`; VI=NP/avg; EF=NP/avgHR. **Cadence coaching** out-of-band
`>target+5`/`<target−5`, after ≥5 s; "Speed up/Slow down - target N RPM". **Center cues** "Maintain N
watts for D"/"Ramp up/down to N watts"/"Free ride at N watts"; look-ahead "In K -" when `dur≥20 &&
remaining≤10`. **Text events** active `[offset,offset+dur]`, default 10 s, last-wins, fire-once via
`idx:offset:text`. **Samples** one/advanced-sec `{t,power,hr,cadence,targetPower}`; save debounce
500 ms; persisted blob carries the auto-pause/resume/grace/pause-accounting fields. **Crash recovery:**
running→resume **paused**. **Manual clamps:** buttons/keys ERG [50,1500]/res [0,100]; typed ERG
[50,ftp×2.5]; require `isFreeRideActive`. **Chart empty-state** precedence `resume>readyToStart>
noWorkout>noBike`; messages + arrow left(noBike)/right(ready)/hidden(resume).
