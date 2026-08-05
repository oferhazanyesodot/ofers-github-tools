/**
 * Bookmark Sync Engine
 *
 * Maintains a single bookmark folder in the Bookmarks Bar that mirrors
 * the user's open PRs. Performs incremental updates only.
 */

import { getSettings } from "../shared/settings.js";

/**
 * Synchronize the bookmark folder with the given PR list.
 * @param {Array<{url: string, repo: string, title: string}>} prs
 */
export async function synchronizeBookmarks(prs) {
  const { folderName } = await getSettings();
  const folder = await getOrCreateFolder(folderName);
  const existing = await chrome.bookmarks.getChildren(folder.id);

  const existingByUrl = new Map();
  for (const bm of existing) {
    if (bm.url) existingByUrl.set(bm.url, bm);
  }

  const desiredUrls = new Set(prs.map((pr) => pr.url));

  // Remove stale bookmarks
  for (const [url, bm] of existingByUrl) {
    if (!desiredUrls.has(url)) {
      await chrome.bookmarks.remove(bm.id);
    }
  }

  // Add new / update changed
  for (const pr of prs) {
    const desiredTitle = formatTitle(pr);
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

  // Reorder to match GitHub's sort order
  await reorderBookmarks(folder.id, prs);
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Find an existing folder by name, or create one in the Bookmarks Bar.
 * Never creates duplicates.
 */
async function getOrCreateFolder(name) {
  const results = await chrome.bookmarks.search({ title: name });
  const folder = results.find((node) => !node.url);
  if (folder) return folder;

  // ID "1" is the Bookmarks Bar in Chrome
  return await chrome.bookmarks.create({ parentId: "1", title: name });
}

/**
 * Reorder children of a folder to match the desired PR ordering.
 */
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
function formatTitle(pr) {
  return `${pr.repo} - ${pr.title}`;
}
