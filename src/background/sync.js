import { synchronizeBookmarks } from "../bookmarks/index.js";
import { fetchPRs } from "../fetcher/index.js";
import { setStatus } from "../shared/status.js";
import { notifyNewPRs } from "./notifications.js";
import { updatePRBadge } from "./badge.js";
import { syncCopilotUsage } from "./copilot-sync.js";

export async function syncPRs() {
  let prs;

  try {
    prs = await fetchPRs();
  } catch (error) {
    console.warn("[GitHub PR Bookmarks] Fetch failed:", error.message);
    await setStatus("error", error.message);
    return;
  }

  if (prs === null) {
    await setStatus("not_logged_in", "Not logged in to GitHub.");
    await updatePRBadge(0);
    return;
  }

  try {
    await notifyNewPRs(prs);
    await synchronizeBookmarks(prs);
    await chrome.storage.local.set({ prList: prs });
    await updatePRBadge(prs.length);
    await setStatus("ok", `Synced ${prs.length} PRs at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error("[GitHub PR Bookmarks] Bookmark sync error:", error.message);
    await setStatus("error", error.message);
  }

  try {
    await syncCopilotUsage();
  } catch (error) {
    console.warn("[GitHub PR Bookmarks] Copilot usage sync failed:", error.message);
  }
}
