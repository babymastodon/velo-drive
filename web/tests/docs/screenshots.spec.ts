import {expect, type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildFitFile} from "../../src/core/fit.js";
import type {CanonicalWorkout} from "../../src/core/model.js";
import {parseZwoXmlToCanonicalWorkout} from "../../src/core/zwo.js";
import {
  test,
  reachNewRidingView,
  readSeedWorkouts,
  type HarnessConfig,
} from "../e2e/fixtures.js";
import {
  buildViolatorWorkout,
  generateDemoTelemetry,
  workoutDurationSec,
} from "./demo-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..", "..");
const SCREENSHOT_ROOT = resolve(WEB_ROOT, "..", "media", "screenshots", "guide");
const FTP = 250;
const FIXED_NOW = Date.UTC(2026, 5, 17, 12, 0, 0);
const SEED_ZWO = readSeedWorkouts();

type ThemeMode = "light" | "dark";

function loadBuiltIn(fileName: string): CanonicalWorkout {
  const text = readFileSync(join(WEB_ROOT, "public", "workouts", fileName), "utf8");
  const workout = parseZwoXmlToCanonicalWorkout(text);
  if (!workout) throw new Error(`Unable to parse built-in workout: ${fileName}`);
  workout.sourcePath = fileName;
  return workout;
}

const AIRFORGE = loadBuiltIn("Airforge.zwo");
const SLEEPY_SPIN = loadBuiltIn("Sleepy%20Spin.zwo");
const WINDLINE = loadBuiltIn("Windline.zwo");
const VIOLATOR = buildViolatorWorkout();

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function historySeed(workout: CanonicalWorkout, startedAtIso: string): [string, string] {
  const startedAt = new Date(startedAtIso);
  const durationSec = workoutDurationSec(workout);
  const samples = generateDemoTelemetry(workout, FTP);
  const bytes = buildFitFile({
    canonicalWorkout: workout,
    samples,
    ftp: FTP,
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationSec * 1000),
    totalElapsedSec: durationSec,
  });
  const stamp = startedAt
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d+Z$/, "Z");
  return [`${stamp} - ${workout.workoutTitle}.fit`, bytesToBase64(bytes)];
}

const HISTORY = Object.fromEntries([
  historySeed(SLEEPY_SPIN, "2026-06-09T14:15:00Z"),
  historySeed(WINDLINE, "2026-06-12T23:45:00Z"),
  historySeed(AIRFORGE, "2026-06-15T15:30:00Z"),
]);

