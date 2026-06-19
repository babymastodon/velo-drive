// NEW (Svelte) app rendered in AUTO theme mode: REAL visual diffs vs the legacy
// auto-mode baselines (written by auto-theme.legacy.spec, which runs first via
// project deps). Each test pixelmatches the new auto render against
// web/visual-report/<name>-auto-<os>os/legacy.png and ASSERTS diffRatio < thresh.
//
// Why this spec exists: the pixel gate only renders FORCED themes booted from
// config (<html class="theme-*">); it NEVER exercises Auto-OS-resolution (no
// theme-* class, palette via @media) or an OS light/dark flip. The C1 theme
// collapse moves the dark vars from @media-dark onto the always-set .theme-*
// class. After the collapse, AUTO mode will set the class in JS (resolving the
// OS) instead of riding @media — the COMPUTED pixels are unchanged, so these
// diffs must stay ~0 both before and after the collapse. That byte-identity is
// the safety net proving the collapse changes nothing.
//
// Plus a BEHAVIOR test: boot auto, flip the OS via page.emulateMedia, and assert
// the resolved palette (--bg / --chart-empty-shadow) flips AND a chart redraws
// (the themeVersion path) so charts never keep a stale palette.

import {
  test,
  expect,
  reachNewRidingView,
  VISUAL_HARNESS_CONFIG,
  PICKER_HARNESS_CONFIG,
  SETTINGS_HARNESS_CONFIG,
  PLANNER_HARNESS_CONFIG,
  SAMPLE_WORKOUT,
  type HarnessConfig,
} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";
import type {Page} from "@playwright/test";

const MAX_DIFF_RATIO = 0.02;
// The calendar's per-day chip AA renders ~marginally over the strict budget in
// both light + dark; matched to the existing planner allowance.
const MAX_DIFF_RATIO_PLANNER = 0.022;

function auto(cfg: HarnessConfig): HarnessConfig {
  return {...cfg, themeMode: "auto"};
}

const HUD_EMPTY_AUTO: HarnessConfig = {
  ...auto(VISUAL_HARNESS_CONFIG),
  selectedWorkout: undefined,
  connectBike: false,
};

