// Captures the LEGACY in-picker workout builder render as the committed visual
// BASELINE (web/visual-report/builder/legacy.png) that the new-app builder test
// diffs against. Opens the picker via #workoutNameLabel, clicks "Create
// workout" (#pickerAddWorkoutBtn) to enter the builder with the DETERMINISTIC
// default new-workout blocks (warmup / steady / intervals / cooldown), then
// writes the baseline + keeps real structural assertions that the builder is
// open.

import {test, expect, reachRidingView, PICKER_HARNESS_CONFIG} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("Builder legacy baseline", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("opens the workout builder and writes the baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);

    await page.locator("#workoutNameLabel").click();
    await expect(page.locator("#workoutPickerModal")).toBeVisible();

    // Enter the builder via "Create workout".
    await page.locator("#pickerAddWorkoutBtn").click();

    // The modal switches to builder mode + the builder root is shown.
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toBeVisible();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await expect(page.locator("#workoutBuilderSaveBtn")).toBeVisible();
    await expect(page.locator("#workoutBuilderBackBtn")).toBeVisible();

    // Deterministic default blocks => the chart SVG renders.
    await expect(page.locator("#workoutBuilderRoot .wb-chart-mini-host svg").first()).toBeVisible();
    // Insert-block toolbar buttons are present.
    expect(await page.locator("#workoutBuilderRoot .wb-code-insert-btn").count()).toBeGreaterThan(5);

    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    // Let the chart's rAF + ResizeObserver settle so the SVG is laid out.
    await page.waitForTimeout(120);

    const shot = await page.screenshot({fullPage: false});
    writeBaseline("builder", "legacy.png", shot);
  });
});
