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
  const rootFolder = await getOrCreateFolder(settings.folderName, "1");

  // Separate stale PRs if threshold is configured
  const { current, stale } = partitionByAge(prs, settings.staleThresholdDays);

  if (settings.groupByRepo) {
    await syncGroupedByRepo(rootFolder, current, settings);
  } else {
    await syncFlat(rootFolder, current, settings);
  }

  // Handle stale PRs
  if (settings.staleThresholdDays > 0 && stale.length > 0) {
    const staleFolder = await getOrCreateFolder("Old PRs", rootFolder.id);
    await syncFlat(staleFolder, stale, settings);
  } else if (settings.staleThresholdDays > 0) {
    // Remove stale folder if empty
    await removeEmptyFolder("Old PRs", rootFolder.id);
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

async function getOrCreateFolder(name, parentId) {
  const results = await chrome.bookmarks.search({ title: name });
  const folder = results.find((node) => !node.url && node.parentId === parentId);
  if (folder) return folder;

  return await chrome.bookmarks.create({ parentId, title: name });
}

async function removeEmptyFolder(name, parentId) {
  const results = await chrome.bookmarks.search({ title: name });
  for (const node of results) {
    if (!node.url && node.parentId === parentId) {
      const children = await chrome.bookmarks.getChildren(node.id);
      if (children.length === 0) {
        await chrome.bookmarks.removeTree(node.id);
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
