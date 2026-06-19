// New (Svelte) app BLE auto-reconnect + connection logs + boot auto-open guard.
// Behavior only (no visual diff). The harness FTMS sim supports getDevices() and
// seeds lastBikeDeviceId when connectBike:true, so a fresh load drives the
// transport's reconnect-saved-devices path exactly like the real app.

import {test, expect, reachNewRidingView, type HarnessConfig} from "./fixtures.js";

const CONNECT_CONFIG: HarnessConfig = {
  ftp: 250,
  soundEnabled: false,
  themeMode: "light",
  selectedWorkout: undefined,
  connectBike: true,
  connectHr: false,
};

async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__.settle();
  });
}

test.describe("BLE (new Svelte app) — auto-reconnect on load", () => {
  test.use({harnessConfig: CONNECT_CONFIG});

  test("seeded lastBikeDeviceId reconnects on load: bike status dot is connected", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // transport.init() → maybeReconnectSavedDevices() → getDevices() found the
    // seeded device id and connected. The HUD status dot reflects 'connected'.
    await expect(page.getByTestId("bike-status-dot")).toHaveClass(/connected/);
  });

  test("a mid-session disconnect re-pairs via backoff (status returns to connected)", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await expect(page.getByTestId("bike-status-dot")).toHaveClass(/connected/);

    // Drop the trainer GATT: the disconnect handler schedules a backoff retry.
    await page.evaluate(() => {
      (window as unknown as {__VELO_HARNESS__: {sim: {disconnectBike: () => void}}}).__VELO_HARNESS__.sim.disconnectBike();
    });
    await settle(page);
    await expect(page.getByTestId("bike-status-dot")).toHaveClass(/error/);

    // Advance past the 1s backoff so the reconnect timer fires and re-connects
    // the (still-paired) device.
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {clock: {step: (ms: number) => Promise<void>}; settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.clock.step(1500);
      await h.settle();
    });
    await expect(page.getByTestId("bike-status-dot")).toHaveClass(/connected/);
  });
});

test.describe("BLE (new Svelte app) — connection logs", () => {
  test.use({harnessConfig: CONNECT_CONFIG});

  test("transport log events appear in the settings logs sub-view", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // The reconnect on load emits transport log lines (getDevices(), handshake).
    // Open Settings → logs sub-view and assert the content carries a log line.
    await page.locator("#settingsBtn").click();
    await expect(page.locator("#settingsOverlay")).toBeVisible();
    await page.getByTestId("settings-open-logs").click();
    await expect(page.getByTestId("settings-title")).toHaveText("Connection logs");

    const logText = (await page.getByTestId("settings-logs-content").textContent()) ?? "";
    expect(logText.length).toBeGreaterThan(0);
    expect(logText).toContain("FTMS requestControl + startOrResume sent.");
  });
});

test.describe("BLE (new Svelte app) — boot auto-open guard", () => {
  test.use({harnessConfig: CONNECT_CONFIG});

  test("settings does NOT auto-open in the configured/supported hermetic state", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await settle(page);

    // Root dir is seeded, getDevices() exists, runner is Chromium → no attention.
    await expect(page.locator("#settingsOverlay")).toHaveCount(0);
    // The compatibility alert element stays hidden (supported platform).
    await page.locator("#settingsBtn").click();
    await expect(page.getByTestId("settings-compat-alert")).toBeHidden();
  });
});
