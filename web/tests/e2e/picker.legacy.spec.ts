// Captures the LEGACY workout picker overlay render as the committed visual
// BASELINE (web/visual-report/picker/legacy.png) that the new-app picker test
// diffs against. Opens the picker via #workoutNameLabel (seeded .zwo library)
// and keeps real structural assertions that it lists workouts.

import {test, expect, reachRidingView, PICKER_HARNESS_CONFIG} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("Picker legacy baseline", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("opens the workout picker and writes the baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);

    await page.locator("#workoutNameLabel").click();

    const overlay = page.locator("#workoutPickerOverlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator("#workoutPickerModal")).toBeVisible();
    await expect(page.locator("#workoutPickerTitle")).toHaveText("Workout library");

    // The seeded library is listed (rows rendered into the tbody).
    const rows = page.locator("#pickerWorkoutTbody tr.picker-row");
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(5);

    // Summary reflects "<shown> of <total> workouts shown".
    await expect(page.locator("#pickerSummary")).toContainText("workouts shown");

    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });

    const shot = await page.screenshot({fullPage: false});
    writeBaseline("picker", "legacy.png", shot);
  });
});
