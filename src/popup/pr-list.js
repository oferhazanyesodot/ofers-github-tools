import { getSettings, togglePinnedPR, togglePinnedGroup } from "../shared/settings.js";
import { elements } from "./dom.js";
import { copySvg, escapeHtml, formatDate } from "./format.js";

// Kept in module scope so event handlers can re-render after a pin toggle.
let currentSettings = null;
let newUrls = new Set();
// URLs the user opened from the popup — treated as read locally so the unread
// dot clears immediately, without waiting for GitHub to report it read.
let readUrls = new Set();
// Branch keys whose linked-branch group the user has collapsed. Persisted in
// chrome.storage.local so the collapsed/expanded state survives reopening.
let collapsedGroups = new Set();

export async function loadPRList() {
  const [data, settings] = await Promise.all([
    chrome.storage.local.get(["prList", "newPrUrls", "readPRs", "collapsedGroups"]),
    getSettings(),
  ]);
  currentSettings = settings;
  newUrls = new Set(data.newPrUrls || []);
  readUrls = new Set(data.readPRs || []);
  collapsedGroups = new Set(data.collapsedGroups || []);
  let prs = data.prList || [];

  const excluded = parseExcluded(settings.excludeRepos);
  if (excluded.size > 0) {
    prs = prs.filter((pr) => !isExcluded(pr, excluded));
  }

  if (!settings.showDraftPRs) {
    prs = prs.filter((pr) => !pr.isDraft);
  }

  if (prs.length === 0) {
    const message = data.prList && data.prList.length > 0 && !settings.showDraftPRs
      ? "No open PRs (drafts hidden)"
      : "No open PRs found";
    elements.prList.innerHTML = `<div class="pr-empty">${message}</div>`;
    setCopyAllVisible(false);
    return;
  }

  const pinned = new Set(settings.pinnedPRs || []);
  const sorted = sortPRs(prs, settings.sortOrder, pinned);
  const capped = settings.maxPRs > 0 ? sorted.slice(0, settings.maxPRs) : sorted;
  const hiddenCount = sorted.length - capped.length;

  elements.prList.classList.toggle("compact", settings.density === "compact");

  // Only surface source tags when PRs actually come from more than one query.
  const distinctSources = new Set();
  for (const pr of prs) for (const s of pr.sources || []) distinctSources.add(s);
  const showSources = distinctSources.size > 1;

  const renderItem = (pr) => renderPRItem(pr, settings, pinned, newUrls, showSources, readUrls);

  let html;
  if (settings.groupBySharedBranch) {
    html = renderGrouped(capped, renderItem, pinned);
  } else {
    html = capped.map(renderItem).join("");
  }
  if (hiddenCount > 0) {
    html += `<div class="pr-more">+${hiddenCount} more</div>`;
  }
  elements.prList.innerHTML = html;

  bindItemEvents();
  setupCopyAll(capped, settings.showCopyAllButton);
}

function sortPRs(prs, order, pinned = new Set()) {
  const list = [...prs];
  // Pinned PRs always float to the top; drafts sink; then the chosen order.
  const byDraftThen = (compare) => (a, b) => {
    const aPin = pinned.has(a.url);
    const bPin = pinned.has(b.url);
    if (aPin !== bPin) return aPin ? -1 : 1;
    if (a.isDraft !== b.isDraft) return a.isDraft ? 1 : -1;
    return compare(a, b);
  };

  switch (order) {
    case "created":
      list.sort(byDraftThen((a, b) => date(b.createdAt) - date(a.createdAt)));
      break;
    case "title":
      list.sort(byDraftThen((a, b) => (a.title || "").localeCompare(b.title || "")));
      break;
    case "repo":
      list.sort(byDraftThen((a, b) => (a.repo || "").localeCompare(b.repo || "") || date(b.updatedAt) - date(a.updatedAt)));
      break;
    case "updated":
    default:
      list.sort(byDraftThen((a, b) => date(b.updatedAt) - date(a.updatedAt)));
      break;
  }
  return list;
}

