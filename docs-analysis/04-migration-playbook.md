# VeloDrive — Step-by-Step Migration Playbook (with Parity Harnesses)

> Goal: migrate to **TypeScript + Vite + Svelte 5** (Lit substitutes identically — swap the view
> layer, everything else is the same) in a **new directory**, proving **behavioral parity with the
> current `docs/` app at every step**. The migration is gated by automated parity tests, not by
> eyeballing. See doc 03 for *why* this stack; this doc is *how* to do it safely.

---

## 0. The parity philosophy (read this first)

The whole plan rests on one idea: **the legacy code is the oracle.** It is plain ES modules with a
DOM-free core, so we can import legacy modules straight into a test runner and assert that the new
implementation produces the *same outputs for the same inputs*. This is classic **characterization /
differential testing** (Feathers): pin existing behavior with tests *before* refactoring, then the
tests fail the instant new code diverges.

Three rules:

1. **Parity is defined at module boundaries, not internals.** We *want* to change internals (unify
   the 3 workout representations, kill the `≤5 means relative` heuristic). So we assert equality of
   *observable outputs* — `CanonicalWorkout` objects, FIT bytes, metric numbers, the engine's VM
   stream, the files written to disk — never internal data shapes.
2. **Intentional divergences are explicit.** Some legacy behavior is a bug we're fixing (the `≤5`
   heuristic, the `workout-metrics.js:375` crash, unsanitized `innerHTML`). Each goes in an
   `INTENTIONAL_DIFFS` allowlist with a test that asserts the *new* behavior and a note. Everything
   not on that list must match legacy byte-for-byte / value-for-value.
3. **Determinism is mandatory.** Differential tests only work if both sides are fed identical,
   frozen inputs: injected clock, fake timers, scripted BLE samples, seeded library, fixed theme,
   fixed viewport. Any real `Date.now()` / `Math.random()` / live BLE / real time makes parity
   unprovable — so the first refactor of any module is to make its non-determinism injectable.

---

## 1. Workspace & directory layout

Create a new workspace at the repo root. **The legacy app is copied in and frozen** — never edited,
used only as the test oracle and (optionally) the deployed app until cutover.

```
velo-drive/
├── docs/                     ← CURRENT app — stays the live deploy until cutover (untouched)
├── docs-analysis/            ← these reports
└── web/                      ← NEW workspace (pnpm)
    ├── package.json          ← pnpm workspace root
    ├── vite.config.ts
    ├── tsconfig.json
    ├── legacy/               ← FROZEN verbatim copy of docs/ (the ORACLE). Read-only.
    │   └── *.js              ← imported by parity tests; never modified
    ├── src/                  ← the new app
    │   ├── core/             ← framework-agnostic TS (engine, metrics, zwo, fit, ble parsers)
    │   ├── ports/            ← FileStore + TrainerTransport interfaces + web/tauri/mock impls
    │   ├── lib/              ← Svelte components (views)
    │   ├── stores/           ← reactive state (engine VM, library, planner)
    │   └── main.ts
    ├── tests/
    │   ├── corpus/           ← frozen inputs: the 41 .zwo, sample .fit, scraped JSON fixtures
    │   ├── parity/           ← differential tests (legacy vs src) — THE GATE
    │   ├── unit/             ← new-only unit tests + INTENTIONAL_DIFFS assertions
    │   ├── scenarios/        ← engine timeline scripts + golden VM traces
    │   └── e2e/              ← Playwright journeys + visual snapshots
    └── PARITY.md             ← the parity matrix (module → status), updated every PR
```

Keep `legacy/` in sync with `docs/` via a one-line copy script (`scripts/sync-legacy.sh`) so that
if you ship fixes to the live app mid-migration, the oracle stays current. Re-run the parity suite
after every sync.

> **Why a copy, not git-history diffing:** you want both implementations *loadable in the same
> test process at the same time* so a test can call `legacy.parse(x)` and `src.parse(x)` and
> `expect(a).toEqual(b)`. A frozen sibling directory is the simplest way to get that.

---

## 2. Tooling

