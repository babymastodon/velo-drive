// New (Svelte) app HUD: behavior + REAL visual diff vs the legacy baseline.
// The visual test pixelmatches the new render against web/visual-report/hud/
// legacy.png (written by hud.legacy.spec, which runs first via project deps) and
// ASSERTS the diffRatio is under threshold — it FAILS on visual divergence and
// writes legacy/new/diff.png for review. Both apps boot the SAME hermetic config.

import {test, expect, reachNewRidingView, VISUAL_HARNESS_CONFIG, type HarnessConfig} from "./fixtures.js";
import {compareImages, readBaseline, writeVisualReport} from "../visual/compare.js";

// A workout that STARTS in a free-ride (ERG) segment so the manual controls +
// e/r/j/k hotkeys are active from the first tick (seg[3] === "freeride").
const FREERIDE_WORKOUT = {
  workoutTitle: "Freeride Sample",
  rawSegments: [
    [10, 60, 60, "freeride"], // 10 min free ride
    [5, 60, 60, null, 90],
  ],
  textEvents: [],
};

const FREERIDE_CONFIG: HarnessConfig = {
  ftp: 250,
  soundEnabled: false,
  themeMode: "light",
  selectedWorkout: FREERIDE_WORKOUT,
  connectBike: true,
  connectHr: false,
};

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

  test("Space starts the ride: countdown overlay -> running", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    await page.evaluate(() => {
      window.__VELO_HARNESS__.sim.setReportedPower(200);
      window.__VELO_HARNESS__.sim.setReportedCadence(90);
    });

    // Press Space (code-based, layout independent). The countdown overlay
    // renders "3" synchronously, proving Space reached engine.startWorkout().
    await page.locator("body").press("Space");
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.settle();
    });
    await expect(page.locator("#statusOverlay")).toBeVisible();
    await expect(page.locator("#statusText")).toHaveText("3");

    // Advance past the 4s countdown into the running state.
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.clock.step(5000);
    });
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.ride(3, () => {
        window.__VELO_HARNESS__.sim.setReportedPower(200);
        window.__VELO_HARNESS__.sim.setReportedCadence(90);
      });
      await window.__VELO_HARNESS__.settle();
    });

    await expect(page.getByTestId("pause-btn")).toHaveClass(/visible/);
    const running = await page.evaluate(() => window.__VELO_APP__.getVm()?.workoutRunning);
    expect(running).toBe(true);
  });

  test("stop shows the Dialog confirm, then ends + writes a .fit", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Run a few seconds so there are live samples to save into a .fit.
    await page.evaluate(() => {
      window.__VELO_HARNESS__.sim.setReportedPower(200);
      window.__VELO_HARNESS__.sim.setReportedCadence(90);
    });
    await page.getByTestId("start-btn").click();
    await page.evaluate(async () => window.__VELO_HARNESS__.clock.step(5000));
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.ride(5, () => {
        window.__VELO_HARNESS__.sim.setReportedPower(200);
        window.__VELO_HARNESS__.sim.setReportedCadence(90);
      });
      await window.__VELO_HARNESS__.settle();
    });

    // Click stop -> the confirm dialog appears (no native confirm()).
    await page.getByTestId("stop-btn").click();
    await expect(page.getByTestId("dialog")).toBeVisible();
    await expect(page.getByTestId("dialog-message")).toHaveText("End current workout and save it?");

    // Cancel first: the workout stays running (not ended).
    await page.getByTestId("dialog-cancel").click();
    await page.evaluate(async () => window.__VELO_HARNESS__.settle());
    expect(await page.evaluate(() => window.__VELO_APP__.getVm()?.workoutRunning)).toBe(true);

    // Confirm: the workout ends and a .fit is written to the history dir.
    await page.getByTestId("stop-btn").click();
    await page.getByTestId("dialog-ok").click();
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.settle();
      await window.__VELO_HARNESS__.clock.step(0);
    });

    expect(await page.evaluate(() => window.__VELO_APP__.getVm()?.workoutRunning)).toBe(false);
    const fits = await page.evaluate(() =>
      Array.from(window.__VELO_HARNESS__.fs.history._files.keys()).filter((n) =>
        n.toLowerCase().endsWith(".fit"),
      ),
    );
    expect(fits.length).toBeGreaterThan(0);
  });

  test("cadence-out coaching text appears after the >=5s dwell", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // SAMPLE_WORKOUT warmup targets 90 RPM. Start, then report 70 RPM (20 below
    // target) for >=5s so the running title flips to "Speed up - target 90 RPM".
    await page.evaluate(() => {
      window.__VELO_HARNESS__.sim.setReportedPower(150);
      window.__VELO_HARNESS__.sim.setReportedCadence(70);
    });
    await page.getByTestId("start-btn").click();
    await page.evaluate(async () => window.__VELO_HARNESS__.clock.step(5000));
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.ride(8, () => {
        window.__VELO_HARNESS__.sim.setReportedPower(150);
        window.__VELO_HARNESS__.sim.setReportedCadence(70);
      });
      await window.__VELO_HARNESS__.settle();
    });

    await expect(page.getByTestId("workout-title-center")).toHaveText("Speed up - target 90 RPM");
  });
});

