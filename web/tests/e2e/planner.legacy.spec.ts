// Captures the LEGACY workout planner (calendar) render as the committed visual
// BASELINE (web/visual-report/planner/legacy.png) that the new-app planner test
// diffs against. Opens the planner via #calendarBtn with the FIXED-date harness
// (today = 2026-06-17), a seeded completed ride on 2026-06-15, and a scheduled
// workout on 2026-06-20, then asserts the calendar + a history card render.

import {test, expect, reachRidingView, PLANNER_HARNESS_CONFIG} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("Planner legacy baseline", () => {
  test.use({harnessConfig: PLANNER_HARNESS_CONFIG});

  test("opens the planner calendar and writes the baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachRidingView(page);

    await page.locator("#calendarBtn").click();

    const overlay = page.locator("#workoutPickerOverlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator("#plannerCalendarBody")).toBeVisible();

    // Settle async history/schedule loading + chart rAFs.
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(200);

    // The calendar rendered weeks.
    const weeks = page.locator("#plannerCalendarBody .planner-week-row");
    expect(await weeks.count()).toBeGreaterThan(4);

    // A completed-ride history card is present (seeded ride on 2026-06-15).
    const historyCard = page.locator(
      '.planner-day[data-date="2026-06-15"] .planner-workout-card:not(.planner-scheduled-card)',
    );
    await expect(historyCard.first()).toBeVisible();

    await page.waitForTimeout(120);

    const shot = await page.screenshot({fullPage: false});
    writeBaseline("planner", "legacy.png", shot);

    // Also capture the ride DETAIL view as a SECONDARY baseline (the calendar
    // diff above is the required gate; this guards the stat chips + power curve
    // + planned-vs-actual chart layout).
    await historyCard.first().click();
    await expect(page.locator("#plannerDetailView")).toBeVisible();
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(250);
    await expect(page.locator("#plannerDetailStats .wb-stat-chip").first()).toBeVisible();
    const detailShot = await page.screenshot({fullPage: false});
    writeBaseline("planner-detail", "legacy.png", detailShot);
  });
});
