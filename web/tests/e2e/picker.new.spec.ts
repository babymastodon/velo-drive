// Workout picker behavior. Boots the hermetic config (the seeded .zwo library +
// default sort).
//
// Behavior covers the library-browse + ride-selection scope: search narrows,
// zone/duration filters narrow, sort headers reorder, expand shows stats +
// chart, select sets the engine's workout + closes, delete moves a file to
// trash, clone creates an "X Copy" file. The in-picker BUILDER is deferred.

import {test, expect, reachNewRidingView, PICKER_HARNESS_CONFIG} from "./fixtures.js";
import type {Page} from "@playwright/test";

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

// The zone/duration filters are custom dropdowns (FilterDropdown): open the
// trigger, click the option with the given data-value.
async function pickFilter(page: Page, testid: string, value: string): Promise<void> {
  await page.getByTestId(testid).click();
  await page.locator(`.fd-menu [data-value="${value}"]`).click();
}
function filterLabel(page: Page, testid: string) {
  return page.getByTestId(testid).locator(".fd-label");
}

test.describe("Picker — behavior", () => {
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
    await pickFilter(page, "picker-zone-filter", "VO2Max");
    await page.waitForTimeout(50);
    const after = await rows(page).count();
    expect(after).toBeLessThan(before);
  });

  test("a duration filter narrows the list", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const before = await rows(page).count();
    await pickFilter(page, "picker-duration-filter", "31-45");
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

  test("keyboard expansion keeps the next detail row inside the scroll viewport", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const collapsedRows = rows(page);
    await expect(collapsedRows.first()).toHaveCSS("content-visibility", "auto");
    const target = collapsedRows.nth(Math.min(20, (await collapsedRows.count()) - 2));
    await target.evaluate((row) => {
      const wrapper = row.closest<HTMLElement>(".workout-picker-table-wrapper");
      if (!wrapper) throw new Error("picker scroll wrapper not found");
      wrapper.scrollTop =
        (row as HTMLElement).offsetTop -
        wrapper.clientHeight +
        (row as HTMLElement).offsetHeight +
        12;
      (row as HTMLElement).click();
    });

    const expanded = page.locator("#pickerWorkoutTbody tr.picker-expanded-row");
    await expect(expanded).toBeVisible();
    await expect(expanded).toHaveCSS("content-visibility", "visible");
    await page.keyboard.press("j");

    await expect
      .poll(() =>
        page.evaluate(() => {
          const wrapper = document.querySelector<HTMLElement>(
            ".workout-picker-table-wrapper",
          );
          const row = document.querySelector<HTMLElement>(".picker-expanded-row");
          const thead = document.querySelector<HTMLElement>(
            ".workout-picker-table thead",
          );
          if (!wrapper || !row || !thead) return false;
          const rowRect = row.getBoundingClientRect();
          const wrapRect = wrapper.getBoundingClientRect();
          const viewTop = wrapRect.top + thead.offsetHeight + 6;
          const bandHeight = wrapRect.bottom - viewTop;
          return rowRect.height > bandHeight
            ? Math.abs(rowRect.top - viewTop) <= 1
            : rowRect.top >= viewTop - 1 && rowRect.bottom <= wrapRect.bottom + 1;
        }),
      )
      .toBe(true);
  });

  test("filtering and clearing keep the relevant workout in view", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const collapsedRows = rows(page);
    const filterTitle = await collapsedRows.first().getAttribute("data-title");
    const target = collapsedRows.nth(Math.min(30, (await collapsedRows.count()) - 1));
    const targetTitle = await target.getAttribute("data-title");
    await target.click();
    await expect(page.locator("#pickerWorkoutTbody tr.picker-expanded-row")).toHaveAttribute(
      "data-title",
      targetTitle || "",
    );

    // Hide the deep selection while retaining a much shorter result list.
    await page.getByTestId("picker-search").fill(filterTitle || "");
    await expect(page.locator("#pickerWorkoutTbody tr.picker-expanded-row")).toHaveCount(0);
    await expect(rows(page).first()).toHaveAttribute("data-title", filterTitle || "");
    await expect
      .poll(() =>
        page.locator(".workout-picker-table-wrapper").evaluate((wrapper) => wrapper.scrollTop),
      )
      .toBeLessThanOrEqual(1);

    // The selected ID is preserved. When clearing restores its row much farther
    // down the list, it should be brought back inside the usable viewport.
    await page.getByRole("button", {name: "Clear search"}).click();
    await expect
      .poll(() =>
        page.evaluate((title) => {
          const wrapper = document.querySelector<HTMLElement>(
            ".workout-picker-table-wrapper",
          );
          const row = document.querySelector<HTMLElement>(
            `#pickerWorkoutTbody tr.picker-expanded-row[data-title="${CSS.escape(title)}"]`,
          );
          const thead = document.querySelector<HTMLElement>(
            ".workout-picker-table thead",
          );
          if (!wrapper || !row || !thead) return false;
          const rowRect = row.getBoundingClientRect();
          const wrapRect = wrapper.getBoundingClientRect();
          const viewTop = wrapRect.top + thead.offsetHeight + 6;
          const bandHeight = wrapRect.bottom - viewTop;
          return rowRect.height > bandHeight
            ? Math.abs(rowRect.top - viewTop) <= 1
            : rowRect.top >= viewTop - 1 && rowRect.bottom <= wrapRect.bottom + 1;
        }, targetTitle || ""),
      )
      .toBe(true);
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

test.describe("Picker — keymap", () => {
  test("'/' focuses the search input", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    // Focus the modal body so the key routes through the picker (not the body).
    await page.getByTestId("picker-modal").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("picker-search")).toBeFocused();
  });

  test("'z' and 'd' open the zone / duration filter dropdowns", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId("picker-modal").click();

    await page.keyboard.press("z");
    await expect(page.getByTestId("picker-zone-filter")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".fd-menu", {hasText: "Recovery"})).toBeVisible();

    await page.keyboard.press("d");
    await expect(page.getByTestId("picker-duration-filter")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("picker-zone-filter")).toHaveAttribute("aria-expanded", "false");
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

  test("'j' / 'k' navigate the open zone filter dropdown (D1)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Open the zone dropdown via 'z' (highlight starts on "All zones").
    await page.getByTestId("picker-modal").click();
    await page.keyboard.press("z");
    await expect(page.locator(".fd-menu")).toBeVisible();

    // Order: All zones, Freeride, Recovery, …
    await page.keyboard.press("j"); // → Freeride
    await page.keyboard.press("j"); // → Recovery
    await page.keyboard.press("Enter"); // commit Recovery
    await expect(filterLabel(page, "picker-zone-filter")).toHaveText("Recovery");

    // The new value actually re-filters the table.
    await page.waitForTimeout(30);
    expect(await rows(page).count()).toBeGreaterThan(0);
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

test.describe("Picker — filter/sort persistence", () => {
  test("filters + sort restore on reopen", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Set a search term, a zone filter, and a name sort.
    await page.getByTestId("picker-search").fill("z");
    await pickFilter(page, "picker-zone-filter", "Endurance");
    await page.locator('th[data-sort-key="name"]').click();
    await page.waitForTimeout(50);

    // Close + reopen.
    await page.getByTestId("picker-close").click();
    await expect(page.locator("#workoutPickerOverlay")).toHaveCount(0);
    await openPicker(page);

    await expect(page.getByTestId("picker-search")).toHaveValue("z");
    await expect(filterLabel(page, "picker-zone-filter")).toHaveText("Endurance");
    // First click on the name header sorts it descending (default per key).
    await expect(page.locator('th[data-sort-key="name"]')).toHaveClass(/sorted-desc/);
  });
});

test.describe("Picker — saveWorkout trash-then-write", () => {
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

test.describe("Picker — builder unsaved-changes guard", () => {
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

test.describe("Picker — import", () => {
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

  test("the Import-from-URL button opens a URL prompt", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId("picker-add-workout").click();
    await page.waitForTimeout(60);

    // Open the Import menu, then the "From a URL…" item opens the prompt dialog.
    // (The actual fetch can't be made deterministic in the e2e harness — see the
    // core/scrapers Vitest unit test for the parser coverage.)
    await page.getByTestId("builder-import").click();
    await page.getByTestId("builder-import-url").click();
    await expect(page.getByTestId("dialog-input")).toBeVisible();
    await page.getByTestId("dialog-cancel").click();
  });
});

// The .zwo write + dir-handle persistence round-trip through the (in-memory)
// FileStore. The real File-System-Access write path is exercised here via the
// fake FS; the REAL-only aspect (re-requesting read-write permission on a
// reloaded handle) is covered by the WebFileStore ensureDirPermission calls,
// which the harness fake resolves as "granted".
test.describe("Picker — save round-trip + dir persistence", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("clone writes a new .zwo to the workouts dir (FS round-trip)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    const firstRow = rows(page).first();
    const title = (await firstRow.locator("td:first-child").innerText()).trim();
    const copyFile = encodeURIComponent(`${title} Copy`) + ".zwo";

    await firstRow.click();
    await page.getByTestId("picker-clone").click();
    await page.waitForTimeout(80);

    // The cloned file exists in the workouts dir and re-parses to a valid title.
    const result = await page.evaluate(async (file) => {
      const fs = (window as unknown as {
        __VELO_HARNESS__: {fs: {workouts: {_files: Map<string, unknown>; getFileHandle: (n: string) => Promise<{getFile: () => Promise<{text: () => Promise<string>}>}>}}};
      }).__VELO_HARNESS__.fs;
      const has = fs.workouts._files.has(file);
      let text = "";
      if (has) {
        const fh = await fs.workouts.getFileHandle(file);
        text = await (await fh.getFile()).text();
      }
      return {has, text};
    }, copyFile);
    expect(result.has, `clone should write ${copyFile}`).toBe(true);
    expect(result.text).toContain("<workout_file>");
  });

  test("the root dir handle survives a reload (persisted in IndexedDB)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // The configured root handle is present in the settings store, keyed
    // rootDirHandle, and the app's loadRootDirHandle returns it.
    const persisted = await page.evaluate(async () => {
      const bridge = (window as unknown as {__VELO_APP__: {ui: unknown}}).__VELO_APP__;
      const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, {handle?: unknown}>}})
        .__VELO_HARNESS__.settingsStore;
      const rec = store.get("rootDirHandle");
      return {hasRootRecord: !!rec, hasHandle: !!rec?.handle, hasBridge: !!bridge};
    });
    expect(persisted.hasRootRecord, "rootDirHandle must be persisted in IndexedDB").toBe(true);
    expect(persisted.hasHandle, "the record carries the FileSystemDirectoryHandle").toBe(true);

    // After a real reload the picker still lists the seeded library (the handle
    // was reloaded from IndexedDB, not lost), so "no folder" never recurs.
    await page.reload();
    await reachNewRidingView(page);
    await openPicker(page);
    expect(await rows(page).count()).toBeGreaterThan(5);
  });
});

