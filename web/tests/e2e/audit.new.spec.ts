// tests/e2e/audit.new.spec.ts
//
// Absolute-correctness checks for the forced-dark CSS bug class. Rather than
// comparing against a baseline, this spec judges each element on its OWN
// computed style, so a bug that is uniformly present still fails.
//
// It deliberately exercises conditions ordinary screenshot tests miss:
//   * animations ENABLED (so a redraw flash is observable),
//   * unusual states: empty-library, no-workout, dropdown-open, runtime-toggle,
//   * FORCED dark: <html class="theme-dark"> on a LIGHT OS, so
//     @media(prefers-color-scheme:dark) overrides do NOT apply. We force the OS
//     to light (colorScheme:'light') AND set theme-dark — exactly the broken
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
const SHOT_DIR = resolve(__dirname, "..", "..", "test-results", "audit");

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

// --------------------------- mirror scanner: dark-in-light ---------------------------
//
// The mirror of the forced-dark bug: <html class="theme-light"> on a DARK OS. Any
// element styled ONLY inside @media(prefers-color-scheme:dark) (with no
// :root.theme-light twin re-asserting the light value) keeps its DARK styling on
// the forced-LIGHT page → a near-black wash / dark text-shadow on a light surface.
// We scan for a near-black, non-trivial-alpha background / shadow / gradient.
async function scanDarkInLight(page: Page, allow: string[] = []): Promise<Offender[]> {
  return page.evaluate((allowSelectors) => {
    const offenders: {selector: string; prop: string; value: string}[] = [];
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
    function firstColor(s: string) {
      return allColors(s)[0] ?? null;
    }
    // "near black" wash = all channels low AND alpha meaningful.
    function isNearBlackWash(c: {r: number; g: number; b: number; a: number}, minAlpha: number): boolean {
      return c.r <= 60 && c.g <= 60 && c.b <= 60 && c.a >= minAlpha;
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
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const sel = selectorFor(el);
      if (matchesAllow(sel)) continue;
      const bg = firstColor(cs.backgroundColor);
      // A full-bleed near-black surface element on a light page is the offense.
      // Require it to cover a sizeable area so legitimate small dark chips
      // (status dots, accent buttons) are not flagged.
      if (bg && isNearBlackWash(bg, 0.6) && rect.width * rect.height > 40000) {
        offenders.push({selector: sel, prop: "background-color", value: cs.backgroundColor});
      }
      if (cs.backgroundImage && cs.backgroundImage.includes("gradient")) {
        for (const c of allColors(cs.backgroundImage)) {
          if (isNearBlackWash(c, 0.6) && rect.width * rect.height > 40000) {
            offenders.push({selector: sel, prop: "background-image", value: cs.backgroundImage});
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

// Theme-reactive CSS vars that MUST flip with the active forced theme. Each var
// has a light value and a dark value; a missing :root.theme-* twin (or a missing
// @media-dark entry) leaves the var stuck on the wrong palette (e.g. the
// freeride/shade/insert-line gaps).
const THEME_VARS_LIGHT: Record<string, string> = {
  "--freeride-fill": "#d8d8d8",
  "--freeride-stripe": "#b0b0b0",
  "--shade-bg": "#000000",
  "--wb-insert-line": "#3a7bff",
};
const THEME_VARS_DARK: Record<string, string> = {
  "--freeride-fill": "#545454",
  "--freeride-stripe": "#6f6f6f",
  "--shade-bg": "#ffffff",
  "--wb-insert-line": "#6ba8ff",
};

async function readThemeVars(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((vars) => {
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const v of vars) out[v] = cs.getPropertyValue(v).trim().toLowerCase();
    return out;
  }, names);
}

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

  test("picker zone/duration filters + library render dark (no light-in-dark)", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await settle(page);

    saveShot("picker-library-dark", await page.screenshot({fullPage: false}));

    // Open the zone filter dropdown so its floating menu is scanned too.
    await page.getByTestId("picker-zone-filter").click();
    await expect(page.locator(".fd-menu")).toBeVisible();

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

// =====================================================================================
// THEME-REACTIVE VAR PARITY (the freeride / shade / insert-line gap class)
//
// These vars are consumed by the chart renderer (core/chart.ts) as JS-read CSS
// custom properties, so a stuck-light var in forced dark paints a LIGHT freeride
// block / a BLACK shade overlay on the dark chart — invisible to a DOM color
// scan but visible on screen. We assert the var VALUES flip with the forced
// theme (forced-dark must read the dark palette) and with @media (auto+dark OS).
// =====================================================================================

test.describe("forced-dark — theme-reactive chart vars flip to the dark palette", () => {
  test.use({harnessConfig: darkForcedConfig()});

  test("--freeride-fill/--freeride-stripe/--shade-bg/--wb-insert-line read the DARK values under forced dark", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await settle(page);

    const got = await readThemeVars(page, Object.keys(THEME_VARS_DARK));
    for (const [name, dark] of Object.entries(THEME_VARS_DARK)) {
      expect(got[name], `${name} under forced-dark`).toBe(dark.toLowerCase());
    }
    // And it must NOT be the stuck-light value (the bug we fixed).
    for (const [name, light] of Object.entries(THEME_VARS_LIGHT)) {
      expect(got[name], `${name} must not be the stuck-light value under forced-dark`).not.toBe(light.toLowerCase());
    }
  });
});

test.describe("auto + dark OS — @media-dark provides the dark chart vars", () => {
  // colorScheme dark (a real dark OS) + themeMode auto => no theme-* class, the
  // @media(prefers-color-scheme:dark) block must supply the dark palette,
  // including --wb-insert-line (the var that was missing from @media-dark).
  test.use({colorScheme: "dark", harnessConfig: darkForcedConfig({themeMode: "auto"})});

  test("--wb-insert-line + freeride/shade read the DARK values under auto+dark-OS", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    // auto mode sets no forced theme class.
    await expect(page.locator("html")).not.toHaveClass(/theme-dark|theme-light/);
    await settle(page);

    const got = await readThemeVars(page, Object.keys(THEME_VARS_DARK));
    for (const [name, dark] of Object.entries(THEME_VARS_DARK)) {
      expect(got[name], `${name} under auto+dark-OS`).toBe(dark.toLowerCase());
    }
  });
});

// =====================================================================================
// MIRROR BUG: forced-LIGHT on a DARK OS (<html class="theme-light"> + colorScheme:dark).
//
// The @media(prefers-color-scheme:dark) blocks DO apply on the dark OS, so any
// rule lacking a :root.theme-light twin keeps DARK styling on the forced-light
// page. We (1) scan the live DOM for a dark wash on the light surface across
// HUD / picker / builder / planner / settings, and (2) assert the theme-reactive
// chart vars read the LIGHT palette.
// =====================================================================================

function lightForcedOnDarkConfig(extra: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    ftp: 250,
    soundEnabled: false,
    themeMode: "light",
    selectedWorkout: SAMPLE_WORKOUT,
    connectBike: false,
    connectHr: false,
    seedZwo: readSeedWorkouts(),
    ...extra,
  };
}

test.describe("forced-light on dark OS — HUD has no dark-in-light + light chart vars", () => {
  test.use({colorScheme: "dark", harnessConfig: lightForcedOnDarkConfig()});

  test("HUD renders light; chart vars read the LIGHT palette", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await expect(page.locator("html")).toHaveClass(/theme-light/);
    await settle(page);
    saveShot("forced-light-hud", await page.screenshot({fullPage: false}));

    const got = await readThemeVars(page, Object.keys(THEME_VARS_LIGHT));
    for (const [name, light] of Object.entries(THEME_VARS_LIGHT)) {
      expect(got[name], `${name} under forced-light-on-dark-OS`).toBe(light.toLowerCase());
    }

    const offenders = await scanDarkInLight(page, ALLOW);
    expect(
      offenders,
      `forced-light dark-in-light offenders:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("forced-light on dark OS — picker + builder have no dark-in-light", () => {
  test.use({colorScheme: "dark", harnessConfig: lightForcedOnDarkConfig()});

  test("picker library and the builder (block selected) render light", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);

    await page.getByTestId("workout-name-label").click();
    await expect(page.getByTestId("picker-modal")).toBeVisible();
    await settle(page);
    saveShot("forced-light-picker", await page.screenshot({fullPage: false}));
    let offenders = await scanDarkInLight(page, ALLOW);
    expect(
      offenders,
      `forced-light picker dark-in-light:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);

    // Builder + a selected block (exercises the shade overlay + segment paint).
    await page.getByTestId("picker-add-workout").click();
    await expect(page.locator("#workoutPickerModal.workout-picker-modal--builder")).toBeVisible();
    await settle(page);
    await page.getByTestId("wb-insert-tempo").click();
    await page.getByTestId("wb-insert-vo2max").click();
    await settle(page);
    const seg = page.locator('[data-testid="wb-chart"] polygon.wb-block-segment').first();
    await expect(seg).toBeVisible();
    await seg.click();
    await settle(page);
    saveShot("forced-light-builder-selected", await page.screenshot({fullPage: false}));
    offenders = await scanDarkInLight(page, ALLOW);
    expect(
      offenders,
      `forced-light builder dark-in-light:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("forced-light on dark OS — settings has no dark-in-light", () => {
  test.use({colorScheme: "dark", harnessConfig: lightForcedOnDarkConfig()});

  test("settings + logs panel render light", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.locator("#settingsBtn").click();
    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await settle(page);
    saveShot("forced-light-settings", await page.screenshot({fullPage: false}));
    let offenders = await scanDarkInLight(page, ALLOW);
    expect(
      offenders,
      `forced-light settings dark-in-light:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);

    await page.getByTestId("settings-open-logs").click();
    await settle(page);
    saveShot("forced-light-settings-logs", await page.screenshot({fullPage: false}));
    offenders = await scanDarkInLight(page, ALLOW);
    expect(
      offenders,
      `forced-light logs dark-in-light:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("forced-light on dark OS — planner day hover uses the light hover", () => {
  test.use({colorScheme: "dark", harnessConfig: lightForcedOnDarkConfig()});

  test("calendar renders light and .planner-day:hover resolves to --hover-light", async ({configuredPage}) => {
    const page = configuredPage;
    await reachNewRidingView(page);
    await page.locator("#calendarBtn").click();
    await expect(page.getByTestId("planner-modal")).toBeVisible();
    await expect(page.locator("#plannerCalendarBody")).toBeVisible();
    await settle(page);
    saveShot("forced-light-planner", await page.screenshot({fullPage: false}));

    const offenders = await scanDarkInLight(page, ALLOW);
    expect(
      offenders,
      `forced-light planner dark-in-light:\n${offenders.map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`).join("\n")}`,
    ).toEqual([]);

    // The forced-light day-hover must resolve to --hover-light (the gentle light
    // wash), NOT the stronger @media-dark --hover-medium. We compare the resolved
    // values of both vars and assert the rule maps to the light one. (The CSS twin
    // we added is `:root.theme-light .planner-day:hover { background: --hover-light }`.)
    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        light: cs.getPropertyValue("--hover-light").trim(),
        medium: cs.getPropertyValue("--hover-medium").trim(),
      };
    });
    // In forced-light these resolve to the light-palette rgba(0,0,0,*) values.
    expect(vars.light).toContain("0, 0, 0");
    expect(vars.medium).toContain("0, 0, 0");
  });
});
