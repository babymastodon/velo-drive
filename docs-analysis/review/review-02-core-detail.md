# Review 02 — Core Modules Detail (read-only code-quality)

Scope: `web/src/core/*.ts` (engine, builder-backend, chart, zwo, fit, metrics, beeper,
scrapers, planner-analysis, model) + `web/src/ports/web/*` (WebFileStore,
WebBluetoothTransport). Goal: confirm the rewrite is **simple, readable,
well-encapsulated** — the opposite of the legacy spaghetti.

**No code was changed.** This is an audit. `engine.ts` behavior is pinned by tests;
the codecs (`zwo`/`fit`/`model`/`metrics`) are correctness-critical — any fix must
preserve behavior (parity/differential tests exist).

---

## Headline verdict

The rewrite is **genuinely clean and lightweight**, not spaghetti. Functions are
mostly small and single-purpose, state is encapsulated (engine = class with injected
deps; builder = closure module; ports = focused adapters), naming is good, and the
files that are *long* are long for legitimate reasons:

- `fit.ts` (binary FIT codec) and `zwo.ts` (regex XML parser + emitter) are
  **essentially verbose** — the message/field tables and the position-tracking parser
  are inherent to the format, not accidental complexity. Both are well-organized.
- `chart.ts` is a long **SVG renderer** — also inherently verbose; the geometry is
  preserved verbatim for visual parity. Its accidental complexity is limited (see C1).
- `metrics.ts`, `planner-analysis.ts`, `scrapers.ts`, `beeper.ts`, `model.ts` are
  **clean and cohesive**; only minor nits.

The real, recurring smell is **cross-file duplication of a tiny set of segment
helpers and constants** (the same `isFreeRideSegment` / `getRawCadence` /
`FREERIDE_POWER_REL` / zone thresholds copy-pasted into 3–5 files). The two largest
files each have one genuinely tangled region (engine: none critical; builder:
selection state machine + `segmentsToBlocks`). The two ports are clean but each carry
one structural duplication (BT bike/HR twins; FileStore trash/dir-handle helpers).

Severity legend: **High** = maintainability hazard / latent bug magnet · **Med** =
worth fixing in the area · **Low** = polish. "No-brainer" = low-risk mechanical
simplification that cuts noise with near-zero behavioral risk.

---

## Cross-cutting findings (span multiple files)

| # | Finding | Location (file:line) | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------------------|--------------|----------|----------------|
| X1 | **`isFreeRideSegment` duplicated 3×** — identical body `Array.isArray(seg) && seg[3] === 'freeride'` | `fit.ts:77`, `engine.ts:175`, `chart.ts:78` (plus inline `seg[3] === 'freeride'` in `metrics.ts`, `builder-backend.ts:826`, `fit.ts:1253`) | One predicate, the canonical "is this a free-ride tuple?" rule, lives in 3 copies + several inlinings. A change to the tuple shape (`model.ts`) needs N edits. | Med | Move `isFreeRideSegment(seg)` into `model.ts` (it already owns `RawSegment`) and import. No-brainer; zero behavior change. |
| X2 | **`getRawCadence` duplicated 4×** — same `seg[4]`/`seg[3]` fallback logic | `zwo.ts:1182`, `engine.ts:179`, `chart.ts:82`, `builder-backend.ts:972` | Identical cadence-extraction copied into 4 files; the positional `seg[3]/seg[4]` magic is exactly the kind of rule you want defined once. | Med | Co-locate with `RawSegment` in `model.ts` and import. No-brainer. |
| X3 | **`FREERIDE_POWER_REL = 0.5` redeclared 3×** | `zwo.ts:20`, `builder-backend.ts:21`, `chart.ts:14` | Same constant, 3 definitions. | Low | Export once (from `model.ts` or `metrics.ts`). No-brainer. |
| X4 | **`FREERIDE_SEGMENT_FLAG = 'freeride'` vs bare `'freeride'` literal** | `metrics.ts:15`, `zwo.ts:19` named; raw string literal in `engine.ts:176/181`, `fit.ts:78/1253`, `chart.ts:79/84`, `builder-backend.ts` | Mixed: two files name the flag, the rest hardcode the string. Inconsistent and search-fragile. | Low | Export one `FREERIDE_FLAG` const and use it everywhere (folds into X1). No-brainer. |
| X5 | **Power-zone thresholds (`60/76/90/105/119`) duplicated** | `metrics.ts:352-356` (`inferZoneFromSegments`) and `chart.ts:113-117` (`zoneInfoFromRel`) | The zone boundary table is the canonical training-zone definition, copy-pasted with the same numbers in two modules. If zones are re-tuned they can silently diverge (metrics says "Tempo", chart colors it "Threshold"). | Med | Extract a shared `zoneKeyFromPct(pct)` (or a `ZONE_BOUNDS` table) in `metrics.ts`; `chart.ts` imports it and maps key→CSS var. Low risk; preserves behavior. |

