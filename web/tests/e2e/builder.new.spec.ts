// New (Svelte) app workout BUILDER: REAL visual diff vs the legacy baseline +
// behavior. The visual test pixelmatches the new builder render against
// web/visual-report/builder/legacy.png (written by builder.legacy.spec, which
// runs first via project deps) and ASSERTS diffRatio < threshold. Both apps
// boot the SAME hermetic config and enter the builder on the SAME deterministic
// default new-workout blocks, so only layout/CSS can differ.
//
// Behavior covers the create/edit scope: insert a block (toolbar + key) changes
// the block count / chart; a stepper edit changes the value; undo reverts;
// validate blocks an invalid save (missing name); a valid Save writes a .zwo
// (asserted via the fake FS) and returns to the library.

import {test, expect, reachNewRidingView, PICKER_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";
import type {Page} from "@playwright/test";

const MAX_DIFF_RATIO = 0.02;

async function openBuilder(page: Page): Promise<void> {
  await page.getByTestId("workout-name-label").click();
  await expect(page.getByTestId("picker-modal")).toBeVisible();
  await page.getByTestId("picker-add-workout").click();
  await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toBeVisible();
  await expect(page.getByTestId("builder-save")).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
  // Let the chart's rAF settle.
  await page.waitForTimeout(120);
}

function chartSegments(page: Page) {
  return page.locator('[data-testid="wb-chart"] svg polygon.wb-block-segment');
}

test.describe("Builder (new Svelte app) — visual", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("visually matches the legacy builder baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    // Structural sanity (real assertions, not just "rendered").
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await expect(page.getByTestId("builder-back")).toBeVisible();
    await expect(page.locator('[data-testid="wb-chart"] svg').first()).toBeVisible();
    expect(await page.getByTestId("wb-toolbar-buttons").locator(".wb-code-insert-btn").count()).toBe(11);

    const baseline = readBaseline("builder", "legacy.png");
    expect(baseline, "legacy builder baseline must exist (builder.legacy.spec runs first)").not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("builder", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy builder must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new builder differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/builder/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});

test.describe("Builder (new Svelte app) — behavior", () => {
  test("inserting a block via the toolbar changes the chart segment count", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    const before = await chartSegments(page).count();
    // Insert a steady (tempo) block at the current insertion point.
    await page.getByTestId("wb-insert-tempo").click();
    await page.waitForTimeout(60);
    const after = await chartSegments(page).count();
    expect(after).toBe(before + 1);
  });

  test("inserting a block via a keyboard shortcut changes the chart", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    const before = await chartSegments(page).count();
    // 'e' inserts an Endurance steady block.
    await page.locator("#workoutBuilderRoot").click({position: {x: 5, y: 5}});
    await page.keyboard.press("e");
    await page.waitForTimeout(60);
    const after = await chartSegments(page).count();
    expect(after).toBeGreaterThan(before);
  });

  test("editing a stepper changes the block value; undo reverts", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    // Select the first block (warmup) by clicking its segment in the chart.
    await chartSegments(page).first().click();
    await expect(page.getByTestId("wb-block-editor")).toBeVisible();

    const durInput = page.getByTestId("wb-field-durationSec");
    const before = await durInput.inputValue();

    // Bump the duration via the "+" stepper button.
    const stepper = page.locator('.wb-block-field[data-kind="duration"]').first();
    await stepper.locator("button.control-btn").last().click();
    await page.waitForTimeout(60);
    const after = await durInput.inputValue();
    expect(Number(after)).toBeGreaterThan(Number(before));

    // Undo reverts the edit.
    await page.getByTestId("wb-undo").click();
    await page.waitForTimeout(60);
    // Re-select the block (undo deselects) and re-read.
    await chartSegments(page).first().click();
    const reverted = await page.getByTestId("wb-field-durationSec").inputValue();
    expect(Number(reverted)).toBe(Number(before));
  });

  test("validate blocks an invalid save (missing name)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    const workoutsBefore = await page.evaluate(() => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.workouts._files.size;
    });

    // Clear the required Name field.
    await page.getByTestId("wb-name").fill("");
    await page.getByTestId("builder-save").click();
    await page.waitForTimeout(60);

    // Still in builder mode (save was blocked), status shows the error, and no
    // new file was written.
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toBeVisible();
    await expect(page.getByTestId("builder-status")).toContainText("Name is required");

    const workoutsAfter = await page.evaluate(() => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.workouts._files.size;
    });
    expect(workoutsAfter).toBe(workoutsBefore);
  });

  test("a valid Save writes a .zwo to the workouts dir and returns to the library", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    const title = "Builder New Workout";
    const fileName = encodeURIComponent(title) + ".zwo";

    await page.getByTestId("wb-name").fill(title);
    await page.getByTestId("wb-source").fill("Me");
    await page.getByTestId("wb-description").fill("A built test workout.");

    const before = await page.evaluate(() => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.workouts._files.size;
    });

    await page.getByTestId("builder-save").click();
    await page.waitForTimeout(80);

    // Returned to the library (builder mode off).
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toHaveCount(0);
    await expect(page.getByTestId("picker-title")).toHaveText("Workout library");

    // The .zwo file exists in the fake FS with the expected segments.
    const result = await page.evaluate(async (file) => {
      const fs = (window as unknown as {
        __VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>; getFileHandle: (n: string) => Promise<{getFile: () => Promise<{text: () => Promise<string>}>}>}}};
      }).__VELO_HARNESS__.fs;
      const has = fs.workouts._files.has(file);
      let text = "";
      if (has) {
        const fh = await fs.workouts.getFileHandle(file);
        const f = await fh.getFile();
        text = await f.text();
      }
      return {has, count: fs.workouts._files.size, text};
    }, fileName);

    expect(result.has).toBe(true);
    expect(result.count).toBe(before + 1);
    // The saved .zwo contains the default-workout structure: a warmup ramp,
    // a steady block, an interval set, and a cooldown ramp.
    expect(result.text).toContain("<workout_file>");
    expect(result.text).toContain("<Warmup");
    expect(result.text).toContain("<SteadyState");
    expect(result.text).toContain("<IntervalsT");
    expect(result.text).toContain("<Cooldown");
    expect(result.text).toContain("A built test workout.");

    // The new workout is now listed in the library table.
    await expect(
      page.locator("#pickerWorkoutTbody td:first-child", {hasText: title}).first(),
    ).toBeVisible();
  });
});