| Concern | Tool | Notes |
|---|---|---|
| Package/workspace | **pnpm** | fast, workspace-native; one `pnpm install` |
| Build / dev server / HMR | **Vite** | the toolchain Tauri expects; outputs to `dist/` |
| View framework | **Svelte 5** (runes) | (or Lit) — only the view layer; core stays plain TS |
| Language | **TypeScript** (strict) | the single biggest safety win |
| Unit / integration / differential | **Vitest** | can `import` legacy ESM directly as the oracle; fake timers built in |
| DOM environment for component tests | **happy-dom** (or jsdom) | for view/component parity without a browser |
| E2E + visual + interaction parity | **Playwright** | screenshot diffs (pixelmatch), ARIA/DOM snapshots, journey scripts |
| Property-based codec testing | **fast-check** | generate random workouts → assert ZWO/FIT round-trip fixpoints |
| Type-checking Svelte | **svelte-check** | CI gate |
| Lint / format | **ESLint + Prettier** | + `eslint-plugin-svelte` |
| Coverage | **@vitest/coverage-v8** | track core coverage; aim high on `core/` and `ports/` |
| CI | **GitHub Actions** | run unit + parity + e2e on every PR; parity suite is a required check |
| Tauri (Phase 6 only) | **@tauri-apps/cli**, **plugin-fs**, Rust **btleplug** | native FS + BLE bridge, added last |

---

## 3. The five parity harnesses

These are the safety net. Each migration step is "make harness X green," not "I think it works."

### Harness 1 — Pure-codec & metrics differential *(strongest; do first)*
The leaf modules (`zwo`, `fit-file`, `workout-metrics`) are pure → ideal for differential testing.

- **Corpus:** all 41 bundled `.zwo`, a set of `.fit` files generated from recorded/sample rides,
  and saved scraper-output JSON fixtures.
- **ZWO parse parity:** `legacy.parseZwoXmlToCanonicalWorkout(xml)` deep-equals
  `src.parseZwo(xml)` (modulo INTENTIONAL_DIFFS for the `≤5` fix) for every corpus file.
- **ZWO serialize parity:** for each canonical, assert `src.toZwo(c)` byte-equals `legacy` output;
  and a **fixpoint** test: `parse → serialize → parse` yields an identical canonical.
- **FIT parity:** `buildFitFile` takes `startedAt/endedAt` as inputs (no internal clock) → feed
  fixed timestamps and assert **byte-for-byte** equality of legacy vs new output; `parseFitFile`
  deep-equals on the corpus; round-trip `build → parse` reproduces inputs (incl. the embedded
  canonical JSON).
- **Metrics parity:** `computeMetricsFromSegments` / `FromSamples` numbers match legacy exactly (or
  within a tiny epsilon) across the corpus.
- **Property-based (fast-check):** generate random valid workouts, assert `parse(serialize(w))` is a
  fixpoint and metrics are invariant under representation changes.

```ts
// tests/parity/zwo.parity.test.ts  (sketch)
import * as legacy from '../../legacy/zwo.js';
import * as next   from '../../src/core/zwo';
import { CORPUS }  from '../corpus';
import { INTENTIONAL_DIFFS } from './intentional-diffs';

for (const f of CORPUS.zwo) {
  test(`ZWO parse parity: ${f.name}`, () => {
    const a = legacy.parseZwoXmlToCanonicalWorkout(f.xml);
    const b = next.parseZwo(f.xml);
    expect(normalize(b)).toEqual(applyAllowedDiffs(normalize(a), f, INTENTIONAL_DIFFS));
  });
}
```

> Locking Harness 1 *before* unifying the data model is what makes the model unification safe: the
> internal shape changes freely while the boundary outputs stay pinned.

### Harness 2 — Engine simulation / replay *(behavioral core)*
The engine is DOM-free, callback-driven, clock+BLE-driven → make it deterministic and record its
output stream.

- **Make injectable:** pass in `now()`, the tick scheduler (use Vitest fake timers), the BLE
  transport (a `MockTransport` that emits scripted `bikeSample`/`hrSample`), and mock
  `Beeper`/`FileStore` as spies.
- **A scenario** is a timeline script: `[{t:0, call:'start'}, {t:1, sample:{power:0}}, …]`.
- **Record** the full `onStateChanged(vm)` sequence + the ordered `setTrainerState(...)` calls +
  `Beeper` calls + files written. Run **legacy engine and new engine on the same scenario**, diff
  the recordings (golden trace).
- **Scenarios to cover (these ARE the journeys):** fresh start + 3-2-1; follow intervals & ERG
  target each tick; interval beeps at 9 s/3 s and the big-step alarm; auto-start by pedaling;
  auto-pause after zero power; auto-resume at ≥90 % target; manual pause/resume + the 10 s
  auto-resume block; FTP change mid-ride rescales targets; free-ride erg vs resistance; reach end →
  FIT written; crash recovery (load active state → resumes **paused**).

