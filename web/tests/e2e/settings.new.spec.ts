// Settings behavior.

import {test, expect, reachNewRidingView} from "./fixtures.js";

async function openSettings(page: import("@playwright/test").Page) {
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsOverlay")).toBeVisible();
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

test.describe("Settings — behavior", () => {
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

    // --- Sound volume slider: 0 mutes (soundEnabled=false + soundVolume=0),
    //     a positive level re-enables. Persists both. ---
    const readSound = () =>
      page.evaluate(async () => {
        const store = (window as unknown as {__VELO_HARNESS__: {settingsStore: Map<string, unknown>}})
          .__VELO_HARNESS__.settingsStore;
        const en = store.get("soundEnabled") as {value?: boolean} | undefined;
        const vol = store.get("soundVolume") as {value?: number} | undefined;
        return {enabled: en?.value, volume: vol?.value};
      });
    const volume = page.getByTestId("sound-volume");
    await volume.fill("0");
    const muted = await readSound();
    expect(muted.enabled).toBe(false);
    expect(muted.volume).toBe(0);

    // 70% maps to the reference gain 1.0 (today's loudness).
    await volume.fill("70");
    const ref = await readSound();
    expect(ref.enabled).toBe(true);
    expect(ref.volume).toBeCloseTo(1.0);
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
