/**
 * Toolbar icon theming.
 *
 * The toolbar icon follows the extension's own theme setting chosen in options:
 *   light        → dark glyph
 *   dark         → white glyph
 *   hello-kitty  → pink glyph
 *   system       → follow the OS scheme (light → dark glyph, dark → white glyph)
 *
 * Service workers can't read `prefers-color-scheme`, so for the "system" theme
 * the popup/options pages (which are styled by prefers-color-scheme) report the
 * OS scheme, which we cache so "system" can be resolved even with no page open.
 */

import { getSettings } from "../shared/settings.js";

const OS_SCHEME_KEY = "osColorScheme";

function suffixForTheme(theme, osScheme) {
  switch (theme) {
    case "light": return "-light";  // dark glyph on the light UI
    case "dark": return "-dark";    // white glyph on the dark UI
    case "hello-kitty": return "-kitty";
    case "system":
      // Follow the OS: dark OS → white glyph (-dark file), light OS → dark glyph.
      return osScheme === "dark" ? "-dark" : "-light";
    default:
      return "-light";
  }
}

function iconPaths(theme, osScheme) {
  const suffix = suffixForTheme(theme, osScheme);
  // Absolute extension URLs — a module service worker resolves relative paths
  // against the wrong base, which makes setIcon fail to download the images.
  return {
    16: chrome.runtime.getURL(`icons/icon16${suffix}.png`),
    48: chrome.runtime.getURL(`icons/icon48${suffix}.png`),
  };
}

/**
 * Apply the toolbar icon for a theme, resolving "system" via the given OS scheme.
 *
 * Primary path: setIcon with absolute extension URLs. If the browser can't
 * fetch those from the worker, fall back to decoding the PNGs into ImageData.
 */
export async function applyIconForTheme(theme, osScheme) {
  const paths = iconPaths(theme, osScheme);
  try {
    await chrome.action.setIcon({ path: paths });
    return;
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] setIcon(path) failed, trying imageData:", err.message);
  }

  try {
    const imageData = await loadImageData(paths);
    await chrome.action.setIcon({ imageData });
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Failed to set toolbar icon:", err.message);
  }
}

/**
 * Decode icon PNGs into ImageData keyed by size for setIcon({ imageData }).
 * @param {Record<number, string>} paths - size → extension URL
 */
async function loadImageData(paths) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([size, url]) => {
      const response = await fetch(url);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      return [size, ctx.getImageData(0, 0, bitmap.width, bitmap.height)];
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Read the current theme from settings and apply the matching toolbar icon,
 * using the last OS scheme reported by a page for the "system" theme.
 */
export async function refreshThemeIcon() {
  const { theme } = await getSettings();
  const { [OS_SCHEME_KEY]: osScheme } = await chrome.storage.local.get(OS_SCHEME_KEY);
  await applyIconForTheme(theme, osScheme || "light");
}

/**
 * Record the OS color scheme reported by a page and refresh the icon if the
 * current theme follows the system.
 * @param {"light" | "dark"} scheme
 */
export async function setOsScheme(scheme) {
  const normalized = scheme === "dark" ? "dark" : "light";
  await chrome.storage.local.set({ [OS_SCHEME_KEY]: normalized });
  const { theme } = await getSettings();
  if (theme === "system") await applyIconForTheme(theme, normalized);
}