```ts
// tests/scenarios/runEngine.ts  (sketch)
export function runEngine(engineFactory, scenario) {
  vi.useFakeTimers();
  const trace = [];
  const ble = new MockTransport();
  const eng = engineFactory({ now: () => vi.getMockedSystemTime(),
                              transport: ble, beeper: spyBeeper, store: memStore,
                              onStateChanged: vm => trace.push(snapshot(vm)) });
  for (const step of scenario) { vi.setSystemTime(step.t*1000); applyStep(eng, ble, step);
                                 vi.advanceTimersByTime(1000); }
  return { trace, trainerCalls: ble.writes, beeps: spyBeeper.calls, files: memStore.written };
}
// parity test: expect(runEngine(next, S)).toEqual(runEngine(legacy, S))
```

### Harness 3 — Port (adapter) conformance + mocks
Define `FileStore` and `TrainerTransport` interfaces; write **one conformance suite** each, run it
against every implementation.

- `FileStore`: run the suite against `MemoryFileStore` (tests), `WebFileStore` (happy-dom + a fake
  directory handle / OPFS), later `TauriFileStore`. Asserts list/read/write/delete/clone/trash and
  schedule.json round-trips behave identically.
- `TrainerTransport`: `MockTransport` feeds raw FTMS/HR notification bytes from fixtures; assert the
  decoded `bikeSample`/`hrSample` match Harness-1 byte-parser outputs. This proves the parser port
  and lets every engine/UI test run with no real Bluetooth.

### Harness 4 — UI parity (visual + interaction) *(per view, Playwright)*
Serve legacy `docs/` and the new app side by side under **identical seeded state** (same fixture
library folder, mocked BLE, frozen clock, fixed theme + viewport).

- **DOM/ARIA snapshot parity:** assert structural/text parity of each rendered view.
- **Visual diff:** pixelmatch screenshots at a fixed viewport; allow a tiny threshold; review diffs.
- **Interaction scripts ≙ journeys:** open picker → type a search → expand a row → Select, and
  assert the **resulting persisted artifact** matches (see Harness 5). Build a workout via keyboard
  and assert the saved `.zwo` equals what legacy produces from the same keystrokes. Navigate the
  calendar, open a ride detail, etc.
- Keep a **manual parity checklist** for what can't be automated cheaply (real trainer ERG feel,
  audio cues, OS Bluetooth chooser).

### Harness 5 — Persisted-artifact diff *(the folder is the source of truth)*
Because the real database is files, the most robust end-to-end parity check is: run a journey in
legacy, snapshot the resulting `workouts/`, `history/`, `schedule.json`, and IndexedDB keys; run the
same journey in new; **diff the artifacts.** Especially powerful for save/clone/delete/rename and
FIT-on-finish. Normalize timestamps/filenames where they're intentionally time-based.

---

## 4. Step-by-step sequence (each step names its gate)

Order = dependency order + easiest-to-hardest. Ship nothing user-facing until Phase 4's views exist,
but every PR keeps the parity suite green.

| Phase | Work | Gating harness | Definition of done |
|---|---|---|---|
| **0. Scaffold** | pnpm workspace; Vite+Svelte+TS; Vitest+Playwright; copy `docs/`→`legacy/` (frozen) + sync script; CI runs all suites; create `PARITY.md` matrix | CI green (empty) | `pnpm test`/`pnpm e2e` run; legacy imports load in Vitest |
| **1. Corpus + codecs + metrics** | Build the corpus; write Harness 1; port `zwo`/`fit-file`/`workout-metrics` to `src/core` as TS; **unify the 3 representations into one typed model with edge codecs**; record INTENTIONAL_DIFFS (the `≤5` fix, the `:375` bug, overloaded-tuple removal) | **Harness 1** + fast-check | All corpus parse/serialize/metrics parity green except allowlisted diffs |
| **2. Engine** | Make clock/timer/transport/beeper/store injectable; port engine to TS behind the same VM contract | **Harness 2** | All scenario golden traces match legacy |
| **3. Ports** | Extract `FileStore` + `TrainerTransport` interfaces; move all FS/IndexedDB code out of the picker into `WebFileStore`; wrap BLE parsers; add Memory/Mock impls | **Harness 3** | Conformance suites green for web + mock impls; engine tests run on MockTransport |
| **4. Views (one overlay at a time)** | Reactive store for the VM; replace 45 `alert/confirm` with an in-app modal/toast; migrate **settings → welcome → riding HUD → picker → planner → builder** to Svelte; split the giants (picker→Library/Picker/BuilderHost; chart→one renderer each; planner→isolate the virtualized calendar); untangle the shared picker/planner overlay | **Harness 4 + 5** per view | Each view's DOM/visual/journey/artifact parity green before moving on |
| **5. Shell + hardening** | Assemble the app shell + Escape/modal-stack as a real overlay manager; derive `elapsedSec` from wall-clock-minus-paused (fix tick drift — an INTENTIONAL_DIFF); replace manual `PRECACHE_URLS` with vite-plugin-pwa | full **e2e journeys** | All 7 journeys pass end-to-end; offline works |
| **6. Cutover** | Deploy new app behind a beta URL; run both in parallel; when `PARITY.md` is all-green + manual checklist signed off, point `velodrive.bike` at `dist/`; keep `docs/` as instant rollback | smoke + manual | Production on new app; rollback path verified |
| **7. Tauri** *(separate effort)* | Add Tauri; implement `TauriFileStore` (plugin-fs) + `TauriBleTransport` (Rust btleplug) + native scan/pick UI; bundle default workouts as resources; drop the extension transport, keep `scrapers.js` pure core for URL import | Harness 3 against Tauri impls; native smoke | Native build connects a real trainer + rides a workout |

