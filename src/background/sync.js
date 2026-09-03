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

    // Tag PRs that weren't present in the previous sync so the popup can flag
    // them as "new". Skip this on the very first sync (no baseline yet) to
    // avoid marking every PR as new.
    const prev = await chrome.storage.local.get(["prList", "prListInitialized"]);
    const prevUrls = new Set((prev.prList || []).map((pr) => pr.url));
    const isFirstSync = !prev.prListInitialized;
    const newPrUrls = isFirstSync ? [] : prs.filter((pr) => !prevUrls.has(pr.url)).map((pr) => pr.url);

    // Prune the locally-read set to PRs still in the list, so it doesn't grow
    // unbounded as PRs are merged/closed.
    const currentUrls = new Set(prs.map((pr) => pr.url));
    const prevRead = (await chrome.storage.local.get("readPRs")).readPRs || [];
    const readPRs = prevRead.filter((url) => currentUrls.has(url));

    await chrome.storage.local.set({ prList: prs, newPrUrls, prListInitialized: true, readPRs });
    await updatePRBadge(prs.length);
    await setStatus("ok", `Synced ${prs.length} PRs at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error("[GitHub PR Bookmarks] Bookmark sync error:", error.message);
    await setStatus("error", error.message);
  }

  syncCopilotUsage().catch((error) => {
    console.warn("[GitHub PR Bookmarks] Copilot usage sync failed:", error.message);
  });
}