test.describe("HUD (new Svelte app) — chart hover tooltip", () => {
  test("hovering a workout segment shows #chartTooltip with zone/power/duration text", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    const svg = page.locator("#chartSvg");
    await expect(svg).toBeVisible();
    const tooltip = page.locator("#chartTooltip");

    // Idle (no hover): the tooltip must be hidden (CSS display:none).
    await expect(tooltip).toBeHidden();

    // Move the real mouse over the middle of a rendered workout segment. The
    // hover engine resolves the segment via elementFromPoint and fills the tip.
    const seg = svg.locator(".chart-segment").first();
    await expect(seg).toHaveCount(1);
    const box = await seg.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(tooltip).toBeVisible();
    const text = (await tooltip.textContent())?.trim() ?? "";
    expect(text.length).toBeGreaterThan(0);
    // Segment tooltip format: "<Zone>: <p0>% FTP, <w0>W, <dur>" (or "Free ride: …").
    expect(text).toMatch(/FTP|Free ride/);

    // Leaving the chart hides the tooltip again.
    const svgBox = await svg.boundingBox();
    await page.mouse.move(svgBox!.x + svgBox!.width / 2, svgBox!.y - 40);
    await expect(tooltip).toBeHidden();
  });

  test("hovering the live power trace during a ride shows the interpolated value", async ({
    configuredPage,
  }) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Run a few seconds at a steady 200 W so a live power trace exists.
    await page.evaluate(() => {
      window.__VELO_HARNESS__.sim.setReportedPower(200);
      window.__VELO_HARNESS__.sim.setReportedCadence(90);
    });
    await page.getByTestId("start-btn").click();
    await page.evaluate(async () => window.__VELO_HARNESS__.clock.step(5000));
    await page.evaluate(async () => {
      await window.__VELO_HARNESS__.ride(8, () => {
        window.__VELO_HARNESS__.sim.setReportedPower(200);
        window.__VELO_HARNESS__.sim.setReportedCadence(90);
      });
      await window.__VELO_HARNESS__.settle();
    });

    const svg = page.locator("#chartSvg");
    const tooltip = page.locator("#chartTooltip");
    const box = await svg.boundingBox();
    expect(box).not.toBeNull();

    // The 200 W trace sits near the elapsed cursor (far left). Sweep vertically
    // across the early-time column so the 16px line-hit band catches the trace.
    const x = box!.x + box!.width * 0.02;
    let lineText = "";
    for (let i = 0; i <= 40; i += 1) {
      const y = box!.y + (box!.height * i) / 40;
      await page.mouse.move(x, y);
      const t = (await tooltip.textContent())?.trim() ?? "";
      if (/Power|Heart Rate|Cadence/.test(t)) {
        lineText = t;
        break;
      }
    }
    expect(lineText, "live-trace hover should report Power/HR/Cadence").toMatch(
      /Power|Heart Rate|Cadence/,
    );
    await expect(tooltip).toBeVisible();
  });
});

