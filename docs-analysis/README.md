# VeloDrive — Codebase Analysis & Modernization Report

Deep analysis of the current VeloDrive codebase (`docs/`, ~21.6k LOC vanilla ES-module JS, no
build/tests), produced 2026-06-18 from a full line-level read of every module.

| Doc | Contents |
|---|---|
| [01-functionality-and-user-journeys.md](01-functionality-and-user-journeys.md) | Complete feature catalogue + the 7 user journeys that matter, with the modules each touches |
| [02-architecture-and-layout.md](02-architecture-and-layout.md) | File layout, module dependency graph, the SPA shell, the 3-way workout data model, storage/BLE/render layers, code-quality signals, the good seams and sharp edges |
| [03-modernization-options-and-recommendation.md](03-modernization-options-and-recommendation.md) | Decision criteria, the two port interfaces to extract first, 5 stack options compared, the recommendation (TS + Vite + Svelte 5), a 7-phase incremental plan, and Tauri-specific hard parts |
| [04-migration-playbook.md](04-migration-playbook.md) | How to execute the migration in a new `web/` dir against a frozen `legacy/` oracle: directory layout, tooling, the 5 parity harnesses, the phased step sequence with gates, the parity matrix, and determinism requirements |
| [05-design-and-migration-plan.md](05-design-and-migration-plan.md) | **The authoritative spec (v5, UI/CSS-first).** Re-centered on the real challenge: the core is small/low-risk; the work and risk are the **Svelte view rewrite and layout/CSS fidelity**. Primary de-risk: **re-host the CSS global & verbatim** (don't rewrite it). Three matched gates — **looks right** (computed-style+geometry differential · screenshot regression · **Claude visual review** · layout invariants), **works right** (behavioral harness with FTMS sim), **computes right** (cheap old-vs-new core tests). Migrate in **vertical slices, shipping behind legacy**; a real-environment lane gates cutover. Includes the harness internals, component tree, scenario catalog, and **Part X: engine magic-numbers**. Supersedes all earlier versions. |

## TL;DR

- **Today:** vanilla ES modules in a clean dependency DAG; a DOM-free, callback-isolated ride
  **engine**; pure leaf codecs (`zwo`, `fit-file`, `workout-metrics`); narrow **BLE** and
  **storage** facades. But: no types, no tests, no build; three parallel workout representations
  with overloaded positional tuples; three 2k-LOC imperative view files; 174 raw DOM lookups;
  45 blocking `alert/confirm`.
- **Recommendation:** **TypeScript + Vite + Svelte 5** (Lit as the low-lock-in fallback). Keep the
  pure core as framework-agnostic TS. It's a *refactor, not a rewrite*.
- **Do first (framework-independent, de-risks everything):** (1) types + one unified workout model
  + round-trip tests; (2) a `FileStore` interface and a `TrainerTransport` interface, each with a
  web implementation today and a Tauri implementation later.
- **Tauri:** the folder-of-files storage maps *more simply* to native FS; the real blocker is
  **Web Bluetooth**, which needs a native Rust (`btleplug`) BLE bridge behind the transport
  interface. The Chrome extension scraper is throwaway natively (keep its pure parsing core).
