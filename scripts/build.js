/**
 * One build, one zip — a single universal package for both the Chrome Web Store
 * and Firefox (AMO).
 *
 * How one zip works in both browsers:
 *  - manifest.json declares BOTH background.service_worker (Chrome) and
 *    background.scripts (Firefox). Each browser reads the field it supports and
 *    ignores the other (works in Chrome 121+ and Firefox 121+).
 *  - browser_specific_settings.gecko is read by Firefox and ignored by Chrome.
 *  - The "offscreen" permission / offscreen document is used only by Chrome;
 *    the fetcher feature-detects DOMParser vs the offscreen document at runtime,
 *    so Firefox never touches it.
 *
 * Bump the version once in manifest.json.
 *
 * Usage: node scripts/build.js
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "pkg");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// Every file the package ships. Paths are relative to the repo root.
const files = [
  "manifest.json",
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  // Per-theme toolbar icon variants, swapped at runtime by icon-theme.js to
  // match the extension's theme setting (light / dark / hello-kitty / system).
  "icons/icon16-light.png",
  "icons/icon16-dark.png",
  "icons/icon16-kitty.png",
  "icons/icon48-light.png",
  "icons/icon48-dark.png",
  "icons/icon48-kitty.png",
  "src/background/index.js",
  "src/background/icon-theme.js",
  "src/background/github-transport.js",
  "src/background/revert-file.js",
  "src/background/badge.js",
  "src/background/notifications.js",
  "src/background/copilot-sync.js",
  "src/background/alarm.js",
  "src/background/sync.js",
  manifest.action.default_popup,
  "src/popup/popup.js",
  "src/popup/dom.js",
  "src/popup/format.js",
  "src/popup/status.js",
  "src/popup/pr-list.js",
  "src/popup/copilot.js",
  "src/popup/popup.css",
  manifest.options_ui.page,
  "src/options/options.js",
  "src/options/dom.js",
  "src/options/form.js",
  "src/options/toast.js",
  "src/options/options.css",
  ...manifest.content_scripts.flatMap((s) => s.js),
  // Offscreen document — Chrome-only at runtime, harmless in the Firefox package.
  "src/offscreen/offscreen.html",
  "src/offscreen/offscreen.js",
  "src/shared/constants.js",
  "src/shared/settings.js",
  "src/shared/status.js",
  "src/shared/theme.js",
  "src/shared/os-scheme.js",
  "src/bookmarks/index.js",
  "src/fetcher/index.js",
  "src/fetcher/parser.js",
  "src/copilot/fetcher.js",
  "src/copilot/projection.js",
];

// ─── Validate ────────────────────────────────────────────────────────────────
if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){1,3}$/.test(manifest.version)) {
  throw new Error("Manifest version must contain one to four numeric components.");
}
if (manifest.description.length > 132) {
  throw new Error("Manifest description exceeds the 132-character store limit.");
}
// Sanity: the unified manifest must carry both background forms so one zip works
// in both browsers.
if (!manifest.background.service_worker || !manifest.background.scripts) {
  throw new Error("manifest.background must declare both service_worker (Chrome) and scripts (Firefox).");
}

// ─── Stage & copy ────────────────────────────────────────────────────────────
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const rel of [...new Set(files)]) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error(`Missing resource: ${rel}`);
  const dest = path.join(STAGE, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// ─── Zip ─────────────────────────────────────────────────────────────────────
const archive = path.join(DIST, `ofers-github-tools-${manifest.version}.zip`);
fs.rmSync(archive, { force: true });
if (process.platform === "win32") {
  execFileSync("powershell", [
    "-NoProfile", "-Command",
    `Compress-Archive -Path '${path.join(STAGE, "*")}' -DestinationPath '${archive}' -Force`,
  ]);
} else {
  execFileSync("zip", ["-qr", archive, "."], { cwd: STAGE });
}

console.log(`Built ${path.relative(ROOT, archive)} — upload the same zip to both the Chrome Web Store and Firefox AMO.`);
