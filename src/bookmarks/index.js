/**
 * Bookmark Sync Engine
 *
 * Maintains a bookmark folder in the Bookmarks Bar that mirrors
 * the user's open PRs. Supports:
 *  - Incremental updates
 *  - Draft indicators
 *  - Group by repo (subfolders)
 *  - Stale PR detection (move old PRs to subfolder)
 */

import { getSettings } from "../shared/settings.js";

/**
 * Synchronize the bookmark folder with the given PR list.
 * @param {Array} prs - Parsed PR objects from the fetcher
 */
export async function synchronizeBookmarks(prs) {
  const settings = await getSettings();

  // Bookmarks feature disabled: tear down any folder we previously created so
  // the user isn't left with a stale folder, then bail out.
  if (!settings.bookmarksEnabled) {
    await removeRootFolder(settings.folderName);
    return;
  }

  const barId = await getBookmarksBarId();
  const rootFolder = await getOrCreateFolder(settings.folderName, barId);

  // Drop excluded repositories entirely.
  const filtered = filterExcludedRepos(prs, settings.excludeRepos);

  // Sort: pinned first, then non-drafts, drafts at the end.
  const pinned = new Set(settings.pinnedPRs || []);
  const sorted = [...filtered].sort((a, b) => {
    const aPin = pinned.has(a.url);
    const bPin = pinned.has(b.url);
    if (aPin !== bPin) return aPin ? -1 : 1;
    if (a.isDraft === b.isDraft) return 0;
    return a.isDraft ? 1 : -1;
  });

  // Separate stale PRs if threshold is configured
  const { current, stale } = partitionByAge(sorted, settings.staleThresholdDays);

  // Group either when the user opted in, or automatically once the number of
  // distinct repos reaches the configured auto-group threshold.
  const distinctRepos = new Set(current.map((pr) => pr.repo)).size;
  const shouldGroup =
    settings.groupByRepo ||
    (settings.autoGroupThreshold > 0 && distinctRepos >= settings.autoGroupThreshold);

  if (shouldGroup) {
    await syncGroupedByRepo(rootFolder, current, settings);
  } else {
    // Clean up any leftover repo subfolders from when groupByRepo was enabled
    await removeSubfolders(rootFolder.id, ["Old PRs"]);
    await syncFlat(rootFolder, current, settings);
  }

  // Handle stale PRs.
  if (settings.staleThresholdDays > 0 && stale.length > 0) {
    const staleFolder = await getOrCreateFolder("Old PRs", rootFolder.id);
    await syncFlat(staleFolder, stale, settings);
  } else {
    // No stale PRs (threshold off, raised, or everything is fresh again).
    // Prune any bookmarks left in an existing "Old PRs" folder and remove it.
    await clearAndRemoveFolder("Old PRs", rootFolder.id);
  }
}

// ─── Flat Sync ───────────────────────────────────────────────────────────────

async function syncFlat(folder, prs, settings) {
  const existing = await chrome.bookmarks.getChildren(folder.id);

  const existingByUrl = new Map();
  for (const bm of existing) {
    if (bm.url) existingByUrl.set(bm.url, bm);
  }

  const desiredUrls = new Set(prs.map((pr) => pr.url));

  // Remove stale bookmarks (but not subfolders)
  for (const [url, bm] of existingByUrl) {
    if (!desiredUrls.has(url)) {
      await chrome.bookmarks.remove(bm.id);
    }
  }

  // Add new / update changed
  for (const pr of prs) {
    const desiredTitle = formatTitle(pr, settings);
    const bm = existingByUrl.get(pr.url);

    if (bm) {
      if (bm.title !== desiredTitle) {
        await chrome.bookmarks.update(bm.id, { title: desiredTitle });
      }
    } else {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: desiredTitle,
        url: pr.url,
      });
    }
  }

  await reorderBookmarks(folder.id, prs);
}

// ─── Grouped by Repo Sync ────────────────────────────────────────────────────

async function syncGroupedByRepo(rootFolder, prs, settings) {
  // Group PRs by repo name
  const byRepo = new Map();
  for (const pr of prs) {
    const group = byRepo.get(pr.repo) || [];
    group.push(pr);
    byRepo.set(pr.repo, group);
  }

  const existingChildren = await chrome.bookmarks.getChildren(rootFolder.id);
  const existingFolders = new Map();
  const existingBookmarks = new Map();

  for (const child of existingChildren) {
    if (child.url) {
      existingBookmarks.set(child.url, child);
    } else {
      existingFolders.set(child.title, child);
    }
  }

  // Remove top-level bookmarks that should now be in subfolders
  for (const [, bm] of existingBookmarks) {
    await chrome.bookmarks.remove(bm.id);
  }

  // Remove repo folders that no longer have PRs
  for (const [title, folder] of existingFolders) {
    if (title === "Old PRs") continue; // preserve stale folder
    if (!byRepo.has(title)) {
      await chrome.bookmarks.removeTree(folder.id);
    }
  }

  // Sync each repo subfolder
  for (const [repo, repoPrs] of byRepo) {
    const repoFolder = await getOrCreateFolder(repo, rootFolder.id);
    await syncFlat(repoFolder, repoPrs, settings);
  }
}

// ─── Exclude Repos ───────────────────────────────────────────────────────────

/**
 * Remove PRs whose repo matches the exclude list.
 * Matches against either the short repo name ("repo") or the full
 * "owner/repo" name, case-insensitively.
 * @param {Array} prs
 * @param {string} excludeRepos - comma-separated list
 */
