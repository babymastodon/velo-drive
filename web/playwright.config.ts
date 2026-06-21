import {defineConfig, devices} from "@playwright/test";

// Hermetic e2e against the built app (dist/) under an injected __VELO_TEST_ENV__.
// Deterministic rendering: fixed landscape viewport, DPR 1, reduced motion,
// animations disabled (fixture CSS).

const PORT = 4179;
const URL = `http://localhost:${PORT}`;

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
      name: "new-app",
      testMatch: /\.new\.spec\.ts$/,
      use: {...devices["Desktop Chrome"], baseURL: URL, viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
    },
  ],

  webServer: [
    {
      command: "npx vite build && node harness/static-server.mjs dist " + PORT,
      url: URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
