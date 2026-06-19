// Captures the LEGACY app rendered in AUTO theme mode (themeMode:"auto", so NO
// forced theme-* class — the palette rides the OS @media(prefers-color-scheme))
// as the committed visual BASELINES that auto-theme.new.spec diffs against.
//
// Two OS contexts per view:
//   * Auto + dark OS  (colorScheme:"dark")  -> the dark palette via @media-dark.
//   * Auto + light OS (colorScheme:"light") -> the light palette via :root.
//
// The pixel gate (dark.* + light specs) only ever renders FORCED themes booted
// from config (<html class="theme-*">); it never exercises Auto-OS-resolution.
// These baselines pin the Auto render so the C1 theme-collapse (move the dark
// vars from @media-dark onto the always-set .theme-* class) can be proven
// byte-identical: the LEGACY app is never changed, so a stable oracle render of
// every Auto path is captured here, and auto-theme.new must keep matching it
// before AND after the collapse.

import {
  test,
  expect,
  reachRidingView,
  VISUAL_HARNESS_CONFIG,
  PICKER_HARNESS_CONFIG,
  SETTINGS_HARNESS_CONFIG,
  PLANNER_HARNESS_CONFIG,
  type HarnessConfig,
} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";
import type {Page} from "@playwright/test";

// Auto-mode variants of the matched-state configs: themeMode "auto" leaves the
// app class-less so the OS @media governs (the legacy mechanism, unchanged).
function auto(cfg: HarnessConfig): HarnessConfig {
  return {...cfg, themeMode: "auto"};
}

const HUD_EMPTY_AUTO: HarnessConfig = {
  ...auto(VISUAL_HARNESS_CONFIG),
  selectedWorkout: undefined,
  connectBike: false,
};

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

// Each OS context (dark | light) writes its own baseline suffix so a single view
// has TWO oracle renders. The describe blocks below set colorScheme per context.
function suffix(os: "dark" | "light"): string {
  return os === "dark" ? "auto-darkos" : "auto-lightos";
}

for (const os of ["dark", "light"] as const) {
  test.describe(`Auto-theme legacy baselines (${os} OS) — hud`, () => {
    test.use({colorScheme: os, harnessConfig: HUD_EMPTY_AUTO});

    test(`HUD chart empty-state (auto, ${os} OS)`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await expect(page.locator("#chartEmptyOverlay")).toBeVisible();
      // Auto mode must leave the root class-less (the @media path).
      await expect(page.locator("html")).not.toHaveClass(/theme-dark|theme-light/);
      await settle(page);
      writeBaseline(`hud-${suffix(os)}`, "legacy.png", await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme legacy baselines (${os} OS) — picker`, () => {
    test.use({colorScheme: os, harnessConfig: auto(PICKER_HARNESS_CONFIG)});

    test(`picker library (auto, ${os} OS)`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await page.locator("#workoutNameLabel").click();
      await expect(page.locator("#workoutPickerModal")).toBeVisible();
      await settle(page);
      writeBaseline(`picker-${suffix(os)}`, "legacy.png", await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme legacy baselines (${os} OS) — builder`, () => {
    test.use({colorScheme: os, harnessConfig: auto(PICKER_HARNESS_CONFIG)});

    test(`builder (auto, ${os} OS)`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await page.locator("#workoutNameLabel").click();
      await page.locator("#pickerAddWorkoutBtn").click();
      await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
      await expect(page.locator("#workoutBuilderRoot .wb-chart-mini-host svg").first()).toBeVisible();
      await settle(page);
      await page.waitForTimeout(150);
      writeBaseline(`builder-${suffix(os)}`, "legacy.png", await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme legacy baselines (${os} OS) — settings`, () => {
    test.use({colorScheme: os, harnessConfig: auto(SETTINGS_HARNESS_CONFIG)});

    test(`settings (auto, ${os} OS)`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await page.locator("#settingsBtn").click();
      await expect(page.locator("#settingsModal")).toBeVisible();
      await settle(page);
      writeBaseline(`settings-${suffix(os)}`, "legacy.png", await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme legacy baselines (${os} OS) — planner`, () => {
    test.use({colorScheme: os, harnessConfig: auto(PLANNER_HARNESS_CONFIG)});

    test(`planner calendar (auto, ${os} OS)`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await page.locator("#calendarBtn").click();
      await expect(page.locator("#workoutPickerOverlay")).toBeVisible();
      await expect(page.locator("#plannerCalendarBody")).toBeVisible();
      await settle(page);
      await page.waitForTimeout(150);
      writeBaseline(`planner-${suffix(os)}`, "legacy.png", await page.screenshot({fullPage: false}));
    });
  });
}
