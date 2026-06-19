// state/theme.svelte.ts
//
// A reactive "theme version" counter that increments whenever the <html>
// theme classes / data-theme change. Charts read colors from CSS variables at
// DRAW time (core/chart.ts getCssVar), so a theme switch leaves stale colors
// unless the chart is re-rendered. Mirrors the legacy app's theme-sensitive
// redraw: docs/workout.js installs a MutationObserver on <html> watching
// class/data-theme and calls rerenderThemeSensitive() (HUD + planner charts);
// docs/workout-picker.js does the same for its open picker/builder table.
//
// Components depend on `themeStore.version` inside their chart-render $effect so
// the effect re-runs (and redraws with the now-current palette) on every theme
// toggle. A single shared MutationObserver (installed lazily on first read of
// the store) drives it for the whole app.

class ThemeStore {
  // Bumped on every <html> class / data-theme mutation. Read this in a chart
  // render $effect to make the effect theme-reactive.
  version = $state(0);

  private observer: MutationObserver | null = null;

  /** Install the singleton <html> observer (idempotent). */
  ensureObserver(): void {
    if (this.observer || typeof document === 'undefined' || !document.documentElement) return;
    this.observer = new MutationObserver(() => {
      this.version += 1;
    });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
  }
}

export const themeStore = new ThemeStore();

/**
 * Read inside a chart-render $effect so the effect re-runs on theme change.
 * Lazily installs the shared <html> MutationObserver on first use.
 */
export function themeVersion(): number {
  themeStore.ensureObserver();
  return themeStore.version;
}
