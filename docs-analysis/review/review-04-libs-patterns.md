# Review 04 — Libraries & Design Patterns

**Scope:** `/home/babymastodon/code/velo-drive/web/src` (~18,100 lines TS/Svelte)
**Lens:** Where would a small library OR one reusable internal helper/pattern meaningfully cut code across many modules? And where did the rewrite adopt a heavier pattern than a lightweight, zero-runtime-dep app needs?
**Constraint respected:** The app has **zero runtime dependencies** (Svelte/Vite are build-time only). The bar for recommending a new dependency is HIGH. A shared *internal* helper (no new dep) is preferred wherever it does the job.

**Headline:** The zero-dep philosophy holds up extremely well. **No new runtime dependency clears the bar** — not for charting, FIT parsing, XML, IndexedDB, dates, or dialogs. The genuine wins are a handful of small **internal helpers** that remove copy-paste already present across modules, plus a few spots of mild over-engineering to trim or simply leave alone. The promise-dialog and modal-chrome layers are already exemplary.

---

## Candidate table

| # | Candidate (lib / pattern / helper) | What it replaces + modules touched | Est. line reduction | Cost / risk | Verdict + why |
|---|---|---|---|---|---|
| 1 | **`RawSegment` accessor + timeline-walk helper** (internal `core/segments.ts`) | The positional tuple convention (`seg[0]`=min, `[1]/[2]`=pct, `[3]`=freeride/cadence, `[4]`=cadence) and the `Math.max(1,Math.round(min*60))` duration + accumulate-time + interpolate loop are hand-reimplemented across **engine.ts, metrics.ts, fit.ts, zwo.ts, chart.ts, hud-format.ts, hud-coaching.ts, scrapers.ts** (8 modules). `getRawCadence`/`isFreeRideSegment` are byte-for-byte duplicated in engine.ts, hud-format.ts, hud-coaching.ts, zwo.ts. The segment-at-time walk + interpolation in hud-format.ts (44-66) duplicates engine.ts `getCurrentSegmentAtTime` (198-248). | **~80–140** | Low–medium. Pure refactor; covered by existing differential/parity tests. Must NOT change the tuple's runtime shape (byte-locked FIT + zwo parity). | **internal-helper — RECOMMEND (top cross-cutting win).** Touches the most modules; no dep. See Top recommendations. |
| 2 | **`svg-dom` render helper** (`el/line/text/rect`, `makeScales`, `drawGrid`, `drawFtpLine`, one `renderSegmentPolygon`) inside chart.ts | 48 `createElementNS`+`setAttribute` sequences; the x/y scale transform inlined ~12×/~11×; grid+W-label loop copy-pasted 3×; FTP line built 3×; `renderSegmentPolygon`/`renderBuilderSegmentPolygon` ~95% identical. chart.ts only (consumers are thin). | **~300–450** (15–23% of chart.ts) | Low. Zero pixels change, zero bundle bytes. | **internal-helper — RECOMMEND.** Big reduction, no dep. See Top recommendations. |
| 3 | **Charting library (uPlot ~40KB, Chart.js, etc.)** | chart.ts axis/grid/scale | (would *not* remove the bulk) | +40KB+ dep; can't express draggable polygon handles, `<pattern>` freeride hatch, `data-*` hit-testing, log-x power curve. | **DON'T.** The interactivity + freeride patterns *are* the value and map onto no generic chart API. You'd keep most code and add a dep. |
| 4 | **`DeviceChannel` helper** in WebBluetoothTransport.ts | `connectToBike`/`connectToHr` (~40 dup lines), `scheduleBikeAutoReconnect`/`scheduleHrAutoReconnect` (~25 dup), plus parallel `bike*`/`hr*` field pairs, disconnect/status handlers. | **~80–120** | Medium. A per-device controller is mildly "object-model"-ish (which the user is wary of) but here it *reduces* surface. Parse logic genuinely differs per device, so it stays separate. | **internal-helper — RECOMMEND (cautiously).** Biggest single-file dup; no dep. Keep it a thin state-holder, not a framework. |
| 5 | **FIT parser `Cursor`** (`u8/u16/u32/i16/i32/f32/bytes/str`, auto-advance, bounds-aware) | `readValue` switch (815-881), the 6+ repeated `if (cursor+N>limit)` bounds checks and ~10 `getUint8(cursor++)` in `parseDefinition` + main loop. | **~40–60** | Low. Parser is round-trip-tested, NOT byte-locked (only the *writer* is). Centralizing bounds checks is a latent-bug win. | **internal-helper — RECOMMEND.** Touches only the safe (parse) half. Do NOT refactor the byte-locked writer for ~15 lines. |
| 6 | **Third-party FIT parser** (`@garmin/fitsdk`, `fit-file-parser`) | fit.ts parse/build | — | 100KB+, pulls full FIT profile, no support for VeloDrive's custom developer fields (`vd_canon*`) that encode the CanonicalWorkout. | **DON'T.** Bigger + can't do the dev-field layer you'd still hand-write. |
| 7 | **`attr()` + `emit()` build helpers** in zwo.ts | 4 identical `cadenceAttr` builds, double `Math.round(durationSec)`, repeated `lines.push`+`lineBlocks.push`+`cursorSec+=dur` epilogue across 4 element branches (1047-1092). | **~30–40** | Low. Parity-tested pure refactor; removes a double-round bug surface. | **internal-helper — RECOMMEND.** |
| 8 | **XML library** (`fast-xml-parser`, `xmlbuilder2`) replacing zwo regex parser/string builder | zwo.ts | (would delete ~45 escaping lines) | 40–100KB; **breaks the offset-tracked error reporting** (`ZwoError{start,end}` for the editor squiggles) that the regex parser exists to provide. | **DON'T.** The regex parser's "boilerplate" is load-bearing (source-position diagnostics). |
| 9 | **`idb-keyval`-style ~1KB dep** for IndexedDB | WebFileStore promise-wrapping | (~20 only) | Assumes one-value-per-key; this store deliberately holds two record shapes (`{key,value}` settings vs `{key,handle}` FSA handles) in one store. Most of the 859 lines is FSA dir work idb-keyval doesn't touch. | **DON'T.** ~20-line ceiling, wrong shape, violates zero-dep. |
| 10 | **Internal `promisifyRequest<T>(req)`** in WebFileStore.ts | 4 repeated `new Promise(r=>{req.onsuccess;req.onerror})` blocks (187-264). | **~20–25** | Trivial. | **internal-helper — OPTIONAL/marginal.** Already DRY at the method level (4 tidy private wrappers, not scattered inline). Do only if touching the file. |
| 11 | **`core/date-keys.ts`** (extract PlannerView's `formatKey/keyToDate/startOfWeek/addDays/isSameDay`) | `formatKey` is hand-reimplemented twice in App.svelte (56, 158); the helper kit lives only in PlannerView (73-203). | **~6 dup** removed; +~40-line testable file | Trivial. | **internal-helper — RECOMMEND (small but clean).** |
| 12 | **Date library** (date-fns / dayjs / moment) | PlannerView date math | — | ~80 lines of trivial arithmetic; all downside. | **DON'T.** |
| 13 | **Shared `isEditableTarget(t)`** in `ui/keys.ts` | `INPUT\|TEXTAREA\|SELECT\|isContentEditable` check reimplemented 4× (App.svelte 204, PlannerView 777, BuilderView 744, PickerView 841) — and they've already **drifted** (some omit `SELECT`). | **~12** | Trivial. | **internal-helper — RECOMMEND.** Removes drift risk. |
| 14 | **`formatStat()` string helpers** (IF/TSS/kJ) in core/metrics.ts | `Number.isFinite→Math.round→"N kJ"/"TSS N"/"IF x.xx"` repeated in PlannerView (487-496, 662-685) and PickerView (255-263, 1341-1364). | **~15–20** | Low. Shapes differ (planner=arrays, picker=cells) so unify only the string formatting, not a chip component. | **internal-helper — OPTIONAL.** |
| 15 | **Promise-based dialog store** | window.alert/confirm/prompt | — | Already built (`state/dialog.svelte.ts`) and used consistently everywhere. | **Already done — KEEP.** Exemplary; the pattern this review would have recommended already exists. |
| 16 | **Shared reactive-store base class / factory** | `state/*.svelte.ts` (5 stores) | ~0 | Adds indirection over 5 dissimilar shapes (VM wrapper, promise slot, append buffer…). | **DON'T.** Runes usage is already consistent; a factory is ceremony. |
| 17 | **`verticalNavDelta(e)`** (decode j/k/↑/↓ → ±1) | PickerView (774, 877), PlannerView (852) | ~6–8 | Each call site does different things with the delta (clamp vs wrap vs grid-step); only the decode is shared. | **internal-helper — OPTIONAL, low value.** |
| 18 | **`BufferReader` for BLE parsing** | `parseIndoorBikeData`/`parseHrMeasurement` flag-cursor reads | ~8–12 | Conditional `index += N` field skips don't fit a clean reader API. **No overlap with fit.ts** (type-dispatched vs flag-driven — unrelated). | **DON'T (marginal).** Don't unify with fit.ts. |

---

## Top recommendations

### 1. Internal `RawSegment` / segment-timeline helper — the highest-leverage change (no dep)

The positional segment tuple `[minutes, startPct, endPct, type?, cadence?]` is the single most-touched data shape in the app, and **every module that reads it re-derives the same three operations by hand:**

- **Duration:** `Math.max(1, Math.round((seg[0] || 0) * 60))` — verified in **12 locations** across metrics.ts, fit.ts, zwo.ts, engine.ts, chart.ts, hud-format.ts, hud-coaching.ts.
- **Freeride / cadence accessors:** `isFreeRideSegment` and `getRawCadence` are defined **verbatim** in `engine.ts` (175-185), `hud-format.ts` (27-37), `hud-coaching.ts` (30), and a variant in `zwo.ts` (1182). Four independent copies of the same 8-line functions.
- **Walk-to-time + linear interpolation:** `hud-format.ts:getWorkoutTargetAtTime` (44-66) is a near-line-for-line re-implementation of the accumulate-then-interpolate loop inside `engine.ts:getCurrentSegmentAtTime` (198-248). chart.ts and metrics.ts walk the same accumulation independently.

A small `core/segments.ts` (no dep, ~40–50 lines) exporting `segDurationSec(seg)`, `isFreeRide(seg)`, `segCadence(seg)`, `totalDurationSec(segments)`, and `targetAtTime(segments, ftp, t, opts)` would let all 8 modules import one definition. **Estimated reduction ~80–140 lines**, and — more important than the line count — it **collapses 4 copies of the freeride/cadence convention into one**, which is exactly the kind of silently-drifting duplication that causes bugs (the tuple's slot-3-is-either-string-or-number ambiguity is currently re-encoded in every copy).

Why this beats every library candidate: it's *model* knowledge specific to VeloDrive's tuple, so no third-party code applies; it adds zero bytes; and it's the change that touches the most modules. **The one caution:** the tuple's runtime *shape* is byte-locked against the legacy FIT writer and zwo parity tests — the helper must read the existing shape, never restructure it. Done that way, the existing differential tests cover the refactor.

### 2. Internal `svg-dom` helper inside chart.ts — biggest single-file reduction (no dep)

chart.ts is 1,934 lines, of which roughly **750–850 are pure SVG-element assembly** (48 `createElementNS` + `setAttribute` + `appendChild` sequences, the y-transform `y = h - (val/maxY)*h` inlined ~12×, the x-transform inlined ~11×, the grid+label loop copy-pasted 3×, the FTP line built 3×, and two ~95%-identical `renderSegmentPolygon` functions). About 600–700 lines are genuine domain logic (zone mapping, gap-aware interpolation, draggable-handle hit-testing, log-x power curve, freeride `<pattern>` defs) that no library replaces.

A ~40–60-line internal helper block — generic `el(tag, attrs)`, thin `line/text/rect/path` wrappers, a `makeScales({width,height,totalSec,maxY})` returning `xFor`/`yFor` closures, shared `drawGrid()`/`drawFtpLine()`, and a single merged `renderSegmentPolygon(opts)` (builder passes a flag for the extra dataset stamping) — would cut **~300–450 lines (15–23% of the file)** with **zero visual change and zero added bundle bytes**. A charting library (#3) is the wrong tool: it can't express the drag handles, the freeride hatch pattern, or the `data-*` hit-testing protocol the builder relies on, so you'd keep the hard part and add 40KB for the easy part.

### 3. (Runner-up cluster) The cheap, safe, high-clarity helpers

Three tiny extractions remove real, already-drifting duplication for well under 60 lines of new code total:

- **`isEditableTarget()`** (#13) — the `INPUT|TEXTAREA|SELECT|isContentEditable` guard exists in 4 components and has **already drifted** (some omit `SELECT`), which is a latent keyboard-handling bug. One shared function fixes correctness, not just tidiness.
- **`core/date-keys.ts`** (#11) — PlannerView already has a correct, timezone-careful date-helper kit; App.svelte hand-reimplements `formatKey` twice. Extracting gives the helpers a testable home and kills the copies.
- **Delete `DialogStore.resolvePrompt()`** (#3 in table) — dead method, no callers; `resolve()` already subsumes the prompt case.

These are "do them while you're in the file" wins, not architecture.

---

## Over-engineering found

The codebase is, overall, *not* over-engineered — there's no DI container, no factory-of-factories, no deep class hierarchy. The composition root (`app/app.ts`, ~58 lines of explicit `new` + wiring) is exemplary for a lightweight app. The flags below are mild.

1. **Ports interfaces sold as a test seam they don't provide (mild).** `ports/FileStore.ts` and `ports/TrainerTransport.ts` are ports-and-adapters interfaces with **exactly one implementation each** (`WebFileStore`, `WebBluetoothTransport`) and **no test fake implementing them** — the test harness fakes the *browser globals* (`navigator.bluetooth`, `indexedDB`, `showDirectoryPicker`) at the shim layer one level below, yet the interface header comments claim they exist "so the harness fakes drive it." So the stated justification is inaccurate. **However, don't remove them:** they're `import type`-only (zero runtime cost, deleted at build) and they genuinely keep `engine.ts` — the testable heart — free of any `navigator`/`indexedDB` reference (real dependency-inversion value even with one impl). Recommendation: keep the interfaces, fix the comments; do **not** add more ports. Collapsing them would save ~110 interface lines but couple the engine to platform modules — a wash, and against the grain of the clean engine.

2. **Duplicated `bike*`/`hr*` machinery in WebBluetoothTransport (#4).** Two near-identical connect/reconnect/status code paths (~80–120 dup lines). This is duplication, not abstraction-overkill, but it's the largest single-file copy-paste. A thin `DeviceChannel` state-holder fixes it — kept thin so it doesn't become the "object model" the user wants to avoid. (Also two harmless dead-duplicate assignments: `this.bikeConnected = true; this.bikeConnected = true;` at ~451-452 and the `false` pair at ~470-471 — copy-paste artifacts.)

3. **`DialogStore.resolvePrompt()` — dead single-impl method** (dialog.svelte.ts:85-90). No callers; `resolve()` handles the prompt case. Delete (~6 lines).

4. **Three store-construction conventions (cosmetic inconsistency).** Four stores are exported classes instantiated at the root (`new UiStore()`); `ThemeStore` is a private class + exported singleton + two free wrapper functions; mutation is sometimes arrow-fn fields (to pass as callbacks) and sometimes plain methods. Each variant has a real reason (Theme needs a module-global lazy-installing accessor for charts; arrow fields are passed as event callbacks). **Not worth unifying** — a shared base/factory (#16) would be ceremony over 5 dissimilar shapes. At most, document the convention.

5. **`FREERIDE_POWER_REL` defined twice** in chart.ts (line 14 and `FREERIDE_POWER_REL_BUILDER` at 922) with the same value `0.5`; the builder copy is dead-equivalent.

6. **`BaseTypeRef = string | BaseType` union + `normalizeBaseType`** in zwo.ts — supports passing base types as either string keys or resolved objects, forcing a `normalizeBaseType` call at ~6 use sites. Picking one form deletes the helper and union (~6 lines). Minor.

7. **Five overlapping intermediate segment shapes** in zwo.ts (`SnippetBlock`/`WorkingSegment`/`ParsedBlock`/`BlockResult`/`BlockEntry`); `BlockResult` vs `ParsedBlock` overlap heavily. Internal and typed — not worth churning, but noted as more types than the pipeline strictly needs.

### Deliberate complexity that looks like over-engineering but should be LEFT ALONE

- **Two theme counters** (`version` + `autoVersion`) — a faithful port; manual toggle redraws HUD/planner but not picker/builder. Collapsing changes visual behavior.
- **zwo.ts regex parser** (vs DOMParser) — exists to report character-offset error ranges for the editor; a DOM/lib parser throws those away.
- **fit.ts byte-locked writer** — differential byte-equality tested; do not "tidy" it.
- **`canonicalEquals` deep-compare** in PickerView (430-468) — verbose but handles number/string coercion that `JSON.stringify` would get wrong.
- **`StatusOverlay.svelte`** imperatively driven by the Beeper by id — a faithful re-host, intentionally un-idiomatic.

---

## Bottom line

- **Add zero dependencies.** Every library candidate (charting, FIT, XML, IndexedDB, dates) loses to either an internal helper or the status quo. The zero-dep stance is well-earned, not accidental.
- **The real wins are internal helpers**, in priority order: (1) the `RawSegment`/segment-timeline helper (~80–140 lines, 8 modules — the only truly cross-cutting one), (2) the chart `svg-dom` helper (~300–450 lines, one file), then the cheap cluster (`isEditableTarget`, `date-keys.ts`, FIT `Cursor`, zwo `attr/emit`, `DeviceChannel`).
- **Over-engineering is minimal.** The ports are slightly more abstraction than a single-impl app needs but cost nothing at runtime and keep the engine clean; the only thing to actually delete is `resolvePrompt()` and a couple of dead duplicate assignments. The promise-dialog + modal-chrome layers are already the textbook lightweight solution.
