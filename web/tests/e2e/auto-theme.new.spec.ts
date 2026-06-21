// OS-FLIP BEHAVIOR in AUTO theme mode: boot auto, flip the OS via
// page.emulateMedia, and assert the resolved palette (--bg /
// --chart-empty-shadow / --ftp-line) flips AND a chart redraws (the themeVersion
// path) so charts never keep a stale palette.

import {
  test,
  expect,
  reachNewRidingView,
  SAMPLE_WORKOUT,
} from "./fixtures.js";
import type {Page} from "@playwright/test";

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

// =====================================================================================
// OS-FLIP BEHAVIOR: boot auto, flip the OS, assert the resolved palette follows
// AND a chart redraws (the themeVersion path).
//
// The chart bakes CSS-var colors (e.g. --ftp-line) into SVG paint attributes at
// DRAW time, so an OS flip must (a) re-resolve the active palette (computed --bg
// / --chart-empty-shadow flip) and (b) trigger a redraw so the chart picks up the
// new palette (a redraw of theme-sensitive charts via the matchMedia listener).
// A stuck palette or a non-redrawing chart is the bug class this guards.
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

  // PART 1 — the resolved palette follows the OS. In auto mode the resolved
  // palette (--bg / --chart-empty-shadow / --ftp-line) MUST follow the OS
  // prefers-color-scheme: the JS resolves auto->light/dark and sets the .theme-*
  // class on the OS change. If the palette ever got stuck (e.g. the class is set
  // once at boot and never updated on the OS flip), the dark assertions below
  // would FAIL.
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