// Opening the picker (or 'w') with NO workout data folder configured must warn
// (Dialog) + open Settings — not silently do nothing
// (ensureRootDirConfiguredForWorkouts).
test.describe("Picker — no-folder guard", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("opening the picker with no folder warns and opens Settings", async ({page, harnessConfig}) => {
    // Seed harness config + env (as the configuredPage fixture does), then strip
    // the configured dir handles so the app boots UNCONFIGURED (a fresh user).
    await page.addInitScript((cfg) => {
      (window as unknown as {__VELO_HARNESS_CONFIG__: unknown}).__VELO_HARNESS_CONFIG__ = cfg;
    }, harnessConfig);
    await page.addInitScript({path: new URL("../../harness/page-env.js", import.meta.url).pathname});
    // hasSeenWelcome=true so the boot welcome gate stays out of the way; then
    // remove the root/zwo dir handles to simulate "no folder configured".
    await page.addInitScript(() => {
      const store = (window as unknown as {
        __VELO_HARNESS__?: {settingsStore?: Map<string, unknown>};
      }).__VELO_HARNESS__?.settingsStore;
      if (!store) return;
      store.set("hasSeenWelcome", {key: "hasSeenWelcome", value: true});
      store.delete("rootDirHandle");
      store.delete("dirHandle");
      store.delete("workoutDirHandle");
      store.delete("trashDirHandle");
    });
    await page.goto("/");
    await reachNewRidingView(page);

    // Boot auto-opens Settings (missing folder); close it so we drive the guard
    // ourselves via the workout-name label.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);

    await page.getByTestId("workout-name-label").click();
    // The no-folder guard fires: a warning Dialog appears, the picker does NOT.
    await expect(page.getByTestId("dialog-message")).toContainText("workout data folder");
    await expect(page.getByTestId("picker-modal")).toHaveCount(0);

    // Dismissing the warning reveals Settings (the guard opened it).
    await page.getByTestId("dialog-ok").click();
    await expect(page.getByTestId("settings-modal")).toBeVisible();
  });
});

