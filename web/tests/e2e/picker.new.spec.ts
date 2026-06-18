// New (Svelte) app workout picker: REAL visual diff vs the legacy baseline +
// behavior. The visual test pixelmatches the new picker render against
// web/visual-report/picker/legacy.png (written by picker.legacy.spec, which runs
// first via project deps) and ASSERTS diffRatio < threshold. Both apps boot the
// SAME hermetic config (same seeded .zwo library + default sort), so only
// layout/CSS can differ.
//
// Behavior covers the library-browse + ride-selection scope: search narrows,
// zone/duration filters narrow, sort headers reorder, expand shows stats +
// chart, select sets the engine's workout + closes, delete moves a file to
// trash, clone creates an "X Copy" file. The in-picker BUILDER is deferred.

import {test, expect, reachNewRidingView, PICKER_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";
import type {Page} from "@playwright/test";

const MAX_DIFF_RATIO = 0.02;

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId("workout-name-label").click();
  await expect(page.getByTestId("picker-modal")).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

function rows(page: Page) {
  return page.locator("#pickerWorkoutTbody tr.picker-row");
}

test.describe("Picker (new Svelte app) — visual", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("visually matches the legacy picker baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Structural sanity (real assertions, not just "rendered").
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await expect(page.getByTestId("picker-title")).toHaveText("Workout library");
    expect(await rows(page).count()).toBeGreaterThan(5);
    await expect(page.getByTestId("picker-summary")).toContainText("workouts shown");

    const baseline = readBaseline("picker", "legacy.png");
    expect(baseline, "legacy picker baseline must exist (picker.legacy.spec runs first)").not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("picker", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy picker must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new picker differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/picker/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});

test.describe("Picker (new Svelte app) — behavior", () => {
  test("search narrows the list", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const before = await rows(page).count();
    // A title token unlikely to match every workout.
    await page.getByTestId("picker-search").fill("recovery");
    await page.waitForTimeout(50);
    const after = await rows(page).count();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  test("a zone filter narrows the list", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const before = await rows(page).count();
    await page.getByTestId("picker-zone-filter").selectOption("VO2Max");
    await page.waitForTimeout(50);
    const after = await rows(page).count();
    expect(after).toBeLessThan(before);
  });

  test("a duration filter narrows the list", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const before = await rows(page).count();
    await page.getByTestId("picker-duration-filter").selectOption("1-30");
    await page.waitForTimeout(50);
    const after = await rows(page).count();
    expect(after).toBeLessThan(before);
  });

  test("clicking a sort header reorders the list", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const firstNames = async () => {
      const cells = page.locator("#pickerWorkoutTbody tr.picker-row td:first-child");
      const n = Math.min(5, await cells.count());
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push((await cells.nth(i).innerText()).trim());
      return out;
    };

    const beforeAsc = await firstNames();
    // Sort by name (ascending), then toggle to descending — the order must flip.
    await page.locator('th[data-sort-key="name"]').click();
    await page.waitForTimeout(50);
    const nameAsc = await firstNames();
    await page.locator('th[data-sort-key="name"]').click();
    await page.waitForTimeout(50);
    const nameDesc = await firstNames();

    expect(nameAsc.join("|")).not.toBe(nameDesc.join("|"));
    // Name-asc differs from the default kJ-asc order too.
    expect(nameAsc.join("|")).not.toBe(beforeAsc.join("|"));
  });

  test("expanding a row shows stats + chart", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    await rows(page).first().click();
    const expanded = page.locator("#pickerWorkoutTbody tr.picker-expanded-row");
    await expect(expanded).toBeVisible();
    // Stat chips present (Zone/Duration/etc.) + the mini chart SVG rendered.
    await expect(expanded.locator(".wb-stat-chip").first()).toBeVisible();
    await page.waitForTimeout(50);
    await expect(page.getByTestId("picker-mini-chart").locator("svg")).toBeVisible();
  });

  test("selecting a workout closes the picker and sets it as the engine's workout", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const firstRow = rows(page).first();
    const selectedTitle = (await firstRow.locator("td:first-child").innerText()).trim();
    await firstRow.click();
    await page.getByTestId("picker-select").click();

    // Picker closed.
    await expect(page.locator("#workoutPickerOverlay")).toHaveCount(0);

    // Engine VM now reflects the selected workout (read via the live HUD label).
    await expect(page.getByTestId("workout-name-label")).toHaveText(selectedTitle);

    // Persisted in the settings store too.
    const persistedTitle = await page.evaluate(async () => {
      const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, unknown>}})
        .__VELO_HARNESS__.settingsStore;
      const rec = store.get("selectedWorkout") as {value?: {workoutTitle?: string}} | undefined;
      return rec?.value?.workoutTitle;
    });
    expect(persistedTitle).toBe(selectedTitle);
  });

  test("delete moves a file to trash", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const firstRow = rows(page).first();
    const title = (await firstRow.locator("td:first-child").innerText()).trim();
    const expectedFile = encodeURIComponent(title) + ".zwo";

    const trashBefore = await page.evaluate(() => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {trash: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.trash._files.size;
    });

    await firstRow.click();
    await page.getByTestId("picker-delete").click();
    // Confirm dialog.
    await page.getByTestId("dialog-ok").click();
    await page.waitForTimeout(50);

    const result = await page.evaluate((file) => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {trash: {_files: Map<string, unknown>}; workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      const trashKeys = Array.from(fs.trash._files.keys());
      return {
        trashCount: fs.trash._files.size,
        removedFromWorkouts: !fs.workouts._files.has(file),
        // trash file names are stamped: "<base> (<iso>).zwo"
        movedToTrash: trashKeys.some((k) => k.startsWith(file.slice(0, -4))),
      };
    }, expectedFile);

    expect(result.trashCount).toBe(trashBefore + 1);
    expect(result.removedFromWorkouts).toBe(true);
    expect(result.movedToTrash).toBe(true);
  });

  test("clone creates an 'X Copy' file", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const firstRow = rows(page).first();
    const title = (await firstRow.locator("td:first-child").innerText()).trim();
    const expectedCopyFile = encodeURIComponent(`${title} Copy`) + ".zwo";

    await firstRow.click();
    await page.getByTestId("picker-clone").click();
    await page.waitForTimeout(50);

    const hasCopy = await page.evaluate((file) => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.workouts._files.has(file);
    }, expectedCopyFile);
    expect(hasCopy).toBe(true);

    // The clone is also listed in the table (as a "X Copy" row).
    await expect(
      page.locator(`#pickerWorkoutTbody td:first-child`, {hasText: `${title} Copy`}).first(),
    ).toBeVisible();
  });

  test("the 'w' key opens the picker", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.keyboard.press("w");
    await expect(page.getByTestId("picker-modal")).toBeVisible();
  });
});