test.describe("HUD (new Svelte app) — free-ride manual controls", () => {
  test.use({harnessConfig: FREERIDE_CONFIG});

  test("manual input commit reaches the engine (free-ride ERG config)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await startFreeride(page);

    // The manual ERG input is now visible; type a new watts value and Enter.
    const input = page.getByTestId("manual-input");
    await expect(input).toBeVisible();
    await input.fill("175");
    await input.press("Enter");
    await page.evaluate(async () => window.__VELO_HARNESS__.settle());

    const target = await page.evaluate(() => window.__VELO_APP__.getVm()?.manualErgTarget);
    expect(target).toBe(175);

    // The committed ERG value reached the trainer (a control-point ERG write).
    const ergWrites = await page.evaluate(() =>
      window.__VELO_HARNESS__.sim.controlPointWrites.filter((w) => w.opcode === 0x05).map((w) => w.value),
    );
    expect(ergWrites).toContain(175);
  });

  test("manual input clamps out-of-range watts to [50, ftp*2.5]", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await startFreeride(page);

    const input = page.getByTestId("manual-input");
    await input.fill("9999"); // ftp=250 -> max 625
    await input.press("Enter");
    await page.evaluate(async () => window.__VELO_HARNESS__.settle());
    expect(await page.evaluate(() => window.__VELO_APP__.getVm()?.manualErgTarget)).toBe(625);

    await input.fill("1"); // min 50
    await input.press("Enter");
    await page.evaluate(async () => window.__VELO_HARNESS__.settle());
    expect(await page.evaluate(() => window.__VELO_APP__.getVm()?.manualErgTarget)).toBe(50);
  });

  test("j/k adjust the manual target by -/+10", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await startFreeride(page);

    const before = await page.evaluate(() => window.__VELO_APP__.getVm()?.manualErgTarget ?? 0);
    // k = +10
    await page.locator("body").press("k");
    await page.evaluate(async () => window.__VELO_HARNESS__.settle());
    expect(await page.evaluate(() => window.__VELO_APP__.getVm()?.manualErgTarget)).toBe(before + 10);
    // j = -10
    await page.locator("body").press("j");
    await page.evaluate(async () => window.__VELO_HARNESS__.settle());
    expect(await page.evaluate(() => window.__VELO_APP__.getVm()?.manualErgTarget)).toBe(before);
  });
});

// Reach a running, free-ride (ERG) state from the FREERIDE_CONFIG so the manual
// controls + e/r/j/k hotkeys are active.
async function startFreeride(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    window.__VELO_HARNESS__.sim.setReportedPower(180);
    window.__VELO_HARNESS__.sim.setReportedCadence(85);
  });
  await page.getByTestId("start-btn").click();
  await page.evaluate(async () => window.__VELO_HARNESS__.clock.step(5000));
  await page.evaluate(async () => {
    await window.__VELO_HARNESS__.ride(2, () => {
      window.__VELO_HARNESS__.sim.setReportedPower(180);
      window.__VELO_HARNESS__.sim.setReportedCadence(85);
    });
    await window.__VELO_HARNESS__.settle();
  });
  await page.locator('[data-testid="manual-controls"]').waitFor({state: "visible"});
}

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
      fs: {history: {_files: Map<string, unknown>}};
    };
    __VELO_APP__: {
      getVm: () => {
        workoutRunning?: boolean;
        manualErgTarget?: number;
        manualResistance?: number;
        freeRideMode?: string;
        isFreeRideActive?: boolean;
      } | null;
    };
  }
}