// A reload should land back on whatever overlay was open (persisted lastOverlay).
// The hermetic harness re-seeds settings on each load, so we drive the RESTORE
// path directly: seed lastOverlay=picker + a configured folder, then boot.
test.describe("Picker — restore last overlay on boot", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG});

  test("auto-opens the workout library when it was the last overlay", async ({page, harnessConfig}) => {
    await page.addInitScript((cfg) => {
      (window as unknown as {__VELO_HARNESS_CONFIG__: unknown}).__VELO_HARNESS_CONFIG__ = cfg;
    }, harnessConfig);
    await page.addInitScript({path: new URL("../../harness/page-env.js", import.meta.url).pathname});
    await page.addInitScript(() => {
      const store = (window as unknown as {
        __VELO_HARNESS__?: {settingsStore?: Map<string, unknown>};
      }).__VELO_HARNESS__?.settingsStore;
      if (!store) return;
      store.set("hasSeenWelcome", {key: "hasSeenWelcome", value: true});
      store.set("lastOverlay", {key: "lastOverlay", value: "picker"});
    });
    await page.goto("/");

    // The picker comes up on boot without any user interaction, and lists the
    // seeded library.
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    expect(await rows(page).count()).toBeGreaterThan(5);
  });
});

// The bottom-bar quick workout selector (zone/duration drop-ups + ‹ › carets).
test.describe("Quick workout selector", () => {
  test("renders carets + zone/duration drop-ups and steps to a workout", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    await expect(page.getByTestId("quick-selector")).toBeVisible();
    await expect(page.getByTestId("quick-prev")).toBeVisible();
    await expect(page.getByTestId("quick-next")).toBeVisible();
    await expect(page.getByTestId("quick-zone")).toBeVisible();
    await expect(page.getByTestId("quick-duration")).toBeVisible();

    // The zone drop-up opens upward with the zone options + their swatches.
    await page.getByTestId("quick-zone").click();
    await expect(page.locator(".quick-menu")).toBeVisible();
    await expect(page.locator(".quick-menu .picker-zone-dot").first()).toBeVisible();
    // Clicking outside (Escape) closes it.
    await page.keyboard.press("Escape");
    await expect(page.locator(".quick-menu")).toHaveCount(0);

    // The duration drop-up opens with buckets and NO "Any duration" on the main page.
    await page.getByTestId("quick-duration").click();
    await expect(page.locator(".quick-menu")).toBeVisible();
    await expect(page.locator(".quick-item", {hasText: "Any duration"})).toHaveCount(0);
  });
});

