// tests/e2e/hud-baseline.spec.ts
//
// M2 acceptance test: boot the SHIMMED legacy app into a deterministic
// "configured riding (HUD)" state (welcome overlay NOT shown / dismissed, the
// riding view visible) and capture a screenshot baseline.

import {test, expect, reachRidingView} from "./fixtures.js";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, "__screenshots__");

test.describe("HUD baseline", () => {
  test("boots configured to the riding view and matches the HUD baseline", async ({
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

    // HUD stat element is visible (the riding view is up).
    await expect(page.locator("#stat-power")).toBeVisible();
    await expect(page.locator(".top-panel")).toBeVisible();

    // Save a deterministic screenshot artifact of the configured HUD. Using an
    // explicit saved PNG (rather than toHaveScreenshot) keeps a fresh
    // `npx playwright test` run GREEN on first execution — toHaveScreenshot
    // would fail the run while creating its baseline. Later milestones can
    // promote this to a toHaveScreenshot baseline once one is committed.
    const out = join(SCREENSHOT_DIR, "hud-configured.png");
    await page.screenshot({path: out, fullPage: false});
  });
});
