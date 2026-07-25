import {defineConfig, devices} from "@playwright/test";

const PORT = 4183;
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/docs",
  testMatch: "screenshots.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,

  use: {
    ...devices["Desktop Chrome"],
    baseURL: URL,
    viewport: {width: 1440, height: 900},
    deviceScaleFactor: 1,
    timezoneId: "America/Los_Angeles",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: `npx vite build && node harness/static-server.mjs dist ${PORT}`,
    url: URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
