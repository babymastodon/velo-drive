# VeloDrive — Modernization Options & Recommendation

> Goal (from the brief): move VeloDrive to a **more modern, well-factored, safer** codebase that
> is **simplest going forward**, **not a heavyweight framework**, and **eventually a Tauri native
> app**. This document states the constraints, lays out the options with trade-offs, and gives a
> single recommended path with a phased plan.

---

## 1. What "better" means here (decision criteria)

| Criterion | Why it matters for *this* app |
|---|---|
| **Type safety** | The #1 risk today is the 3-way workout model + overloaded positional tuples + `≤5 means relative` heuristic, decoded in duplicate. Types catch this class of bug at compile time. |
| **Reactive rendering** | 174 manual DOM lookups + a full non-diffed re-render every tick. A small reactive layer deletes most of `workout.js`'s wiring and the giant view files' DOM plumbing. |
| **Lightweight** | The user explicitly rules out heavyweight frameworks. Runtime size matters less than *conceptual* weight and lock-in; the live HUD must stay snappy. |
| **Tauri-ready** | Two hard ports: **Web Bluetooth** (must become native BLE) and **File System Access** (must become native FS). The architecture should isolate both behind interfaces *now*. |
| **Incremental** | 21.6k LOC, single maintainer, no tests. A big-bang rewrite is high-risk. The path must allow shipping continuously. |
| **Testable** | Zero tests today. The pure core (engine, metrics, zwo, fit) is the highest-value thing to lock down with tests during the move. |

The codebase is **well-positioned** for this: the engine is already DOM-free and callback-isolated,
the codecs are pure leaf modules, and BLE + storage are already narrow facades. This is a
*re-factor*, not a *re-write* — the risk is in the giant view files, not the core.

---

## 2. The two things that must be abstracted regardless of option

These are framework-independent and should happen first, because they de-risk the Tauri port and
are valuable even if you never adopt a framework:

### 2a. A `Storage`/`FileStore` interface (one seam for the data layer)
Define a single async interface — list/read/write/delete workouts, read/write history, read/write
schedule, get/set settings — and give it **two implementations**:
- `WebFileStore` — today's File System Access + IndexedDB code, moved out of `workout-picker.js`
  and consolidated in one place.
- `TauriFileStore` — `@tauri-apps/plugin-fs` over a real directory path (simpler: no handle
  persistence, no `queryPermission` dance, no `fetch`-to-seed — bundle defaults as resources).

### 2b. A `TrainerTransport` interface (one seam for BLE)
Keep the existing `BleManager` event facade (`bikeSample`/`hrSample`/`bikeStatus`/…/`setTrainerState`)
as the stable boundary and put the *transport* behind it:
- `WebBluetoothTransport` — today's `navigator.bluetooth` code.
- `TauriBleTransport` — a Rust `btleplug` bridge exposed via Tauri commands/events. The pure
  FTMS/HR byte parsers and control-point encoders move with it unchanged (or into Rust).
