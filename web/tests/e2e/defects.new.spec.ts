// tests/e2e/defects.new.spec.ts
//
// Targeted behavior coverage for the verified-defects fix pass (new Svelte app).
// Each test asserts a specific user-visible behavior; none capture a visual
// baseline (the existing visual specs already guard pixels). Covers:
//   * default-workout seeding on an empty folder pick (J-CFG-17)
//   * post-ride flow: finishing a scheduled ride removes its scheduled entry +
//     auto-opens the ride detail (J-PLAN-34 / J-RIDE-26)
//   * picker empty-search Escape stays open + blurs the search (P-1)
//   * sound default boots audible (J-CFG-15)
//   * boot auto-opens the planner when today has a scheduled ride (J-RIDE-34)

import {test, expect, reachNewRidingView, readSeedWorkouts, SAMPLE_WORKOUT} from "./fixtures.js";
import type {Page} from "@playwright/test";

// Typed accessors for the in-page bridges, used inside page.evaluate callbacks.
// Kept as local helpers (not a shared `declare global`) so this spec doesn't
// clash with the per-file Window augmentations in the other specs.
interface Harness {
  settle: () => Promise<void>;
  clock: {step: (ms: number) => Promise<void>};
  ride: (n: number, perTick?: (i: number) => void) => Promise<void>;
  sim: {setReportedPower: (w: number) => void; setReportedCadence: (r: number) => void};
  settingsStore: Map<string, {key: string; value: unknown}>;
  fs: {
    root: {
      getFileHandle: (n: string, o?: {create?: boolean}) => Promise<{getFile: () => Promise<{text: () => Promise<string>}>}>;
    };
    workouts: {_files: Map<string, unknown>};
    history: {_files: Map<string, unknown>};
  };
}
interface AppBridge {
  getVm: () => {workoutRunning?: boolean} | null;
  getThemeVersion: () => number;
}

// A fixed virtual clock so "today" is deterministic. Local-date key is computed
// the same way the app does (formatKey: local Y-M-D) using a Date at this ms;
// Node + the browser share the runner's timezone, so they agree.
const FIXED_MS = Date.UTC(2026, 5, 18, 19, 0, 0); // 2026-06-18 19:00 UTC (afternoon PT)
function localKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TODAY_KEY = localKey(FIXED_MS);

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

// --------------------------- default-workout seeding (J-CFG-17) ---------------------------
test.describe("default-workout seeding on folder pick", () => {
  // Boot configured but with an EMPTY workouts library (seedZwo omitted) so the
  // folder pick must seed the 6 bundled starters.
  test.use({
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "light",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: false,
      connectHr: false,
    },
  });

  test("picking the folder seeds the full starter library into an empty library", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // The bundled starter library = the complete docs/workouts/ set (41 files).
    const expectedNames = Object.keys(readSeedWorkouts()).sort();

    // Library starts empty.
    const before = await page.evaluate(() =>
      Array.from((window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.fs.workouts._files.keys()),
    );
    expect(before.filter((n) => n.toLowerCase().endsWith(".zwo"))).toHaveLength(0);

    // Pick the folder via Settings (showDirectoryPicker returns the seeded root).
    await page.locator("#settingsBtn").click();
    await expect(page.locator("#settingsModal")).toBeVisible();
    await page.getByTestId("root-dir-button").click();
    // Seeding is a REAL-time async chain (fetch + writes), not virtual-clock
    // timers — poll for it to finish rather than only pumping the clock.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            Array.from((window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.fs.workouts._files.keys()).filter((n) =>
              n.toLowerCase().endsWith(".zwo"),
            ).length,
        ),
      )
      .toBe(expectedNames.length);

    const after = await page.evaluate(() =>
      Array.from((window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.fs.workouts._files.keys()).filter((n) =>
        n.toLowerCase().endsWith(".zwo"),
      ),
    );
    expect(after.sort()).toEqual(expectedNames);
  });
});

