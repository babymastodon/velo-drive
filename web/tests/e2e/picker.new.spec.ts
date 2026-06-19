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

// --------------------------- Wave 2: keymap, persistence, builder guard, import ---------------------------

test.describe("Picker (new Svelte app) — keymap", () => {
  test("'/' focuses the search input", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    // Focus the modal body so the key routes through the picker (not the body).
    await page.getByTestId("picker-modal").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("picker-search")).toBeFocused();
  });

  test("'z' and 'd' open the zone / duration filters", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId?.("picker-modal");
    await page.getByTestId("picker-modal").click();

    await page.keyboard.press("z");
    await expect(page.getByTestId("picker-zone-filter")).toBeFocused();

    // Re-focus the modal body before 'd' so the key routes through the picker
    // keymap rather than being swallowed by the focused <select>'s typeahead.
    await page.getByTestId("picker-modal").click();
    await page.keyboard.press("d");
    await expect(page.getByTestId("picker-duration-filter")).toBeFocused();
  });

  test("'j' / 'k' move the expanded selection", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId("picker-modal").click();

    const expandedTitle = async () => {
      const row = page.locator("#pickerWorkoutTbody tr.picker-expanded-row");
      if ((await row.count()) === 0) return null;
      return row.getAttribute("data-title");
    };

    await page.keyboard.press("j");
    await page.waitForTimeout(30);
    const first = await expandedTitle();
    expect(first).not.toBeNull();

    await page.keyboard.press("j");
    await page.waitForTimeout(30);
    const second = await expandedTitle();
    expect(second).not.toBe(first);

    await page.keyboard.press("k");
    await page.waitForTimeout(30);
    const back = await expandedTitle();
    expect(back).toBe(first);
  });

  test("'e' opens the builder for the expanded row", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId("picker-modal").click();

    await page.keyboard.press("j"); // expand a row
    await page.waitForTimeout(30);
    const title = await page
      .locator("#pickerWorkoutTbody tr.picker-expanded-row")
      .getAttribute("data-title");

    await page.keyboard.press("e");
    await page.waitForTimeout(60);
    // Builder chrome shows: Save + Back buttons + the row title.
    await expect(page.getByTestId("builder-save")).toBeVisible();
    await expect(page.getByTestId("builder-back")).toBeVisible();
    await expect(page.getByTestId("picker-title")).toHaveText(title ?? "");
  });
});

test.describe("Picker (new Svelte app) — filter/sort persistence", () => {
  test("filters + sort restore on reopen", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Set a search term, a zone filter, and a name sort.
    await page.getByTestId("picker-search").fill("z");
    await page.getByTestId("picker-zone-filter").selectOption("Endurance");
    await page.locator('th[data-sort-key="name"]').click();
    await page.waitForTimeout(50);

    // Close + reopen.
    await page.getByTestId("picker-close").click();
    await expect(page.locator("#workoutPickerOverlay")).toHaveCount(0);
    await openPicker(page);

    await expect(page.getByTestId("picker-search")).toHaveValue("z");
    await expect(page.getByTestId("picker-zone-filter")).toHaveValue("Endurance");
    // First click on the name header sorts it descending (default per key).
    await expect(page.locator('th[data-sort-key="name"]')).toHaveClass(/sorted-desc/);
  });
});

test.describe("Picker (new Svelte app) — saveWorkout trash-then-write", () => {
  test("overwriting a clone trashes the old file before writing", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const firstRow = rows(page).first();
    const title = (await firstRow.locator("td:first-child").innerText()).trim();
    const copyFile = encodeURIComponent(`${title} Copy`) + ".zwo";

    // Clone once (creates "X Copy").
    await firstRow.click();
    await page.getByTestId("picker-clone").click();
    await page.waitForTimeout(50);

    const trashBefore = await page.evaluate(() => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {trash: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.trash._files.size;
    });

    // Edit the clone and Save WITHOUT renaming → same file name → must trash the
    // existing copy before writing (no silent overwrite).
    await page.locator(`#pickerWorkoutTbody td:first-child`, {hasText: `${title} Copy`}).first().click();
    await page.getByTestId("picker-edit").click();
    await page.waitForTimeout(60);
    await page.getByTestId("builder-save").click();
    await page.waitForTimeout(60);

    const after = await page.evaluate((file) => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {trash: {_files: Map<string, unknown>}; workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      const trashKeys = Array.from(fs.trash._files.keys());
      return {
        trashCount: fs.trash._files.size,
        stillInWorkouts: fs.workouts._files.has(file),
        movedToTrash: trashKeys.some((k) => k.startsWith(file.slice(0, -4))),
      };
    }, copyFile);

    expect(after.trashCount).toBe(trashBefore + 1);
    expect(after.stillInWorkouts).toBe(true); // re-written
    expect(after.movedToTrash).toBe(true);
  });
});

