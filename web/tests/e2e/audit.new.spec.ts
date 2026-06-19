// tests/e2e/audit.new.spec.ts
//
// NEW-METHOD visual audit: ABSOLUTE-correctness checks for the forced-dark bug
// class the legacy diff-gate is blind to.
//
// Why this spec exists (and why the old gate missed these):
//   * The old gate DIFFS new-vs-legacy. Bugs present in BOTH diff to ~0. This
//     spec judges each element on its OWN computed style, no baseline.
//   * The old gate DISABLES animations (fixtures.ts injects
//     `*{transition:none;animation:none}`). This spec renders with animations
//     ENABLED so a redraw flash is observable.
//   * The old gate only renders seeded/boot-settled states. This spec renders
//     empty-library, no-workout, dropdown-open, and runtime-toggle states.
//   * The bug class is FORCED dark: <html class="theme-dark"> on a LIGHT OS, so
//     @media(prefers-color-scheme:dark) overrides do NOT apply. We force the
//     OS to light (colorScheme:'light') AND set theme-dark — exactly the broken
//     combo — so any rule that relied only on @media-dark is exposed.
//
// The assertion: NO element that renders over a dark surface may compute a
// near-white background / box-shadow / text-shadow / gradient. We scan the live
// DOM in-page and fail with the offending selector + value.

import {
  test,
  expect,
  reachNewRidingView,
  readSeedWorkouts,
  SAMPLE_WORKOUT,
  type HarnessConfig,
} from "./fixtures.js";
import type {Page} from "@playwright/test";
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, "..", "..", "visual-report", "audit");

function saveShot(name: string, buf: Buffer): void {
  mkdirSync(SHOT_DIR, {recursive: true});
  writeFileSync(resolve(SHOT_DIR, `${name}.png`), buf);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const h = (window as unknown as {__VELO_HARNESS__: {settle: () => Promise<void>}}).__VELO_HARNESS__;
    await h.settle();
  });
}

// --------------------------- absolute-correctness scanner ---------------------------
//
// Runs in-page. For every VISIBLE element (and the ::before/::after pseudos, and
// the SVG paint attributes), parse its background / box-shadow / text-shadow /
// background-image-gradient and flag any color whose luminance is "near white"
// AND whose alpha is non-trivial. Returns the offenders so the test can name
// them. We accept a small allowlist of intentionally-light tokens (the white CTA
// text, the white toggle thumb) — those are foreground-on-color, not a light
// wash on the dark page surface.

export interface Offender {
  selector: string;
  prop: string;
  value: string;
}

async function scanLightInDark(page: Page, allow: string[] = []): Promise<Offender[]> {
  return page.evaluate((allowSelectors) => {
    const offenders: {selector: string; prop: string; value: string}[] = [];

    // Parse the first rgb/rgba in a string; return {r,g,b,a} or null.
    function firstColor(s: string): {r: number; g: number; b: number; a: number} | null {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m || !m[1]) return null;
      const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
      const r = parts[0] ?? NaN, g = parts[1] ?? NaN, b = parts[2] ?? NaN;
      const a = parts.length > 3 ? parts[3] ?? 1 : 1;
      if (![r, g, b].every(Number.isFinite)) return null;
      return {r, g, b, a};
    }
    // All rgb/rgba colors in a string.
    function allColors(s: string): {r: number; g: number; b: number; a: number}[] {
      const out: {r: number; g: number; b: number; a: number}[] = [];
      const re = /rgba?\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const parts = (m[1] ?? "").split(",").map((x) => parseFloat(x.trim()));
        const r = parts[0] ?? NaN, g = parts[1] ?? NaN, b = parts[2] ?? NaN;
        const a = parts.length > 3 ? parts[3] ?? 1 : 1;
        if ([r, g, b].every(Number.isFinite)) out.push({r, g, b, a});
      }
      return out;
    }
    // "near white" = all channels high. Alpha must be meaningful to wash the surface.
    function isNearWhiteWash(c: {r: number; g: number; b: number; a: number}, minAlpha: number): boolean {
      return c.r >= 230 && c.g >= 230 && c.b >= 230 && c.a >= minAlpha;
    }

    function selectorFor(el: Element): string {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).join(".")
        : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    }

    const matchesAllow = (sel: string): boolean => allowSelectors.some((a) => sel.includes(a));

    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    for (const el of all) {
      const cs = getComputedStyle(el);
      // Only consider elements that are actually painted (not display:none and
      // with non-zero box) — a hidden white element does not render.
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const sel = selectorFor(el);
      if (matchesAllow(sel)) continue;

      // background-color: a solid/near-solid white box on the dark page.
      const bg = firstColor(cs.backgroundColor);
      if (bg && isNearWhiteWash(bg, 0.5)) {
        offenders.push({selector: sel, prop: "background-color", value: cs.backgroundColor});
      }
      // background-image gradients (the picker-empty radial-glow lives here).
      if (cs.backgroundImage && cs.backgroundImage.includes("gradient")) {
        for (const c of allColors(cs.backgroundImage)) {
          if (isNearWhiteWash(c, 0.15)) {
            offenders.push({selector: sel, prop: "background-image", value: cs.backgroundImage});
            break;
          }
        }
      }
      // box-shadow / text-shadow: a bright white glow on the dark page.
      for (const prop of ["boxShadow", "textShadow"] as const) {
        const v = (cs as unknown as Record<string, string>)[prop];
        if (!v || v === "none") continue;
        for (const c of allColors(v)) {
          if (isNearWhiteWash(c, 0.5)) {
            offenders.push({selector: sel, prop, value: v});
            break;
          }
        }
      }
    }
    return offenders;
  }, allow);
}

