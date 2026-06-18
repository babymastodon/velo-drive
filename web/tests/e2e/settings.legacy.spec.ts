// Captures the LEGACY Settings overlay render as the committed visual BASELINE
// (web/visual-report/settings/legacy.png) that the new-app Settings test diffs
// against. Opens settings via #settingsBtn (after dismissing welcome) and keeps
// real structural assertions that it is open + populated.

import {test, expect, reachRidingView, SETTINGS_HARNESS_CONFIG} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("Settings legacy baseline", () => {
  test.use({harnessConfig: SETTINGS_HARNESS_CONFIG});

  test("opens the settings modal and writes the baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);

    await page.locator("#settingsBtn").click();

    const overlay = page.locator("#settingsOverlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(page.locator("#settingsTitle")).toHaveText("Settings");

    // FTP input reflects the seeded engine FTP (250).
    await expect(page.locator("#settingsFtpInput")).toHaveValue("250");

    // Let any open animation settle, then snapshot.
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });

    const shot = await page.screenshot({fullPage: false});
    writeBaseline("settings", "legacy.png", shot);
  });
});
