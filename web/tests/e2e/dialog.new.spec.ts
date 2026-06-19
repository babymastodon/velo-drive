// Themed dialog keyboard behavior (events-audit D3 + the dialog-over-overlay
// Escape leak). Legacy native confirm()/alert() are modal and cancel on Escape;
// the themed dialog must do the same and must NOT leak Escape to the overlay
// behind it.
import {test, expect} from "./fixtures.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe("Themed dialog keyboard", () => {
  test("confirm: Escape cancels (resolves false) and hides the dialog", async ({configuredPage}) => {
    const page = configuredPage;
    const result = page.evaluate(
      () => (window as any).__VELO_APP__.dialogs.confirm("Stop the ride?", {title: "Confirm"}),
    );
    await expect(page.getByTestId("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await result).toBe(false);
    await expect(page.getByTestId("dialog")).toBeHidden();
  });

  test("confirm: Enter accepts (resolves true)", async ({configuredPage}) => {
    const page = configuredPage;
    const result = page.evaluate(
      () => (window as any).__VELO_APP__.dialogs.confirm("OK?", {title: "Confirm"}),
    );
    await expect(page.getByTestId("dialog")).toBeVisible();
    await page.keyboard.press("Enter");
    expect(await result).toBe(true);
  });

  test("Escape on a dialog over an open overlay closes ONLY the dialog, not the overlay behind", async ({configuredPage}) => {
    const page = configuredPage;
    await page.locator("#settingsBtn").click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__VELO_APP__.ui.activeOverlay))
      .toBe("settings");

    const result = page.evaluate(
      () => (window as any).__VELO_APP__.dialogs.confirm("X", {title: "Y"}),
    );
    await expect(page.getByTestId("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await result).toBe(false);
    await expect(page.getByTestId("dialog")).toBeHidden();

    // The settings overlay behind the dialog must still be open (no Escape leak).
    expect(await page.evaluate(() => (window as any).__VELO_APP__.ui.activeOverlay)).toBe("settings");
  });
});