function date(value) {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Normalize the key used to link PRs across repos. Prefer the branch name
 * (what actually ties work together across repos); fall back to the title when
 * the payload didn't carry a branch. Case/whitespace-insensitive.
 */
function groupKey(pr) {
  const raw = (pr.branch && pr.branch.trim()) || pr.title || "";
  return raw.trim().toLowerCase();
}

/**
 * A human label for a group heading: the branch name when we have one,
 * otherwise the shared title.
 */
function groupLabel(prs) {
  const withBranch = prs.find((pr) => pr.branch && pr.branch.trim());
  return withBranch ? withBranch.branch.trim() : (prs[0].title || "");
}

/**
 * Render the list with "linked branch" grouping: any key shared by 2+ PRs
 * across distinct repos is rendered under a single collapsible-looking header;
 * everything else is rendered flat. Group order follows the position of each
 * group's first (already-sorted) member, interleaved with ungrouped items so
 * the overall sort order is preserved.
 */
function renderGrouped(prs, renderItem, pinned = new Set()) {
  const buckets = new Map();
  for (const pr of prs) {
    const key = groupKey(pr);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(pr);
  }

  // A bucket only counts as a group when the branch spans 2+ distinct repos.
  const grouped = new Set();
  for (const [key, items] of buckets) {
    const repos = new Set(items.map((pr) => (pr.repoFullName || pr.repo || "").toLowerCase()));
    if (items.length >= 2 && repos.size >= 2) {
      grouped.add(key);
    }
  }

  const emittedGroups = new Set();
  const out = [];
  for (const pr of prs) {
    const key = groupKey(pr);
    if (grouped.has(key)) {
      // Emit the whole group once, at the position of its first member.
      if (emittedGroups.has(key)) continue;
      emittedGroups.add(key);
      const items = buckets.get(key);
      out.push(renderGroup(key, groupLabel(items), items, renderItem, pinned));
    } else {
      out.push(renderItem(pr));
    }
  }
  return out.join("");
}

/**
 * Wrap a set of linked PRs in a group container with a header showing the
 * shared branch and how many repos it spans. The header is a click target that
 * collapses/expands the members; when collapsed only the header row shows.
 */
function renderGroup(key, label, items, renderItem, pinned = new Set()) {
  const repoCount = new Set(items.map((pr) => (pr.repoFullName || pr.repo || "").toLowerCase())).size;
  const collapsed = collapsedGroups.has(key);
  const groupClass = collapsed ? "pr-group collapsed" : "pr-group";
  const tip = collapsed
    ? `Expand — ${escapeHtml(label)} across ${repoCount} repositories`
    : `Collapse — ${escapeHtml(label)} across ${repoCount} repositories`;

  // The group star is "active" only when every member PR is pinned.
  const urls = items.map((pr) => pr.url);
  const allPinned = urls.length > 0 && urls.every((u) => pinned.has(u));
  // Space-delimited: newlines don't survive HTML attribute parsing, but URLs
  // never contain spaces, so we split on whitespace when reading back.
  const urlData = escapeHtml(urls.join(" "));

  return `
    <div class="${groupClass}" data-group="${escapeHtml(key)}">
      <div class="pr-group-header" data-group="${escapeHtml(key)}" title="${tip}">
        <svg class="pr-group-chevron" viewBox="0 0 16 16" fill="currentColor" width="10" height="10">
          <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
        <svg class="pr-group-icon" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.492 2.492 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/>
        </svg>
        <span class="pr-group-label">${escapeHtml(label)}</span>
        <span class="pr-group-count">${repoCount} repos</span>
        <div class="pr-group-pin ${allPinned ? "active" : ""}" data-urls="${urlData}" title="${allPinned ? "Unstar group" : "Star whole group"}">
          ${starSvg(allPinned)}
        </div>
        <div class="pr-group-copy" data-urls="${urlData}" title="Copy all ${items.length} PR URLs">
          ${copySvg()}
        </div>
      </div>
      <div class="pr-group-items">
        ${items.map(renderItem).join("")}
      </div>
    </div>
  `;
}

/**
 * Toggle a group's collapsed state and persist it. Returns the updated set.
 */
async function toggleGroupCollapsed(key) {
  if (collapsedGroups.has(key)) {
    collapsedGroups.delete(key);
  } else {
    collapsedGroups.add(key);
  }
  await chrome.storage.local.set({ collapsedGroups: [...collapsedGroups] });
  return collapsedGroups;
}

function parseExcluded(excludeRepos) {
  if (!excludeRepos || !excludeRepos.trim()) return new Set();
  return new Set(
    excludeRepos
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isExcluded(pr, excluded) {
  const repo = (pr.repo || "").toLowerCase();
  const full = (pr.repoFullName || "").toLowerCase();
  const owner = full.split("/")[0];
  return excluded.has(repo) || excluded.has(full) || excluded.has(owner);
}

function bindItemEvents() {
  elements.prList.querySelectorAll(".pr-copy").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      navigator.clipboard.writeText(button.dataset.url);
      button.innerHTML = "✓";
      setTimeout(() => {
        button.innerHTML = copySvg();
      }, 1500);
    });
  });

  elements.prList.querySelectorAll(".pr-pin").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const next = await togglePinnedPR(button.dataset.url);
      if (currentSettings) currentSettings.pinnedPRs = next;
      // Re-render so the pinned item jumps to the top and the star updates.
      await loadPRList();
    });
  });

  elements.prList.querySelectorAll(".pr-item").forEach((item) => {
    item.addEventListener("click", async () => {
      const url = item.dataset.url;
      await markRead(url);
      await openPR(url);
    });
  });

  // Copy every PR url in the group.
  elements.prList.querySelectorAll(".pr-group-copy").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const urls = (button.dataset.urls || "").split(/\s+/).filter(Boolean);
      navigator.clipboard.writeText(urls.join("\n"));
      button.innerHTML = "✓";
      setTimeout(() => {
        button.innerHTML = copySvg();
      }, 1500);
    });
  });

  // Star/unstar the whole group (pins or unpins all its member PRs).
  elements.prList.querySelectorAll(".pr-group-pin").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const urls = (button.dataset.urls || "").split(/\s+/).filter(Boolean);
      const { pinned } = await togglePinnedGroup(urls);
      if (currentSettings) currentSettings.pinnedPRs = pinned;
      // Re-render so pinned items float up and every star reflects the change.
      await loadPRList();
    });
  });

  // Clicking a group header collapses/expands its members. Toggle the class in
  // place (no full re-render) so the popup doesn't flicker or lose scroll.
  elements.prList.querySelectorAll(".pr-group-header").forEach((header) => {
    header.addEventListener("click", async (event) => {
      event.stopPropagation();
      const key = header.dataset.group;
      await toggleGroupCollapsed(key);
      const group = header.closest(".pr-group");
      group?.classList.toggle("collapsed");
    });
  });
}

