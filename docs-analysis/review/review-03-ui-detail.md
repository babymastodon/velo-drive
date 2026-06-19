# Review 03 — UI Layer Detail (read-only)

Scope: `web/src/ui/*.svelte` + `web/src/ui/*.ts` and `web/src/state/*.svelte.ts`.
Goal: simple, readable, well-encapsulated components; flag fat components, cross-view
duplication, `$effect` overuse, prop-drilling/state-ownership issues, keymap coherence,
and dead/stale code. CSS and legacy DOM class names are out of scope (verbatim re-host).

**Bottom line:** This is a genuinely *good* rewrite, not spaghetti. The big views are large
but each is **cohesively sectioned** and the heavy lifting (metrics, chart, zwo/fit parsing,
builder model, planner analysis) lives in `core/` where it belongs. The components are
overwhelmingly view+glue. The state stores are clean and small. The findings below are
mostly low-risk de-spaghetti wins (de-dup, stale comments) plus a couple of structural
notes; none are urgent, and several "fat" views are fairly judged as fine.

Legend — Severity: **High** (real maintenance hazard) / **Med** (worth doing) / **Low** (nit).
"No-brainer" = low-risk, low-effort de-spaghetti win.

---

## Findings

| # | Finding | Location (file:line) | Why it hurts | Severity | Fix recommendation + tradeoff |
|---|---------|----------------------|--------------|----------|-------------------------------|
| 1 | **Stale "DEFERRED" header comment** — the file-level comment says the in-picker builder is DEFERRED and the Create/Edit buttons "no-op", but the builder is fully implemented (`enterBuilderMode`, `BuilderView` host, save, import, drafts). | `PickerView.svelte:7-9` | Actively misleading: a reader trusts the header and mis-models the file. | Med | Delete the three "DEFERRED … no-op" sentences. Pure comment edit, zero risk. **No-brainer.** |
| 2 | **Duplicated `isEditable`/`isEditableTarget` helper** across 4 components, each re-implementing the same INPUT/TEXTAREA/SELECT/contentEditable check. | `App.svelte:204-209`, `PlannerView.svelte:777-782`, `PickerView.svelte:841`, `BuilderView.svelte:744` | 4 copies of an identical predicate; one drifts and keymaps diverge silently. | Low | Extract `isEditableTarget(el)` into a tiny `ui/keymap-utils.ts` and import. Trivial, no behavior change. **No-brainer.** |
| 3 | **Duplicated local date-key formatter** (`YYYY-MM-DD` from a local `Date`). Inlined twice in App, and is exactly `PlannerView.formatKey`. | `App.svelte:56` & `App.svelte:158` vs `PlannerView.svelte:84-89` | Date-key logic is correctness-sensitive (schedule matching keys off it); 3 copies invite a one-char skew. | Med | Add `formatLocalDateKey(date)` to a shared `core/date.ts` (or `metrics`-adjacent util) and use everywhere, including the schedule-mode handoff in the planner. Small, mechanical. **No-brainer.** |
| 4 | **Duplicated segment helpers** — `getRawCadence` appears in both `hud-format.ts:27` and `hud-coaching.ts:30` (identical), and `getCurrentCadenceTarget` exists in both files with slightly different implementations. | `hud-format.ts:27,78-97` and `hud-coaching.ts:30-36,138-146` | Two copies of cadence-target logic that *should* agree (the HUD indicator vs the coaching title); they're already subtly different, which is exactly the divergence risk. | Med | Move `getRawCadence` + a single `getCurrentCadenceTarget` into one module (or into `core/model.ts`/`metrics.ts`) and have both consume it. Low risk; consolidates a real behavioral overlap. |
| 5 | **`getCurrentCadenceTarget` recomputes `total` inside the per-segment loop** — the `for (const s of cw.rawSegments) total += …` block runs once *per outer segment* instead of once. | `hud-format.ts:83-88` | O(n²) and confusing; the running `acc`/`end` already walk the timeline, so `total`/`tc` clamping is redundant here (the loop returns on the first `end` past `t`). | Low | Hoist the total out of the loop (or drop it — the early-return already bounds `t`). Tiny perf+clarity win; verify against the `hud-coaching` version while consolidating (#4). |
| 6 | **Picker filter zone strings vs `inferZoneFromSegments` output may mismatch.** The `<select>` options use `VO2Max`, while `getZone` returns whatever `inferZoneFromSegments` emits (`VO2Max`, `Uncategorized`, …) and the filter compares with strict `===`. | `PickerView.svelte:1046-1052` (options) vs `:134-136,151` (filter) | If core ever renames a zone label, the filter silently drops all rows for that zone with no error. Not a bug today (labels line up) but a brittle string contract spread across two files. | Low | Source the zone option list from a single exported constant in `core/metrics.ts` (the same source `inferZoneFromSegments` uses). Keeps filter + classifier in lockstep. |
| 7 | **`BuilderView.handleKeydown` is a ~230-line keymap monolith** (undo/redo/clipboard/insert-by-letter/selection/duration+power steppers) in one function. | `BuilderView.svelte:741-973` | Hard to scan; the precedence ordering (meta combos before bare letters, multi-select branches before single) is implicit and fragile. It *works* and is well-commented, but it's the single densest spot in the UI. | Med | Optional: split into `handleClipboardKey`, `handleInsertKey`, `handleSelectionKey`, `handleStepperKey`, each returning handled/not. Moderate effort; meaningful readability gain but touches a behavior-critical path — only worth it if this file keeps growing. Otherwise leave as-is. |
| 8 | **Three near-identical chart-action + theme-redraw registries.** `PlannerView` (`registerChart`/`chartRenderers` + `themeVersion` effect), `PickerView` (`miniChart`/`chartRenderers` + `themeAutoVersion` effect), and `BuilderView` (single chart + `themeAutoVersion` effect) all hand-roll "register a render closure, rAF it, re-run on theme bump, clean up on destroy." | `PlannerView.svelte:503-579`, `PickerView.svelte:922-946`, `BuilderView.svelte:466-496` | The "imperative SVG that must redraw on theme change" pattern is copy-pasted 3×; the picker/builder use `themeAutoVersion` while the planner uses `themeVersion`, which is correct-by-design but easy to get wrong on the next chart. | Low–Med | Extract a `makeChartRegistry(themeSignal)` helper (or a `use:themedChart` action factory) returning the `use:` action + the effect wiring. The per-view *signal choice* stays explicit. Medium effort; removes a real triplicate, but each copy is short and self-contained, so it's a judgment call. |
| 9 | **`PickerView` carries two genuinely different responsibilities** — the browse/filter/sort/schedule *library* AND the full *builder host* (draft persistence, dirty tracking, TrainerDay/file import, save-with-rename). ~1416 lines. | `PickerView.svelte` (builder-host block `:405-733`) | The library concerns and the builder-host concerns barely interact; the file is large mostly because both live here. It mirrors legacy structure, so it's defensible, but it's the clearest "could be two files" case. | Low | Optional: lift the builder-host glue (draft/dirty/import/save) into a `picker-builder-host.ts` controller or a thin child component, leaving Picker as the library. Real cohesion win but non-trivial; only if this view keeps accreting. **Not** a no-brainer. |
| 10 | **`PlannerView.openDetail` builds the entire `DetailState` view-model inline** — FIT re-read, duration/paused reconciliation, VI/EF, HR/cadence stats — ~60 lines of analysis math in the component. | `PlannerView.svelte:586-645` | This is *derivation* logic (engine/metrics altitude), not rendering; it's the one place real domain math leaked into a `.svelte` file. | Med | Move the `parsed → DetailState` mapping into `core/planner-analysis.ts` (which already owns `buildPowerCurve`/`computeHrCadStats`) as e.g. `buildRideDetail(parsed, ftp)`. The component then just calls it and stores the result. Low risk, testable in isolation, shrinks the view. |
| 11 | **`onWorkoutEnded` boot callback embeds business logic in `App.svelte`** — derives the day key and calls `removeScheduledByTitle`, plus the welcome/attention/today-schedule gating sequence (~115 lines of boot orchestration). | `App.svelte:45-196` | App is the composition root, so *some* orchestration is expected, but the schedule-cleanup-on-finish rule is domain policy sitting in the shell. | Low | Optional: move the "on finish, unschedule today's matching entry" rule into the engine/file-store layer (it already owns `removeScheduledByTitle`). The welcome/attention gating is genuinely shell concern — leave it. Minor. |
| 12 | **Builder `dragState: any`** — the drag engine's most stateful object is untyped. | `BuilderView.svelte:120` (`let dragState: any`) | `any` in the densest interaction code (pointer math, ramp regions, interval timing) defeats the type checker exactly where a typo hurts most. | Low | Define a `DragState` interface for the object shape assembled at `:618-636`. Pure typing; no runtime change. **No-brainer.** |
| 13 | **`engine` prop threaded through `PlannerView` for a single call.** | `PlannerView.svelte:54,763` (`engine.setWorkoutFromPicker`) | Minor prop surface; fine, but worth noting the planner only needs the engine to load a scheduled workout. | Low (accept) | No action needed — it's one legitimate use. Listed only to confirm it's *not* a smell. |
| 14 | **Comment/code drift risk: `OverlayId` includes `'picker'`/`'planner'` but the welcome handler comment in `ui.svelte.ts` predates them.** The store is otherwise excellent. | `ui.svelte.ts:22-24` ("populated by the overlay components (picker wave)") | Tiny: a "wave" note that's now history, not state. | Low | Trim the parenthetical. Cosmetic. |

---

## Things that are GOOD (explicitly fair)

- **State stores (`state/*`) are exemplary.** `ui.svelte.ts` is the single, well-documented
  owner of overlay routing, schedule/ builder/detail sub-modes, and the `handleEscape`
  disposition. `dialog`, `logs`, `engine`, `theme` are each tiny and single-purpose. No
  prop-drilling of state that should be in a store. This is the opposite of spaghetti.
- **Keymap routing is coherent and centralized by design.** `App.svelte:219-341` is the one
  global router; overlays register a single `OverlayKeyHandler` via
  `ui.registerOverlayKeyHandler` (`WelcomeView`, `PickerView`, `PlannerView`), and the
  builder-owns-everything case is handled by one explicit `ui.pickerBuilderMode` gate
  (`App.svelte:254`). The dialog-traps-keyboard branch (`:228-245`) is correct and in one
  place. The convention is consistent across views — this is the right shape.
- **`hud-format.ts` / `hud-coaching.ts` extraction** keeps the HUD components
  (`StatCards` 106 lines, `BottomNav`) thin — formatting/coaching math is out of the
  template. `BottomNav` looks big but is almost entirely static SVG markup; its script is
  small and clear. (The only overlap is finding #4/#5.)
- **`OverlayModal` shared chrome** (backdrop press-gesture) is properly factored and reused
  by `Dialog`, `Settings`, `Picker`, `Planner` — exactly the de-dup the prompt hoped for.
- **`$effect` usage is disciplined, not overused.** The effects that exist are doing real
  imperative-bridge work that `$derived` cannot do: imperative chart redraws on a tracked
  theme signal (`LiveChart:71-91`, planner/picker/builder), ResizeObserver wiring
  (`StatCards:50-54`, `BuilderView:108-117`), DOM measurement/auto-scroll
  (`SettingsView:166-178`), and font-fitting (`StatCards:43-48`). The `open`-transition
  guards (`PlannerView:209-218` `wasOpen`, `PickerView:117-128`) correctly avoid re-running
  load logic on unrelated reactive reads — a thoughtful touch, not a hack. No effect is doing
  work that should be a `$derived`.
- **The genuinely "fat" views are cohesive.** `PlannerView` (1276) and `PickerView` (1416)
  read top-to-bottom with clear `// ---` section banners (date helpers → state → load → weeks
  model → aggregates → charts → interactions → keymap → template). Size is driven by faithful
  legacy DOM + many small handlers, not by tangled concerns. Apart from findings #9 and #10,
  there's little to lift out.
- **Leaking core types into templates is minimal** — views build local display-only
  view-models (`PickerItem`, `DetailState`, `cardStatParts`, `detailStats`) rather than
  binding raw core structures in markup.

---

## Suggested priority

1. **No-brainers (do them):** #1 (delete stale comment), #2 (`isEditableTarget` util),
   #3 (shared `formatLocalDateKey`), #12 (`DragState` type), #14 (comment trim).
2. **Worth doing (small, testable):** #4 + #5 (consolidate cadence helpers, fix the
   O(n²)), #10 (`buildRideDetail` into `planner-analysis`).
3. **Judgment calls (only if these files keep growing):** #7 (split builder keymap),
   #8 (chart-registry helper), #9 (split picker library vs builder-host), #11, #6.

No High-severity structural problems found. The rewrite met its "simple, well-encapsulated,
no needless complexity" goal; the remaining work is tidy-up, not de-tangling.
