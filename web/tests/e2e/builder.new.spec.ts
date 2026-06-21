// New (Svelte) app workout BUILDER: behavior coverage.
//
// Behavior covers the create/edit scope: insert a block (toolbar + key) changes
// the block count / chart; a stepper edit changes the value; undo reverts;
// validate blocks an invalid save (missing name); a valid Save writes a .zwo
// (asserted via the fake FS) and returns to the library.

import {test, expect, reachNewRidingView} from "./fixtures.js";
import type {Page} from "@playwright/test";

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

// Real navigator.clipboard is denied by default in headless Chromium; granting
// the clipboard permissions makes writeText/readText resolve against a real
// in-browser store so copy->paste round-trips deterministically. (The pure
// codec is unit-tested separately in tests/unit/builder-clipboard.test.ts.)
async function grantClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
}

function selectedBands(page: Page) {
  return page.locator('[data-testid="wb-chart"] svg rect.wb-block-band.is-active');
}

test.describe("Builder (new Svelte app) — clipboard + multi-select", () => {
  test("copy a block then paste duplicates it (block count + segment count grow)", async ({configuredPage}) => {
    const page = configuredPage;
    await grantClipboard(page);
    await reachNewRidingView(page);
    await openBuilder(page);

    // Select the first block (a warmup ramp).
    await chartSegments(page).first().click();
    await expect(page.getByTestId("wb-block-editor")).toBeVisible();
    const beforeSegments = await chartSegments(page).count();

    await page.keyboard.press("Control+c");
    await page.waitForTimeout(40);
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(80);

    const afterSegments = await chartSegments(page).count();
    // The warmup ramp is a single segment, so pasting a copy adds exactly 1.
    expect(afterSegments).toBe(beforeSegments + 1);

    // The clipboard payload is the ZWO XML for the copied block.
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("<workout_file>");
    expect(clip).toContain("<Warmup");
  });

  test("cut (d) removes the block and paste re-inserts it", async ({configuredPage}) => {
    const page = configuredPage;
    await grantClipboard(page);
    await reachNewRidingView(page);
    await openBuilder(page);

    const baseline = await chartSegments(page).count();

    // Select first block, cut it with `d` (cut-to-clipboard).
    await chartSegments(page).first().click();
    await expect(page.getByTestId("wb-block-editor")).toBeVisible();
    await page.keyboard.press("d");
    await page.waitForTimeout(80);
    const afterCut = await chartSegments(page).count();
    expect(afterCut).toBe(baseline - 1);

    // Paste re-inserts the cut block.
    await page.keyboard.press("p");
    await page.waitForTimeout(80);
    const afterPaste = await chartSegments(page).count();
    expect(afterPaste).toBe(baseline);
  });

  test("Shift+ArrowRight extends the selection from 1 to 2 blocks", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    // Select the first block.
    await chartSegments(page).first().click();
    await page.waitForTimeout(40);
    expect(await selectedBands(page).count()).toBe(1);

    // Shift+ArrowRight grows the selection to include the next block.
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(60);
    expect(await selectedBands(page).count()).toBe(2);
  });

  test("shift-clicking a later block range-selects between them", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    // Default workout has >= 4 blocks (warmup/steady/intervals/cooldown).
    await chartSegments(page).first().click();
    await page.waitForTimeout(40);
    expect(await selectedBands(page).count()).toBe(1);

    // Shift-click a later block's segment to extend the range. (The band rects
    // are pointer-events:none; the visible segment polygons carry the click.)
    const segs = chartSegments(page);
    const total = await segs.count();
    expect(total).toBeGreaterThanOrEqual(2);
    await segs.nth(total - 1).click({modifiers: ["Shift"], force: true});
    await page.waitForTimeout(60);
    expect(await selectedBands(page).count()).toBeGreaterThan(1);
  });

  // Escape in the builder must DESELECT the block, NOT close the picker (the
  // builder-mode handler returns early). A second Escape (no selection) goes Back
  // to the library — it still does NOT close the whole picker overlay.
  test("Escape in the builder deselects the block and keeps the builder open", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    // Select the first block.
    await chartSegments(page).first().click();
    await page.waitForTimeout(40);
    expect(await selectedBands(page).count()).toBe(1);
    await expect(page.getByTestId("wb-block-editor")).toBeVisible();

    // Escape deselects the block but the builder/picker stays open.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
    expect(await selectedBands(page).count()).toBe(0);
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toBeVisible();
    await expect(page.getByTestId("builder-save")).toBeVisible();

    // A second Escape (no selection) goes Back to the library, NOT close. The
    // picker overlay remains open; the builder chrome is gone.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toHaveCount(0);
  });

  // Global HUD hotkeys must NOT fire while the builder owns the keymap. 's' is an
  // insert shortcut (threshold) in the builder, NOT the
  // global "open Settings" hotkey — pressing it inserts a block and the Settings
  // overlay never appears.
  test("global hotkeys are suppressed while the builder is open", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);
    const before = await chartSegments(page).count();
    expect(before).toBeGreaterThan(0);

    // Select a block so focus is on the chart (not a meta input), then 's'.
    await chartSegments(page).first().click();
    await page.waitForTimeout(40);
    await page.keyboard.press("Escape"); // deselect (builder stays open)
    await page.waitForTimeout(40);

    // 's' is the builder insert-threshold key, NOT the global "open Settings"
    // hotkey: Settings must NOT open, and a block is inserted instead.
    await page.keyboard.press("s");
    await page.waitForTimeout(80);
    await expect(page.getByTestId("settings-modal")).toHaveCount(0);
    expect(await chartSegments(page).count()).toBe(before + 1);
  });

  test("Cmd/Ctrl+A moves the insertion cursor to start (no selection)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openBuilder(page);

    // Focus the builder, ensure no block is selected.
    await page.locator("#workoutBuilderRoot").click({position: {x: 5, y: 5}});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(40);

    // Cmd+A (no selection) = cursor-to-start; it must NOT select all blocks
    // (no block-editor appears, no bands become active).
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(60);
    expect(await selectedBands(page).count()).toBe(0);
    await expect(page.getByTestId("wb-block-editor")).toHaveCount(0);
  });
});
