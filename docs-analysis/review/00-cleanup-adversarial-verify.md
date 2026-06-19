# Adversarial verification — VeloDrive cleanup refactor (8d88958 · 041910b · 812470f)

**Goal:** Try to PROVE the "100% behavior- AND render-preserving" claim FALSE.
**Method:** Line-by-line OLD (`7196a9e`) vs NEW (`812470f`) comparison of every changed region in `web/src`, plus full test run.
**Scope of code change:** read-only. **No code was modified.**

**Test suite at HEAD:** `15 files / 473 tests — all pass.** Notably `core-history-schedule.test.ts` (19) and `web-file-store.test.ts` (10) independently pin the domain move; `metrics.parity` (170) and `zwo.parity` (206) pin the segment/zwo math.

## Bottom-line verdict

The cleanup is **effectively regression-free for all real (validated) inputs.** I found **no flag that changes output for any well-formed workout, schedule, or render.** Every accessor, threshold, regex, boundary rule, dedupe order, and cache version is byte-identical to the pre-refactor inline code.

I am raising **two low-severity flags** (both only fire on malformed / out-of-contract input that the parser should never produce) and **one process gap** (the chart render-lock snapshot proves self-consistency, not byte-identity to the legacy renderer). None is a blocker. Details below.

---

## Item-by-item

### 1. `core/segments.ts` accessors — VERIFIED-SAFE (one low-severity edge flag: F1)

`getRawStartPct/EndPct/Type` return `seg?.[k]` unchanged (raw `unknown`, no coercion) — matches old direct `seg[1]`/`seg[2]`/`seg[3]` reads. `isFreeRideSegment` = `Array.isArray(seg) && seg[3]==='freeride'` — byte-identical to all old copies. `getRawCadence` (shared) reproduces the old 5-line copy verbatim (`seg[3]==='freeride'→null`, prefer finite `seg[4]`, fallback numeric `seg[3]`, else `null`). `FREERIDE_POWER_REL = 0.5` unchanged.

**Builder-backend `getRawCadence` (the kept one):** CONFIRMED not swapped. `builder-backend.ts:19` imports only `{ FREERIDE_POWER_REL, isFreeRideSegment }` — **not** `getRawCadence`. The local function-scoped `getRawCadence` at `builder-backend.ts:979-987` (which wraps `normalizeCadence`, lines 982/984) lexically shadows any import and is the one resolved at the `segmentsToBlocks` call site (`:834`). The `isFreeRideSegment(seg)` swap at `:833` is safe because the loop already passed `if (!Array.isArray(seg)…) continue` two lines up, so the added `Array.isArray` arm is always true there.

**`segDurationSec(min) = Math.max(1, Math.round((min || 0) * 60))`** matches every old call site EXCEPT one nuance:

> **FLAG F1 (LOW) — `segDurationSec` adds a `|| 0` that `metrics.ts` did not have.**
> Old `metrics.ts:67` (computeMetricsFromSegments): `const dur = Math.max(1, Math.round((minutes as number) * 60));` — **no `|| 0`.**
> New: `segDurationSec(minutes as number)` injects `(minutes || 0)`.
> Divergence only when `minutes` is `NaN`: OLD → `dur = NaN` (loop `for(i<NaN)` runs 0×, `totalSec += NaN` poisons totals); NEW → `dur = 1` (loop runs once, `totalSec += 1`). For `0`/`null`/`undefined` the two converge (both → 1). The same `Number()`-coercion shift exists in chart via `getRawMinutes` (`Number(seg?.[0])||0`) replacing old bare `(seg[0]||0)` — diverges only for a non-numeric **string** `seg[0]` (e.g. `"abc"`: old → `NaN`, new → `1`).
> **Real-world impact: effectively none.** All callers (`computeMetricsFromSegments` × `builder-backend:423`, `PickerView:151`, `metrics:306`; chart paths) feed parser-validated `canonicalWorkout.rawSegments`, where `minutes` is always a finite number. The refactor arguably makes the function *more* robust (NaN→1 instead of NaN-poisoning). Flagging only because it is a genuine output difference on out-of-contract input and the task asked for "however subtle."

### 2. Zone thresholds (`zoneIndexForPct`) — VERIFIED-SAFE
`ZONE_THRESHOLDS=[60,76,90,105,119]`, `zoneIndexForPct` returns first `i` with `pct < threshold[i]`, else `5`. This reproduces both old ladders exactly, including the `<` (strict) boundaries: pct=60→endurance, pct=59.999→recovery, pct=119→anaerobic. Both `metrics.inferZoneFromSegments` (lowercase labels) and `chart.zoneInfoFromRel` (titlecase) now route through the SAME function, so they are *guaranteed* mutually consistent. `NaN` input: every `<` is false → returns 5 → `anaerobic`/`Anaerobic`, matching the old `else` fall-through in both copies. Boundary values 60/76/90/105/119 verified identical.

### 3. Chart svg-dom extraction — VERIFIED-SAFE (process gap: G1)
- **Attribute order:** `el()` iterates the literal's keys with `for…in` (insertion order) and skips only `null`/`undefined`. Every call site preserves the original `setAttribute` sequence. Spot-verified the order-sensitive ones: HUD/builder grid lines (`appendGridLine`: line `x1,x2,y1,y2,stroke,stroke-width,pointer-events`; label `x,y,font-size,fill,pointer-events`) match the old hand-written order; FTP line/label, position cursor, past-shade rect, power-curve ticks/labels, text-event icon rect — all preserved.
- **Mixed create-then-setAttribute nodes** (`el('g')`/`el('path')` then later `.setAttribute`): the `bubble` path (`chart.ts:1075,1089-1100`) and `iconGroup` transform (`:1088`) keep the original attribute order and append point. ✓
- **Remaining hand-rolled `createElementNS`:** 6 (`chart.ts:712` xhtml div, `:830`/`:1211` the two root `<svg>`, `:1034` marker `g`, `:1042` tick line, `:1053` group `g`) — all left as the original code had them (the `<svg>` roots and the xhtml div can't go through the SVG-typed helper); each still correct. (Task said "5"; the xhtml `div` is the 6th, namespaced differently.)
- **`el()` null-skip arm** never changes output: no call site passes a possibly-null attribute where the old code unconditionally `setAttribute`'d a stringified value, so `if (v==null) continue` is inert in practice.
- **Uncovered renderer paths** (0 segments / freeride / missing cadence / huge power): these all funnel through the verified helpers (`segDurationSec`, `getRawCadence`, `isFreeRideSegment`, `zoneInfoFromRel`), so identity follows from items 1-2. The snapshot fixture *does* include freeride + intervals + ramp + a power gap.

> **GAP G1 (PROCESS, not a code bug) — the chart render-lock snapshot does NOT prove byte-identity to the legacy renderer.**
> `web/tests/unit/chart-output.test.ts` and its `__snapshots__/*.snap` golden were **both introduced in commit 041910b** — the same commit that did the svg-dom extraction (`git log --diff-filter=A` confirms). So the snapshot captured **post-refactor** output. It proves the chart is deterministic/stable going forward, but it does **not** prove the new SVG is byte-identical to what `7196a9e`'s chart emitted. The "render-preserving" claim for the chart therefore rests on **manual review only** (which I did, and it holds). If true legacy-parity assurance is wanted, regenerate the `.snap` from `7196a9e`'s chart output and diff — see "Recommended follow-ups."

### 4. `isEditableTarget` superset — VERIFIED-SAFE
The shared `dom-utils.ts:15-25` helper is `INPUT||TEXTAREA||SELECT||el.isContentEditable` with a `!el→false` guard. Three of the four old copies (App.svelte `isEditable`, PlannerView, BuilderView) **already had** the `isContentEditable` arm — identical. Only the **PickerView** inline guard had drifted to omit it, so the picker is the sole site where an arm was *added*. A full `grep -rni "contenteditable|designmode|execcommand"` over `web/src` returns **zero** contenteditable attributes / designMode / rich-text widgets anywhere — including the embedded builder and any dialog over the picker. Therefore `el.isContentEditable` is always `false` in the picker and the added arm can never change which keys are suppressed. Guard placement and `e.target` argument are unchanged at all four call sites.

### 5. `core/date-keys.ts formatDateKey` — VERIFIED-SAFE
`getFullYear()` / `String(getMonth()+1).padStart(2,'0')` / `String(getDate()).padStart(2,'0')`, joined `${y}-${m}-${d}`. **Character-for-character identical** to PlannerView's old `formatKey` (now imported as `formatDateKey as formatKey`) and to **both** App.svelte inline formatters. All local-time accessors — no `getUTC*`, no `toISOString` — so no UTC drift; month `+1` and zero-padding preserved. Schedule/history keys stay byte-identical to on-disk values.

### 6. Domain move (`history.ts` / `schedule.ts` / `calendar.ts`) — VERIFIED-SAFE
- **`buildHistoryPreview`** ≡ old `WebFileStore.buildPreview`: `durationSecHint` cascade, `kj` fallback (`totalWorkJ!=null?…/1000:metrics.kj`), `ifValue`, `tss`, `powerMax`, `zone`, `.fit`-strip title regex — all verbatim.
- **`buildRideDetail`** ≡ old `PlannerView.openDetail`: `totalTimerSec`/`totalElapsedSec` cascades, `pausedSec=max(0,elapsed-timer)`, `activeDurationSec`, `vi=NP/avgP` (guarded), `ef=(NP||0)/avgHr` (guarded), HR/cad stats, power curve — verbatim. The 3 fallback fields (title / startedAt chain / zone) are correctly threaded through the new `fallback` param. One benign eager-vs-lazy nuance: `utcDateKeyToLocalDate(formatKey(today))` is now computed at the call site instead of lazily in a `||` chain — pure, no behavior change.
- **`schedule.ts`** (remove/move/schedule/unschedule): past-day guard (local-midnight compare), `findIndex` first-match, `slice+concat` reorder, dedupe-then-append / replace-in-place — all verbatim. Empty-schedule, past-date-reject, replace-not-found-append, dedupe edges preserved; pinned by `core-history-schedule.test.ts`.
- **`calendar.ts`**: all four search regexes byte-identical (incl. the `–` en-dash alternate and `(m|min)?` suffix), ±5 approx, reversed-range swap, NaN-safe `!(dur>=min)` negation; `buildCalendarWeeks` month-boundary rules (`month-left/top/bottom-boundary` with the exact `firstDow`/`lastDow`/`dow` comparisons and `lastDow!==6` guard) and monthLabel (`Today` / `toLocaleString month:long` / catch→`getMonth()+1`) verbatim.
- **Stats cache:** `STATS_CACHE_VERSION = 30` **unchanged**; `StatsCacheEntry`/`StatsCache` interfaces and `cacheEntryFromPreview` (`startedAt.toISOString()`) / `previewFromCache` (`new Date(...)`) were **not moved** and are untouched. On-disk serialization unchanged. No `??` introduced in any new core file.

### 7. Dead-code deletions — VERIFIED-SAFE
- **Doubled `bikeConnected`:** both removed duplicates were byte-identical (`= true` ×2 in connect path; `= false` ×2 in `onBikeDisconnect`), plain field writes with no intervening read/side-effect → collapsing is inert.
- **Collapsed `getBlockDurationSec`:** `BlockKind` is exactly `steady|warmup|cooldown|intervals|freeride`. `intervals` returns early; the other four old branches each returned the identical `Math.max(1, Math.round(Number(dur)||0))` — now the single collapsed return. The old `return 0` fall-through was **unreachable** (no sixth kind; `block.kind` only set via `createBlock(kind: BlockKind)`). No kind that used to return 0 now returns a duration.
- **`DialogStore.resolvePrompt`:** `grep -rn resolvePrompt web/` → zero refs. Truly dead.
- **`void maxHr`:** removed an unused local + its no-op `void`; `maxHr` had no other reference; `max()` is pure. Inert.
- **Dead CSS:** `.debug-*` selectors (0 markup/JS refs); a duplicate `border-radius` block in picker.css (surviving rule has identical values); a duplicate trailing `:-webkit-autofill` in the autofill list (distinct resting/hover/focus states all retained). No applied style changed.

### 8. Q14 `NormalizedKind` — VERIFIED-SAFE
Purely a type-level change. Old code already pushed the string literals `'rampUp'`/`'rampDown'` (via `as BlockKind` casts) and compared `(b.kind as string) === 'rampUp'`. New `NormalizedKind = BlockKind | 'rampUp' | 'rampDown'` removes the casts but the runtime string values pushed and compared are identical. No runtime effect.

---

## Flags, ranked

| # | Severity | Where | What | Real-world risk |
|---|----------|-------|------|-----------------|
| F1 | LOW | `metrics.ts:67` (now `segDurationSec`) + chart `getRawMinutes` | New `\|\| 0` / `Number()` coercion makes `NaN`/non-numeric-string `minutes` resolve to `dur=1` instead of old `NaN`. | Only triggers on malformed segments the parser never emits. Change is arguably an *improvement* (no NaN-poisoning). Not output-affecting for any validated workout. |
| G1 | PROCESS | `web/tests/unit/chart-output.test.ts` + `.snap` | Render-lock snapshot was authored in the refactor commit, so it pins post-refactor output, not legacy parity. | Chart byte-identity to `7196a9e` is established by manual review only, not by an automated gate. Manual review passed. |

No HIGH or MEDIUM flags. No behavioral regression found for any in-contract input.

## Recommended follow-ups (optional, for a human)

1. **Close G1:** regenerate the chart snapshot from `7196a9e`'s renderer (or run the old `drawWorkoutChart` against the new fixtures once) and diff against the committed `.snap` to convert the chart claim from "review-verified" to "test-verified" legacy parity.
2. **(Trivial)** If strict legacy-faithfulness on malformed input ever matters, F1's metrics path could keep the old no-`||0` form — but in practice the new behavior is safer; no action needed.
3. No other double-checks warranted; the domain-move and dead-code claims are fully pinned by passing tests.