// Allowlist: tokens that are legitimately near-white as FOREGROUND on a colored
// chip (not a wash on the page surface). The white CTA text + the white toggle
// thumb are correct in both themes.
const ALLOW = [".toggle-thumb", ".switch-thumb", "input", "textarea", ".settings-ftp-input"];

function darkForcedConfig(extra: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    ftp: 250,
    soundEnabled: false,
    themeMode: "dark",
    selectedWorkout: SAMPLE_WORKOUT,
    connectBike: false,
    connectHr: false,
    seedZwo: readSeedWorkouts(),
    ...extra,
  };
}

// The whole point: keep the OS in LIGHT while the app is in forced dark so the
// @media(prefers-color-scheme:dark) rules do NOT apply. (playwright.config.ts
// already defaults colorScheme:'light', but we pin it so the intent is explicit
// and a future config change can't silently mask the bug.)
test.use({colorScheme: "light"});

test.describe("forced-dark — empty library picker", () => {
  // Empty library (no seedZwo) -> the .picker-empty-state overlay shows.
  test.use({harnessConfig: {ftp: 250, soundEnabled: false, themeMode: "dark", selectedWorkout: SAMPLE_WORKOUT, connectBike: false, connectHr: false}});

  test("empty-library picker (forced dark) has no white glow / wash", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await settle(page);

    const empty = page.locator("#pickerEmptyState");
    await expect(empty).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/theme-dark/);

    saveShot("empty-picker-dark", await page.screenshot({fullPage: false}));

    const offenders = await scanLightInDark(page, ALLOW);
    expect(
      offenders,
      `forced-dark light-in-dark offenders:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });

  test("the .picker-empty-state glow is not near-white in forced dark", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.locator("#pickerEmptyState")).toBeVisible();
    await settle(page);

    const glow = await page.locator("#pickerEmptyState").evaluate((el) => getComputedStyle(el).backgroundImage);
    // Pull every rgb(a) and assert none is a near-white wash with alpha >= 0.15.
    const colors = [...glow.matchAll(/rgba?\(([^)]+)\)/g)].map((m) =>
      (m[1] ?? "").split(",").map((x) => parseFloat(x.trim())),
    );
    const offending = colors.find(
      (c) => (c[0] ?? 0) >= 230 && (c[1] ?? 0) >= 230 && (c[2] ?? 0) >= 230 && (c[3] ?? 1) >= 0.15,
    );
    expect(offending, `picker-empty glow background-image = ${glow}`).toBeUndefined();
  });
});

test.describe("forced-dark — no-workout HUD", () => {
  test.use({harnessConfig: darkForcedConfig({selectedWorkout: undefined, connectBike: true})});

  test('"Select a workout" overlay has no white shadow/wash in forced dark', async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await expect(page.locator("#chartEmptyOverlay")).toBeVisible();
    await settle(page);

    saveShot("no-workout-hud-dark", await page.screenshot({fullPage: false}));

    // Directly assert the chart-empty message text-shadow + overlay bg.
    const msg = await page.locator("#chartEmptyMessage").evaluate((el) => {
      const cs = getComputedStyle(el);
      return {textShadow: cs.textShadow};
    });
    const shadowColors = [...msg.textShadow.matchAll(/rgba?\(([^)]+)\)/g)].map((m) =>
      (m[1] ?? "").split(",").map((x) => parseFloat(x.trim())),
    );
    const badShadow = shadowColors.find(
      (c) => (c[0] ?? 0) >= 230 && (c[1] ?? 0) >= 230 && (c[2] ?? 0) >= 230 && (c[3] ?? 1) >= 0.3,
    );
    expect(badShadow, `chart-empty-message text-shadow = ${msg.textShadow}`).toBeUndefined();

    const offenders = await scanLightInDark(page, ALLOW);
    expect(
      offenders,
      `forced-dark light-in-dark offenders:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("forced-dark — picker library + open dropdowns", () => {
  test.use({harnessConfig: darkForcedConfig({seedZwo: readSeedWorkouts()})});

  test("picker zone/duration carets + library render dark (no light-in-dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await settle(page);

    saveShot("picker-library-dark", await page.screenshot({fullPage: false}));

    // The select carets are a CSS background-image SVG (var(--select-arrow)).
    // In forced dark it must be the light-stroke ('%23bbbbbb') variant, and it
    // must be positioned once (right 12px center), not duplicated.
    const zoneSel = page.getByTestId("picker-zone-filter");
    const caret = await zoneSel.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        image: cs.backgroundImage,
        position: cs.backgroundPosition,
        repeat: cs.backgroundRepeat,
        size: cs.backgroundSize,
      };
    });
    // Single caret, no-repeat, anchored right.
    expect(caret.repeat).toContain("no-repeat");
    expect(caret.image).toContain("svg");
    // The dark caret stroke is %23bbbbbb (light grey). The light caret is %23999.
    // url-encoding may vary, so just assert it is NOT the light-only %23999.
    expect(caret.image.includes("%23999") && !caret.image.includes("bbbbbb")).toBe(false);

    const offenders = await scanLightInDark(page, ALLOW);
    expect(
      offenders,
      `forced-dark light-in-dark offenders:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("forced-dark — builder block selected + redraw flash", () => {
  test.use({harnessConfig: darkForcedConfig({seedZwo: readSeedWorkouts()})});

  test("builder with a block selected renders dark, and a click redraw shows no white flash", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    // Open picker -> open the builder (new workout).
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await page.getByTestId("picker-add-workout").click();
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toBeVisible();
    await expect(page.getByTestId("builder-save")).toBeVisible();
    await settle(page);

    // A new workout has no blocks; insert a couple so the chart has segments.
    await page.getByTestId("wb-insert-tempo").click();
    await page.getByTestId("wb-insert-vo2max").click();
    await settle(page);

    // Select the first block via its chart segment.
    const seg = page.locator('[data-testid="wb-chart"] polygon.wb-block-segment').first();
    await expect(seg).toBeVisible();
    await seg.click();
    await settle(page);

    saveShot("builder-selected-dark", await page.screenshot({fullPage: false}));

    // Capture rapid frames immediately AFTER a click redraw to catch a flash.
    // With animations ENABLED, a stray transition that re-paints to a light bg
    // would be visible in one of these frames; we scan each for light-in-dark.
    const frames: Offender[][] = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid="wb-chart"] polygon.wb-block-segment').nth(0).click({force: true}).catch(() => {});
      frames.push(await scanLightInDark(page, ALLOW));
      saveShot(`builder-flash-frame-${i}-dark`, await page.screenshot({fullPage: false}));
    }
    const flashOffenders = frames.flat();
    expect(
      flashOffenders,
      `builder redraw flash light-in-dark:\n${flashOffenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);

    // The chart svg + its polygons never carry a light fill in dark.
    const polyFills = await page.locator('[data-testid="wb-chart"] polygon.wb-block-segment').evaluateAll((nodes) =>
      nodes.map((n) => (n as SVGElement).getAttribute("fill") || ""),
    );
    const lightPoly = polyFills.find((f) => /#f[0-9a-f]f[0-9a-f]f[0-9a-f]|#fff|255,\s*255,\s*255/i.test(f));
    expect(lightPoly, `builder segment fill = ${lightPoly}`).toBeUndefined();
  });
});

test.describe("forced-dark — runtime light->dark toggle", () => {
  // Boot in LIGHT, then toggle to dark at runtime via the same applyThemeMode
  // path the Settings "Dark" button uses, and re-scan. A rule that only worked
  // because the page booted dark (vs toggled dark) would surface here.
  test.use({harnessConfig: {ftp: 250, soundEnabled: false, themeMode: "light", selectedWorkout: undefined, connectBike: true, connectHr: false, seedZwo: readSeedWorkouts()}});

  test("toggling light->dark at runtime leaves no light-in-dark on the HUD", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    await expect(page.locator("#chartEmptyOverlay")).toBeVisible();

    // Flip to forced dark exactly like the Settings toggle (class + data-theme).
    await page.evaluate(() => {
      const root = document.documentElement;
      root.classList.remove("theme-light");
      root.classList.add("theme-dark");
      root.dataset.theme = "dark";
    });
    await settle(page);
    await page.waitForTimeout(400); // let any transitions finish (animations ON)

    saveShot("runtime-toggle-dark", await page.screenshot({fullPage: false}));

    const offenders = await scanLightInDark(page, ALLOW);
    expect(
      offenders,
      `runtime-toggle light-in-dark offenders:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });
});
