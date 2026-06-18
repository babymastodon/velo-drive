// Captures the LEGACY HUD render as the committed visual BASELINE
// (web/visual-report/hud/legacy.png) that the new-app HUD test diffs against.
// Also keeps real structural assertions (welcome dismissed, riding view up).

import {test, expect, reachRidingView} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("HUD legacy baseline", () => {
  test("boots configured to the riding view and writes the HUD baseline", async ({
    configuredPage,
  }) => {
    const page = configuredPage;

    await reachRidingView(page);

    // The welcome overlay must not be covering the HUD.
    const welcomeCovering = await page
      .locator("#welcomeOverlay")
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
      })
      .catch(() => false);
    expect(welcomeCovering).toBe(false);

    await expect(page.locator("#stat-power")).toBeVisible();
    await expect(page.locator(".top-panel")).toBeVisible();

    // Write the committed baseline (regenerated from the live legacy render each
    // run, so it can never go stale relative to the oracle).
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("hud", "legacy.png", shot);
  });
});
