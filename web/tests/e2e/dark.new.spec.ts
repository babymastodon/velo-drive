// Theme-SWITCH behavior: boot LIGHT, then flip to Dark and assert the charts
// REDRAW on the theme change (via a MutationObserver on <html> that re-renders
// theme-sensitive charts). If the app does NOT redraw, the chart keeps its stale
// LIGHT-palette colors on the now-dark page.

import {
  test,
  expect,
  reachNewRidingView,
} from "./fixtures.js";
import type {Page} from "@playwright/test";

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
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
  });
});
