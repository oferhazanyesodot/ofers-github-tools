/**
 * Sync orchestration — ties fetching, bookmark writing, and status together.
 */

import { fetchPRs } from "../fetcher/index.js";
import { synchronizeBookmarks } from "../bookmarks/index.js";
import { setStatus } from "../shared/status.js";

/**
 * Perform a full sync cycle:
 *  1. Fetch PRs from GitHub
 *  2. Update bookmark folder
 *  3. Update badge + status
 *
 * Gracefully handles all failure modes without destroying existing bookmarks.
 */
export async function syncPRs() {
  let prs;

  try {
    prs = await fetchPRs();
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Fetch failed:", err.message);
    await setStatus("error", err.message);
    return; // never touch bookmarks on failure
  }

  if (prs === null) {
    await setStatus("not_logged_in", "Not logged in to GitHub.");
    return;
  }

  try {
    await synchronizeBookmarks(prs);
    await updateBadge(prs.length);
    await setStatus("ok", `Synced ${prs.length} PRs at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error("[GitHub PR Bookmarks] Bookmark sync error:", err.message);
    await setStatus("error", err.message);
  }
}

// ─── Badge ───────────────────────────────────────────────────────────────────

async function updateBadge(count) {
  const text = count > 0 ? String(count) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}