/**
 * Open a PR according to the user's tab preferences:
 *  - reuseExistingTab: if the PR is already open in a tab, focus it instead of
 *    opening a duplicate.
 *  - openInCurrentTab: navigate the active tab instead of opening a new one.
 */
async function openPR(url) {
  const settings = currentSettings || {};

  if (settings.reuseExistingTab) {
    const existing = await findOpenTab(url);
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId != null) {
        try { await chrome.windows.update(existing.windowId, { focused: true }); } catch { /* ignore */ }
      }
      return;
    }
  }

  if (settings.openInCurrentTab) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Don't navigate the extension's own pages; fall back to a new tab.
    if (active && active.id != null && !(active.url || "").startsWith("chrome-extension://")) {
      await chrome.tabs.update(active.id, { url });
      return;
    }
  }

  await chrome.tabs.create({ url });
}

/**
 * Find an open tab already showing this PR. Matches the exact URL and the URL
 * without a hash/query so a PR opened on a sub-tab (e.g. /files) still counts.
 */
async function findOpenTab(url) {
  const base = url.split("#")[0].split("?")[0];
  try {
    const tabs = await chrome.tabs.query({ url: `${base}*` });
    if (tabs.length > 0) return tabs[0];
  } catch {
    // tabs.query with a URL pattern needs the "tabs" permission's host access;
    // fall back to scanning all tabs.
  }
  const all = await chrome.tabs.query({});
  return all.find((t) => (t.url || "").split("#")[0].split("?")[0] === base) || null;
}

/**
 * Mark a PR as locally read: persist it, update the in-memory set, and clear
 * its unread dot in the DOM right away (no full re-render, so the popup doesn't
 * flicker as the tab opens).
 */
async function markRead(url) {
  if (!url || readUrls.has(url)) return;
  readUrls.add(url);
  await chrome.storage.local.set({ readPRs: [...readUrls] });
  const item = elements.prList.querySelector(`.pr-item[data-url="${cssEscape(url)}"]`);
  item?.querySelector(".pr-unread")?.remove();
}

/**
 * Escape a value for safe use inside a CSS attribute selector.
 */
