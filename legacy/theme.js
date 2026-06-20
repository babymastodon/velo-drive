import {loadThemeMode, saveThemeMode} from "./storage.js";

const THEME_CLASS_LIGHT = "theme-light";
const THEME_CLASS_DARK = "theme-dark";

export function applyThemeMode(mode) {
  const root = document?.documentElement;
  if (!root) return;

  const next = mode === "dark" || mode === "light" ? mode : "auto";
  root.classList.remove(THEME_CLASS_LIGHT, THEME_CLASS_DARK);

  if (next === "dark") {
    root.classList.add(THEME_CLASS_DARK);
  } else if (next === "light") {
    root.classList.add(THEME_CLASS_LIGHT);
  }

  root.dataset.theme = next;
}

export async function initThemeFromStorage() {
  const mode = await loadThemeMode("auto");
  applyThemeMode(mode);
  return mode;
}

export async function saveAndApplyThemeMode(mode) {
  const next = mode === "dark" || mode === "light" ? mode : "auto";
  applyThemeMode(next);
  await saveThemeMode(next);
  return next;
}