function configFor(themeMode: ThemeMode, selectedWorkout: CanonicalWorkout): HarnessConfig {
  return {
    ftp: FTP,
    soundEnabled: false,
    themeMode,
    selectedWorkout,
    startMs: FIXED_NOW,
    connectBike: true,
    connectHr: true,
    sim: {power: 125, cadence: 88, hr: 96, batteryPercent: 86},
    seedZwo: SEED_ZWO,
    seedHistory: HISTORY,
    schedule: [
      {date: "2026-06-18", workoutTitle: "Breath of Power"},
      {date: "2026-06-20", workoutTitle: "Crestline Endurance"},
    ],
  };
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const harness = (window as unknown as {
      __VELO_HARNESS__: {settle: () => Promise<void>};
    }).__VELO_HARNESS__;
    await harness.settle();
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function saveScreenshot(page: Page, name: string, theme: ThemeMode): Promise<void> {
  await mkdir(SCREENSHOT_ROOT, {recursive: true});
  await settle(page);
  await page.mouse.move(2, 2);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.screenshot({
    path: join(SCREENSHOT_ROOT, `${name}-${theme}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function openLibrary(page: Page): Promise<void> {
  await page.getByTestId("workout-name-label").click();
  await expect(page.getByTestId("picker-modal")).toBeVisible();
  await settle(page);
}

async function openPlanner(page: Page): Promise<void> {
  await page.getByTestId("calendar-btn").click();
  await expect(page.getByTestId("planner-modal")).toBeVisible();
  await expect(page.getByTestId("planner-calendar-body")).toBeVisible();
  await settle(page);
  await page.waitForTimeout(120);
}

async function runRideTo(page: Page, workout: CanonicalWorkout, elapsedSec: number): Promise<void> {
  const samples = generateDemoTelemetry(workout, FTP, elapsedSec);
  const rows = samples.map((sample) => [sample.power, sample.cadence, sample.hr] as const);

  const first = rows[0]!;
  await page.evaluate(([power, cadence, hr]) => {
    const harness = (window as unknown as {
      __VELO_HARNESS__: {
        sim: {
          setReportedPower: (value: number) => void;
          setReportedCadence: (value: number) => void;
          setReportedHr: (value: number) => void;
        };
      };
    }).__VELO_HARNESS__;
    harness.sim.setReportedPower(power);
    harness.sim.setReportedCadence(cadence);
    harness.sim.setReportedHr(hr);
  }, first);

  await page.getByTestId("start-btn").click();
  await page.evaluate(async () => {
    const harness = (window as unknown as {
      __VELO_HARNESS__: {clock: {step: (ms: number) => Promise<void>}};
    }).__VELO_HARNESS__;
    await harness.clock.step(5000);
  });

  await page.evaluate(async (telemetry) => {
    const harness = (window as unknown as {
      __VELO_HARNESS__: {
        sim: {
          setReportedPower: (value: number) => void;
          setReportedCadence: (value: number) => void;
          setReportedHr: (value: number) => void;
        };
        ride: (count: number, perTick: (index: number) => void) => Promise<void>;
        settle: () => Promise<void>;
      };
    }).__VELO_HARNESS__;
    await harness.ride(telemetry.length, (index) => {
      const [power, cadence, hr] = telemetry[index]!;
      harness.sim.setReportedPower(power);
      harness.sim.setReportedCadence(cadence);
      harness.sim.setReportedHr(hr);
    });
    await harness.settle();
  }, rows);

  await expect(page.getByTestId("bike-status-dot")).toHaveClass(/connected/);
  await expect(page.getByTestId("hr-status-dot")).toHaveClass(/connected/);
  await expect(page.getByTestId("chart-empty-overlay")).toBeHidden();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`documentation screenshots — ${theme}`, () => {
    test.describe("active ride", () => {
      test.use({harnessConfig: configFor(theme, VIOLATOR)});

      test("Violator live ride", async ({configuredPage}) => {
        const page = configuredPage;
        await reachNewRidingView(page);
        await runRideTo(page, VIOLATOR, 21 * 60);
        await expect(page.getByTestId("stat-elapsed-time")).toHaveText("00:21:00");
        await expect(page.getByTestId("active-workout-name")).toHaveText("Violator");
        await expect(page.getByTestId("pause-btn")).toHaveClass(/visible/);
        await saveScreenshot(page, "ride-violator", theme);
      });
    });

    test.describe("library", () => {
      test.use({harnessConfig: configFor(theme, AIRFORGE)});

      test("built-in Airforge details", async ({configuredPage}) => {
        const page = configuredPage;
        await reachNewRidingView(page);
        await openLibrary(page);
        const nameHeader = page.locator('th[data-sort-key="name"]');
        await nameHeader.click();
        await nameHeader.click();
        await expect(nameHeader).toHaveClass(/sorted-asc/);
        const row = page.locator('.picker-row[data-title="Airforge"]');
        if ((await page.locator(".picker-expanded-row").count()) === 0) await row.click();
        await expect(page.locator(".picker-expanded-row")).toBeVisible();
        await expect(page.getByTestId("picker-mini-chart").locator("svg")).toBeVisible();
        await page.locator(".workout-picker-table-wrapper").evaluate((element) => {
          element.scrollTop = 0;
        });
        const detailsFullyVisible = await page.locator(".picker-expanded-row").evaluate((element) => {
          const wrapper = element.closest(".workout-picker-table-wrapper");
          if (!wrapper) return false;
          const details = element.getBoundingClientRect();
          const bounds = wrapper.getBoundingClientRect();
          return details.top >= bounds.top && details.bottom <= bounds.bottom;
        });
        expect(detailsFullyVisible).toBe(true);
        await saveScreenshot(page, "library-airforge", theme);
      });
    });

    test.describe("calendar and history", () => {
      test.use({harnessConfig: configFor(theme, AIRFORGE)});

      test("training calendar", async ({configuredPage}) => {
        const page = configuredPage;
        await reachNewRidingView(page);
        await openPlanner(page);
        await expect(page.locator('.planner-day[data-date="2026-06-15"]')).toContainText("Airforge");
        await expect(page.locator('.planner-day[data-date="2026-06-20"]')).toContainText(
          "Crestline Endurance",
        );
        await saveScreenshot(page, "calendar-training-week", theme);
      });

      test("completed Airforge analysis", async ({configuredPage}) => {
        const page = configuredPage;
        await reachNewRidingView(page);
        await openPlanner(page);
        await page
          .locator(
            '.planner-day[data-date="2026-06-15"] .planner-workout-card:not(.planner-scheduled-card)',
          )
          .click();
        await expect(page.getByTestId("planner-detail")).toBeVisible();
        await expect(page.getByTestId("planner-power-curve").locator("path").first()).toBeVisible();
        await saveScreenshot(page, "history-airforge", theme);
      });
    });

    test.describe("builder", () => {
      test.use({harnessConfig: configFor(theme, AIRFORGE)});

      test("editing a built-in workout", async ({configuredPage}) => {
        const page = configuredPage;
        await reachNewRidingView(page);
        await openLibrary(page);
        const row = page.locator('.picker-row[data-title="Airforge"]');
        if ((await page.locator(".picker-expanded-row").count()) === 0) await row.click();
        await page.getByTestId("picker-edit").click();
        await expect(page.locator("#workoutBuilderRoot")).toBeVisible();
        await page.waitForTimeout(120);
        // Select the broad warm-up block; narrow interval polygons sit beneath
        // resize handles by design and are a poor deterministic click target.
        await page.getByTestId("wb-chart").locator(".wb-block-segment").first().click();
        await expect(page.getByTestId("wb-block-editor")).toBeVisible();
        await saveScreenshot(page, "builder-airforge", theme);
      });
    });

    test.describe("settings", () => {
      test.use({harnessConfig: configFor(theme, AIRFORGE)});

      test("configured app settings", async ({configuredPage}) => {
        const page = configuredPage;
        await reachNewRidingView(page);
        await page.getByTestId("settings-btn").click();
        await expect(page.getByTestId("settings-modal")).toBeVisible();
        await expect(page.getByTestId("root-dir-status")).toHaveText("VeloDrive");
        await expect(page.getByTestId("ftp-input")).toHaveValue("250");
        await saveScreenshot(page, "settings", theme);
      });
    });
  });
}