function suffix(os: "dark" | "light"): string {
  return os === "dark" ? "auto-darkos" : "auto-lightos";
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

function diff(name: string, shot: Buffer, max = MAX_DIFF_RATIO): void {
  const baseline = readBaseline(name, "legacy.png");
  expect(baseline, `legacy ${name} baseline must exist (auto-theme.legacy.spec runs first)`).not.toBeNull();
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

for (const os of ["dark", "light"] as const) {
  test.describe(`Auto-theme new (${os} OS) — hud`, () => {
    test.use({colorScheme: os, harnessConfig: HUD_EMPTY_AUTO});

    test(`HUD chart empty-state (auto, ${os} OS) matches legacy`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachNewRidingView(page);
      await expect(page.locator("#chartEmptyOverlay")).toBeVisible();
      await expect(page.locator("#chartEmptyMessage")).toHaveText("Select a workout");
      await settle(page);
      diff(`hud-${suffix(os)}`, await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme new (${os} OS) — picker`, () => {
    test.use({colorScheme: os, harnessConfig: auto(PICKER_HARNESS_CONFIG)});

    test(`picker library (auto, ${os} OS) matches legacy`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachNewRidingView(page);
      await page.getByTestId("workout-name-label").click();
      await expect(page.getByTestId("picker-modal")).toBeVisible();
      await settle(page);
      diff(`picker-${suffix(os)}`, await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme new (${os} OS) — builder`, () => {
    test.use({colorScheme: os, harnessConfig: auto(PICKER_HARNESS_CONFIG)});

    test(`builder (auto, ${os} OS) matches legacy`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachNewRidingView(page);
      await page.getByTestId("workout-name-label").click();
      await page.getByTestId("picker-add-workout").click();
      await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
      await expect(page.locator('[data-testid="wb-chart"] svg').first()).toBeVisible();
      await settle(page);
      await page.waitForTimeout(150);
      diff(`builder-${suffix(os)}`, await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme new (${os} OS) — settings`, () => {
    test.use({colorScheme: os, harnessConfig: auto(SETTINGS_HARNESS_CONFIG)});

    test(`settings (auto, ${os} OS) matches legacy`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachNewRidingView(page);
      await page.locator("#settingsBtn").click();
      await expect(page.locator("#settingsModal")).toBeVisible();
      await settle(page);
      diff(`settings-${suffix(os)}`, await page.screenshot({fullPage: false}));
    });
  });

  test.describe(`Auto-theme new (${os} OS) — planner`, () => {
    test.use({colorScheme: os, harnessConfig: auto(PLANNER_HARNESS_CONFIG)});

    test(`planner calendar (auto, ${os} OS) matches legacy`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachNewRidingView(page);
      await page.locator("#calendarBtn").click();
      await expect(page.locator("#workoutPickerOverlay")).toBeVisible();
      await expect(page.locator("#plannerCalendarBody")).toBeVisible();
      await settle(page);
      await page.waitForTimeout(150);
      diff(`planner-${suffix(os)}`, await page.screenshot({fullPage: false}), MAX_DIFF_RATIO_PLANNER);
    });
  });
}

// =====================================================================================
// OS-FLIP BEHAVIOR: boot auto, flip the OS, assert the resolved palette follows
// AND a chart redraws (the themeVersion path).
//
// The chart bakes CSS-var colors (e.g. --ftp-line) into SVG paint attributes at
// DRAW time, so an OS flip must (a) re-resolve the active palette (computed --bg
// / --chart-empty-shadow flip) and (b) trigger a redraw so the chart picks up the
// new palette (legacy rerenderThemeSensitive via the matchMedia listener). A
// stuck palette or a non-redrawing chart is the bug class this guards.
// =====================================================================================

async function readPalette(page: Page): Promise<{bg: string; emptyShadow: string; ftpLine: string}> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue("--bg").trim().toLowerCase(),
      emptyShadow: cs.getPropertyValue("--chart-empty-shadow").trim().toLowerCase(),
      ftpLine: cs.getPropertyValue("--ftp-line").trim().toLowerCase(),
    };
  });
}

// The drawn FTP line is a <line> baked with stroke=var(--ftp-line) at draw time.
// Proving the chart redrew with the CURRENT palette = the chart contains a <line>
// whose stroke equals the now-resolved --ftp-line (a stale chart would still
// carry the previous palette's --ftp-line). Returns whether such a line exists.
async function chartHasFtpLine(page: Page, ftpLine: string): Promise<boolean> {
  return page.evaluate((want) => {
    const svg = document.querySelector("#chartSvg");
    if (!svg) return false;
    return Array.from(svg.querySelectorAll("line")).some(
      (ln) => (ln.getAttribute("stroke") || "").trim().toLowerCase() === want,
    );
  }, ftpLine);
}

test.describe("Auto-theme new — OS flip resolves the palette to the OS; charts redraw with it", () => {
  // Boot auto + light OS + a selected workout (so the chart draws the FTP line).
  test.use({
    colorScheme: "light",
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "auto",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: true,
      connectHr: false,
    },
  });

  // PART 1 — the resolved palette follows the OS. This is the load-bearing guard
  // for the C1 collapse: in auto mode the resolved palette (--bg /
  // --chart-empty-shadow / --ftp-line) MUST follow the OS prefers-color-scheme.
  // Pre-collapse this rides @media (auto = class-less). Post-collapse it must
  // still follow (the JS must resolve auto->light/dark and set the .theme-* class
  // on the OS change). If a broken Phase 2 leaves the palette stuck (e.g. the
  // class is set once at boot and never updated on the OS flip, while the @media
  // blocks it used to rely on were deleted), the dark assertions below FAIL and
  // force the verify-or-revert.
  //
  // NOTE on emulateMedia: page.emulateMedia({colorScheme}) updates
  // matchMedia(...).matches and the resolved @media palette, but in this Chromium
  // build it does NOT dispatch the matchMedia 'change' event, so the app's
  // auto-redraw listener cannot be driven from a test (and the style propagation
  // to an in-chart redraw immediately after the flip is racy). We therefore pin
  // the palette RESOLUTION here (queried fresh, deterministic) and the redraw
  // WIRING separately in PART 2 (the same themeVersion counter the OS flip feeds).
  test("the resolved auto palette follows the OS prefers-color-scheme (dark <-> light)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await settle(page);
    await expect(page.locator('[data-testid="chart-svg"]')).toBeVisible();

    const light = await readPalette(page);
    expect(light.bg, "light OS --bg").toBe("#f4f4f4");
    expect(light.ftpLine, "light OS --ftp-line").toBe("#5f9ceb");
    expect(await chartHasFtpLine(page, light.ftpLine), "chart drawn with light FTP line").toBe(true);

    // Flip the OS to dark — the resolved palette must follow.
    await page.emulateMedia({colorScheme: "dark"});
    await settle(page);
    await page.waitForTimeout(120);

    const dark = await readPalette(page);
    expect(dark.bg, "dark OS --bg").toBe("#222222");
    expect(dark.bg, "--bg must follow the OS to dark").not.toBe(light.bg);
    expect(dark.emptyShadow, "--chart-empty-shadow must follow the OS to dark").not.toBe(light.emptyShadow);
    expect(dark.ftpLine, "dark OS --ftp-line").toBe("#5c7ea6");

    // Flip back to light — the resolved palette must follow back.
    await page.emulateMedia({colorScheme: "light"});
    await settle(page);
    await page.waitForTimeout(120);
    const backLight = await readPalette(page);
    expect(backLight.bg, "--bg must follow the OS back to light").toBe(light.bg);
    expect(backLight.emptyShadow, "--chart-empty-shadow must follow back to light").toBe(light.emptyShadow);
    expect(backLight.ftpLine, "--ftp-line must follow back to light").toBe(light.ftpLine);
  });

  // PART 2 — the themeVersion redraw WIRING. A theme change must bump the shared
  // themeVersion counter so subscribed charts redraw without an external nudge.
  // The OS-flip listener and a manual toggle feed the SAME themeStore.version
  // counter (state/theme.svelte.ts), so we drive it through the observable path
  // (a manual <html> class/data-theme mutation, which the MutationObserver
  // catches) and assert the chart auto-redraws to the new palette. This pins the
  // redraw plumbing the OS flip reuses; the OS-flip path itself can't be driven
  // in-browser (emulateMedia fires no 'change'), so this is the faithful proxy.
  test("a theme change bumps themeVersion and auto-redraws the chart (no manual nudge)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await settle(page);
    const light = await readPalette(page);
    expect(await chartHasFtpLine(page, light.ftpLine), "chart drawn light").toBe(true);

    // Toggle the <html> theme to dark exactly as applyThemeMode does. The
    // MutationObserver bumps themeVersion -> the chart $effect re-runs -> redraw.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.classList.remove("theme-light");
      root.classList.add("theme-dark");
      root.dataset.theme = "dark";
    });
    await settle(page);
    await page.waitForTimeout(120);

    const dark = await readPalette(page);
    expect(dark.ftpLine, "forced-dark --ftp-line").toBe("#5c7ea6");
    // Auto-redrew (no nudgeRedraw): the dark FTP line is present, the stale light
    // one is gone.
    expect(await chartHasFtpLine(page, dark.ftpLine), "chart auto-redrew to dark via themeVersion").toBe(true);
    expect(await chartHasFtpLine(page, light.ftpLine), "no stale light FTP line after auto-redraw").toBe(false);
  });
});
