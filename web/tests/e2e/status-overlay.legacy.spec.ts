// Captures the LEGACY status overlay (the big "3" countdown frame) as the
// committed visual BASELINE (web/visual-report/status-overlay/legacy.png) that
// the new-app status-overlay test diffs against.
//
// Determinism: clicking #startBtn runs Beeper.runStartCountdown, whose first
// step renders "3" synchronously into #statusOverlay/#statusText. The viewport
// is fixed (1280x800), so the overlay font size is fixed too. We settle the
// virtual clock by 0ms (pump microtasks without advancing the countdown) so the
// overlay is parked on the "3" frame, then screenshot.

import {test, expect, reachRidingView, VISUAL_HARNESS_CONFIG} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("Status overlay legacy baseline", () => {
  test.use({harnessConfig: VISUAL_HARNESS_CONFIG});

  test("captures the 3-2-1 countdown overlay (the '3' frame)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);

    // Start the workout: the countdown's first step renders "3" synchronously.
    await page.locator("#startBtn").click();
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__.settle();
    });

    const overlay = page.locator("#statusOverlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator("#statusText")).toHaveText("3");

    const shot = await page.screenshot({fullPage: false});
    writeBaseline("status-overlay", "legacy.png", shot);
  });
});
