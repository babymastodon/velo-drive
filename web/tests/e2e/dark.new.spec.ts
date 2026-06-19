// New (Svelte) app rendered in FORCED DARK mode: REAL visual diffs vs the legacy
// dark baselines (written by dark.legacy.spec, which runs first via project
// deps). Each test pixelmatches the new dark render against
// web/visual-report/<name>-dark/legacy.png and ASSERTS diffRatio < threshold.
// These catch theme-only rendering bugs the light-only specs miss: chart stale
// colors on theme switch, modal elevation, select carets, builder block
// selection band, and welcome/empty-state shadows.

import {
  test,
  expect,
  reachNewRidingView,
  VISUAL_HARNESS_CONFIG_DARK,
  PICKER_HARNESS_CONFIG_DARK,
  SETTINGS_HARNESS_CONFIG_DARK,
  PLANNER_HARNESS_CONFIG_DARK,
  type HarnessConfig,
} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";
import type {Page} from "@playwright/test";

const MAX_DIFF_RATIO = 0.02;
// The calendar's per-day chip AA renders ~marginally over the strict budget in
// both light + dark; matched to the existing planner light allowance.
const MAX_DIFF_RATIO_PLANNER = 0.022;

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

function diff(name: string, shot: Buffer, max = MAX_DIFF_RATIO): void {
  const baseline = readBaseline(name, "legacy.png");
  expect(baseline, `legacy ${name} baseline must exist (dark.legacy.spec runs first)`).not.toBeNull();
  const result = compareImages(shot, baseline!);
  writeVisualReport(name, baseline!, shot, result.diffPng, {
    diffRatio: result.diffRatio,
    diffPixels: result.diffPixels,
    totalPixels: result.totalPixels,
    sizeMismatch: result.sizeMismatch,
    maxAllowed: max,
    width: result.width,
    height: result.height,
  });
  expect(result.sizeMismatch, `new + legacy ${name} must be the same size`).toBe(false);
  expect(
    result.diffRatio,
    `new ${name} differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/${name}/diff.png)`,
  ).toBeLessThan(max);
}

const HUD_EMPTY_DARK: HarnessConfig = {
  ...VISUAL_HARNESS_CONFIG_DARK,
  selectedWorkout: undefined,
  connectBike: false,
};

test.describe("Dark-mode new — hud", () => {
  test.use({harnessConfig: HUD_EMPTY_DARK});

  test("HUD chart empty-state (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await expect(page.locator("#chartEmptyOverlay")).toBeVisible();
    await expect(page.locator("#chartEmptyMessage")).toHaveText("Select a workout");
    await settle(page);
    diff("hud-dark", await page.screenshot({fullPage: false}));
  });
});

test.describe("Dark-mode new — picker", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG_DARK});

  test("picker library (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await settle(page);
    diff("picker-dark", await page.screenshot({fullPage: false}));
  });

  test("picker filters active — caret (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await page.getByTestId("picker-zone-filter").selectOption("VO2Max");
    await page.getByTestId("picker-duration-filter").selectOption("31-45");
    await settle(page);
    await page.waitForTimeout(60);
    diff("picker-caret-dark", await page.screenshot({fullPage: false}));
  });
});

test.describe("Dark-mode new — builder", () => {
  test.use({harnessConfig: PICKER_HARNESS_CONFIG_DARK});

  test("builder (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await page.getByTestId("picker-add-workout").click();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await expect(page.locator('[data-testid="wb-chart"] svg').first()).toBeVisible();
    await settle(page);
    await page.waitForTimeout(150);
    diff("builder-dark", await page.screenshot({fullPage: false}));
  });

  // Interaction-state + click-redraw: select a block, which both renders the
  // selection band AND triggers a chart redraw. A stale/flashing redraw (bug #3)
  // or a wrong selection band (bug #4) shows up as a dark diff.
  test("builder block selected (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await page.getByTestId("picker-add-workout").click();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await page.waitForTimeout(150);
    const seg = page.locator('[data-testid="wb-chart"] svg polygon.chart-segment').first();
    await expect(seg).toBeVisible();
    await seg.click({force: true});
    // Move the pointer off the chart so the hover tooltip/segment-highlight does
    // not pollute the selection-band snapshot.
    await page.mouse.move(2, 2);
    await settle(page);
    await page.waitForTimeout(150);
    diff("builder-selected-dark", await page.screenshot({fullPage: false}));
  });
});

// Theme-SWITCH: boot LIGHT, then toggle to Dark via Settings. The charts must
// REDRAW on the theme change (legacy does this via a MutationObserver on <html>
// -> rerenderThemeSensitive). If the new app does NOT redraw, the chart keeps
// its stale LIGHT-palette colors on the now-dark page (the flashing / stale-
// color / wrong-selection bugs), which shows as a large diff vs the legacy
// (correctly redrawn) dark baseline.
async function switchToDarkViaSettings(page: Page): Promise<void> {
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsModal")).toBeVisible();
  await page.getByTestId("theme-dark").click();
  await settle(page);
  await page.locator("#settingsCloseBtn").click();
  await page.waitForTimeout(120);
}

// Flip the theme the way applyThemeMode does (when Settings is covered by an
// overlay). The new app's theme observer must catch this + redraw open charts.
async function switchThemeOnRoot(page: Page, mode: "dark" | "light"): Promise<void> {
  await page.evaluate((m) => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(m === "dark" ? "theme-dark" : "theme-light");
    root.dataset.theme = m;
  }, mode);
  await settle(page);
}

// Start the seeded workout + ride a few deterministic ticks so the HUD chart is
// FULLY VISIBLE with live power/HR/cadence traces (no empty overlay).
async function startAndRide(page: Page): Promise<void> {
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
  await settle(page);
}

test.describe("Dark-mode new — theme switch", () => {
  test("HUD chart redraws on switch to dark", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await startAndRide(page);
    await switchThemeOnRoot(page, "dark");
    await page.waitForTimeout(120);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    diff("hud-switch-dark", await page.screenshot({fullPage: false}));
  });

  test("builder chart redraws on switch to dark", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await page.getByTestId("picker-add-workout").click();
    await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
    await page.waitForTimeout(150);
    await switchThemeOnRoot(page, "dark");
    await page.waitForTimeout(200);
    diff("builder-switch-dark", await page.screenshot({fullPage: false}));
  });
});

test.describe("Dark-mode new — settings", () => {
  test.use({harnessConfig: SETTINGS_HARNESS_CONFIG_DARK});

  test("settings (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.locator("#settingsBtn").click();
    await expect(page.locator("#settingsModal")).toBeVisible();
    await settle(page);
    diff("settings-dark", await page.screenshot({fullPage: false}));
  });
});

test.describe("Dark-mode new — planner", () => {
  test.use({harnessConfig: PLANNER_HARNESS_CONFIG_DARK});

  test("planner calendar (dark) matches legacy", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.locator("#calendarBtn").click();
    await expect(page.locator("#workoutPickerOverlay")).toBeVisible();
    await expect(page.locator("#plannerCalendarBody")).toBeVisible();
    await settle(page);
    await page.waitForTimeout(150);
    diff("planner-dark", await page.screenshot({fullPage: false}), MAX_DIFF_RATIO_PLANNER);
  });
});
