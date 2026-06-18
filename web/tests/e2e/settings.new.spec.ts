// New (Svelte) app Settings: REAL visual diff vs the legacy baseline + behavior.
// The visual test pixelmatches the new Settings render against
// web/visual-report/settings/legacy.png (written by settings.legacy.spec, which
// runs first via project deps) and ASSERTS diffRatio < threshold. Both apps boot
// the SAME hermetic config so only layout/CSS can differ.

import {test, expect, reachNewRidingView, SETTINGS_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

const MAX_DIFF_RATIO = 0.02;

async function openSettings(page: import("@playwright/test").Page) {
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsOverlay")).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

test.describe("Settings (new Svelte app) — visual", () => {
  test.use({harnessConfig: SETTINGS_HARNESS_CONFIG});

  test("visually matches the legacy Settings baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openSettings(page);

    // Structural sanity (real assertions, not just "rendered").
    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await expect(page.getByTestId("settings-title")).toHaveText("Settings");
    await expect(page.getByTestId("ftp-input")).toHaveValue("250");
    await expect(page.getByTestId("theme-light")).toHaveClass(/active/);

    const baseline = readBaseline("settings", "legacy.png");
    expect(baseline, "legacy Settings baseline must exist (settings.legacy.spec runs first)").not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("settings", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy Settings must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new Settings differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/settings/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});

test.describe("Settings (new Svelte app) — behavior", () => {
  test("FTP +10 persists, theme toggles to dark, sound toggles", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openSettings(page);

    // --- FTP +10 (250 -> 260): displayed value + persisted in the store ---
    await page.getByTestId("ftp-plus").click();
    await expect(page.getByTestId("ftp-input")).toHaveValue("260");
    const persistedFtp = await page.evaluate(async () => {
      const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, unknown>}})
        .__VELO_HARNESS__.settingsStore;
      const rec = store.get("ftp") as {value?: number} | undefined;
      return rec?.value;
    });
    expect(persistedFtp).toBe(260);

    // --- Theme -> dark: <html> classes + data-theme + persisted ---
    await page.getByTestId("theme-dark").click();
    await expect(page.getByTestId("theme-dark")).toHaveClass(/active/);
    const html = page.locator("html");
    await expect(html).toHaveClass(/theme-dark/);
    await expect(html).toHaveAttribute("data-theme", "dark");
    const persistedTheme = await page.evaluate(async () => {
      const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, unknown>}})
        .__VELO_HARNESS__.settingsStore;
      const rec = store.get("themeMode") as {value?: string} | undefined;
      return rec?.value;
    });
    expect(persistedTheme).toBe("dark");

    // --- Sound toggle: checkbox flips + persisted ---
    const sound = page.getByTestId("sound-checkbox");
    const before = await sound.isChecked();
    // The toggle slider span overlays the checkbox; click it via the label.
    await sound.click({force: true});
    expect(await sound.isChecked()).toBe(!before);
    const persistedSound = await page.evaluate(async () => {
      const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, unknown>}})
        .__VELO_HARNESS__.settingsStore;
      const rec = store.get("soundEnabled") as {value?: boolean} | undefined;
      return rec?.value;
    });
    expect(persistedSound).toBe(!before);
  });

  test("Escape closes settings; logs sub-view returns to main first", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await openSettings(page);

    // Open the logs sub-view, then Escape returns to main (not closed).
    await page.getByTestId("settings-open-logs").click();
    await expect(page.getByTestId("settings-title")).toHaveText("Connection logs");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-title")).toHaveText("Settings");
    await expect(page.getByTestId("settings-modal")).toBeVisible();

    // Escape again closes the overlay entirely.
    await page.keyboard.press("Escape");
    await expect(page.locator("#settingsOverlay")).toHaveCount(0);
  });

  test("the 's' key opens settings", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.keyboard.press("s");
    await expect(page.getByTestId("settings-modal")).toBeVisible();
  });
});
