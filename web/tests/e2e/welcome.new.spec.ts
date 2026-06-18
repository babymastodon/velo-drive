// New (Svelte) app Welcome tour: REAL visual diff vs the legacy baseline +
// behavior. Pixelmatches the new render against web/visual-report/welcome/
// legacy.png (written by welcome.legacy.spec, runs first via project deps) and
// ASSERTS diffRatio < threshold. The new app does NOT show welcome on boot, so
// the harness opens it for the test via __VELO_APP__.ui.openWelcome.

import {test, expect, reachNewRidingView, WELCOME_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

const MAX_DIFF_RATIO = 0.02;

async function openWelcomeAt(page: import("@playwright/test").Page, index: number) {
  await page.evaluate((i) => {
    const app = (window as unknown as {__VELO_APP__: {ui: {openWelcome: (m: string, idx: number) => void}}}).__VELO_APP__;
    app.ui.openWelcome("full", i);
  }, index);
  await expect(page.locator("#welcomeOverlay")).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
  await page.waitForTimeout(150);
}

test.describe("Welcome (new Svelte app) — visual", () => {
  test.use({harnessConfig: WELCOME_HARNESS_CONFIG});

  test("visually matches the legacy Welcome baseline (trainers slide)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openWelcomeAt(page, 1);

    await expect(page.getByTestId("welcome-overlay")).toBeVisible();
    await expect(page.getByTestId("welcome-title")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );

    const baseline = readBaseline("welcome", "legacy.png");
    expect(baseline, "legacy Welcome baseline must exist (welcome.legacy.spec runs first)").not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("welcome", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy Welcome must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new Welcome differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/welcome/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});

test.describe("Welcome (new Svelte app) — behavior", () => {
  test("next/prev navigate slides; close + Escape dismiss", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openWelcomeAt(page, 0);

    // Slide 0 is the splash; prev is hidden.
    await expect(page.getByTestId("welcome-title")).toHaveText("Welcome to VeloDrive");
    await expect(page.getByTestId("welcome-prev")).toHaveCSS("visibility", "hidden");

    // Next -> trainers.
    await page.getByTestId("welcome-next").click({force: true});
    await expect(page.getByTestId("welcome-title")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );
    await expect(page.getByTestId("welcome-prev")).toHaveCSS("visibility", "visible");

    // Prev -> back to splash.
    await page.getByTestId("welcome-prev").click({force: true});
    await expect(page.getByTestId("welcome-title")).toHaveText("Welcome to VeloDrive");

    // Close button dismisses the overlay (and reveals the HUD). The welcome
    // <main> can overlay the hit-point, so invoke the button's click handler
    // directly to assert the close wiring.
    await page.getByTestId("welcome-close").dispatchEvent("click");
    await expect(page.locator("#welcomeOverlay")).toHaveCount(0);
    await expect(page.locator("#stat-power")).toBeVisible();

    // Re-open + Escape dismisses.
    await openWelcomeAt(page, 1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#welcomeOverlay")).toHaveCount(0);
  });
});
