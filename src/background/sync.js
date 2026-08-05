/**
 * Sync orchestration — ties fetching, bookmark writing, status, and notifications together.
 */

import { fetchPRs } from "../fetcher/index.js";
import { synchronizeBookmarks } from "../bookmarks/index.js";
import { setStatus } from "../shared/status.js";
import { getSettings } from "../shared/settings.js";

/**
 * Perform a full sync cycle:
 *  1. Fetch PRs from GitHub
 *  2. Detect new PRs and notify
 *  3. Update bookmark folder
 *  4. Store PR list for popup display
 *  5. Update badge + status
 */
export async function syncPRs() {
  let prs;

  try {
    prs = await fetchPRs();
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Fetch failed:", err.message);
    await setStatus("error", err.message);
    return;
  }

  if (prs === null) {
    await setStatus("not_logged_in", "Not logged in to GitHub.");
    await updateBadge(0);
    return;
  }

  try {
    // Detect new PRs before updating
    await notifyNewPRs(prs);

    // Sync bookmarks
    await synchronizeBookmarks(prs);

    // Store PR list for the popup
    await chrome.storage.local.set({ prList: prs });

    // Update badge & status
    await updateBadge(prs.length);
    await setStatus("ok", `Synced ${prs.length} PRs at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error("[GitHub PR Bookmarks] Bookmark sync error:", err.message);
    await setStatus("error", err.message);
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function notifyNewPRs(currentPRs) {
  const settings = await getSettings();
  if (!settings.notifications) return;

  const data = await chrome.storage.local.get("knownPrUrls");
  const knownUrls = new Set(data.knownPrUrls || []);

  // On first run, just record URLs without notifying
  if (knownUrls.size === 0) {
    await chrome.storage.local.set({ knownPrUrls: currentPRs.map((pr) => pr.url) });
    return;
  }

  const newPRs = currentPRs.filter((pr) => !knownUrls.has(pr.url));

  if (newPRs.length > 0) {
    const title = newPRs.length === 1
      ? `New PR: ${newPRs[0].repo}`
      : `${newPRs.length} new PRs`;

    const message = newPRs.length === 1
      ? newPRs[0].title
      : newPRs.map((pr) => `${pr.repo} - ${pr.title}`).join("\n");

    // Chrome notifications API (no extra permission needed — included in MV3)
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: 1,
    });
  }

  // Update known URLs
  await chrome.storage.local.set({ knownPrUrls: currentPRs.map((pr) => pr.url) });
}

// ─── Badge ───────────────────────────────────────────────────────────────────

async function updateBadge(count) {
  const text = count > 0 ? String(count) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}
