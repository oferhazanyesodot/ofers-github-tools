/**
 * Build script for Firefox version of the extension.
 * 
 * Firefox differences from Chrome:
 *  - No offscreen documents (DOMParser available in background scripts)
 *  - Uses "background.scripts" instead of "service_worker"
 *  - Needs browser_specific_settings.gecko
 *  - No chrome.runtime.getContexts()
 *  - No chrome.offscreen API
 *
 * This script copies src/ into firefox/ with a Firefox-specific manifest
 * and a modified fetcher that uses DOMParser directly.
 *
 * Usage: node scripts/build-firefox.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "firefox");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mkdirp(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  mkdirp(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

function writeFile(dest, content) {
  mkdirp(path.dirname(dest));
  fs.writeFileSync(dest, content, "utf8");
}

// ─── Clean ───────────────────────────────────────────────────────────────────

if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
}
mkdirp(OUT);

// ─── Copy icons ──────────────────────────────────────────────────────────────

copyDir(path.join(ROOT, "icons"), path.join(OUT, "icons"));

// ─── Copy popup ──────────────────────────────────────────────────────────────

copyDir(path.join(ROOT, "src", "popup"), path.join(OUT, "popup"));

// ─── Copy options ────────────────────────────────────────────────────────────

copyDir(path.join(ROOT, "src", "options"), path.join(OUT, "options"));

// ─── Copy shared ─────────────────────────────────────────────────────────────

copyDir(path.join(ROOT, "src", "shared"), path.join(OUT, "shared"));

// ─── Copy fetcher (parser only — index.js will be rewritten) ─────────────────

mkdirp(path.join(OUT, "fetcher"));
copyFile(
  path.join(ROOT, "src", "fetcher", "parser.js"),
  path.join(OUT, "fetcher", "parser.js")
);

// ─── Copy bookmarks ──────────────────────────────────────────────────────────

copyDir(path.join(ROOT, "src", "bookmarks"), path.join(OUT, "bookmarks"));

// ─── Copy background (alarm + sync) ─────────────────────────────────────────

mkdirp(path.join(OUT, "background"));
copyFile(
  path.join(ROOT, "src", "background", "alarm.js"),
  path.join(OUT, "background", "alarm.js")
);
copyFile(
  path.join(ROOT, "src", "background", "sync.js"),
  path.join(OUT, "background", "sync.js")
);
copyFile(
  path.join(ROOT, "src", "background", "index.js"),
  path.join(OUT, "background", "index.js")
);

// ─── Write Firefox-specific fetcher/index.js ─────────────────────────────────
// Firefox background scripts have DOMParser, so no offscreen document needed.

const firefoxFetcher = `/**
 * PR Fetcher — Firefox version.
 * Firefox background scripts have DOMParser available,
 * so no offscreen document is needed.
 */

import { extractPRsFromPayload } from "./parser.js";
import { getSettings } from "../shared/settings.js";
import { buildPRUrl } from "../shared/constants.js";

export async function fetchPRs() {
  const { query } = await getSettings();
  const url = buildPRUrl(query);

  // Strategy 1: JSON
  const jsonResult = await tryFetchJSON(url);
  if (jsonResult === null) return null;
  if (Array.isArray(jsonResult)) return jsonResult;

  // Strategy 2: HTML with DOMParser (available in Firefox background)
  return await tryFetchHTML(url);
}

async function tryFetchJSON(url) {
  try {
    const response = await fetch(url, {
      credentials: "include",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });

    if (isRedirect(response) || isAuthError(response)) return null;

    if (response.status === 200) {
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      if (contentType.includes("json") || text.trim().startsWith("{")) {
        try {
          const data = JSON.parse(text);
          const prs = extractPRsFromPayload(data);
          if (prs && prs.length > 0) return prs;

          if (data?.payload?.pullsDashboardSurfaceContentRoute) {
            return data.payload.pullsDashboardSurfaceContentRoute.results || [];
          }
        } catch (_) {}
      }

      if (looksLikeLoginPage(text)) return null;
    }

    return undefined;
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] JSON fetch failed:", err.message);
    return undefined;
  }
}