function rankedWorkoutXml(name: string, minutes: number, power: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>VeloDrive Test</author>
  <name>${name}</name>
  <description>Quick selector ranking fixture.</description>
  <sportType>bike</sportType>
  <workout>
    <SteadyState Duration="${minutes * 60}" Power="${power.toFixed(2)}" />
  </workout>
</workout_file>`;
}

const QUICK_SELECTOR_WORKOUTS = {
  "endurance-1.zwo": rankedWorkoutXml("Endurance 1", 20, 0.60),
  "endurance-2.zwo": rankedWorkoutXml("Endurance 2", 20, 0.63),
  "endurance-3.zwo": rankedWorkoutXml("Endurance 3", 20, 0.66),
  "endurance-4.zwo": rankedWorkoutXml("Endurance 4", 20, 0.70),
  "endurance-5.zwo": rankedWorkoutXml("Endurance 5", 20, 0.74),
  "endurance-long-1.zwo": rankedWorkoutXml("Endurance Long 1", 40, 0.60),
  "endurance-long-2.zwo": rankedWorkoutXml("Endurance Long 2", 40, 0.67),
  "endurance-long-3.zwo": rankedWorkoutXml("Endurance Long 3", 40, 0.74),
  "tempo-1.zwo": rankedWorkoutXml("Tempo 1", 20, 0.80),
  "tempo-2.zwo": rankedWorkoutXml("Tempo 2", 20, 0.82),
  "tempo-3.zwo": rankedWorkoutXml("Tempo 3", 20, 0.84),
};

test.describe("Quick workout selector — combination memory", () => {
  test.use({
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "light",
      selectedWorkout: {
        workoutTitle: "Endurance 4",
        sourcePath: "endurance-4.zwo",
        rawSegments: [[20, 70, 70]],
        textEvents: [],
      },
      connectBike: false,
      connectHr: false,
      seedZwo: QUICK_SELECTOR_WORKOUTS,
    },
  });

  test("restores each combo's last workout and uses rank percentage only for a new combo", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    const loadedTitle = () =>
      page.evaluate(
        () =>
          (window as unknown as {
            __VELO_APP__: {getVm: () => {canonicalWorkout?: {workoutTitle?: string} | null} | null};
          }).__VELO_APP__.getVm()?.canonicalWorkout?.workoutTitle ?? "",
      );
    const chooseZone = async (zone: string) => {
      await page.getByTestId("quick-zone").click();
      await page.locator(".quick-menu .quick-item", {hasText: zone}).click();
    };
    const chooseDuration = async (duration: string) => {
      await page.getByTestId("quick-duration").click();
      await page.locator(".quick-menu .quick-item", {hasText: duration}).click();
    };

    await expect(page.getByTestId("quick-zone")).toContainText("Endurance");
    await expect(page.getByTestId("quick-duration")).toContainText("16–30 min");

    // Endurance 4 is 75% through its five-workout list. Tempo has never been
    // viewed, so its three-workout list should open at the same rank: Tempo 3.
    await chooseZone("Tempo");
    await expect.poll(loadedTitle).toBe("Tempo 3");

    // Make Tempo 2 the last workout shown for the Tempo/16–30 combination.
    await page.getByTestId("quick-prev").click();
    await expect.poll(loadedTitle).toBe("Tempo 2");

    // Both switches restore combo memory. A percentage fallback here would pick
    // Endurance 3 and then Tempo 3, so these assertions distinguish the paths.
    await chooseZone("Endurance");
    await expect.poll(loadedTitle).toBe("Endurance 4");
    await chooseZone("Tempo");
    await expect.poll(loadedTitle).toBe("Tempo 2");

    // Duration changes use the same rule and remember a separate workout for
    // every zone/duration pair.
    await chooseZone("Endurance");
    await chooseDuration("31–45 min");
    await expect.poll(loadedTitle).toBe("Endurance Long 3");
    await page.getByTestId("quick-prev").click();
    await expect.poll(loadedTitle).toBe("Endurance Long 2");
    await chooseDuration("16–30 min");
    await expect.poll(loadedTitle).toBe("Endurance 4");
    await chooseDuration("31–45 min");
    await expect.poll(loadedTitle).toBe("Endurance Long 2");

    await expect
      .poll(() =>
        page.evaluate(() => {
          const record = (
            window as unknown as {
              __VELO_HARNESS__: {settingsStore: Map<string, {value?: Record<string, string>}>};
            }
          ).__VELO_HARNESS__.settingsStore.get("quickComboWorkouts");
          return record?.value ?? {};
        }),
      )
      .toMatchObject({
        "Endurance|16-30": "endurance-4.zwo",
        "Endurance|31-45": "endurance-long-2.zwo",
        "Tempo|16-30": "tempo-2.zwo",
      });
  });
});

// The filter <select>s show a clear "×" (replacing the caret) when a value is set.
test.describe("Picker — filter clear", () => {
  test("selecting a zone shows a × that clears it", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    await expect(page.getByTestId("picker-zone-filter-clear")).toHaveCount(0);
    await pickFilter(page, "picker-zone-filter", "VO2Max");
    const clear = page.getByTestId("picker-zone-filter-clear");
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(filterLabel(page, "picker-zone-filter")).toHaveText("All zones");
    await expect(page.getByTestId("picker-zone-filter-clear")).toHaveCount(0);
  });
});

// Enter in the search box selects the top match and closes the picker (one press).
test.describe("Picker — Enter selects", () => {
  test("Enter in search selects the top result and closes", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);
    await page.getByTestId("picker-search").fill("recovery");
    await page.waitForTimeout(50);
    await page.getByTestId("picker-search").press("Enter");
    await expect(page.locator("#workoutPickerOverlay")).toHaveCount(0);
    expect((await page.getByTestId("workout-name-label").textContent())?.trim().length || 0).toBeGreaterThan(0);
  });
});