function filterExcludedRepos(prs, excludeRepos) {
  if (!excludeRepos || !excludeRepos.trim()) return prs;
  const excluded = new Set(
    excludeRepos
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (excluded.size === 0) return prs;
  return prs.filter((pr) => {
    const repo = (pr.repo || "").toLowerCase();
    const full = (pr.repoFullName || "").toLowerCase();
    const owner = full.split("/")[0];
    return !excluded.has(repo) && !excluded.has(full) && !excluded.has(owner);
  });
}

// ─── Stale Detection ─────────────────────────────────────────────────────────

function partitionByAge(prs, thresholdDays) {
  if (!thresholdDays || thresholdDays <= 0) {
    return { current: prs, stale: [] };
  }

  const cutoff = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
  const current = [];
  const stale = [];

  for (const pr of prs) {
    const updated = new Date(pr.updatedAt).getTime();
    if (updated < cutoff) {
      stale.push(pr);
    } else {
      current.push(pr);
    }
  }

  return { current, stale };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the Bookmarks Bar/Toolbar folder ID.
 * Chrome uses "1", Firefox uses "toolbar_____".
 */
async function getBookmarksBarId() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];

  // The root has children: Bookmarks Bar/Toolbar, Other Bookmarks, Mobile
  // Firefox: "toolbar_____", Chrome: "1"
  if (root && root.children) {
    for (const child of root.children) {
      // Firefox toolbar folder
      if (child.id === "toolbar_____") return child.id;
      // Chrome bookmarks bar
      if (child.id === "1") return child.id;
      // Match by title as fallback
      if (child.title === "Bookmarks Toolbar" || child.title === "Bookmarks Bar") {
        return child.id;
      }
    }
  }

  // Last resort: return first child of root (usually the toolbar)
  if (root?.children?.[0]) return root.children[0].id;

  return "1";
}

async function getOrCreateFolder(name, parentId) {
  const results = await chrome.bookmarks.search({ title: name });

  // Prefer exact parent match
  const exactMatch = results.find((node) => !node.url && node.parentId === parentId);
  if (exactMatch) return exactMatch;

  // If parentId is the bookmarks bar ("1"), also accept "2" (Other Bookmarks)
  // to handle folders that may have been moved
  if (parentId === "1") {
    const anyRoot = results.find((node) => !node.url && (node.parentId === "1" || node.parentId === "2"));
    if (anyRoot) return anyRoot;
  }

  // For sub-folders, just find any folder with that name under any parent
  // This catches cases where parentId is a string number we didn't expect
  const anyMatch = results.find((node) => !node.url);
  if (anyMatch && parentId === "1") return anyMatch;

  return await chrome.bookmarks.create({ parentId, title: name });
}

/**
 * Remove the extension's root bookmark folder entirely (used when the
 * Bookmarks feature is turned off).
 */
async function removeRootFolder(name) {
  const barId = await getBookmarksBarId();
  const results = await chrome.bookmarks.search({ title: name });
  for (const node of results) {
    // Only remove a folder sitting at the bookmarks bar / other bookmarks to
    // avoid nuking an unrelated folder that happens to share the name.
    if (!node.url && (node.parentId === barId || node.parentId === "1" || node.parentId === "2")) {
      try {
        await chrome.bookmarks.removeTree(node.id);
      } catch (e) {
        console.warn("[GitHub PR Bookmarks] Failed to remove root folder:", e.message);
      }
    }
  }
}

/**
 * Remove a named subfolder (and anything left inside it) when it exists under
 * the given parent. Used to tear down the "Old PRs" folder once there are no
 * stale PRs — e.g. after raising the threshold so previously-stale PRs are
 * fresh again, or after disabling archiving entirely.
 */
async function clearAndRemoveFolder(name, parentId) {
  const children = await chrome.bookmarks.getChildren(parentId);
  for (const child of children) {
    if (!child.url && child.title === name) {
      try {
        await chrome.bookmarks.removeTree(child.id);
      } catch (e) {
        console.warn("[GitHub PR Bookmarks] Failed to remove folder:", name, e.message);
      }
    }
  }
}

/**
 * Remove all subfolders inside a parent, except those in the preserve list.
 * Used when switching from grouped mode to flat mode.
 */
async function removeSubfolders(parentId, preserve = []) {
  const children = await chrome.bookmarks.getChildren(parentId);
  const preserveSet = new Set(preserve);

  for (const child of children) {
    // A folder has no url property (or it's undefined/empty)
    const isFolder = !child.url;
    if (isFolder && !preserveSet.has(child.title)) {
      try {
        await chrome.bookmarks.removeTree(child.id);
      } catch (e) {
        console.warn("[GitHub PR Bookmarks] Failed to remove subfolder:", child.title, e.message);
      }
    }
  }
}

async function reorderBookmarks(folderId, prs) {
  const children = await chrome.bookmarks.getChildren(folderId);
  const byUrl = new Map();
  for (const bm of children) {
    if (bm.url) byUrl.set(bm.url, bm);
  }

  for (let i = 0; i < prs.length; i++) {
    const bm = byUrl.get(prs[i].url);
    if (bm && bm.index !== i) {
      await chrome.bookmarks.move(bm.id, { parentId: folderId, index: i });
    }
  }
}

/**
 * Format a PR into its bookmark title.
 */
function formatTitle(pr, settings) {
  let title = `${pr.repo} - ${pr.title}`;
  if (settings.showDraftIndicator && pr.isDraft) {
    title = `[DRAFT] ${title}`;
  }
  return title;
}
