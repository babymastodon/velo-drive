// tests/e2e/fixtures.ts
//
// Playwright fixtures that inject the hermetic test env (virtual clock +
// in-memory FS seeded CONFIGURED + FTMS sim + audio recorder) BEFORE the app
// loads, then expose helpers to reach the configured riding view and to drive a
// ride from test code.
//
// Mechanics:
//   * `__VELO_HARNESS_CONFIG__` is set first (carries FTP / sound / theme /
//     selectedWorkout / seeded .zwo). Then `harness/page-env.js` runs and builds
//     the env onto `window.__VELO_TEST_ENV__`, which the app's platform shim
//     (installed first in main.ts) reads to swap the platform providers.
//   * Both init scripts run before any app code, so the app boots fully faked.

import {test as base, expect, type Page} from "@playwright/test";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildFitFile} from "../../src/core/fit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..", "..");
// The bundled workout library (shipped in the PWA at public/workouts).
const SEED_WORKOUTS = resolve(WEB_ROOT, "public", "workouts");
const PAGE_ENV = join(WEB_ROOT, "harness", "page-env.js");

/** Read all bundled .zwo workouts as {filename: text}. */
export function readSeedWorkouts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(SEED_WORKOUTS)) {
    if (!name.toLowerCase().endsWith(".zwo")) continue;
    out[name] = readFileSync(join(SEED_WORKOUTS, name), "utf8");
  }
  return out;
}

// A small, deterministic CanonicalWorkout used as the selected workout so the
// engine boots with a workout loaded (durations are in MINUTES). Shape:
// rawSegments = [[min,startPct,endPct,(flag?),(cad?)], ...].
export const SAMPLE_WORKOUT = {
  workoutTitle: "Harness Sample",
  rawSegments: [
    [3, 35, 55, null, 90], // warmup ramp 35%->55%
    [5, 60, 60, null, 90], // steady 60%
    [2, 85, 85, null, 95], // effort 85%
    [3, 50, 40, null, 85], // cooldown ramp
  ],
  textEvents: [],
};

export interface HarnessConfig {
  ftp?: number;
  soundEnabled?: boolean;
  themeMode?: "light" | "dark" | "auto";
  selectedWorkout?: unknown;
  startMs?: number;
  connectBike?: boolean;
  connectHr?: boolean;
  sim?: Record<string, unknown>;
  seedZwo?: Record<string, string>;
  schedule?: unknown;
  // History .fit files to seed into the history dir: fileName -> base64 bytes.
  seedHistory?: Record<string, string>;
}

// Config for the VISUAL snapshots. connectBike:false -> the app does not
// auto-reconnect, so it shows the "no bike" empty state (avoids auto-reconnect
// timing differences in snapshots). Behavior tests use the default config (bike
// connected) instead.
export const VISUAL_HARNESS_CONFIG: HarnessConfig = {
  ftp: 250,
  soundEnabled: false,
  themeMode: "light",
  selectedWorkout: SAMPLE_WORKOUT,
  connectBike: false,
  connectHr: false,
  seedZwo: readSeedWorkouts(),
};

// Settings + Welcome share the same matched-state config as the HUD. (The
// settings modal + welcome overlay are theme/FTP/folder dependent, all of which
// are seeded here.)
export const SETTINGS_HARNESS_CONFIG: HarnessConfig = VISUAL_HARNESS_CONFIG;
export const WELCOME_HARNESS_CONFIG: HarnessConfig = VISUAL_HARNESS_CONFIG;

// Picker shares the same matched-state config (the seeded .zwo library). The
// picker defaults to its kJ-ascending sort + no filters.
export const PICKER_HARNESS_CONFIG: HarnessConfig = VISUAL_HARNESS_CONFIG;

