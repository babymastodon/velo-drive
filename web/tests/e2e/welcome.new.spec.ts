// New (Svelte) app Welcome tour: REAL visual diff vs the legacy baseline +
// behavior. Pixelmatches the new render against web/visual-report/welcome/
// legacy.png (written by welcome.legacy.spec, runs first via project deps) and
// ASSERTS diffRatio < threshold. The new app does NOT show welcome on boot, so
// the harness opens it for the test via __VELO_APP__.ui.openWelcome.

import {test, expect, reachNewRidingView, WELCOME_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

const MAX_DIFF_RATIO = 0.02;

async function openWelcomeAt(page: import("@playwright/test").Page, index: number) {
  await page.evaluate((i) => {
    const app = (window as unknown as {__VELO_APP__: {ui: {openWelcome: (m: string, idx: number) => void}}}).__VELO_APP__;
    app.ui.openWelcome("full", i);
  }, index);
  await expect(page.locator("#welcomeOverlay")).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
  await page.waitForTimeout(150);
}

test.describe("Welcome (new Svelte app) — visual", () => {
  test.use({harnessConfig: WELCOME_HARNESS_CONFIG});

  test("visually matches the legacy Welcome baseline (trainers slide)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openWelcomeAt(page, 1);

    await expect(page.getByTestId("welcome-overlay")).toBeVisible();
    await expect(page.getByTestId("welcome-title")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );

    const baseline = readBaseline("welcome", "legacy.png");
    expect(baseline, "legacy Welcome baseline must exist (welcome.legacy.spec runs first)").not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("welcome", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy Welcome must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new Welcome differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/welcome/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});

test.describe("Welcome (new Svelte app) — behavior", () => {
  test("next/prev navigate slides; close + Escape dismiss", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openWelcomeAt(page, 0);

    // Slide 0 is the splash; the prev arrow is hidden via the legacy
    // `.welcome-nav-hidden` class (opacity:0 + pointer-events:none) rather than
    // an inline visibility:hidden (functional-equivalent, matches legacy CSS).
    await expect(page.getByTestId("welcome-title")).toHaveText("Welcome to VeloDrive");
    await expect(page.getByTestId("welcome-prev")).toHaveClass(/welcome-nav-hidden/);
    await expect(page.getByTestId("welcome-prev")).toHaveCSS("opacity", "0");

    // Next -> trainers.
    await page.getByTestId("welcome-next").click({force: true});
    await expect(page.getByTestId("welcome-title")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );
    await expect(page.getByTestId("welcome-prev")).not.toHaveClass(/welcome-nav-hidden/);
    await expect(page.getByTestId("welcome-prev")).toHaveCSS("opacity", "1");

    // Prev -> back to splash.
    await page.getByTestId("welcome-prev").click({force: true});
    await expect(page.getByTestId("welcome-title")).toHaveText("Welcome to VeloDrive");

    // Close button dismisses the overlay (and reveals the HUD). The welcome
    // <main> can overlay the hit-point, so invoke the button's click handler
    // directly to assert the close wiring.
    await page.getByTestId("welcome-close").dispatchEvent("click");
    await expect(page.locator("#welcomeOverlay")).toHaveCount(0);
    await expect(page.locator("#stat-power")).toBeVisible();

    // Re-open + Escape dismisses.
    await openWelcomeAt(page, 1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#welcomeOverlay")).toHaveCount(0);
  });

  test("ArrowRight advances the slide; Escape closes (keyboard nav)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    // Open on the trainers slide (index 1, a non-splash slide so nav is live).
    await openWelcomeAt(page, 1);
    await expect(page.getByTestId("welcome-title")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );

    // ArrowRight -> next slide (offline).
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("welcome-title")).toHaveText("Local data. Offline workouts.");

    // ArrowLeft -> back to trainers.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("welcome-title")).toHaveText(
      "Ride structured workouts on your smart trainer",
    );

    // Escape closes the welcome overlay.
    await page.keyboard.press("Escape");
    await expect(page.locator("#welcomeOverlay")).toHaveCount(0);
  });
});

// Bug #5: boot-time welcome gating. A fresh REAL user (no hasSeenWelcome flag)
// sees the welcome tour on boot; a configured user who has seen it does NOT.
// Mirrors legacy shouldForceFullWelcome/maybeShowWelcome (docs/workout.js).
test.describe("Welcome (new Svelte app) — boot gating", () => {
  test.use({harnessConfig: WELCOME_HARNESS_CONFIG});

  test("first-run (no hasSeenWelcome flag) shows the welcome tour on boot", async ({page, harnessConfig}) => {
    await page.addInitScript((c) => {
      (window as unknown as {__VELO_HARNESS_CONFIG__: unknown}).__VELO_HARNESS_CONFIG__ = c;
    }, harnessConfig);
    await page.addInitScript({path: new URL("../../harness/page-env.js", import.meta.url).pathname});
    // Do NOT seed hasSeenWelcome → fresh user. (Configured, web/not-PWA → full tour.)
    await page.goto("/");
    await page.waitForFunction(() => !!(window as unknown as {__VELO_HARNESS__?: unknown}).__VELO_HARNESS__);
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__.settle();
    });
    // Welcome shows on boot for a fresh user.
    await expect(page.locator("#welcomeOverlay")).toBeVisible();
    await expect(page.getByTestId("welcome-title")).toHaveText("Welcome to VeloDrive");

    // And the flag is persisted so a reload does NOT re-show it.
    const seen = await page.evaluate(() => {
      const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, {value?: unknown}>}})
        .__VELO_HARNESS__.settingsStore;
      return store.get("hasSeenWelcome")?.value;
    });
    expect(seen).toBe(true);
  });

  test("a configured user who has seen welcome does NOT see it on boot", async ({page, harnessConfig}) => {
    await page.addInitScript((c) => {
      (window as unknown as {__VELO_HARNESS_CONFIG__: unknown}).__VELO_HARNESS_CONFIG__ = c;
    }, harnessConfig);
    await page.addInitScript({path: new URL("../../harness/page-env.js", import.meta.url).pathname});
    // Seed the "welcome seen" flag → matches the configured hermetic state.
    await page.addInitScript(() => {
      const store = (window as unknown as {__VELO_HARNESS__?: {settingsStore?: Map<string, unknown>}})
        .__VELO_HARNESS__?.settingsStore;
      store?.set("hasSeenWelcome", {key: "hasSeenWelcome", value: true});
    });
    await page.goto("/");
    await reachNewRidingView(page);
    // No welcome on boot; the HUD is shown directly.
    await expect(page.locator("#welcomeOverlay")).toHaveCount(0);
    await expect(page.locator("#stat-power")).toBeVisible();
  });
});
