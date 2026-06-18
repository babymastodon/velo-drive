// Captures the LEGACY Welcome tour render as the committed visual BASELINE
// (web/visual-report/welcome/legacy.png). The new-app Welcome test diffs against
// it. We render slide 2 ("trainers") — a full scene slide with title/body/nav
// shown immediately (the splash slide hides text for 1s + suppresses nav, which
// is harder to settle deterministically). Keeps real assertions that the tour is
// open on the right slide.

import {test, expect, WELCOME_HARNESS_CONFIG} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("Welcome legacy baseline", () => {
  test.use({harnessConfig: WELCOME_HARNESS_CONFIG});

  test("opens the welcome tour on the trainers slide and writes the baseline", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await page.waitForLoadState("load");
    await page.waitForFunction(() => !!(window as unknown as {__VELO_HARNESS__?: unknown}).__VELO_HARNESS__);
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });

    // The welcome overlay is force-shown (full mode) in headless. Wait for it.
    const overlay = page.locator("#welcomeOverlay");
    await expect(overlay).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.getElementById("welcomeOverlay");
      return !!el && el.classList.contains("welcome-overlay--visible");
    });

    // Advance the splash text-reveal (1s) so the first slide is settled, then go
    // to the "trainers" slide (the slide-change uses a 330ms virtual-clock
    // fallback because transitionend never fires with animations disabled).
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: {clock: {step: (ms: number) => Promise<void>}}}).__VELO_HARNESS__.clock.step(1200);
    });

    // Advance to the "trainers" slide. The welcome <main> overlays the nav, so
    // force the click; the slide-change renders the next slide after a 330ms
    // virtual-clock fallback (transitionend never fires with animations off).
    await page.locator("#welcomeNextBtn").click({force: true});
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: {clock: {step: (ms: number) => Promise<void>}}}).__VELO_HARNESS__.clock.step(800);
    });

    await expect(page.locator("#welcomeTitle")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );

    // The trainers scene loads its SVG asynchronously (a REAL fetch); only after
    // it resolves does the app schedule the steady-state timer on the VIRTUAL
    // clock. So: poll in REAL time, advancing the virtual clock each tick, until
    // the scene reaches steady (pieces become opacity:1).
    await expect
      .poll(
        async () => {
          await page.evaluate(async () => {
            await (window as unknown as {__VELO_HARNESS__: {clock: {step: (ms: number) => Promise<void>}}}).__VELO_HARNESS__.clock.step(3000);
          });
          return page.evaluate(() => {
            const root = document.querySelector("#welcomeScene .welcome-scene-root");
            return !!root && root.classList.contains("welcome-scene--steady");
          });
        },
        {timeout: 15_000, intervals: [200, 200, 300, 500, 800]},
      )
      .toBe(true);

    // Settle the scene asset load + any pending timers.
    await page.evaluate(async () => {
      const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
      await h.settle();
    });
    await page.waitForTimeout(200);

    const shot = await page.screenshot({fullPage: false});
    writeBaseline("welcome", "legacy.png", shot);
  });
});