// --------------------------- Planner (calendar) fixture ---------------------------
//
// The virtualized calendar renders relative to "today" (the VIRTUAL clock) and
// to seeded history/schedule, so for a stable snapshot the harness clock is
// pinned to a FIXED date and seeded with history .fit files + schedule.json.
// (Today = 2026-06-17; a completed ride on 2026-06-15 and a scheduled workout
// on 2026-06-20.)
export const PLANNER_FIXED_MS = Date.UTC(2026, 5, 17, 12, 0, 0); // 2026-06-17 12:00 UTC

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return Buffer.from(bin, "binary").toString("base64");
}

// A deterministic completed ride: 40 min, steady-ish power around the workout
// target with a couple of efforts, fixed HR/cadence. startedAt fixes the file
// name (UTC ISO with ":" -> "-") so the planner indexes it onto 2026-06-15.
const PLANNER_HISTORY_WORKOUT = {
  workoutTitle: "Morning Tempo",
  source: "fixture",
  sourceURL: "",
  description: "",
  rawSegments: [
    [10, 50, 60],
    [10, 75, 75],
    [10, 88, 88],
    [10, 60, 50],
  ] as [number, number, number][],
  textEvents: [],
};

function buildPlannerHistoryFit(): {fileName: string; base64: string} {
  const startedAt = new Date(Date.UTC(2026, 5, 15, 8, 30, 0)); // 2026-06-15 08:30 UTC
  const ftp = 250;
  const samples: {t: number; power: number; hr: number; cadence: number; targetPower: number}[] = [];
  // Build per-second samples following the rawSegments target with mild noise.
  let t = 0;
  for (const seg of PLANNER_HISTORY_WORKOUT.rawSegments) {
    const [minutes, startPct, endPct] = seg as number[];
    const dur = Math.round((minutes as number) * 60);
    for (let i = 0; i < dur; i++) {
      const frac = dur > 1 ? i / (dur - 1) : 0;
      const pct = (startPct as number) + ((endPct as number) - (startPct as number)) * frac;
      const target = Math.round((pct / 100) * ftp);
      // deterministic pseudo-noise
      const noise = ((i * 37 + t * 13) % 11) - 5;
      samples.push({
        t,
        power: Math.max(0, target + noise),
        hr: 120 + Math.round(pct * 0.4),
        cadence: 88 + ((i % 5) - 2),
        targetPower: target,
      });
      t += 1;
    }
  }
  const endedAt = new Date(startedAt.getTime() + t * 1000);
  const bytes = buildFitFile({
    canonicalWorkout: PLANNER_HISTORY_WORKOUT,
    samples,
    ftp,
    startedAt,
    endedAt,
    totalElapsedSec: t,
  });
  const timestamp = startedAt
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\.\d+Z$/, "Z");
  const fileName = `${timestamp} - Morning Tempo.fit`;
  return {fileName, base64: toBase64(bytes)};
}

const PLANNER_HISTORY = buildPlannerHistoryFit();

export const PLANNER_HARNESS_CONFIG: HarnessConfig = {
  ftp: 250,
  soundEnabled: false,
  themeMode: "light",
  selectedWorkout: SAMPLE_WORKOUT,
  connectBike: false,
  connectHr: false,
  startMs: PLANNER_FIXED_MS,
  seedZwo: readSeedWorkouts(),
  seedHistory: {[PLANNER_HISTORY.fileName]: PLANNER_HISTORY.base64},
  // A scheduled workout on a future day (2026-06-20). The title must exist in
  // the seeded .zwo library so the planner can hydrate its rawSegments/metrics.
  schedule: [{date: "2026-06-20", workoutTitle: "Sleepy Spin"}],
};

