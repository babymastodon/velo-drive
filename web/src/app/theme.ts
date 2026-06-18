// theme.ts
//
// TypeScript port of docs/theme.js: apply the theme by toggling <html> classes
// (theme-light / theme-dark) + data-theme, and persist the chosen mode. The
// legacy app persists the mode to BOTH localStorage (for the anti-FOUC inline
// script) and the IndexedDB "settings" store; we mirror that so the new app
// boots in the same theme and a pixel diff sees identical theming.

import type { FileStore } from '../ports/FileStore.js';

const THEME_CLASS_LIGHT = 'theme-light';
const THEME_CLASS_DARK = 'theme-dark';
const STORAGE_THEME_MODE = 'themeMode';

export type ThemeMode = 'light' | 'dark' | 'auto';

export function normalizeThemeMode(mode: unknown): ThemeMode {
  return mode === 'dark' || mode === 'light' ? mode : 'auto';
}

/** Toggle the <html> theme classes + data-theme (mirrors applyThemeMode). */
export function applyThemeMode(mode: unknown): ThemeMode {
  const root = document?.documentElement;
  const next = normalizeThemeMode(mode);
  if (!root) return next;
  root.classList.remove(THEME_CLASS_LIGHT, THEME_CLASS_DARK);
  if (next === 'dark') root.classList.add(THEME_CLASS_DARK);
  else if (next === 'light') root.classList.add(THEME_CLASS_LIGHT);
  root.dataset.theme = next;
  return next;
}

/** Read the persisted theme mode (localStorage first, then the store). */
export async function loadThemeMode(store: FileStore): Promise<ThemeMode> {
  try {
    const cached =
      typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_THEME_MODE) : null;
    if (cached === 'dark' || cached === 'light' || cached === 'auto') return cached;
  } catch {
    /* ignore localStorage failures */
  }
  const raw = await store.getSetting<string>(STORAGE_THEME_MODE, 'auto');
  return normalizeThemeMode(raw);
}

/** Apply + persist the theme mode (mirrors saveAndApplyThemeMode). */
export async function saveAndApplyThemeMode(store: FileStore, mode: unknown): Promise<ThemeMode> {
  const next = applyThemeMode(mode);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_THEME_MODE, next);
  } catch {
    /* ignore localStorage failures */
  }
  await store.putSetting(STORAGE_THEME_MODE, next);
  return next;
}