test.describe("Picker (new Svelte app) — builder unsaved-changes guard", () => {
  test("Back while dirty shows the discard dialog", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Enter the builder from scratch.
    await page.getByTestId("picker-add-workout").click();
    await page.waitForTimeout(60);
    await expect(page.getByTestId("builder-back")).toBeVisible();

    // Make a change: tweak the name field so the builder is dirty.
    const nameInput = page.locator('[data-testid="wb-name"]');
    await nameInput.click();
    await nameInput.fill("Dirty Draft");
    await page.waitForTimeout(60);

    // Back → discard-confirm dialog appears.
    await page.getByTestId("builder-back").click();
    await expect(page.getByTestId("dialog-message")).toContainText("Discard unsaved changes?");

    // Cancel → stay in the builder.
    await page.getByTestId("dialog-cancel").click();
    await page.waitForTimeout(30);
    await expect(page.getByTestId("builder-back")).toBeVisible();

    // Back again → Discard → returns to the library.
    await page.getByTestId("builder-back").click();
    await page.getByTestId("dialog-ok").click();
    await page.waitForTimeout(50);
    await expect(page.getByTestId("picker-title")).toHaveText("Workout library");
  });
});

test.describe("Picker (new Svelte app) — import", () => {
  test("uploading a .zwo file loads it into the builder", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Enter the builder so the Upload control is live.
    await page.getByTestId("picker-add-workout").click();
    await page.waitForTimeout(60);

    const zwo = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<workout_file>",
      "  <author>VeloDrive</author>",
      "  <name>Uploaded Spin</name>",
      "  <description><![CDATA[A short uploaded spin.]]></description>",
      "  <sportType>bike</sportType>",
      "  <workout>",
      '    <Warmup Duration="300" PowerLow="0.50" PowerHigh="0.70" />',
      '    <SteadyState Duration="600" Power="0.65" />',
      '    <Cooldown Duration="300" PowerLow="0.70" PowerHigh="0.45" />',
      "  </workout>",
      "</workout_file>",
    ].join("\n");

    await page.getByTestId("builder-upload-input").setInputFiles({
      name: "Uploaded Spin.zwo",
      mimeType: "application/xml",
      buffer: Buffer.from(zwo, "utf8"),
    });
    await page.waitForTimeout(80);

    // Builder title reflects the uploaded workout.
    await expect(page.getByTestId("picker-title")).toHaveText("Uploaded Spin");

    // Save it into the library, then confirm it appears as a row.
    await page.getByTestId("builder-save").click();
    await page.waitForTimeout(80);

    const inLibrary = await page.evaluate(() => {
      const fs = (window as unknown as {__VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>}}}})
        .__VELO_HARNESS__.fs;
      return fs.workouts._files.has(encodeURIComponent("Uploaded Spin") + ".zwo");
    });
    expect(inLibrary).toBe(true);

    await expect(
      page.locator("#pickerWorkoutTbody td:first-child", {hasText: "Uploaded Spin"}).first(),
    ).toBeVisible();
  });

  test("the Import TrainerDay button opens a URL prompt", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId("picker-add-workout").click();
    await page.waitForTimeout(60);

    // The button is wired: clicking it opens the URL prompt dialog. (The actual
    // TrainerDay fetch cannot be made deterministic in the e2e harness — see the
    // core/scrapers Vitest unit test for the parser coverage.)
    await page.getByTestId("builder-trainerday").click();
    await expect(page.getByTestId("dialog-input")).toBeVisible();
    await page.getByTestId("dialog-cancel").click();
  });
});
