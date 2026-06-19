// state/theme.svelte.ts
//
// Reactive "theme version" counters that increment when the theme changes, so
// charts (which read CSS-var colors at DRAW time, core/chart.ts getCssVar) can
// re-render with the now-current palette. Two counters mirror the two distinct
// legacy redraw wirings exactly:
//
//  * `version` — bumped on BOTH a manual <html> class/data-theme mutation AND an
//    Auto-mode OS light/dark flip. Read by the HUD + planner charts. Mirrors
//    docs/workout.js, which installs a MutationObserver on <html> (manual
//    toggle) AND a matchMedia('(prefers-color-scheme: dark)') listener (Auto OS
//    flip), both calling rerenderThemeSensitive() (HUD + planner).
//
//  * `autoVersion` — bumped ONLY on the Auto-mode OS flip (the matchMedia path).
//    Read by the picker mini-chart + builder chart. Mirrors
//    docs/workout-picker.js, which wires its picker/builder rerender to the
//    matchMedia listener ONLY — a manual data-theme toggle does NOT redraw the
//    picker/builder there (so the visual baselines stay valid).
//
// Components depend on the relevant counter inside their chart-render $effect so
// the effect re-runs on the theme change they care about. A single shared
// observer + media listener (installed lazily on first read) drives both.

import { applyThemeMode } from '../app/theme.js';

class ThemeStore {
  // Bumped on manual <html> mutation AND Auto OS flip (HUD + planner).
  version = $state(0);
  // Bumped ONLY on the Auto OS flip (picker mini-chart + builder chart).
  autoVersion = $state(0);

  private observer: MutationObserver | null = null;
  private mediaInstalled = false;

  /** Install the singleton <html> observer + the OS-theme listener (idempotent). */
  ensureObserver(): void {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (!this.observer) {
      this.observer = new MutationObserver(() => {
        this.version += 1;
      });
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
      });
    }
    // In Auto mode the <html> classes never change when the OS flips light/dark
    // (Auto reads the OS via CSS @media), so the MutationObserver above never
    // fires — charts read CSS-var colors at draw time and would keep the stale
    // palette. Listen for the OS change to (a) re-apply the Auto theme so any
    // class-derived state stays correct, and (b) bump BOTH counters so every
    // subscribed chart redraws. Mirrors legacy workout.js:1402-1406 +
    // workout-picker.js:2096-2107.
    if (!this.mediaInstalled && typeof matchMedia === 'function') {
      this.mediaInstalled = true;
      try {
        const mql = matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
          const mode = document.documentElement?.dataset?.theme;
          if (mode === 'auto') applyThemeMode('auto');
          this.version += 1;
          this.autoVersion += 1;
        };
        if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
        else if (typeof mql.addListener === 'function') mql.addListener(onChange);
      } catch {
        /* matchMedia unavailable — Auto OS-flip redraw simply won't fire */
      }
    }
  }
}

export const themeStore = new ThemeStore();

/**
 * Read inside a chart-render $effect so the effect re-runs on theme change
 * (manual toggle OR Auto OS flip). For HUD + planner charts. Lazily installs the
 * shared <html> MutationObserver + OS-theme listener on first use.
 */
export function themeVersion(): number {
  themeStore.ensureObserver();
  return themeStore.version;
}

/**
 * Read inside a chart-render $effect so the effect re-runs ONLY on an Auto-mode
 * OS light/dark flip (NOT a manual toggle). For the picker mini-chart + builder
 * chart, matching legacy workout-picker.js's matchMedia-only redraw wiring.
 */
export function themeAutoVersion(): number {
  themeStore.ensureObserver();
  return themeStore.autoVersion;
}