---

## 5. The parity matrix (`PARITY.md`)

A living table, updated every PR — the single source of truth for "are we there yet."

| Legacy module | New module | Harness | Status | Intentional diffs |
|---|---|---|---|---|
| `zwo.js` | `core/zwo.ts` | H1 | ✅ / 🚧 / ⬜ | `≤5` heuristic removed |
| `fit-file.js` | `core/fit.ts` | H1 | … | — |
| `workout-metrics.js` | `core/metrics.ts` | H1 | … | `:375` crash fixed |
| `workout-engine.js` | `core/engine.ts` | H2 | … | elapsed from wall-clock |
| `ble-manager.js` | `ports/transport/*` | H3 | … | device-id format (Tauri) |
| `storage.js` + picker FS | `ports/filestore/*` | H3/H5 | … | FS centralized |
| `workout-picker.js` | `lib/Picker/*` | H4/H5 | … | innerHTML sanitized |
| `workout-planner.js` | `lib/Planner/*` | H4/H5 | … | — |
| `workout-builder.js` + backend | `lib/Builder/*` | H4/H5 | … | — |
| `workout-chart.js` | `lib/charts/*` | H4 | … | — |
| `settings.js` / `welcome.js` | `lib/Settings`,`Welcome` | H4 | … | — |

---

## 6. Determinism checklist (so parity is provable)

Before a module can be differential-tested, neutralize its non-determinism:

- **Clock:** inject `now()`; never call `Date.now()`/`new Date()` directly in `core/`.
- **Timers:** Vitest fake timers for the engine tick loop.
- **Randomness:** none today; keep it that way in `core/` (vary test data by index).
- **BLE:** always `MockTransport` in tests; real transport only behind the interface.
- **Filesystem:** `MemoryFileStore` in unit tests; seeded fixture folder in e2e.
- **Theme/viewport:** pin both for visual diffs; freeze CSS-var reads.
- **FIT timestamps/filenames:** inject; normalize in artifact diffs.
- **IndexedDB in tests:** use fake-indexeddb (or happy-dom's) with a fresh DB per test.

---

## 7. Gotchas specific to this codebase

- **FIT byte-parity is achievable** because `buildFitFile` takes start/end times as args — pass
  fixed values and you get deterministic bytes. Don't let any internal clock creep in.
- **The `≤5 means relative` heuristic and the overloaded `seg[3]` tuple** are *intentional*
  divergences — assert the new typed behavior, allowlist the legacy quirk, and add targeted tests
  for the previously-ambiguous cases (e.g. a genuine 3 % FTP segment).
- **Shared picker/planner overlay** must be split into two independent components — write the DOM
  parity test against each view's isolated markup, not the shared node.
- **The builder drag system is coupled to the chart's exact SVG `data-*` attributes** — migrate the
  builder and its chart renderer together, and keep those attributes in the parity DOM snapshot.
- **The calendar is a custom virtualized infinite scroll** — its scroll/recycle math is the
  hardest UI to snapshot; test the *data* it renders (which day shows which cards) separately from
  pixel parity, and keep an abstraction seam around the virtualization.
- **`workout-metrics.js:375` is a latent crash** — fix it in new code, add a regression test, log it
  as an intentional diff (don't try to "match" a crash).

---

## 8. Bottom line

- **One frozen `legacy/` copy = the oracle.** Every step is gated by a differential harness that
  compares new vs legacy on a fixed corpus — parity is *proven*, not assumed.
- **Five harnesses, easiest-first:** (1) pure-codec/metrics differential, (2) deterministic engine
  replay, (3) port conformance + mocks, (4) Playwright DOM/visual/journey parity, (5) persisted-file
  diff. Lock 1–3 (the DOM-free core) before touching any view.
- **Migrate behind the gates, view-by-view; cut over only when `PARITY.md` is green** and keep
  `docs/` as one-flip rollback. Tauri is a clean Phase-7 add-on because the FS and BLE seams were
  extracted in Phase 3.