function cssEscape(value) {
  return (window.CSS && CSS.escape) ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function setupCopyAll(prs, enabled = true) {
  if (!elements.copyAllButton) return;
  setCopyAllVisible(enabled && prs.length > 0);
  if (!enabled) return;
  elements.copyAllButton.onclick = () => {
    const urls = prs.map((pr) => pr.url).join("\n");
    navigator.clipboard.writeText(urls);
    const original = elements.copyAllButton.textContent;
    elements.copyAllButton.textContent = `✓ Copied ${prs.length}`;
    setTimeout(() => {
      elements.copyAllButton.textContent = original;
    }, 1500);
  };
}

function setCopyAllVisible(visible) {
  if (elements.copyAllButton) elements.copyAllButton.classList.toggle("hidden", !visible);
}

function renderPRItem(pr, settings, pinned = new Set(), newSet = new Set(), showSources = false, readSet = new Set()) {
  const isPinned = pinned.has(pr.url);
  const itemClass = isPinned ? "pr-item pinned" : "pr-item";
  const iconClass = pr.isDraft ? "pr-icon draft" : "pr-icon";
  const draftBadge = pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : "";
  const numberPrefix = settings.showPRNumber && pr.number ? `<span class="pr-number">#${pr.number}</span> ` : "";

  const unreadDot = settings.showUnread && pr.unread && !readSet.has(pr.url)
    ? '<span class="pr-unread" title="Unread"></span>'
    : "";
  const newTag = settings.showNewTag && newSet.has(pr.url) ? '<span class="new-badge">NEW</span>' : "";
  const sourceTags = showSources ? renderSourceTags(pr) : "";

  return `
    <div class="${itemClass}" data-url="${escapeHtml(pr.url)}">
      ${unreadDot}
      <svg class="${iconClass}" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>
      </svg>
      <div class="pr-content">
        <div class="pr-title">${newTag}${numberPrefix}${escapeHtml(pr.title)}</div>
        <div class="pr-meta">
          <span class="pr-repo" title="${escapeHtml(pr.repoFullName || pr.repo)}">${escapeHtml(repoLabel(pr, settings))}</span>
          ${sourceTags}
          ${draftBadge}
          ${commentCount(pr, settings)}
          ${createdAge(pr, settings)}
          ${ageIndicator(pr, settings)}
        </div>
      </div>
      <div class="pr-pin ${isPinned ? "active" : ""}" data-url="${escapeHtml(pr.url)}" title="${isPinned ? "Unpin" : "Pin to top"}">
        ${starSvg(isPinned)}
      </div>
      <div class="pr-copy" data-url="${escapeHtml(pr.url)}" title="Copy URL">
        ${copySvg()}
      </div>
    </div>
  `;
}

/**
 * Choose the repo label: "owner/repo" when the owner toggle is on, else "repo".
 */
function repoLabel(pr, settings) {
  if (settings.showRepoOwner && pr.repoFullName) return pr.repoFullName;
  return pr.repo;
}

/**
 * A full, human-readable date-time for tooltips (e.g. "Sep 3, 2026, 3:12 PM").
 */
function fullTimestamp(ts) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/**
 * Render when the PR was opened (created), separate from the last-updated time.
 */
function createdAge(pr, settings) {
  if (!settings.showCreatedAge || !pr.createdAt) return "";
  const ts = new Date(pr.createdAt).getTime();
  if (!Number.isFinite(ts)) return "";
  const time = formatDate(ts, settings.dateFormat);
  const tip = settings.fullTimestampTooltip ? `Opened ${fullTimestamp(ts)}` : `Opened ${time}`;
  return `<span class="pr-created" title="${escapeHtml(tip)}">opened ${time}</span>`;
}

/**
 * Render the updated-time, flagged stale when older than the archive threshold.
 */
function ageIndicator(pr, settings) {
  if (!pr.updatedAt) return "";
  const ts = new Date(pr.updatedAt).getTime();
  const time = formatDate(ts, settings.dateFormat);
  const threshold = settings.staleThresholdDays;
  const isStale = threshold > 0 && Date.now() - ts > threshold * 24 * 60 * 60 * 1000;
  const fullTip = settings.fullTimestampTooltip ? `Updated ${fullTimestamp(ts)}` : "";
  if (!isStale) {
    const title = fullTip ? ` title="${escapeHtml(fullTip)}"` : "";
    return `<span class="pr-age"${title}>${time}</span>`;
  }
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  const staleTip = fullTip ? `${fullTip} · no activity for ${days} days` : `No activity for ${days} days`;
  return `<span class="pr-age stale" title="${escapeHtml(staleTip)}">${time}</span>`;
}

function starSvg(filled) {
  if (filled) {
    return `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>`;
  }
  return `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>`;
}

function commentCount(pr, settings) {
  if (!settings.showCommentCount || !pr.commentCount) return "";
  return `<span class="pr-comments" title="${pr.commentCount} comments">💬 ${pr.commentCount}</span>`;
}

/**
 * Render one small tag per source query that surfaced this PR (e.g. "Authored",
 * "Review requested"), so it's clear where each PR came from when several
 * queries are combined. Each label gets a stable color.
 */
function renderSourceTags(pr) {
  const sources = pr.sources || [];
  if (sources.length === 0) return "";
  return sources
    .map((label) => {
      const hue = labelHue(label);
      const style = `--tag-hue:${hue}`;
      return `<span class="pr-source" style="${style}" title="From query: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
    })
    .join("");
}

/**
 * Map a label to a stable hue (0–360) so the same source always looks the same.
 */
function labelHue(label) {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) % 360;
  }
  return hash;
}
