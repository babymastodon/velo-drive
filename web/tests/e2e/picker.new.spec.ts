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
    await page.getByTestId("picker-duration-filter").selectOption("31-45");
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

  test("'j' / 'k' navigate a focused filter <select>'s options (D1)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openPicker(page);

    // Focus the zone filter via the 'z' hotkey.
    await page.getByTestId("picker-modal").click();
    await page.keyboard.press("z");
    const zone = page.getByTestId("picker-zone-filter");
    await expect(zone).toBeFocused();
    await expect(zone).toHaveValue(""); // "All zones"

    // Drive a keydown on the focused <select>. NOTE: Playwright's synthetic
    // keyboard.press() to a focused native <select> is swallowed by Chromium's
    // built-in select keyboard handling and never reaches the JS keydown handler
    // (on the harness Chromium `j` leaves the value unchanged). So we dispatch the
    // keydown the way a real keyboard would on the focused element.
    const pressOnSelect = (key: string) =>
      page.evaluate((k) => {
        const el = document.querySelector("#pickerZoneFilter") as HTMLSelectElement;
        el.focus();
        el.dispatchEvent(new KeyboardEvent("keydown", {key: k, bubbles: true, cancelable: true}));
      }, key);

    // Order: "" (All zones), Freeride, Recovery, …
    await pressOnSelect("j");
    await expect(zone).toHaveValue("Freeride");
    await pressOnSelect("j");
    await expect(zone).toHaveValue("Recovery");

    // 'k' moves back up.
    await pressOnSelect("k");
    await expect(zone).toHaveValue("Freeride");

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

// Opening the picker (or 'w') with NO VeloDrive folder configured must warn
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
    await expect(page.getByTestId("dialog-message")).toContainText("VeloDrive folder");
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
