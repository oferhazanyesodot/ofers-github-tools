/**
 * Theme application — sets a `data-theme` attribute and an `--accent` CSS
 * variable on <html> so the popup and options pages can restyle themselves.
 *
 * Themes:
 *  - system: follow the OS via prefers-color-scheme (no attribute set)
 *  - light / dark: force the palette
 *  - hello-kitty: a pink light theme with its own accent
 */

/**
 * Apply the given appearance settings to the document.
 * @param {{theme?: string, accentColor?: string}} settings
 */
export function applyTheme(settings) {
  const theme = settings?.theme || "system";
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }

  // Hello Kitty forces its own accent; otherwise use the user's accent.
  const accent = theme === "hello-kitty" ? "#ff5fa2" : settings?.accentColor || "#1f6feb";
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-hover", shade(accent, -12));
  // Derive a soft tint of the accent for hover backgrounds / focus rings so
  // every accent-tinted surface matches the chosen accent color.
  root.style.setProperty("--accent-soft", rgba(accent, 0.14));

  // Pick readable text color for on-accent surfaces (buttons).
  root.style.setProperty("--accent-fg", isLight(accent) ? "#1f2328" : "#ffffff");

  // Base font size for the popup (clamped to a sensible range).
  const fontSize = Math.max(11, Math.min(16, Number(settings?.fontSize) || 12));
  root.style.setProperty("--popup-font-size", `${fontSize}px`);

  // Update the page favicon (options tab) to match the theme, if present.
  updateFavicon(theme);
}

/**
 * Point the page's favicon at the icon variant matching the theme, so the
 * extension's own tabs (e.g. the Settings page) don't show the greyish default.
 */
function updateFavicon(theme) {
  const link = typeof document !== "undefined" && document.getElementById("favicon");
  if (!link) return;

  const osDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  const suffix =
    theme === "light" ? "-light" :
    theme === "dark" ? "-dark" :
    theme === "hello-kitty" ? "-kitty" :
    (osDark ? "-dark" : "-light"); // system → follow OS

  link.href = `../../icons/icon48${suffix}.png`;
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return `rgba(31,111,235,${alpha})`;
  const num = parseInt(value, 16);
  return `rgba(${num >> 16}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`;
}

function isLight(hex) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const num = parseInt(value, 16);
  const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
  // Perceived luminance
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
}

/**
 * Darken/lighten a hex color by a percentage (-100..100).
 */
function shade(hex, percent) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const num = parseInt(value, 16);
  const amt = Math.round(2.55 * percent);
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0x00ff) + amt);
  const b = clamp((num & 0x0000ff) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}
