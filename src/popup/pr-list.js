import { getSettings, togglePinnedPR } from "../shared/settings.js";
import { elements } from "./dom.js";
import { copySvg, escapeHtml, formatDate } from "./format.js";

// Kept in module scope so event handlers can re-render after a pin toggle.
let currentSettings = null;
let newUrls = new Set();

export async function loadPRList() {
  const [data, settings] = await Promise.all([
    chrome.storage.local.get(["prList", "newPrUrls"]),
    getSettings(),
  ]);
  currentSettings = settings;
  newUrls = new Set(data.newPrUrls || []);
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

  let html = capped.map((pr) => renderPRItem(pr, settings, pinned, newUrls)).join("");
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
    item.addEventListener("click", () => {
      chrome.tabs.create({ url: item.dataset.url });
    });
  });
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

function renderPRItem(pr, settings, pinned = new Set(), newSet = new Set()) {
  const isPinned = pinned.has(pr.url);
  const itemClass = isPinned ? "pr-item pinned" : "pr-item";
  const iconClass = pr.isDraft ? "pr-icon draft" : "pr-icon";
  const draftBadge = pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : "";
  const numberPrefix = settings.showPRNumber && pr.number ? `<span class="pr-number">#${pr.number}</span> ` : "";

  const unreadDot = settings.showUnread && pr.unread ? '<span class="pr-unread" title="Unread"></span>' : "";
  const newTag = settings.showNewTag && newSet.has(pr.url) ? '<span class="new-badge">NEW</span>' : "";

  return `
    <div class="${itemClass}" data-url="${escapeHtml(pr.url)}">
      ${unreadDot}
      <svg class="${iconClass}" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>
      </svg>
      <div class="pr-content">
        <div class="pr-title">${newTag}${numberPrefix}${escapeHtml(pr.title)}</div>
        <div class="pr-meta">
          <span class="pr-repo">${escapeHtml(pr.repo)}</span>
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
 * Render when the PR was opened (created), separate from the last-updated time.
 */
function createdAge(pr, settings) {
  if (!settings.showCreatedAge || !pr.createdAt) return "";
  const ts = new Date(pr.createdAt).getTime();
  if (!Number.isFinite(ts)) return "";
  const time = formatDate(ts, settings.dateFormat);
  return `<span class="pr-created" title="Opened ${time}">opened ${time}</span>`;
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
  if (!isStale) return `<span class="pr-age">${time}</span>`;
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  return `<span class="pr-age stale" title="No activity for ${days} days">${time}</span>`;
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
