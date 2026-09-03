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
import { getSettings, resolveQueries } from "../shared/settings.js";
import { buildPRUrl } from "../shared/constants.js";
import { githubFetch } from "../background/github-transport.js";

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * Fetch and parse the user's open PRs across all configured queries.
 *
 * When multiple queries are configured they are fetched together and merged,
 * de-duplicated by PR URL (a PR matching several queries appears once).
 *
 * @returns {Promise<Array | null>} PR list or null if not logged in
 */
export async function fetchPRs() {
  const settings = await getSettings();
  const entries = resolveQueries(settings); // [{ label, query }]

  const results = await Promise.all(entries.map((e) => fetchForQuery(e.query)));

  // If every query reports "not logged in", surface that. A single logged-in
  // query is enough to treat the session as authenticated.
  if (results.every((r) => r === null)) return null;

  return mergePRs(entries, results);
}

/**
 * Fetch and parse a single query's PRs.
 * @returns {Promise<Array | null>} PR list, or null if not logged in
 */
async function fetchForQuery(query) {
  const url = buildPRUrl(query);

  // Strategy 1: JSON
  const jsonResult = await tryFetchJSON(url);
  if (jsonResult === null) return null;       // not logged in
  if (Array.isArray(jsonResult)) return jsonResult;

  // Strategy 2: HTML fallback
  return await tryFetchHTML(url);
}

/**
 * Merge PR lists from multiple queries, de-duplicating by URL. Each PR is
 * tagged with the label(s) of every query that surfaced it, so the popup and
 * bookmarks can show where a PR came from.
 * @param {Array<{label: string, query: string}>} entries
 * @param {Array<Array | null>} results - fetch result per entry, same order
 * @returns {Array}
 */
function mergePRs(entries, results) {
  const byUrl = new Map();
  results.forEach((list, i) => {
    if (!Array.isArray(list)) return;
    const label = entries[i].label;
    for (const pr of list) {
      if (!pr || !pr.url) continue;
      const existing = byUrl.get(pr.url);
      if (existing) {
        if (!existing.sources.includes(label)) existing.sources.push(label);
      } else {
        byUrl.set(pr.url, { ...pr, sources: [label] });
      }
    }
  });
  return [...byUrl.values()];
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

// ─── Strategy 2: HTML + DOM parsing ──────────────────────────────────────────
//
// The HTML fallback needs a DOM parser. Chrome MV3 service workers don't have
// `DOMParser`, so we delegate to an offscreen document. Firefox background
// scripts (and any context with `DOMParser`) parse inline. We feature-detect at
// runtime so the same file works in both builds.

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

  // Firefox path: parse inline with the available DOMParser.
  if (canParseInline()) {
    return parseHTMLForPRs(text);
  }

  // Chrome path: delegate to the offscreen document.
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ action: "parseHTML", html: text });
  if (!result) throw new Error("Offscreen document did not respond");
  if (result.loggedOut) return null;
  return result.prs;
}

/**
 * True when this runtime can parse HTML without an offscreen document, i.e. it
 * exposes DOMParser and lacks the offscreen API (Firefox background scripts).
 */
function canParseInline() {
  return typeof DOMParser !== "undefined" && !globalThis.chrome?.offscreen;
}

/**
 * Parse GitHub HTML into PR objects using DOMParser. Mirrors the logic in the
 * offscreen document so both code paths behave identically.
 */
function parseHTMLForPRs(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const scripts = doc.querySelectorAll(
    'script[type="application/json"][data-target="react-partial.embeddedData"], script[type="application/json"]'
  );
  for (const script of scripts) {
    const content = script.textContent.trim();
    if (!content.includes("pullsDashboardSurfaceContentRoute") && !content.includes("pull_request")) continue;
    try {
      const prs = extractPRsFromPayload(JSON.parse(content));
      if (prs?.length > 0) return prs;
    } catch (_) { /* not the payload we want */ }
  }

  // Fallback: scrape anchor links to PRs.
  const links = doc.querySelectorAll('a[href*="/pull/"]');
  const seen = new Set();
  const prs = [];
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const match = href.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
    if (!match) continue;
    const url = `https://github.com${href}`;
    if (seen.has(url)) continue;
    seen.add(url);
    prs.push({
      url,
      repo: match[1].split("/")[1] || match[1],
      repoFullName: match[1],
      title: link.textContent.trim() || `PR #${match[2]}`,
      number: parseInt(match[2], 10),
      isDraft: false,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  }
  return prs;
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