// --------------------------- post-ride flow (J-PLAN-34 / J-RIDE-26) ---------------------------
test.describe("post-ride flow", () => {
  // Today (FIXED_MS) has a scheduled entry whose title matches the selected
  // workout, so finishing the ride should clear it. SAMPLE_WORKOUT title is
  // "Harness Sample"; schedule the same title on today.
  test.use({
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "light",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: true,
      connectHr: false,
      startMs: FIXED_MS,
      seedZwo: readSeedWorkouts(),
      schedule: [{date: TODAY_KEY, workoutTitle: "Harness Sample"}],
    },
  });

  test("finishing a scheduled ride removes its scheduled entry and opens the detail", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Run a few seconds so the FIT has samples.
    await page.evaluate(() => {
      (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.sim.setReportedPower(200);
      (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.sim.setReportedCadence(90);
    });
    await page.getByTestId("start-btn").click();
    await page.evaluate(async () => (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.clock.step(5000));
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.ride(5, () => {
        (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.sim.setReportedPower(200);
        (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.sim.setReportedCadence(90);
      });
      await (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.settle();
    });

    // Stop + confirm -> ride ends + writes a .fit -> onWorkoutEnded fires.
    await page.getByTestId("stop-btn").click();
    await page.getByTestId("dialog-ok").click();
    await page.evaluate(async () => {
      await (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.settle();
      await (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.clock.step(0);
    });
    // The planner load + detail open chain runs over microtasks/rAF.
    await settle(page);

    // (a) The scheduled entry for today is gone from schedule.json.
    const schedule = await page.evaluate(async () => {
      const fs = (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.fs.root as unknown as {
        getFileHandle: (n: string, o?: {create?: boolean}) => Promise<{getFile: () => Promise<{text: () => Promise<string>}>}>;
      };
      const fh = await fs.getFileHandle("schedule.json", {create: false});
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    });
    expect(schedule).toEqual([]);

    // (b) The planner opened to the saved ride's DETAIL view.
    await expect(page.locator("#workoutPickerOverlay")).toBeVisible();
    await expect(page.getByTestId("planner-detail")).toBeVisible();
  });
});

// --------------------------- picker empty-search Escape (P-1) ---------------------------
test.describe("picker empty-search Escape", () => {
  test.use({
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "light",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: false,
      connectHr: false,
      seedZwo: readSeedWorkouts(),
    },
  });

  test("Escape in an EMPTY focused search blurs but keeps the picker open", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();

    const search = page.getByTestId("picker-search");
    await search.click();
    await expect(search).toBeFocused();
    expect(await search.inputValue()).toBe("");

    // Escape on an EMPTY search: must NOT close the picker (legacy always clears
    // + blurs + consumes). The picker stays open; the search loses focus.
    await search.press("Escape");
    await settle(page);

    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await expect(search).not.toBeFocused();
  });

  test("Escape in a NON-empty focused search clears it + keeps the picker open", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    const search = page.getByTestId("picker-search");
    await search.click();
    await search.fill("sleepy");
    await search.press("Escape");
    await settle(page);

    expect(await search.inputValue()).toBe("");
    await expect(page.getByTestId("picker-modal")).toBeVisible();
  });
});

// --------------------------- sound default (J-CFG-15) ---------------------------
test.describe("sound default", () => {
  // Omit soundEnabled from the config so the page-env default (false) is NOT
  // seeded... but page-env always seeds soundEnabled (defaulting false). To test
  // the APP boot default, clear the seeded value first via an init script.
  test.use({
    harnessConfig: {
      ftp: 250,
      themeMode: "light",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: false,
      connectHr: false,
      seedZwo: readSeedWorkouts(),
    },
  });

  test("defaults audible (sound on) when no preference is stored", async ({configuredPage}) => {
    const cp = configuredPage;
    await reachNewRidingView(cp);
    // Remove the harness-seeded soundEnabled so the read falls back to the app
    // default. SettingsView reads getSetting('soundEnabled', true) on each open,
    // so opening settings now reflects the boot default (true) — matching legacy
    // (J-CFG-15). The app/app.ts boot default is the same true fallback.
    await cp.evaluate(() => {
      (window as unknown as {__VELO_HARNESS__: Harness}).__VELO_HARNESS__.settingsStore.delete("soundEnabled");
    });
    await cp.locator("#settingsBtn").click();
    await expect(cp.locator("#settingsModal")).toBeVisible();
    await settle(cp);
    await expect(cp.getByTestId("sound-checkbox")).toBeChecked();
  });
});

// --------------------------- theme OS-flip redraw (J-DARK-06) ---------------------------
test.describe("theme OS-flip redraw", () => {
  // Boot in AUTO mode so the matchMedia('(prefers-color-scheme: dark)') listener
  // fires on an OS color-scheme flip and bumps the shared theme version (which
  // drives the chart redraws).
  test.use({
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "auto",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: false,
      connectHr: false,
      seedZwo: readSeedWorkouts(),
    },
  });

  const getVersion = (page: Page) =>
    page.evaluate(() => (window as unknown as {__VELO_APP__: AppBridge}).__VELO_APP__.getThemeVersion());

  test("a prefers-color-scheme change bumps the theme version in auto mode", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Pin a known starting scheme so the next flip is a REAL transition (an
    // emulate to the already-current scheme dispatches no 'change' event).
    await page.emulateMedia({colorScheme: "light"});
    await settle(page);
    const before = await getVersion(page);

    // Flip to dark: the matchMedia('(prefers-color-scheme: dark)') 'change'
    // listener fires (+ re-applies the auto theme, which the MutationObserver
    // also sees), bumping the shared theme version.
    await page.emulateMedia({colorScheme: "dark"});
    await expect.poll(() => getVersion(page)).toBeGreaterThan(before);

    // Auto mode is preserved (the OS flip re-applies "auto", not a fixed theme).
    await expect(page.locator("html")).toHaveAttribute("data-theme", "auto");
  });
});

// --------------------------- boot auto-open planner for today (J-RIDE-34) ---------------------------
test.describe("boot auto-open planner for today", () => {
  // Today has a scheduled workout whose title is NOT the loaded one, so the
  // planner should auto-open on boot.
  test.use({
    harnessConfig: {
      ftp: 250,
      soundEnabled: false,
      themeMode: "light",
      selectedWorkout: SAMPLE_WORKOUT, // "Harness Sample" (not the scheduled one)
      connectBike: false,
      connectHr: false,
      startMs: FIXED_MS,
      seedZwo: readSeedWorkouts(),
      schedule: [{date: TODAY_KEY, workoutTitle: "Sleepy Spin"}],
    },
  });

  test("opens the planner calendar on boot when today is scheduled", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await settle(page);
    // The boot auto-open runs after the welcome gate; the planner overlay shows.
    await expect(page.locator("#workoutPickerOverlay")).toBeVisible();
    await expect(page.locator("#plannerCalendarBody")).toBeVisible();
  });
});