These five are the single biggest "lightweight & clean" win available: a small shared
"segment helpers" surface in `model.ts`/`metrics.ts` removes ~15 scattered copies and
inlinings with no behavioral change.

---

## engine.ts (948 lines) — class `WorkoutEngine`

Overall **clean and well-encapsulated.** Deps are injected for the virtual-clock test
harness; the many `// P1..P8 / A1..A4` comments document *intentional* pinned behavior
(auto-pause/resume edge cases, restore semantics) and are valuable, not cruft. The
`// TODO(P6 …)` block at `tick()` (450-460) is a legitimate documented known-limitation,
not dead code. Do not "tidy" these away.

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| E1 | **`currentRideTime` expression repeated 4×** — `this.workoutRunning \|\| this.elapsedSec > 0 ? this.elapsedSec : 0` | `engine.ts:253, 259, 264, 752` | The same "ride time to sample at" rule is inlined in `isResistanceFreeRideActive`, `getCurrentTargetPower`, `desiredTrainerState`, `getViewModel`. Easy to edit one and forget the others. | Low | Extract `private currentRideTimeSec(): number`. No-brainer; pure readability, no behavior change. |
| E2 | **`tick()` is long & multi-purpose (~86 lines, 448-534)** | `engine.ts:448-534` | One method advances time, runs the zero-power auto-pause sub-block (475-486, wrapped in a bare `{ }` scope), sends trainer state, pushes a sample, checks end, beeps, then runs the separate auto-resume block (510-531). The bare-block scoping is a smell that says "this wants to be a method." | Med | Extract `handleAutoPause()` and `handleAutoResume()` (already isolated by the `{}` block and the `if (paused)` block). Behavior-pinned by tests, so extract-method only — verify against the engine test suite. Good clarity win. |
| E3 | **Throttled-send `.catch` boilerplate repeated 5×** | `engine.ts:862, 874-876, 886, 896, 906` | `setMode`/`setFreeRideMode`/`setFtp`/`adjustManualErg`/`adjustManualResistance` each repeat `if (!this.workoutPaused) this.sendTrainerState(true).catch(...)`, two of them swallowing silently (`.catch(() => {})`). | Low | Extract `private trySendTrainerState(label?: string)` that guards on `workoutPaused` and logs. Cuts the repetition and unifies error handling. Low risk. |
| E4 | **`restoreActiveState` casts every field through `Record<string, unknown>`** | `engine.ts:824-856` | ~20 `a.x as number` / `as LiveSample[]` casts because `ActiveState` is read as untyped. Acceptable (it's a persistence boundary), but it's the densest cast cluster in the file. | Low | Optional: a typed parse/validate of `ActiveState` at the boundary. Higher effort; only if persistence schema gets stricter. Leave for now. |

No dead code, no stale comments, no spaghetti control flow of concern. The `mode`
field is effectively always `'workout'` (set on every path) — a latent simplification,
but it's part of the persisted `ActiveState` shape, so leave it.

---

## metrics.ts (445 lines) — correctness-critical, clean

Pure functions, good names, the one intentional legacy-bug fix
(`getAdjustedKjForPicker`, 431-445) is clearly documented and test-covered.

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| M1 | **30s normalized-power rolling-window block duplicated verbatim** | `metrics.ts:100-119` (`computeMetricsFromSegments`) and `metrics.ts:222-241` (`computeMetricsFromSamples`) | The entire `window=30` / `sumPow4` / `samplesForNp` rolling-4th-power computation is byte-for-byte identical in both functions. A correctness fix to the NP math must be made twice — exactly the trap that bites a metrics module. | Med | Extract `function normalizedPowerFrom(perSec): number` (returns the 4th-root). Both callers use it; one returns relative IF, the other divides by FTP. Correctness-critical → keep behavior identical and lean on the differential tests. High value. |
| M2 | **`as unknown as number[][]` cast to index tuples** | `metrics.ts:65`, `metrics.ts:324` | Force-casts `RawSegment[]` to `number[][]` to read `seg[3]` etc. Same root cause as X2 (tuple type doesn't model the optional cadence/flag slots cleanly). | Low | Folds into a shared typed accessor (X1/X2). Low priority. |

`inferZoneFromSegments` (305-403) is long-ish but it's a genuine decision tree
(zone-time accumulation → classification); the branches are readable and each maps to a
real rule. Fine as-is aside from X5.

---

## zwo.ts (1303 lines) — codec, essential verbosity

The inline regex parser with position-preserving wrapper-blanking (so error offsets map
to the source) is **inherently** the bulk of the file and is well-factored into small
`handleZwo*` block handlers + `getAttr*` helpers. The text-event relative/absolute
classification (`evaluateTextEventOffset`/`applyTextEventOffset`, 653-710) is the one
intricate part, but it's commented and isolated. **Not penalized for length.**

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| Z1 | **`segmentsToZwoSnippet` emit branches duplicate per-block boilerplate** | `zwo.ts:1047-1092` | The `steady`/`freeride`/`rampUp`/`rampDown` arms each recompute `dur = Math.round(b.durationSec)`, build a near-identical `cadenceAttr`, push a line, then push `lineBlocks` + advance `cursorSec` — ~4 copies of the same 4-line tail. Also `Math.round(b.durationSec)` is computed twice per arm (once into `dur`, once inline in the template). | Low-Med | Extract `pushLine(line, durSec)` to own the `lineBlocks`/`cursorSec` bookkeeping, and a `cadenceAttr(b)` helper. Parity-tested → mechanical, low risk, readable win. |
| Z2 | **`evaluateTextEventOffset` has a redundant inner recomputation** | `zwo.ts:675-684` | Inside the `relativeFits && absoluteFits` branch it recomputes `absoluteWithin`/`relativeWithin` that are logically equal to the already-computed `absoluteFits`/`relativeFits` (same bounds). Dead-ish defensive logic that obscures intent. | Low | Simplify to use the outer booleans. Behavior-sensitive (text-event placement) → verify with zwo parity tests before touching. Not a no-brainer. |
| Z3 | **`toRel` `(v <= 5 ? v : v/100)` heuristic appears in two files** | `zwo.ts:938` and `builder-backend.ts:845` | The "values ≤5 are already relative FTP" rule is duplicated across the two ZWO-adjacent modules. | Low | Could share, but they sit in different pipelines (emit vs. block-parse); low priority. Note it so they stay in sync. |

The `escapeXml`/`unescapeXml`/`cdataWrap`/`cdataUnwrap` helpers (94-137) are tidy and
correct. ZWO XML emission is properly centralized here (not re-implemented in builder).

---

## fit.ts (1305 lines) — binary codec, essential verbosity

A FIT reader/writer is inherently a long table of message/field definitions plus
byte-level encode/decode. This file is **well-structured**: `BASE_TYPES` table,
`createDefinition`/`createDataMessage`/`encodeValue`/`readValue` primitives, then the
message layout in `buildFitFile`. The verbosity is essential, not accidental.

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| F1 | **Dead computed value: `maxHr` then `void maxHr`** | `fit.ts:395-398` | `const maxHr = max(hrVals); … void maxHr;` — computed and explicitly discarded (max HR isn't written to the session/lap). Leftover from the port; the `void` is a tell. | Low | Delete the `maxHr` line and the `void`. No-brainer (confirm no field expects it — it isn't referenced). |
| F2 | **`buildFitFile` is very long (~480 lines, 330-813)** | `fit.ts:330-813` | One function does input normalization, dev-field prep, ~10 message-definition creations, then ~10 message-emission blocks, then header/CRC. It's *sequential and readable*, but it's a lot in one scope. | Low (essential-ish) | Optional: group the definition table and the emit phase into helpers (`defineMessages()`, `emitWorkoutSteps()`, `emitRecords()`). Byte-equality differential test exists → safe but churny. Acceptable to leave; flag only. |
| F3 | **`session` (754-773) and `lap` (776-792) emission near-duplicate** | `fit.ts:754-792` | The lap message repeats the same field set as session (avg/max cadence, power, total_work, threshold_power, timestamps) minus a few fields. | Low | Minor shared value object for the common fields. Low value vs. churn; the differential test makes it safe but it's barely worth it. |

The parser (`parseFitFile`, 980-1305) is dense but appropriate; the canonical-JSON
chunk reassembly + workout-step fallback is the kind of inherent complexity a FIT
re-hydrator carries. No dead code, no spaghetti.

---

## chart.ts (1935 lines) — SVG renderer, mostly essential verbosity

Long because it builds SVG element-by-element with geometry preserved verbatim for
visual parity. The hover engine (`attachSegmentHover`, 289-532) and the builder graph
(`renderBuilderWorkoutGraph`, 1174-1628) are the dense parts, but each is a cohesive
renderer. **Not penalized for length.**

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| C1 | **`renderSegmentPolygon` (200-267) and `renderBuilderSegmentPolygon` (943-1025) are ~95% identical** | `chart.ts:200` and `chart.ts:943` | Two segment-polygon renderers with the same geometry, color mixing, freeride-pattern handling, and dataset stamping; the builder version differs only in returning the element and stamping `data-color` for freeride. ~80 duplicated lines. | Med | Have the builder path call `renderSegmentPolygon` and then stamp the extra datasets, or add an `opts` param. Geometry is parity-pinned → keep output identical and diff the SVG in the visual test. Solid de-dup. |
| C2 | **Dead constant: `FREERIDE_POWER_REL_BUILDER` declared, never used** | `chart.ts:922` | `const FREERIDE_POWER_REL_BUILDER = 0.5;` is never referenced; the builder section uses the top-of-file `FREERIDE_POWER_REL` (line 14). Pure dead code. | Low | Delete it. No-brainer. (Also see X3 — the surviving one should be the shared constant.) |
| C3 | **Module-level mutable singletons for hover state** | `chart.ts:18` (`freeridePatternCounter`), `chart.ts:277-278` (`hoverCleanupMap`, `lastHoveredSegment`) | `lastHoveredSegment` is a module-global mutated across renders; with multiple charts on a page the "previous hovered" can leak between them. The `WeakMap` cleanup mitigates listener leaks, but the single `lastHoveredSegment` global is shared across all SVGs. | Low-Med | Scope `lastHoveredSegment` per-SVG (store on the closure / WeakMap) instead of one module global. Behavioral edge case only under multi-chart pages; low risk to fix. |
| C4 | **Inline-segment time-walk loop duplicated across 4 renderers** | `chart.ts:614-638`, `876-900`, `1718-1743` (+ block walk `1341-1436`) | The "accumulate `t += durSec`, compute `pStartRel`/`pEndRel`/freeride/cadence, call render polygon" loop is copy-pasted across `drawWorkoutChart`, `renderMiniWorkoutGraph`, and `drawMiniHistoryChart`. | Low | A shared `forEachSegmentBand(rawSegments, ftp, cb)` generator would unify them; folds in X1/X2. Moderate value, low risk. |

`getScaledMaxY`, `zoneInfoFromRel`, `mixColors`, `parseHexColor` are clean, reusable,
exported helpers. The four `drawXChart` public entry points are appropriately separate
(different chart types).

---

## planner-analysis.ts (190), scrapers.ts (207), beeper.ts (251), model.ts (80)

**Clean. No material findings.**

- `planner-analysis.ts` — the interval-merge loop in `buildPowerSegments` (101-135) has
  a 5-level nested-ternary tolerance ladder (113-122) that's a bit dense, but it's a
  legible lookup table of `durSum → angle tolerance`; acceptable. `buildPowerCurve`
  (150-185) prefix-sum sliding window is correct and tidy. **Nit only.**
- `scrapers.ts` — focused single-source (TrainerDay) scraper with a clear
  `[result, error]` tuple and well-structured error mapping (140-165). The error-mapping
  `if` ladder is long but each arm is a distinct user-facing message. Clean.
- `beeper.ts` — small, cohesive Web Audio wrapper; the countdown state machine
  (`runStartCountdown`, 207-250) is readable. `setEnabled`/`stopAll` lifecycle is tidy.
- `model.ts` — pure types, well-documented positional-tuple rationale. **This is the
  natural home for the shared segment helpers/constants from X1–X4.**

---

## ports/web/WebFileStore.ts (859 lines) — mostly clean

Small single-purpose methods, named storage-key/version constants, sensible
cache/permission/handle separation. Two structural duplications and one data-loss-guard
nit stand out.

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| FS1 | **`moveZwoFileToTrash` / `deleteHistoryToTrash` near-identical** | `WebFileStore.ts:508-541` and `824-858` | Both: load src+trash dirs, ensure permission, read file, split base/ext, build `${base} (${stamp})${ext}` via `toISOString().replace(/[:.]/g,'-')`, write to trash, `removeEntry`. Differ only in payload type (text vs arrayBuffer) + the 120-char cap. A fix to one (e.g. the name cap) won't reach the other. | Med | Extract `private trashFile(srcDir, trashDir, fileName, capLen?)`. Modest refactor, good payoff. |
| FS2 | **Three dir-handle loaders duplicate the root-fallback pattern** | `WebFileStore.ts:397-408` (`loadWorkoutDirHandle`), `412-419` (`loadZwoDirHandle`), `421-428` (`loadTrashDirHandle`) | Same `loadHandle(KEY)` → fallback to `ROOT_DIR_KEY` → `getDirectoryHandle(subdir,{create:true})`; only the key + subdir name differ. | Low-Med | Helper `loadSubdir(key, subdirName)`; workout keeps its memo wrapper. Near no-brainer. |
| FS3 | **Over-broad catch weakens the save data-loss guard** | `WebFileStore.ts:482-484` (`saveWorkout`) | `try { getFileHandle() ; overwriting = true } catch { overwriting = false }` treats *any* error (not just `NotFoundError`) as "file absent → skip the trash backup." A permission/IO blip is misread as "nothing to back up." `copyDefaultWorkoutsToDir` (354-358) does this correctly by checking `err.name !== 'NotFoundError'`. | Med | Narrow the catch to `NotFoundError` (rethrow otherwise), matching the correct sibling. The whole point of the block is data-loss safety. |
| FS4 | **`overwriting` boolean flag dance** | `WebFileStore.ts:478-488` | `let overwriting=false; try{…overwriting=true}catch{overwriting=false}` — the `catch` reassigns an already-false value. | Low | A `private fileExists(dir,name)` helper returns the bool (also dedupes the probe in `copyDefaultWorkoutsToDir`). Folds into FS3. No-brainer. |
| FS5 | **Magic `120` filename cap unnamed** | `WebFileStore.ts:524-526` | Bare `120` for the trash-name length cap; comment cites legacy line but not the value's meaning. | Low | `const MAX_TRASH_NAME_LEN = 120;`. No-brainer. |
| FS6 | **`buildPreview` nested-ternary duration hint** | `WebFileStore.ts:631-661` (esp. 640-645) | A 3-way nested ternary picks `totalTimerSec` / `endedAt-startedAt` / `lastSample.t`, each `Math.max(1, Math.round(...))`. Dense. | Low-Med | Extract `computeDurationHint(meta, lastSample)` with early-returns. Low risk, clear win. |
| FS7 | **`loadHandle` returns `unknown`; 9 call-sites re-cast** | `WebFileStore.ts:253` + casts at 277, 399, 401, 413, 415, 422, 425, 733, 748 | The IDB-stored handle is `unknown` (justified for structured-clone blobs), but every caller repeats `as FsDirHandle`. | Low | `loadDirHandle(key): Promise<FsDirHandle\|null>` does the cast once. Minor. |

No dead code / unused exports found. The `notifyError` try/catch (177-185) and the
per-call `ensureDirPermission` boilerplate are acceptable defensive choices given the
data-safety context. The "mirrors legacy X:NNNN" comments are latent-stale but harmless.

---

## ports/web/WebBluetoothTransport.ts (761 lines) — clean, but "two of everything"

Good constant grouping (FTMS/CP/HR UUIDs + flag bitmasks are properly named & commented
at 17-65 — these are legitimately protocol-magic, **not** a smell), well-commented
quirks, locally-named conditionals, cohesive parsers. The dominant issue is mechanical
bike/HR duplication, which already produced a real divergence bug.

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| BT1 | **Doubled dead assignments** | `WebBluetoothTransport.ts:451-452` (`this.bikeConnected = true;` twice), `471-472` (`this.bikeConnected = false;` twice) | Copy-paste accident — the second assignment is a pure dead statement. The HR twins (599, 618) have a single assignment, confirming these are mistakes. Signals the bike/HR find-replace was sloppy. | Low | Delete lines 452 and 472. **No-brainer.** |
| BT2 | **Pervasive bike/HR twin duplication (~40% of the body)** | pairs: `scheduleBikeAutoReconnect`/`scheduleHrAutoReconnect` (248-273 / 275-300), `cancelBike…`/`cancelHr…` (234-239 / 241-246), `connectBikeViaPicker`/`connectHrViaPicker` (302-343 / 345-381), `onBikeDisconnect`/`onHrDisconnect` (470-498 / 617-640), `updateBikeStatus`/`updateHrStatus` (745-760) | Two near-identical code paths differing only by UUID, status emitter, default name. Every fix must be applied twice — and BT1 shows that already failed once. | Med | Extract a `DeviceChannel` helper (per-device state + `kind` discriminant) parameterized over UUIDs/emitter/name. Biggest single change; needs test coverage. Worth it for how much surface collapses, but **not** a no-brainer. |
| BT3 | **`connectToBike` long & multi-purpose (~84 lines, 385-468)** | `WebBluetoothTransport.ts:385-468` | ~7 responsibilities in one try block: known-device bookkeeping, GATT connect, 2 characteristic lookups, an inline CP-indication logger (398-409), notification subs, the requestControl/start handshake, a stale-device teardown guard (425-433), id persistence, disconnect-handler swap, catch-teardown. | Med | Extract `subscribeBikeCharacteristics(...)` and `attachBikeDisconnectHandler(...)`; hoist the inline CP-indication arrow (398-409) to `logFtmsControlPointIndication(dv)`. Low risk, real readability win. |
| BT4 | **Clamp magic numbers unnamed** | `WebBluetoothTransport.ts:677` (`Math.min(2000,…)` ERG ceiling), `688-689` (`Math.min(100,…)` resistance max + `*10` FTMS scaling) | Unlike the well-documented UUID/flag block, these output clamps are bare. | Low | `MAX_ERG_WATTS = 2000`, `MAX_RESISTANCE_LEVEL = 100`, comment the ×10 0.1-unit scaling. No-brainer. (The `/100.0` speed and `/2.0` cadence divisors at 510/517 are FTMS resolution constants — acceptable inline, a comment would help.) |
| BT5 | **`as unknown as number` on `setTimeout` returns** | `WebBluetoothTransport.ts:272, 299` | Double-cast to paper over Node-vs-DOM timer typing. | Low | Type timer fields as `ReturnType<typeof setTimeout>`. Trivial. |
| BT6 | **No `dispose()`/teardown despite stateful timers + listeners** | class-wide (timers in 248-300, `gattserverdisconnected` listeners) | No public way to cancel reconnect timers / detach handlers / clear `*KnownDevices`. Fine for a single long-lived instance; latent leak if ever re-created. | Low | Add `dispose()` only if lifecycle demands it. Not urgent. |

The FTMS `parseIndoorBikeData` flag-walk (500-539) is the inherent-verbosity kind — each
skip corresponds to a spec'd field width; **leave it.** Not spaghetti.

---

## builder-backend.ts (2095 lines) — largest file; clean helpers, two tangled regions

The closure-module pattern encapsulates state well; the clamp/accessor helpers
(997-1346) and the clipboard codec (145-216) are genuinely clean and well-named. Two
regions concentrate the complexity, plus a real type-system lie.

| # | Finding | Location | Why it hurts | Severity | Fix + tradeoff |
|---|---------|----------|--------------|----------|----------------|
| B1 | **Type lie: `'rampUp'`/`'rampDown'` smuggled through `BlockKind` via cast** | `builder-backend.ts:859, 867` (`kind: 'rampUp' as BlockKind`) then re-discriminated `(b.kind as string) === 'rampUp'` at `946, 955` | `BlockKind` (23-29) is `steady\|warmup\|cooldown\|intervals\|freeride` — `rampUp`/`rampDown` are NOT members. They're internal sentinels forced through the public type, defeating exhaustiveness checking and misleading any reader who trusts `BlockKind`. | Med | Local `type NormalizedKind = 'steady'\|'freeride'\|'rampUp'\|'rampDown'` for the `normalized` array; removes 4+ casts, no runtime change. **No-brainer.** |
| B2 | **`segmentsToBlocks` over-long & deeply nested (~160 lines, 810-970)** | `builder-backend.ts:810-970` | Three jobs in one: normalize/validate tuples (821-874), greedy interval run-length coalescing (883-929, 4-deep with a nested `while` + 4-clause break), map leftovers to blocks (931-966). The `i += repeat*2` / `j += 2` index arithmetic is fragile to edit. | Med | Extract `normalizeRawSegments()`, `coalesceIntervals()`, `normalizedToBlock()`. Parity-tested (`builder-backend.parity.test.ts`) → safe-ish but verify. |
| B3 | **Selection/cursor state machine is flag soup** | `setSelectionFromCursors` (537-577), `shiftMoveSelection` (579-623) | 5 interrelated mutable fields (`selectedBlockIndex`, `selectedBlockIndices`, `selectionAnchorIndex`, `selectionAnchorCursorIndex`, `insertAfterOverrideIndex`) mutated in different combos across ~6 setters. `shiftMoveSelection` has 3 early-return branches each recomputing anchor/cursor math with uncommented `anchor-1`/`anchor+1`/`anchor-2` offsets (605-606). Highest-risk-to-edit region; invariants are implicit, so one setter can desync `selectedBlockIndices` from `selectedBlockIndex`. | High (maintainability) | Document the invariant and funnel all 5-field writes through one `setSelectionState(...)` mutator. Higher effort; do before the next selection feature, not speculatively. |
| B4 | **`getBlockDurationSec` — 3 byte-identical branches + unreachable `return 0`** | `builder-backend.ts:1177-1199` | `steady` (1186), `freeride` (1190), `warmup\|cooldown` (1194) arms are identical (`Math.max(1, Math.round(Number(dur)\|\|0))`); only `intervals` differs. Final `return 0` (1198) is unreachable for valid `BlockKind`. Looks like the cases differ when they don't. | Low | `if (kind==='intervals'){…}` then one fallthrough. **No-brainer.** |
| B5 | **`Number.isFinite(x as number) ? (x as number) : d` idiom ~30×** | `builder-backend.ts:1003, 1097-1103, 1188, 1204, 1216, 1222, 1888, 1896, 1902, +many` | The cast is pure noise (`Number.isFinite` takes `unknown`), and it trains the eye to ignore casts — so the *real* unsafe cast (B1) hides among them. | Low | Helper `finiteOr(v, d)` collapses dozens of sites. **No-brainer.** |
| B6 | **Adjacent-ramp-linking logic duplicated** | `adjustAdjacentRampsForSteady` (1774-1812) vs `syncAdjacentRampLinks` (1910-1942) | Both walk prev/next neighbor, check warmup/cooldown, set `powerHighRel`/`powerLowRel`, rebuild segments — differing only in trigger condition. Two places to sync when ramp rules change. | Low-Med | Extract `forEachRampNeighbor(blocks, idx, fn)` or a `relinkRamp(...)` mutator. Only worthwhile if ramp logic keeps changing. |
| B7 | **`as unknown as unknown[][]` double-cast** | `builder-backend.ts:821` | Loudest "escaping the type system" signal in the file; root cause is `RawSegment` not modeling the optional `[4]` slot. Same family as X2/M2. | Low-Med | Resolve via a shared typed segment accessor (X1/X2); check `model.ts` `RawSegment` first. |
| B8 | **Defensive `Array.isArray(block?.segments)` / `state.x \|\| []` on internally-owned data** | ~10× (751, 769, 784, 1431, 1480, 1493…) + `state.currentBlocks \|\|` (404, 451, 488…) + `state.textEvents \|\| []` (305) | `currentBlocks`/`textEvents` are closure-private, initialized to `[]`, never nulled. The guards imply external mutation that can't happen — noise that understates the real invariants. | Low | Trust initializers for internal state; keep guards only at public boundaries (`segmentsToBlocks` input, `parseClipboard`). Light pass, low risk. |
| B9 | **Minor dead/redundant clamped-null checks** | `buildContextualRampBlock:1848-1852` | After `clampRel` guarantees finite numbers, `low != null`/`high != null` conjuncts are always true. | Low | Drop the redundant checks. No-brainer. |

**No dead exports** — verified `snapPowerRel`, `snapDurationSec`, `clampPowerPercent`,
`buildSegmentTimings`, `getDurationStep`, `adjustAdjacentRampsForSteady`,
`buildContextualRampBlock`, `syncAdjacentRampLinks` are referenced from the view layer
and/or parity tests. The wide returned-object API (2018-2092) is intentional surface.

---

## Prioritized action list

**No-brainers (low-risk, cut spaghetti immediately):**
- X1–X4: hoist `isFreeRideSegment` / `getRawCadence` / `FREERIDE_POWER_REL` /
  `FREERIDE_FLAG` into `model.ts`/`metrics.ts`; delete the 3–5 copies + inlinings.
- C2 (delete dead `FREERIDE_POWER_REL_BUILDER`), F1 (delete `maxHr`/`void maxHr`),
  BT1 (delete doubled assignments), B1 (`NormalizedKind` type), B4 (collapse
  `getBlockDurationSec`), B5 (`finiteOr` helper), E1 (`currentRideTimeSec`),
  FS5 (`MAX_TRASH_NAME_LEN`), BT4 (clamp constants).

**Worth doing in-area (Med):**
- X5 (shared zone-threshold table), M1 (shared NP rolling-window — correctness-critical,
  lean on differential tests), C1 (merge the two segment-polygon renderers),
  FS1 (shared `trashFile`), FS3 (narrow the save data-loss catch),
  E2 (extract `tick()` auto-pause/resume), BT2/BT3 (collapse bike/HR twins; split
  `connectToBike`), B2 (`segmentsToBlocks` phases).

**Higher effort / do before next feature touch (High maintainability):**
- B3 (centralize the builder selection state machine behind one mutator + documented
  invariant).

**Explicitly leave alone (essential, not accidental):**
- engine `P#/A#` comments and the `tick()` ticks-vs-wall-clock TODO; `fit.ts` message
  tables & `buildFitFile` length; `zwo.ts` position-preserving parser; `chart.ts` SVG
  geometry/magic numbers (parity-pinned); FTMS UUID/flag constants and
  `parseIndoorBikeData` flag-walk in the BT transport.
