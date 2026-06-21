# VeloDrive — Web (TypeScript + Vite + Svelte 5)

VeloDrive is an offline-first PWA for riding structured cycling workouts on
FTMS smart trainers. This package is the app: TypeScript core, Web Bluetooth +
File System Access platform seams, and a Svelte 5 UI.

## How it's built

- **`src/core/`** — framework-agnostic TypeScript: the canonical workout `model`,
  the `zwo`/`fit` codecs, `metrics`, the ride `engine`, `beeper`, `chart`
  renderers, and `builder-backend`.
- **`src/ports/`** — two platform seams behind typed interfaces: `TrainerTransport`
  (Web Bluetooth FTMS) and `FileStore` (File System Access + IndexedDB). These are
  the seams an eventual native (Tauri) port would swap.
- **`src/state/`** — Svelte 5 signals (engine view-model, overlay/UI host, dialog).
- **`src/ui/`** — Svelte components, with the workout CSS hosted global in
  `src/styles/`.

## The test harness (`harness/`, `tests/`)

Hermetic and deterministic — no real hardware, filesystem, clock, or network:

- **Fakes:** an FTMS trainer simulator (`navigator.bluetooth`), an in-memory File
  System Access tree + IndexedDB, a virtual-time clock (steps a ride in ms), and an
  audio recorder (so tests can assert beep patterns).
- **`harness/page-env.js`** builds these onto `window.__VELO_TEST_ENV__`; the app's
  platform shim (installed first in `main.ts`) reads it to swap providers, so the
  app boots fully faked.
- **Unit / property tests** (`tests/unit/`, vitest) cover the core codecs, metrics,
  engine state machine, scheduling, and storage. **End-to-end tests**
  (`tests/e2e/`, Playwright) drive the built app through real user flows.

## Commands

```sh
npm install
npm run dev                            # run the app
npm run typecheck                      # tsc --noEmit (strict)
npm run test                           # vitest: unit + property tests
npx playwright install chromium        # once
npm run test:e2e                       # Playwright end-to-end
npm run build:docs                     # build the PWA into ../docs (GitHub Pages)
```
