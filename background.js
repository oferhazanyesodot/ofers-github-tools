/**
 * GitHub PR Bookmark Folder - Background Service Worker
 *
 * Periodically fetches the user's open PRs from GitHub using the existing
 * browser session (no OAuth, no API tokens) and synchronizes a bookmark folder.
 *
 * Inspired by https://github.com/shiruten/pr-live-folder
 * Authentication layer replaced entirely with session-cookie-based fetch.
 */

"use strict";

const ALARM_NAME = "github-pr-sync";
const ALARM_INTERVAL_MINUTES = 5;
const FOLDER_NAME = "GitHub PRs";
const GITHUB_PR_URL =
  "https://github.com/pulls?q=is%3Apr+state%3Aopen+archived%3Afalse+sort%3Aupdated-desc+author%3A%40me";

// ─── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarm();
  await syncPRs();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await syncPRs();
  }
});

// Also sync when the service worker wakes up (e.g. after browser restart)
chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  await syncPRs();
});

// Handle manual sync requests from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "syncNow") {
    syncPRs().then(() => sendResponse({ done: true }));
    return true; // Keep message channel open for async response
  }
});

// ─── Alarm Setup ─────────────────────────────────────────────────────────────

async function setupAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_INTERVAL_MINUTES });
  }
}

// ─── Main Sync Logic ─────────────────────────────────────────────────────────

async function syncPRs() {
  let prs;
  try {
    prs = await fetchAndParsePRs();
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Failed to fetch PRs:", err.message);
    await setStatus("error", err.message);
    return; // Never destroy bookmarks on failure
  }

  if (prs === null) {
    // User is not logged in
    console.info("[GitHub PR Bookmarks] User not logged in to GitHub.");
    await setStatus("not_logged_in", "Not logged in to GitHub.");
    return;
  }

  try {
    await synchronizeBookmarks(prs);
    await setStatus("ok", `Synced ${prs.length} PRs at ${new Date().toLocaleTimeString()}`);
    // Show PR count on the extension badge
    const badgeText = prs.length > 0 ? String(prs.length) : "";
    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
  } catch (err) {
    console.error("[GitHub PR Bookmarks] Bookmark sync error:", err.message);
    await setStatus("error", err.message);
  }
}

// ─── Offscreen Document Management ───────────────────────────────────────────

let offscreenCreated = false;

async function ensureOffscreenDocument() {
  if (offscreenCreated) return;

  // Check if one already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Parse GitHub HTML to extract PR list",
  });
  offscreenCreated = true;
}

// ─── Fetch & Parse ───────────────────────────────────────────────────────────

async function fetchAndParsePRs() {
  // Strategy 1: Request JSON directly using GitHub's internal Accept header.
  // GitHub's React frontend fetches page data via this same URL with Accept: application/json.
  const jsonPrs = await tryFetchJSON();

  // null = not logged in, undefined = try fallback, array = success
  if (jsonPrs === null) {
    return null;
  }
  if (Array.isArray(jsonPrs)) {
    return jsonPrs;
  }

  // Strategy 2: Fetch the HTML page and parse embedded JSON from script tags.
  const htmlPrs = await tryFetchHTML();
  return htmlPrs;
}

/**
 * Fetch the pulls page with Accept: application/json.
 * GitHub returns the embedded JSON payload directly when this header is present.
 */
async function tryFetchJSON() {
  try {
    const response = await fetch(GITHUB_PR_URL, {
      credentials: "include",
      redirect: "manual",
      headers: {
        Accept: "application/json",
      },
    });

    // A redirect likely means we're not logged in
    if (response.type === "opaqueredirect" || response.status === 302 || response.status === 301) {
      return null;
    }

    if (response.status === 401 || response.status === 403) {
      return null;
    }

    if (response.status === 200) {
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      // Try to parse as JSON
      if (contentType.includes("json") || text.trim().startsWith("{")) {
        try {
          const data = JSON.parse(text);
          const prs = extractPRsFromPayload(data);
          if (prs && prs.length > 0) {
            return prs;
          }
          // Structure exists but 0 results — valid empty state
          if (data?.payload?.pullsDashboardSurfaceContentRoute) {
            return data.payload.pullsDashboardSurfaceContentRoute.results || [];
          }
        } catch (e) {
          // Not valid JSON, fall through
        }
      }

      // If we got HTML back, check for login indicators
      if (text.includes("/login") && text.includes("Sign in")) {
        return null;
      }

      return undefined; // Fall through to HTML strategy
    }

    return undefined; // Signal to try HTML fallback
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Fetch failed:", err.message);
    return undefined;
  }
}

/**
 * Fetch the HTML page and use the offscreen document to parse it.
 */
