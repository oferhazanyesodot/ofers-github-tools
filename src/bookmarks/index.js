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
  // the user isn't left with a stale folder, then bail out. Also clean up a
  // folder left behind by an earlier rename.
  if (!settings.bookmarksEnabled) {
    await handleFolderRename(settings.folderName);
    await removeRootFolder(settings.folderName);
    return;
  }

  // If the folder was renamed since the last sync, remove the old folder so we
  // don't leave an orphaned copy behind.
  await handleFolderRename(settings.folderName);

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

  // When PRs come from more than one labeled query, group them into a subfolder
  // per source (e.g. "Authored", "Review requested") so it's clear which query
  // each PR belongs to. This takes precedence over repo grouping.
  const distinctSources = new Set(current.flatMap((pr) => pr.sources || []));
  const groupBySource = distinctSources.size > 1;

  if (groupBySource) {
    await syncGroupedBySource(rootFolder, current, settings);
  } else if (settings.groupByRepo) {
    // Explicit "group by repository": every repo gets its own subfolder.
    await syncGroupedByRepo(rootFolder, current, settings);
  } else if (settings.autoGroupThreshold > 0) {
    // Auto-group per repo: a repo gets a subfolder once it has this many PRs
    // or more; repos with fewer stay as a flat list at the top level.
    await syncHybridByRepo(rootFolder, current, settings, settings.autoGroupThreshold);
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

// ─── Grouped by Source (query) Sync ──────────────────────────────────────────

/**
 * Organize PRs into a subfolder per source query label. A PR that matched
 * several queries is filed under its first source to avoid duplicate bookmarks.
 */
async function syncGroupedBySource(rootFolder, prs, settings) {
  const bySource = new Map();
  for (const pr of prs) {
    const label = (pr.sources && pr.sources[0]) || "PRs";
    const group = bySource.get(label) || [];
    group.push(pr);
    bySource.set(label, group);
  }

  const existingChildren = await chrome.bookmarks.getChildren(rootFolder.id);
  const existingFolders = new Map();

  for (const child of existingChildren) {
    if (child.url) {
      // A leftover top-level bookmark from flat mode — remove it.
      await chrome.bookmarks.remove(child.id);
    } else {
      existingFolders.set(child.title, child);
    }
  }

  // Remove source folders that no longer have PRs (keep the stale "Old PRs").
  for (const [title, folder] of existingFolders) {
    if (title === "Old PRs") continue;
    if (!bySource.has(title)) {
      await chrome.bookmarks.removeTree(folder.id);
    }
  }

  for (const [label, sourcePrs] of bySource) {
    const folder = await getOrCreateFolder(label, rootFolder.id);
    await syncFlat(folder, sourcePrs, settings);
  }
}

// ─── Hybrid Repo Sync (auto-group busy repos only) ───────────────────────────

/**
 * Hybrid layout: repos with `threshold` or more PRs get their own subfolder;
 * repos with fewer PRs are kept as a flat list of bookmarks at the top level.
 * This avoids a pile of single-PR subfolders while still tidying busy repos.
 *
 * @param {number} threshold - minimum PRs in a repo before it gets a subfolder
 */
async function syncHybridByRepo(rootFolder, prs, settings, threshold) {
  // Bucket PRs by repo, then decide which repos are "grouped" vs "loose".
  const byRepo = new Map();
  for (const pr of prs) {
    const group = byRepo.get(pr.repo) || [];
    group.push(pr);
    byRepo.set(pr.repo, group);
  }

  const groupedRepos = new Map(); // repo → PRs (gets a subfolder)
  const loosePrs = [];            // stay flat at the top level
  for (const [repo, repoPrs] of byRepo) {
    if (repoPrs.length >= threshold) groupedRepos.set(repo, repoPrs);
    else loosePrs.push(...repoPrs);
  }

  // Reconcile the top level: keep loose bookmarks, drop bookmarks that now
  // belong in a subfolder, and remove subfolders that are no longer grouped.
  const existingChildren = await chrome.bookmarks.getChildren(rootFolder.id);
  const looseUrls = new Set(loosePrs.map((pr) => pr.url));

  for (const child of existingChildren) {
    if (child.url) {
      // A top-level bookmark that should now live in a subfolder — remove it
      // here (syncFlat on the subfolder will recreate it).
      if (!looseUrls.has(child.url)) await chrome.bookmarks.remove(child.id);
    } else if (child.title !== "Old PRs" && !groupedRepos.has(child.title)) {
      // A repo subfolder that's no longer grouped (dropped below threshold) —
      // remove it; its PRs, if still open, are now in the loose list.
      await chrome.bookmarks.removeTree(child.id);
    }
  }

  // Grouped repos → subfolders.
  for (const [repo, repoPrs] of groupedRepos) {
    const repoFolder = await getOrCreateFolder(repo, rootFolder.id);
    await syncFlat(repoFolder, repoPrs, settings);
  }

  // Loose PRs → flat at the top level. syncFlat only touches bookmarks (not
  // subfolders), so the grouped subfolders above are left intact.
  await syncFlat(rootFolder, loosePrs, settings);
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
 * When the configured folder name changes between syncs, remove the previously
 * used folder so a rename moves the PRs into the new folder instead of leaving
 * an orphaned copy behind. The last-used name is tracked in local storage.
 */
async function handleFolderRename(currentName) {
  const KEY = "bookmarkFolderName";
  const { [KEY]: previousName } = await chrome.storage.local.get(KEY);

  if (previousName && previousName !== currentName) {
    await removeRootFolder(previousName);
  }
  if (previousName !== currentName) {
    await chrome.storage.local.set({ [KEY]: currentName });
  }
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
