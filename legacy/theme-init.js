(function applyInitialTheme() {
  try {
    const root = document.documentElement;
    const mode = localStorage.getItem("themeMode") || "auto";
    root.classList.remove("theme-light", "theme-dark");
    if (mode === "dark") {
      root.classList.add("theme-dark");
    } else if (mode === "light") {
      root.classList.add("theme-light");
    }
    root.dataset.theme = mode;
  } catch (_err) {
    // Ignore CSP/storage errors and leave system theme behavior.
  }
})();
