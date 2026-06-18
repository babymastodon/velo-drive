// tests/e2e/fixtures.ts
//
// Playwright fixtures that inject the hermetic test env (virtual clock +
// in-memory FS seeded CONFIGURED + FTMS sim + audio recorder) BEFORE the legacy
// app loads, then expose helpers to reach the configured riding view and to
// drive a ride from test code.
//
// Mechanics:
//   * `__VELO_HARNESS_CONFIG__` is set first (carries FTP / sound / theme /
//     selectedWorkout / seeded .zwo). Then `harness/page-env.js` runs and builds
//     the env onto `window.__VELO_TEST_ENV__`, which `velo-shim.js` (first
//     script in the shimmed index.html) reads to swap the platform providers.
//   * Both init scripts run before any app code, so the app boots fully faked.

import {test as base, expect, type Page} from "@playwright/test";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..", "..");
const DOCS_WORKOUTS = resolve(WEB_ROOT, "..", "docs", "workouts");
const PAGE_ENV = join(WEB_ROOT, "harness", "page-env.js");

/** Read all 41 .zwo from docs/workouts as {filename: text}. */
export function readSeedWorkouts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(DOCS_WORKOUTS)) {
    if (!name.toLowerCase().endsWith(".zwo")) continue;
    out[name] = readFileSync(join(DOCS_WORKOUTS, name), "utf8");
  }
  return out;
}

// A small, deterministic CanonicalWorkout used as the selected workout so the
// engine boots with a workout loaded (durations are in MINUTES; see
// docs/workout-engine.js recomputeWorkoutTotalSec). Shape matches
// docs/zwo.js CanonicalWorkout: rawSegments = [[min,startPct,endPct,(flag?),(cad?)], ...].
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
}

// Config for the VISUAL comparison: identical for legacy + new so the only
// differences a pixel diff can surface are layout/CSS. connectBike:false ->
// neither app auto-reconnects, so both show the same "no bike" empty state
// (avoids cross-app auto-reconnect timing differences). Behavior tests use the
// default config (bike connected) instead.
export const VISUAL_HARNESS_CONFIG: HarnessConfig = {
  ftp: 250,
  soundEnabled: false,
  themeMode: "light",
  selectedWorkout: SAMPLE_WORKOUT,
  connectBike: false,
  connectHr: false,
  seedZwo: readSeedWorkouts(),
};

// Settings + Welcome share the same matched-state config as the HUD: identical
// for legacy + new so the only difference a pixel diff surfaces is layout/CSS.
// (The settings modal + welcome overlay are theme/FTP/folder dependent, all of
// which are seeded identically here.)
export const SETTINGS_HARNESS_CONFIG: HarnessConfig = VISUAL_HARNESS_CONFIG;
export const WELCOME_HARNESS_CONFIG: HarnessConfig = VISUAL_HARNESS_CONFIG;

// Picker shares the same matched-state config (identical seeded .zwo library for
// legacy + new). Both apps default to the same picker sort (kJ ascending) + no
// filters, so the only difference a pixel diff can surface is layout/CSS.
export const PICKER_HARNESS_CONFIG: HarnessConfig = VISUAL_HARNESS_CONFIG;

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

    // 2. Build the env onto window.__VELO_TEST_ENV__ (consumed by velo-shim.js).
    await page.addInitScript({path: PAGE_ENV});

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
 * Reach the NEW app's riding (HUD) view: wait for the app to boot (the harness
 * control API to be present), settle the engine init timers, and confirm the
 * HUD is mounted. The new app has no welcome gate in M3, so this is simpler than
 * reachRidingView (legacy).
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