async function tryFetchHTML() {
  const response = await fetch(GITHUB_PR_URL, {
    credentials: "include",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (response.status === 401 || response.status === 403) {
    return null; // Not logged in
  }

  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}`);
  }

  const text = await response.text();

  // Check if the page indicates a login redirect
  if (text.includes('href="/login"') && text.includes("Sign in to GitHub")) {
    return null;
  }

  // Maybe it's actually JSON despite the HTML Accept header
  const directPrs = tryParseDirectJSON(text);
  if (directPrs !== null) {
    return directPrs;
  }

  // Use offscreen document for DOM/HTML parsing
  await ensureOffscreenDocument();

  const result = await chrome.runtime.sendMessage({
    action: "parseHTML",
    html: text,
  });

  if (!result) {
    throw new Error("Offscreen document did not respond");
  }

  if (result.loggedOut) {
    return null;
  }

  return result.prs;
}

/**
 * Attempt to parse the response directly as JSON.
 * GitHub's pulls page may return a JSON payload containing the PR data.
 */
function tryParseDirectJSON(text) {
  // Quick check - if it starts with { or looks like JSON
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  try {
    const data = JSON.parse(trimmed);
    return extractPRsFromPayload(data);
  } catch (e) {
    return null;
  }
}

/**
 * Navigate the JSON payload to find PR results.
 * Mirrors the logic in offscreen.js for when we can parse directly.
 */
function extractPRsFromPayload(data) {
  let results = null;

  // Direct match: { payload: { pullsDashboardSurfaceContentRoute: { results: [...] } } }
  if (data?.payload?.pullsDashboardSurfaceContentRoute?.results) {
    results = data.payload.pullsDashboardSurfaceContentRoute.results;
  } else if (data?.pullsDashboardSurfaceContentRoute?.results) {
    results = data.pullsDashboardSurfaceContentRoute.results;
  } else if (data?.props?.initialPayload?.pullsDashboardSurfaceContentRoute?.results) {
    results = data.props.initialPayload.pullsDashboardSurfaceContentRoute.results;
  } else {
    // Deep search as last resort
    results = deepFindResults(data);
  }

  if (!results || !Array.isArray(results)) {
    return null;
  }

  const prs = [];
  for (const item of results) {
    if (item.itemType !== "pull_request") continue;

    const repoNameWithOwner = item.repoNameWithOwner || "";
    const repoName = repoNameWithOwner.split("/")[1] || repoNameWithOwner;
    const title = item.title || `PR #${item.number}`;
    const url = item.permalink || `https://github.com/${repoNameWithOwner}/pull/${item.number}`;

    prs.push({ url, repo: repoName, title });
  }

  return prs.length > 0 ? prs : null;
}

function deepFindResults(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0]?.itemType === "pull_request") return obj;
    for (const item of obj) {
      const found = deepFindResults(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key === "results" && Array.isArray(obj[key]) &&
          obj[key].length > 0 && obj[key][0]?.itemType === "pull_request") {
        return obj[key];
      }
      const found = deepFindResults(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// ─── Bookmark Synchronization ────────────────────────────────────────────────

/**
 * Finds or creates the "GitHub PRs" folder in the Bookmarks Bar,
 * then incrementally updates its contents to match the PR list.
 */
async function synchronizeBookmarks(prs) {
  const folder = await getOrCreateFolder();
  const existingBookmarks = await chrome.bookmarks.getChildren(folder.id);

  // Build maps for efficient comparison
  const existingByUrl = new Map();
  for (const bm of existingBookmarks) {
    if (bm.url) {
      existingByUrl.set(bm.url, bm);
    }
  }

  const desiredByUrl = new Map();
  for (const pr of prs) {
    desiredByUrl.set(pr.url, pr);
  }

  // Remove bookmarks that no longer appear in the PR list
  for (const [url, bm] of existingByUrl) {
    if (!desiredByUrl.has(url)) {
      await chrome.bookmarks.remove(bm.id);
    }
  }

  // Add or update bookmarks to match current PR list and ordering
  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];
    const desiredTitle = `${pr.repo} - ${pr.title}`;
    const existing = existingByUrl.get(pr.url);

    if (existing) {
      // Update title if it changed
      if (existing.title !== desiredTitle) {
        await chrome.bookmarks.update(existing.id, { title: desiredTitle });
      }
    } else {
      // Create new bookmark
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: desiredTitle,
        url: pr.url,
      });
    }
  }

  // Reorder to match GitHub's ordering
  const updatedBookmarks = await chrome.bookmarks.getChildren(folder.id);
  const bookmarkByUrl = new Map();
  for (const bm of updatedBookmarks) {
    if (bm.url) {
      bookmarkByUrl.set(bm.url, bm);
    }
  }

  for (let i = 0; i < prs.length; i++) {
    const bm = bookmarkByUrl.get(prs[i].url);
    if (bm && bm.index !== i) {
      await chrome.bookmarks.move(bm.id, { parentId: folder.id, index: i });
    }
  }
}

/**
 * Finds the "GitHub PRs" folder in the Bookmarks Bar, or creates it.
 * Never creates duplicates.
 */
async function getOrCreateFolder() {
  // Search for existing folder by title
  const results = await chrome.bookmarks.search({ title: FOLDER_NAME });
  for (const node of results) {
    // Ensure it's actually a folder (no url property) 
    if (!node.url) {
      return node;
    }
  }

  // Create in the Bookmarks Bar (id "1" is the bookmarks bar in Chrome)
  const folder = await chrome.bookmarks.create({
    parentId: "1",
    title: FOLDER_NAME,
  });
  return folder;
}

// ─── Status Storage ──────────────────────────────────────────────────────────

async function setStatus(state, message) {
  await chrome.storage.local.set({
    lastSync: {
      state,
      message,
      timestamp: Date.now(),
    },
  });
}
