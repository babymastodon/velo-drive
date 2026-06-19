// New-app "Select a workout" (no-workout) chart empty-state, dark + light,
// diffed against the legacy baseline. Captures the previously-untested state.
import {test, expect, reachNewRidingView, NO_WORKOUT_DARK, NO_WORKOUT_LIGHT} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

const MAX = 0.02;

for (const [mode, cfg] of [
  ["dark", NO_WORKOUT_DARK],
  ["light", NO_WORKOUT_LIGHT],
] as const) {
  test.describe(`No-workout empty state (new) — ${mode}`, () => {
    test.use({harnessConfig: cfg});
    test(`matches legacy no-workout empty-state (${mode})`, async ({configuredPage}) => {
      const page = configuredPage;
      await reachNewRidingView(page);
      await expect(page.locator("#chartEmptyMessage")).toBeVisible();
      const baseline = readBaseline(`noworkout-${mode}`, "legacy.png");
      expect(baseline, "legacy baseline must exist").not.toBeNull();
      const shot = await page.screenshot();
      const result = compareImages(shot, baseline!);
      writeVisualReport(`noworkout-${mode}`, baseline!, shot, result.diffPng, {
        diffRatio: result.diffRatio,
        mode,
      });
      expect(result.sizeMismatch).toBe(false);
      expect(
        result.diffRatio,
        `no-workout ${mode} differs ${(result.diffRatio * 100).toFixed(2)}% (web/visual-report/noworkout-${mode}/diff.png)`,
      ).toBeLessThan(MAX);
    });
  });
}
