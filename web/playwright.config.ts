import {defineConfig, devices} from "@playwright/test";

// Hermetic e2e against the SHIMMED legacy app, served by our tiny static server.
// Deterministic rendering: fixed landscape viewport, DPR 1, reduced motion,
// animations disabled (via the test fixture + CSS), small screenshot tolerance.

const PORT = 4178;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],

  // Screenshot baselines live next to the spec under __screenshots__.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02, // small tolerance for AA/font rendering noise
      animations: "disabled",
    },
  },

  use: {
    baseURL: BASE_URL,
    viewport: {width: 1280, height: 800}, // landscape
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {...devices["Desktop Chrome"], viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
    },
  ],

  webServer: {
    command: "node harness/static-server.mjs legacy-shimmed " + PORT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
