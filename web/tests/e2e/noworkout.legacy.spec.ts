// Captures the "Select a workout" (no-workout) chart empty-state in DARK mode —
// a state NO prior baseline rendered (all seeded a workout), so its text-shadow
// went untested. Legacy baseline for the new-app diff.
import {test, expect, reachRidingView, NO_WORKOUT_DARK, NO_WORKOUT_LIGHT} from "./fixtures.js";
import {writeBaseline} from "../visual/compare.js";

test.describe("No-workout empty state — legacy baselines", () => {
  test.describe("dark", () => {
    test.use({harnessConfig: NO_WORKOUT_DARK});
    test("captures the no-workout chart empty-state (dark)", async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await expect(page.locator("#chartEmptyMessage")).toBeVisible();
      writeBaseline("noworkout-dark", "legacy.png", await page.screenshot());
    });
  });
  test.describe("light", () => {
    test.use({harnessConfig: NO_WORKOUT_LIGHT});
    test("captures the no-workout chart empty-state (light)", async ({configuredPage}) => {
      const page = configuredPage;
      await reachRidingView(page);
      await expect(page.locator("#chartEmptyMessage")).toBeVisible();
      writeBaseline("noworkout-light", "legacy.png", await page.screenshot());
    });
  });
});
