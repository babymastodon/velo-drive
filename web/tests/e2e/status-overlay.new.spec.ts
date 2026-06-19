// New (Svelte) status overlay: REAL visual diff vs the legacy baseline.
// Pixelmatches the new render (the "3" countdown frame) against
// web/visual-report/status-overlay/legacy.png (written by
// status-overlay.legacy.spec, which runs first via project deps) and ASSERTS
// the diffRatio is under threshold. The new app reproduces the legacy
// #statusOverlay/#statusText DOM (StatusOverlay.svelte) driven by the same
// Beeper, so a faithful render diffs only by sub-pixel AA.

import {test, expect, reachNewRidingView, VISUAL_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

const MAX_DIFF_RATIO = 0.02;

test.describe("Status overlay (new Svelte app) — visual", () => {
  test.use({harnessConfig: VISUAL_HARNESS_CONFIG});

  test("the countdown overlay matches the legacy baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Start: the Beeper countdown renders "3" into #statusOverlay synchronously.
    await page.getByTestId("start-btn").click();
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__.settle();
    });

    await expect(page.locator("#statusOverlay")).toBeVisible();
    await expect(page.locator("#statusText")).toHaveText("3");

    const baseline = readBaseline("status-overlay", "legacy.png");
    expect(
      baseline,
      "legacy status-overlay baseline must exist (status-overlay.legacy.spec runs first)",
    ).not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("status-overlay", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy overlay must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new status overlay differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/status-overlay/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});