// --------------------------- DARK-mode variants ---------------------------
//
// The same matched-state configs as the light ones above, but forcing
// themeMode:"dark" so the app boots the forced-dark palette (:root.theme-dark).
// Used by the dark-mode behavior tests (theme-switch chart redraw, etc.).
export const VISUAL_HARNESS_CONFIG_DARK: HarnessConfig = {
  ...VISUAL_HARNESS_CONFIG,
  themeMode: "dark",
};
export const SETTINGS_HARNESS_CONFIG_DARK: HarnessConfig = VISUAL_HARNESS_CONFIG_DARK;
export const PICKER_HARNESS_CONFIG_DARK: HarnessConfig = VISUAL_HARNESS_CONFIG_DARK;
export const PLANNER_HARNESS_CONFIG_DARK: HarnessConfig = {
  ...PLANNER_HARNESS_CONFIG,
  themeMode: "dark",
};
// No workout selected, bike connected -> the chart empty-state shows
// "Select a workout" (the noWorkout state). Bike connected so the app reaches
// this state regardless of the bike-vs-workout precedence.
export const NO_WORKOUT_DARK: HarnessConfig = {
  ...VISUAL_HARNESS_CONFIG_DARK,
  selectedWorkout: undefined,
  connectBike: true,
};
export const NO_WORKOUT_LIGHT: HarnessConfig = {
  ...NO_WORKOUT_DARK,
  themeMode: "light",
};

export const test = base.extend<{
  harnessConfig: HarnessConfig;
  configuredPage: Page;
}>({
  // Default config: configured + a selected workout + bike connected, sound off,
  // light theme. Override per-test via test.use({ harnessConfig: {...} }).
  harnessConfig: [
    {
      ftp: 250,
      soundEnabled: false,
      themeMode: "light",
      selectedWorkout: SAMPLE_WORKOUT,
      connectBike: true,
      connectHr: false,
      seedZwo: readSeedWorkouts(),
    },
    {option: true},
  ],

  configuredPage: async ({page, harnessConfig}, use) => {
    // 1. Seed harness config BEFORE anything else.
    await page.addInitScript((cfg) => {
      (window as unknown as {__VELO_HARNESS_CONFIG__: unknown}).__VELO_HARNESS_CONFIG__ = cfg;
    }, harnessConfig);

    // 2. Build the env onto window.__VELO_TEST_ENV__ (consumed by the app shim).
    await page.addInitScript({path: PAGE_ENV});

    // 2.0 Seed the "welcome seen" flag into the fake IndexedDB settings store so
    // the new app's boot-time welcome gating (App.svelte maybeShowWelcome) does
    // NOT show the first-run tour in the (already-configured) hermetic state. A
    // fresh REAL user has no such flag and DOES see welcome. This extends the
    // page-env seed from the fixture (not by editing harness/*).
    await page.addInitScript(() => {
      const harness = (window as unknown as {
        __VELO_HARNESS__?: {settingsStore?: Map<string, {key: string; value: unknown}>};
      }).__VELO_HARNESS__;
      harness?.settingsStore?.set("hasSeenWelcome", {key: "hasSeenWelcome", value: true});
    });

    // 2a. The fake FS dir handle exposes values()/[asyncIterator] but not the
    // entries() async-iterator the planner backend uses to list the history dir.
    // Polyfill it on the prototype here (extending the harness fakes from the
    // fixture, not editing harness/*) so the app can enumerate seeded history
    // files.
    await page.addInitScript(() => {
      const harness = (window as unknown as {
        __VELO_HARNESS__?: {fs?: {history?: object}};
      }).__VELO_HARNESS__;
      const proto = harness?.fs?.history
        ? Object.getPrototypeOf(harness.fs.history)
        : null;
      if (proto && typeof (proto as {entries?: unknown}).entries !== "function") {
        (proto as {entries: () => AsyncIterable<[string, unknown]>}).entries = function (
          this: {_files: Map<string, unknown>; _dirs: Map<string, unknown>},
        ) {
          const pairs: [string, unknown][] = [
            ...Array.from(this._files.entries()),
            ...Array.from(this._dirs.entries()),
          ];
          let i = 0;
          const it = {
            next: () =>
              Promise.resolve(
                i < pairs.length ? {value: pairs[i++], done: false} : {value: undefined, done: true},
              ),
            [Symbol.asyncIterator]() {
              return this;
            },
          };
          return it as AsyncIterable<[string, unknown]>;
        };
      }
    });

    // 2b. Seed history .fit files into the fake FS history dir (page-env only
    // seeds .zwo + schedule.json). Runs AFTER page-env, so __VELO_HARNESS__.fs
    // exists. Bytes are passed base64 to survive the init-script boundary.
    if (harnessConfig.seedHistory) {
      await page.addInitScript((seed: Record<string, string>) => {
        const harness = (window as unknown as {
          __VELO_HARNESS__?: {fs?: {history?: {seedFile: (name: string, bytes: Uint8Array) => void}}};
        }).__VELO_HARNESS__;
        const history = harness?.fs?.history;
        if (!history) return;
        for (const name of Object.keys(seed)) {
          const bin = atob(seed[name] as string);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          history.seedFile(name, bytes);
        }
      }, harnessConfig.seedHistory);
    }

    // 3. Kill transitions/animations for deterministic snapshots.
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;}";
      const apply = () => document.documentElement.appendChild(style);
      if (document.documentElement) apply();
      else document.addEventListener("DOMContentLoaded", apply, {once: true});
    });

    await page.goto("/");
    await use(page);
  },
});

