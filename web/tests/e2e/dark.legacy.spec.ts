// Captures the LEGACY app rendered in FORCED DARK mode (:root.theme-dark) as the
// committed visual BASELINES that the dark.new.spec diffs against. Dark-mode
// rendering bugs (stale chart colors on theme switch, modal elevation, select
// carets, welcome SVGs) are invisible to the light-only specs, so these capture
// the oracle's dark render for: HUD chart empty-state ("Connect your bike" /
// "Select a workout"), picker (library), picker with the zone/duration dropdown
// carets, builder, builder with a block SELECTED, settings, and planner.

import {
  test,
  expect,
  reachRidingView,
  VISUAL_HARNESS_CONFIG_DARK,
  PICKER_HARNESS_CONFIG_DARK,
  SETTINGS_HARNESS_CONFIG_DARK,
  PLANNER_HARNESS_CONFIG_DARK,
  type HarnessConfig,
} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

// Empty-state config: no bike + no selected workout -> the chart shows the
// "Select a workout" empty overlay (bug #1: the empty-state font shadow in dark).
const HUD_EMPTY_DARK: HarnessConfig = {
  ...VISUAL_HARNESS_CONFIG_DARK,
  selectedWorkout: undefined,
  connectBike: false,
};

test.describe("Dark-mode legacy baselines — hud", () => {
  test.use({harnessConfig: HUD_EMPTY_DARK});

  test("HUD chart empty-state (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await expect(page.locator("#chartEmptyOverlay")).toBeVisible();
    await expect(page.locator("#chartEmptyMessage")).toHaveText("Select a workout");
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("hud-dark", "legacy.png", shot);
  });
});

test.describe("Dark-mode legacy baselines — picker", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG_DARK});

  test("picker library (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#workoutNameLabel").click();
    await expect(page.locator("#workoutPickerModal")).toBeVisible();
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("picker-dark", "legacy.png", shot);
  });

  // Interaction-state: the zone/duration dropdowns set to a value so the
  // .picker-filter-active caret + active styling render (bug #2: carets).
  test("picker filters active — caret (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#workoutNameLabel").click();
    await expect(page.locator("#workoutPickerModal")).toBeVisible();
    await page.locator("#pickerZoneFilter").selectOption("VO2Max");
    await page.locator("#pickerDurationFilter").selectOption("31-45");
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(60);
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("picker-caret-dark", "legacy.png", shot);
  });
});

test.describe("Dark-mode legacy baselines — builder", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG_DARK});

  test("builder (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#workoutNameLabel").click();
    await page.locator("#pickerAddWorkoutBtn").click();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await expect(page.locator("#workoutBuilderRoot .wb-chart-mini-host svg").first()).toBeVisible();
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(150);
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("builder-dark", "legacy.png", shot);
  });

  // Interaction-state: select the first block so the selection band renders
  // (bug #3 flashing on click + bug #4 selection band). Clicking a block also
  // triggers a chart redraw; a correct render matches legacy.
  test("builder block selected (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#workoutNameLabel").click();
    await page.locator("#pickerAddWorkoutBtn").click();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await page.waitForTimeout(150);
    // Click the first block segment polygon in the chart to select it.
    const seg = page.locator("#workoutBuilderRoot .wb-chart-mini-host svg polygon.chart-segment").first();
    await expect(seg).toBeVisible();
    await seg.click({force: true});
    // Move the pointer off the chart so the hover tooltip/segment-highlight does
    // not pollute the selection-band snapshot.
    await page.mouse.move(2, 2);
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(150);
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("builder-selected-dark", "legacy.png", shot);
  });
});

// Theme-SWITCH baselines: boot LIGHT, then toggle to Dark via Settings. The
// legacy app redraws all theme-sensitive charts on the <html> class mutation
// (rerenderThemeSensitive via a MutationObserver); these baselines capture the
// CORRECTLY-redrawn dark chart so dark.new can prove the new app redraws too
// (instead of leaving stale light-palette chart colors -> the flashing/stale
// bugs).
// Flip the theme exactly as applyThemeMode does (toggle <html> classes +
// data-theme). Used when the Settings button is covered by an overlay; both
// apps' theme observers react to this mutation identically.
async function switchThemeOnRoot(
  page: import("@playwright/test").Page,
  mode: "dark" | "light",
): Promise<void> {
  await page.evaluate((m) => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(m === "dark" ? "theme-dark" : "theme-light");
    root.dataset.theme = m;
  }, mode);
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

async function switchToDarkViaSettings(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsModal")).toBeVisible();
  await page.locator('#settingsThemeToggle [data-theme-mode="dark"]').click();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
  await page.locator("#settingsCloseBtn").click();
  await page.waitForTimeout(120);
}

// Start the seeded workout + ride a few deterministic ticks so the HUD chart is
// FULLY VISIBLE with live power/HR/cadence traces (no empty overlay). The trace
// colors (--power-line/--hr-line/--cad-line) are HUE-shifted between themes, so
// this is where a missing theme-redraw leaves the most visible stale colors.
async function startAndRide(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__VELO_HARNESS__.sim.setReportedPower(200);
    window.__VELO_HARNESS__.sim.setReportedCadence(90);
  });
  await page.locator("#startBtn").click();
  await page.evaluate(async () => {
    await window.__VELO_HARNESS__.clock.step(5000);
  });
  await page.evaluate(async () => {
    await window.__VELO_HARNESS__.ride(30, () => {
      window.__VELO_HARNESS__.sim.setReportedPower(200);
      window.__VELO_HARNESS__.sim.setReportedCadence(90);
    });
  });
  await page.evaluate(async () => {
    await window.__VELO_HARNESS__.settle();
  });
}

test.describe("Dark-mode legacy baselines — theme switch", () => {
  test("HUD chart after switch to dark", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await startAndRide(page);
    await switchThemeOnRoot(page, "dark");
    await page.waitForTimeout(120);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("hud-switch-dark", "legacy.png", shot);
  });

  test("builder chart after switch to dark", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#workoutNameLabel").click();
    await page.locator("#pickerAddWorkoutBtn").click();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await page.waitForTimeout(150);
    // The settings button is covered by the builder overlay, so flip the theme
    // the way the toggle does — toggle the <html> classes + data-theme. Both
    // apps' theme observers must catch this and redraw the open builder chart.
    await switchThemeOnRoot(page, "dark");
    await page.waitForTimeout(200);
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("builder-switch-dark", "legacy.png", shot);
  });
});

test.describe("Dark-mode legacy baselines — settings", () => {
  test.use({harnessConfig: SETTINGS_HARNESS_CONFIG_DARK});

  test("settings (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#settingsBtn").click();
    await expect(page.locator("#settingsModal")).toBeVisible();
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("settings-dark", "legacy.png", shot);
  });
});

test.describe("Dark-mode legacy baselines — planner", () => {
  test.use({harnessConfig: PLANNER_HARNESS_CONFIG_DARK});

  test("planner calendar (dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);
    await page.locator("#calendarBtn").click();
    await expect(page.locator("#workoutPickerOverlay")).toBeVisible();
    await expect(page.locator("#plannerCalendarBody")).toBeVisible();
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(120);
    const shot = await page.screenshot({fullPage: false});
    writeBaseline("planner-dark", "legacy.png", shot);
  });
});
