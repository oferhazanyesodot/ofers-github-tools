/**
 * PR Fetcher — retrieves the user's open PRs from GitHub.
 *
 * Strategy:
 *  1. JSON fetch (Accept: application/json) — fast, no DOM needed.
 *  2. HTML fetch + offscreen document parsing — fallback if JSON unavailable.
 *
 * Return values:
 *  - Array   → PR list (may be empty if user has 0 open PRs)
 *  - null    → user is not logged in to GitHub
 *  - throws  → transient error (network, unexpected response)
 */

import { extractPRsFromPayload } from "./parser.js";
import { getSettings } from "../shared/settings.js";
import { buildPRUrl } from "../shared/constants.js";
import { githubFetch } from "../background/github-transport.js";

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * Fetch and parse the user's open PRs.
 * @returns {Promise<Array | null>} PR list or null if not logged in
 */
export async function fetchPRs() {
  const { query } = await getSettings();
  const url = buildPRUrl(query);

  // Strategy 1: JSON
  const jsonResult = await tryFetchJSON(url);
  if (jsonResult === null) return null;       // not logged in
  if (Array.isArray(jsonResult)) return jsonResult;

  // Strategy 2: HTML fallback
  return await tryFetchHTML(url);
}

// ─── Strategy 1: JSON ────────────────────────────────────────────────────────

async function tryFetchJSON(url) {
  try {
    const response = await githubFetch(url, {
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

          // Payload structure exists but 0 PRs — valid empty state
          if (data?.payload?.pullsDashboardSurfaceContentRoute) {
            return data.payload.pullsDashboardSurfaceContentRoute.results || [];
          }
        } catch (_) { /* not valid JSON */ }
      }

      if (looksLikeLoginPage(text)) return null;
    }

    return undefined; // signal: try HTML fallback
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] JSON fetch failed:", err.message);
    return undefined;
  }
}

// ─── Strategy 2: HTML + Offscreen ────────────────────────────────────────────

async function tryFetchHTML(url) {
  const response = await githubFetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
  });

  if (isAuthError(response)) return null;
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

  const text = await response.text();
  if (looksLikeLoginPage(text)) return null;

  // Maybe the body is actually JSON despite the Accept header
  if (text.trim().startsWith("{")) {
    try {
      const prs = extractPRsFromPayload(JSON.parse(text));
      if (prs) return prs;
    } catch (_) { /* not JSON */ }
  }

  // Delegate to offscreen document for DOM parsing
  await ensureOffscreenDocument();

  const result = await chrome.runtime.sendMessage({ action: "parseHTML", html: text });
  if (!result) throw new Error("Offscreen document did not respond");
  if (result.loggedOut) return null;

  return result.prs;
}

// ─── Offscreen Document Lifecycle ────────────────────────────────────────────

let offscreenReady = false;

async function ensureOffscreenDocument() {
  if (offscreenReady) return;

  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) {
    offscreenReady = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse GitHub HTML to extract PR list",
  });
  offscreenReady = true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRedirect(response) {
  return response.type === "opaqueredirect" || response.status === 302 || response.status === 301;
}

function isAuthError(response) {
  return response.status === 401 || response.status === 403;
}

function looksLikeLoginPage(html) {
  return html.includes("/login") && html.includes("Sign in");
}
