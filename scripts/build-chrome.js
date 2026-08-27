/**
 * Build the Chrome Web Store upload package.
 * Usage: node scripts/build-chrome.js
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist", "chrome");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const files = [
  "manifest.json",
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  manifest.background.service_worker,
  "src/background/github-transport.js",
  "src/background/revert-file.js",
  "src/background/badge.js",
  "src/background/notifications.js",
  "src/background/copilot-sync.js",
  manifest.action.default_popup,
  "src/popup/popup.js",
  "src/popup/dom.js",
  "src/popup/format.js",
  "src/popup/status.js",
  "src/popup/pr-list.js",
  "src/popup/copilot.js",
  manifest.options_ui.page,
  "src/options/options.js",
  "src/options/dom.js",
  "src/options/form.js",
  "src/options/toast.js",
  "src/options/import-export.js",
  ...manifest.content_scripts.flatMap((script) => script.js),
  "src/popup/popup.css",
  "src/options/options.css",
  "src/offscreen/offscreen.html",
  "src/offscreen/offscreen.js",
  "src/shared/constants.js",
  "src/shared/settings.js",
  "src/shared/status.js",
  "src/background/alarm.js",
  "src/background/sync.js",
  "src/bookmarks/index.js",
  "src/fetcher/index.js",
  "src/fetcher/parser.js",
  "src/copilot/fetcher.js",
  "src/copilot/projection.js",
];

function copyFile(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(DIST, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Missing manifest resource: ${relativePath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){1,3}$/.test(manifest.version)) {
  throw new Error("Manifest version must contain one to four numeric components.");
}

if (manifest.description.length > 132) {
  throw new Error("Manifest description exceeds Chrome's 132-character limit.");
}

fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const file of [...new Set(files)]) copyFile(file);

const archive = path.join(ROOT, "dist", `ofers-github-tools-${manifest.version}.zip`);
execFileSync("zip", ["-qr", archive, "."], { cwd: DIST });

console.log(`Built ${path.relative(ROOT, archive)}`);