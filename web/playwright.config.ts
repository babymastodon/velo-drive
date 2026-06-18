import {defineConfig, devices} from "@playwright/test";

// Hermetic e2e, two targets under the SAME injected __VELO_TEST_ENV__:
//   *.legacy.spec.ts -> legacy-shimmed (port 4178): captures committed baselines.
//   *.new.spec.ts    -> new Svelte app dist/ (port 4179): behavior + REAL visual
//                       diff (pixelmatch) vs the legacy baseline.
// Deterministic rendering: fixed landscape viewport, DPR 1, reduced motion,
// animations disabled (fixture CSS). Projects run in order (workers:1), so the
// legacy baseline is regenerated before the new-app diff consumes it.

const LEGACY_PORT = 4178;
const NEW_PORT = 4179;
const LEGACY_URL = `http://localhost:${LEGACY_PORT}`;
const NEW_URL = `http://localhost:${NEW_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  use: {
    viewport: {width: 1280, height: 800},
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "legacy",
      testMatch: /\.legacy\.spec\.ts$/,
      use: {...devices["Desktop Chrome"], baseURL: LEGACY_URL, viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
    },
    {
      name: "new-app",
      testMatch: /\.new\.spec\.ts$/,
      dependencies: ["legacy"],
      use: {...devices["Desktop Chrome"], baseURL: NEW_URL, viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
    },
  ],

  webServer: [
    {
      command: "node harness/static-server.mjs legacy-shimmed " + LEGACY_PORT,
      url: LEGACY_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npx vite build && node harness/static-server.mjs dist " + NEW_PORT,
      url: NEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