- Native gain: no user-gesture requirement, but you must **build a scan/pick UI** (the OS chooser
  disappears) and change the persisted-device id format (native address, not Chrome's opaque id).

Doing 2a + 2b means the eventual Tauri app is "add two adapters + a Rust BLE bridge," not a rewrite.

---

## 3. The options

All options assume the same non-negotiable baseline: **TypeScript + Vite** (gives types, a real
build, HMR, and the toolchain Tauri expects). The options differ in the **view layer**.

### Option A — TypeScript + Vite, keep vanilla DOM (no view framework)
Add TS and a build; introduce a tiny reactive store (signals, ~50 LOC) to replace the manual
re-render; keep imperative DOM but typed and modularized.

- **Pros:** smallest conceptual change; zero framework lock-in; closest to today; lowest learning
  curve; engine/codecs barely change.
- **Cons:** the giant view files stay imperative — you still hand-write DOM and event wiring;
  doesn't really deliver "well-factored" for the 7k LOC of view code; charts stay manual (fine).
- **Verdict:** a safe *floor*, but under-delivers on "well-factored" for the UI.

### Option B — TypeScript + Vite + **Lit** (web components)
Web-standards components with reactive properties; tiny runtime; no compiler magic; renders via
templates. Charts can stay as SVG inside components.

- **Pros:** standards-based, minimal, no lock-in; components map naturally to the existing overlays;
  excellent Tauri fit; incremental (Lit components can coexist with vanilla during migration);
  closest "framework" to the current vanilla mindset.
- **Cons:** more boilerplate than Svelte/Solid; reactivity is property-level (coarser); the team
  writes more glue than a compiler-based option.
- **Verdict:** the **conservative, lowest-lock-in** structured choice.

### Option C — TypeScript + Vite + **Svelte 5** (compiler) ← recommended
Compile-time framework; ships a minimal runtime; fine-grained reactivity via runes; first-class TS;
official Tauri template support.

- **Pros:** least boilerplate to get reactive views; dramatically shrinks the 7k LOC of view code;
  great DX; tiny output; the pure core stays as plain TS modules that Svelte components import;
  excellent Tauri story. Best "modern + well-factored + simplest going forward" balance.
- **Cons:** it *is* a framework (compiler) — a real, if light, dependency and learning curve;
  component-model migration of the builder/picker is the bulk of the work.
- **Verdict:** **best overall fit** for the stated goals.

### Option D — TypeScript + Vite + **Solid.js**
Fine-grained signals, JSX, very fast and small.

- **Pros:** excellent performance for the live HUD; signals model fits the engine VM well; small.
- **Cons:** smaller ecosystem/community than Svelte; JSX is a bigger departure from today; less
  "obvious" for a solo maintainer.
- **Verdict:** strong technically, but Svelte wins on simplicity/ergonomics for this team size.

### Option E — React / Vue / Preact
- **React/Vue:** explicitly the "heavyweight" the brief rules out; React's re-render model also
  fights a 1 Hz high-frequency HUD without care. **Rejected.**
- **Preact:** lightweight and viable, but offers no advantage over Svelte/Lit here while keeping
  React's mental model. **Not recommended.**

### Options comparison

| | A: Vanilla+TS | B: Lit | **C: Svelte 5** | D: Solid | E: React/Vue |
|---|---|---|---|---|---|
| Type safety | ✅ | ✅ | ✅ | ✅ | ✅ |
| "Not heavyweight" | ✅✅ | ✅✅ | ✅ | ✅ | ❌ (React/Vue) |
| Well-factored views | ❌ | ✅ | ✅✅ | ✅✅ | ✅✅ |
| Lock-in / lightness | ✅✅ | ✅✅ | ✅ | ✅ | ❌ |
| DX / least boilerplate | ➖ | ➖ | ✅✅ | ✅ | ✅ |
| Tauri fit | ✅ | ✅ | ✅✅ | ✅ | ✅ |
| Incremental migration | ✅✅ | ✅✅ | ✅ | ➖ | ➖ |
| Live-HUD performance | ✅ | ✅ | ✅ | ✅✅ | ➖ |

---

## 4. Recommendation

**Adopt TypeScript + Vite now; migrate the view layer to Svelte 5 incrementally
(Option C). If minimizing framework lock-in is valued above DX, Lit (Option B) is the
fully-acceptable fallback — the rest of the plan is identical.**

Rationale:
- The brief's "modern, well-factored, safe, but not heavyweight, simplest going forward" maps most
  directly to **TS + Vite + a compiler-based light framework**. Svelte gives the most structure for
  the least ceremony and produces a tiny bundle — it is "structured and safe" without being React.
- The app's clean core/UI seam means **the framework only touches the view layer**. The engine,
  metrics, ZWO/FIT codecs, BLE facade, and storage stay framework-agnostic TS — so framework risk is
  contained and reversible.
- Both Svelte and Lit have first-class Tauri support; the choice does not affect the native port.

**Keep as plain TS (do not frameworkize):** `workout-engine`, `workout-metrics`, `zwo`, `fit-file`,
the BLE byte parsers, and the new `Storage`/`Transport` interfaces. These are the crown jewels and
the most portable code — they should be the best-tested modules.

---

## 5. Phased migration plan (ship continuously, no big bang)

**Phase 0 — Toolchain & safety net (no behavior change).**
Introduce `package.json`, Vite, TypeScript (start in `allowJs`, `checkJs` loose), ESLint/Prettier.
Wire Vite to output to `docs/` so GitHub Pages keeps working (or move to a `dist/` deploy). Add a
test runner (Vitest). **Outcome:** a build exists; nothing visually changes.

**Phase 1 — Type the core + unify the data model (highest ROI).**
Convert the leaf codecs and engine to `.ts`. Define `RawSegment`/`Block`/`Segment`/`TextEvent`/
`CanonicalWorkout` as real types; collapse the 3 representations to **one internal typed model with
codecs at the edges** (ZWO in/out, FIT in/out). Kill the overloaded tuple slot and the `≤5`
heuristic; de-duplicate `getRawCadence`/interval-detection into one shared module. Fix the
`workout-metrics.js:375` bug. **Add unit tests** for ZWO/FIT round-trips and metrics (golden files
from the existing 41 workouts). **Outcome:** the parsing/metrics class of bugs is closed.

**Phase 2 — Extract the two port interfaces (Tauri de-risking).**
Pull all File System Access + IndexedDB code out of `workout-picker.js`/`storage.js` into one
`WebFileStore` behind a `FileStore` interface. Wrap BLE transport behind `TrainerTransport` behind
the existing `BleManager` events. **Outcome:** one file each to swap for native; web app unchanged.

**Phase 3 — Replace blocking dialogs + global plumbing.**
Replace 45 `alert/confirm/prompt` with a small in-app modal/toast component (needed for native
anyway). Introduce the reactive store for the engine VM so views subscribe instead of being
push-rendered. Sanitize the description `innerHTML` sink. **Outcome:** UI is themable, native-safe,
and reactive-ready.

**Phase 4 — Migrate views to components, one overlay at a time.**
Order by isolation, easiest→hardest: **settings → welcome → riding HUD → picker → planner →
builder**. Each overlay becomes a component subtree consuming the typed store and `FileStore`.
Split the giants as you go: picker → `LibraryStore` + `PickerView` + `BuilderHost`; chart → one
component per renderer; planner → isolate the virtualized calendar behind a small abstraction.
Untangle the shared picker/planner overlay into two independent components. **Outcome:** the 7k LOC
of imperative view code becomes structured components; `workout.js`'s god `initPage` disappears.

**Phase 5 — Harden timing & PWA.**
Derive `elapsedSec` from wall-clock-minus-paused (fix the `setInterval` drift). Replace the manual
`PRECACHE_URLS` with a Vite PWA plugin (auto-generated precache + versioning).

**Phase 6 — Tauri shell.**
Add Tauri; implement `TauriFileStore` (`plugin-fs`) and `TauriBleTransport` (Rust `btleplug`
bridge + a native scan/pick UI). Bundle default workouts as resources. Delete the extension
transport (background/content/messaging/IndexedDB scrape-queue) and replace import with in-process
calls + the existing **paste-a-URL** path; keep `scrapers.js`'s pure canonicalization, decoupled
from `fetch`/`document`. The same TS UI runs on web (Web Bluetooth + FSA) and native (btleplug + FS).

---

## 6. Tauri-specific notes (the hard parts, called out)

- **Web Bluetooth → native BLE is the single biggest port.** No Tauri WebView exposes
  `navigator.bluetooth`. Plan for a Rust `btleplug` bridge behind the `TrainerTransport` interface,
  a new scan/pick UI, and a changed persisted-device id format. The FTMS/HR parsers and encoders
  port unchanged (or to Rust).
- **File System Access → native FS is a simplification.** The folder-of-files model maps directly
  to `plugin-fs`; you delete handle persistence, the permission re-grant flow, and `fetch`-seeding.
- **The Chrome extension is throwaway for native.** Its only job is "scrape the page I'm on";
  natively, rely on URL/file import. TrainerRoad/TrainerDay are API-based and port to a native HTTP
  client — but TrainerRoad needs the user's authenticated session (the auth bridge is the hard bit).
  **WhatsOnZwift** has no API and is brittle DOM scraping — the highest-maintenance native problem
  (would need headless HTML fetch + a maintained selector layer, or a webview import flow).
- **Keep the lossless FIT round-trip** (canonical JSON embedded in developer fields) — it survives
  the port untouched and is a genuine feature.

---

## 7. Bottom line

The codebase is healthier than its "vibe-coded, no build, no tests" surface suggests: a clean
module DAG, a DOM-free engine, pure codecs, and narrow BLE/storage facades. The work is not a
rewrite — it is **(1) types + one unified data model, (2) two port interfaces, (3) incremental view
componentization** — done in shippable phases.

- **Recommended stack:** TypeScript + Vite + **Svelte 5** (Lit if lock-in aversion dominates), with
  the pure core kept as framework-agnostic TS and Tauri added last behind the two adapters.
- **Do first, regardless of framework choice:** Phase 1 (types + unified model + tests) and Phase 2
  (FileStore + TrainerTransport interfaces). These deliver the most safety and unlock the native
  app with the least risk.
- **Don't:** adopt React/Vue (heavyweight, fights the live HUD), or attempt a big-bang rewrite.