/**
 * Reach the riding (HUD) view: wait for the app to boot (the harness control API
 * to be present), settle the engine init timers, and confirm the HUD is
 * mounted. The app has no welcome gate here, so this is simpler than
 * reachRidingView.
 */
export async function reachNewRidingView(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !!(window as unknown as {__VELO_HARNESS__?: unknown}).__VELO_HARNESS__);

  // The HUD mounts after bootApp() resolves (an async chain over the fake
  // IndexedDB). Wait for the stat element to render.
  await page.locator("#stat-power").waitFor({state: "visible", timeout: 10_000});

  // Settle engine init timers (microtasks/timeouts) so the configured VM is up.
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });

  await expect(page.locator("#stat-power")).toBeVisible();
}

/**
 * Reach the configured riding (HUD) view: wait for the app to settle, dismiss
 * the welcome overlay if it appeared, and confirm the HUD is visible.
 */
export async function reachRidingView(page: Page): Promise<void> {
  // Let the app boot + the welcome gate resolve.
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !!(window as unknown as {__VELO_HARNESS__?: unknown}).__VELO_HARNESS__);

  // Settle microtasks/timers the engine init kicked off.
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });

  // The welcome overlay is force-shown in headless (not running as a PWA), so
  // dismiss it via its close button. It becomes visible on a requestAnimationFrame
  // (real time), then hides via a window.setTimeout fallback (VIRTUAL time), so
  // we wait for it to appear, click close, then advance the clock to finish the
  // hide animation.
  const overlay = page.locator("#welcomeOverlay");
  const closeBtn = page.locator("#welcomeCloseBtn");

  const isVisible = () =>
    overlay
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
      })
      .catch(() => false);

  if (await overlay.count()) {
    // Give the overlay's rAF a moment to mark it visible; bounded so a
    // gated-off overlay doesn't stall the test.
    try {
      await page.waitForFunction(
        () => {
          const el = document.getElementById("welcomeOverlay");
          if (!el) return true;
          const cs = getComputedStyle(el);
          const visible = cs.display !== "none" && Number(cs.opacity) > 0;
          // resolve once it's either clearly visible or clearly hidden+settled
          return visible || cs.display === "none";
        },
        undefined,
        {timeout: 3000},
      );
    } catch {
      /* fall through and check directly */
    }

    if (await isVisible()) {
      await closeBtn.click({force: true}).catch(() => {});
      // The welcome close relies on a CSS transitionend to finalize; with
      // animations disabled (for deterministic screenshots) that event never
      // fires, so force-hide the overlay deterministically and reveal the
      // riding view (welcome gets its own test later).
      await page.evaluate(() => {
        document.body.classList.remove("welcome-active");
        const o = document.getElementById("welcomeOverlay");
        if (o) {
          o.style.display = "none";
          o.setAttribute("aria-hidden", "true");
        }
      });
    }
  }

  // HUD must be visible.
  await expect(page.locator("#stat-power")).toBeVisible();
}

export {expect};
