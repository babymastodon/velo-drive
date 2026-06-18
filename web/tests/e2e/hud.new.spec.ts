// New (Svelte) app HUD: behavior + REAL visual diff vs the legacy baseline.
// The visual test pixelmatches the new render against web/visual-report/hud/
// legacy.png (written by hud.legacy.spec, which runs first via project deps) and
// ASSERTS the diffRatio is under threshold — it FAILS on visual divergence and
// writes legacy/new/diff.png for review. Both apps boot the SAME hermetic config.

import {test, expect, reachNewRidingView, VISUAL_HARNESS_CONFIG} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

// Fidelity budget: the new Svelte DOM reproduces the legacy classes + the same
// re-hosted CSS, so a faithful render diffs only by sub-pixel AA. Keep this
// strict; raise only with a reviewed justification.
const MAX_DIFF_RATIO = 0.02;

test.describe("HUD (new Svelte app) — visual", () => {
  test.use({harnessConfig: VISUAL_HARNESS_CONFIG});

  test("visually matches the legacy HUD baseline", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Structural sanity (real assertions, not just "rendered").
    await expect(page.locator(".top-panel")).toBeVisible();
    await expect(page.getByTestId("stat-power")).toBeVisible();
    await expect(page.getByTestId("stat-target-power")).toBeVisible();
    await expect(page.locator("#chartSvg")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeVisible();

    const baseline = readBaseline("hud", "legacy.png");
    expect(baseline, "legacy HUD baseline must exist (hud.legacy.spec runs first)").not.toBeNull();

    const shot = await page.screenshot({fullPage: false});
    const result = compareImages(shot, baseline!);
    writeVisualReport("hud", baseline!, shot, result.diffPng, {
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      sizeMismatch: result.sizeMismatch,
      maxAllowed: MAX_DIFF_RATIO,
      width: result.width,
      height: result.height,
    });

    expect(result.sizeMismatch, "new + legacy HUD must be the same size").toBe(false);
    expect(
      result.diffRatio,
      `new HUD differs from legacy by ${(result.diffRatio * 100).toFixed(2)}% (see web/visual-report/hud/diff.png)`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });
});

test.describe("HUD (new Svelte app) — behavior", () => {
  test("runs a ride: countdown -> running, target interpolates, elapsed advances, ERG setpoints recorded", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    await page.evaluate(() => {
      window.__VELO_HARNESS__.sim.setReportedPower(200);
      window.__VELO_HARNESS__.sim.setReportedCadence(90);
    });

    await page.getByTestId("start-btn").click();
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.clock.step(5000);
    });
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.ride(10, () => {
        window.__VELO_HARNESS__.sim.setReportedPower(200);
        window.__VELO_HARNESS__.sim.setReportedCadence(90);
      });
    });
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.settle();
    });

    const elapsedText = (await page.getByTestId("stat-elapsed-time").textContent())?.trim();
    expect(elapsedText).toMatch(/^00:00:(0[5-9]|1[0-5])$/);

    const powerText = (await page.getByTestId("stat-power").textContent())?.trim();
    expect(Number(powerText)).toBeGreaterThanOrEqual(150);

    const targetText = (await page.getByTestId("stat-target-power").textContent())?.trim();
    const target = Number(targetText);
    expect(target).toBeGreaterThanOrEqual(88);
    expect(target).toBeLessThanOrEqual(100);

    const ergWrites = await page.evaluate(() =>
      window.__VELO_HARNESS__.sim.controlPointWrites.filter((w) => w.opcode === 0x05).map((w) => w.value),
    );
    expect(ergWrites.length).toBeGreaterThan(0);
    for (const v of ergWrites) {
      expect(v).toBeGreaterThanOrEqual(80);
      expect(v).toBeLessThanOrEqual(110);
    }

    await expect(page.getByTestId("pause-btn")).toHaveClass(/visible/);
    await expect(page.getByTestId("stop-btn")).toHaveClass(/visible/);
  });
});

declare global {
  interface Window {
    __VELO_HARNESS__: {
      clock: {step: (ms: number) => Promise<void>};
      sim: {
        setReportedPower: (w: number) => void;
        setReportedCadence: (r: number) => void;
        controlPointWrites: {opcode: number; param: number | null; value: number | null}[];
      };
      ride: (n: number, perTick?: (i: number) => void) => Promise<void>;
      settle: () => Promise<void>;
    };
  }
}