async function tryFetchHTML(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });

  if (isAuthError(response)) return null;
  if (!response.ok) throw new Error(\`GitHub returned HTTP \${response.status}\`);

  const text = await response.text();
  if (looksLikeLoginPage(text)) return null;

  // Try as JSON first
  if (text.trim().startsWith("{")) {
    try {
      const prs = extractPRsFromPayload(JSON.parse(text));
      if (prs) return prs;
    } catch (_) {}
  }

  // Parse HTML with DOMParser (available in Firefox background scripts)
  return parseHTMLForPRs(text);
}

function parseHTMLForPRs(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Try script tags with embedded JSON
  const scripts = doc.querySelectorAll(
    'script[type="application/json"][data-target="react-partial.embeddedData"], ' +
    'script[type="application/json"]'
  );

  for (const script of scripts) {
    const content = script.textContent.trim();
    if (!content.includes("pullsDashboardSurfaceContentRoute") && !content.includes("pull_request")) {
      continue;
    }
    try {
      const prs = extractPRsFromPayload(JSON.parse(content));
      if (prs?.length > 0) return prs;
    } catch (_) {}
  }

  // Fallback: anchor links
  const links = doc.querySelectorAll('a[href*="/pull/"]');
  const seen = new Set();
  const prs = [];

  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const match = href.match(/^\\/([^/]+\\/[^/]+)\\/pull\\/(\\d+)$/);
    if (!match) continue;

    const url = \`https://github.com\${href}\`;
    if (seen.has(url)) continue;
    seen.add(url);

    prs.push({
      url,
      repo: match[1].split("/")[1] || match[1],
      title: link.textContent.trim() || \`PR #\${match[2]}\`,
      isDraft: false,
      updatedAt: new Date().toISOString(),
      number: parseInt(match[2], 10),
      repoFullName: match[1],
    });
  }

  return prs;
}

function isRedirect(response) {
  return response.type === "opaqueredirect" || response.status === 302 || response.status === 301;
}

function isAuthError(response) {
  return response.status === 401 || response.status === 403;
}

function looksLikeLoginPage(html) {
  return html.includes("/login") && html.includes("Sign in");
}
`;

writeFile(path.join(OUT, "fetcher", "index.js"), firefoxFetcher);

// ─── Write Firefox manifest ──────────────────────────────────────────────────

const manifest = {
  manifest_version: 3,
  name: "GitHub PR Bookmark Folder",
  version: "1.1.2",
  description: "Automatically maintains a bookmark folder with your open GitHub Pull Requests, using your existing GitHub session.",
  browser_specific_settings: {
    gecko: {
      id: "github-pr-bookmarks@oferhazanyesodot",
      strict_min_version: "109.0",
    },
  },
  permissions: [
    "bookmarks",
    "alarms",
    "storage",
    "notifications",
  ],
  host_permissions: [
    "https://github.com/*",
  ],
  background: {
    scripts: ["background/index.js"],
    type: "module",
  },
  icons: {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  action: {
    default_popup: "popup/popup.html",
    default_icon: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
  options_ui: {
    page: "options/options.html",
    open_in_tab: true,
  },
  commands: {
    "sync-now": {
      suggested_key: {
        default: "Alt+Shift+P",
      },
      description: "Sync PRs now",
    },
  },
};

writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ─── Fix import paths in popup and options ───────────────────────────────────
// In Chrome src/ layout: "../shared/settings.js"
// In Firefox flat layout: "../shared/settings.js" (same relative paths since we mirror the structure)

// ─── Remove offscreen references from background/sync.js if any ──────────────
// The sync.js doesn't reference offscreen, so no changes needed.

// ─── Done ────────────────────────────────────────────────────────────────────

console.log("Firefox build created in firefox/");
console.log("");
console.log("To test:");
console.log("  1. Open Firefox → about:debugging#/runtime/this-firefox");
console.log("  2. Click 'Load Temporary Add-on'");
console.log("  3. Select firefox/manifest.json");
console.log("");
console.log("To package for AMO:");
console.log("  cd firefox && zip -r ../github-pr-bookmark-folder-firefox.zip .");
