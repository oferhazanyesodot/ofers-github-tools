import { getSettings, togglePinnedPR } from "../shared/settings.js";
import { elements } from "./dom.js";
import { copySvg, escapeHtml, formatDate } from "./format.js";

// Kept in module scope so event handlers can re-render after a pin toggle.
let currentSettings = null;
let newUrls = new Set();
// URLs the user opened from the popup — treated as read locally so the unread
// dot clears immediately, without waiting for GitHub to report it read.
let readUrls = new Set();

export async function loadPRList() {
  const [data, settings] = await Promise.all([
    chrome.storage.local.get(["prList", "newPrUrls", "readPRs"]),
    getSettings(),
  ]);
  currentSettings = settings;
  newUrls = new Set(data.newPrUrls || []);
  readUrls = new Set(data.readPRs || []);
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

  let html = capped.map((pr) => renderPRItem(pr, settings, pinned, newUrls, showSources, readUrls)).join("");
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
