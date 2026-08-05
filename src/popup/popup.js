/**
 * Popup script — displays sync status, PR list, and provides quick actions.
 */

import { getSettings } from "../shared/settings.js";

const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("sync-btn");
const optionsBtn = document.getElementById("options-btn");
const footerEl = document.getElementById("footer");
const prListEl = document.getElementById("pr-list");

// ─── Actions ─────────────────────────────────────────────────────────────────

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";

  try {
    await chrome.runtime.sendMessage({ action: "syncNow" });
    await new Promise((r) => setTimeout(r, 2000));
  } catch (err) {
    console.error("Sync trigger failed:", err);
  }

  await loadAll();
  syncBtn.disabled = false;
  syncBtn.textContent = "Sync Now";
});

// ─── Status Display ──────────────────────────────────────────────────────────

async function loadStatus() {
  const data = await chrome.storage.local.get("lastSync");
  const sync = data.lastSync;

  if (!sync) {
    statusEl.className = "status unknown";
    statusEl.textContent = "No sync yet. Click Sync Now to start.";
    return;
  }

  statusEl.className = `status ${sync.state}`;

  if (sync.state === "ok" && sync.timestamp) {
    statusEl.textContent = `${sync.message} (${relativeTime(sync.timestamp)})`;
  } else if (sync.state === "error") {
    statusEl.textContent = `Error: ${sync.message}`;
  } else if (sync.state === "not_logged_in") {
    statusEl.textContent = "Not logged in to GitHub. Sign in at github.com first.";
  } else {
    statusEl.textContent = sync.message || "Unknown state.";
  }
}

// ─── PR List ─────────────────────────────────────────────────────────────────

async function loadPRList() {
  const data = await chrome.storage.local.get("prList");
  const prs = data.prList || [];

  if (prs.length === 0) {
    prListEl.innerHTML = '<div class="pr-empty">No open PRs found</div>';
    return;
  }

  prListEl.innerHTML = prs.map((pr) => renderPRItem(pr)).join("");

  // Add click-to-copy handlers
  prListEl.querySelectorAll(".pr-copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const url = btn.dataset.url;
      navigator.clipboard.writeText(url);
      btn.innerHTML = "✓";
      setTimeout(() => {
        btn.innerHTML = copySvg();
      }, 1500);
    });
  });

  // Open PR on click
  prListEl.querySelectorAll(".pr-item").forEach((item) => {
    item.addEventListener("click", () => {
      chrome.tabs.create({ url: item.dataset.url });
    });
  });
}

function renderPRItem(pr) {
  const iconClass = pr.isDraft ? "pr-icon draft" : "pr-icon";
  const draftBadge = pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : "";
  const time = pr.updatedAt ? relativeTime(new Date(pr.updatedAt).getTime()) : "";

  return `
    <div class="pr-item" data-url="${escapeHtml(pr.url)}">
      <svg class="${iconClass}" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>
      </svg>
      <div class="pr-content">
        <div class="pr-title">${escapeHtml(pr.title)}</div>
        <div class="pr-meta">
          <span class="pr-repo">${escapeHtml(pr.repo)}</span>
          ${draftBadge}
          <span>${time}</span>
        </div>
      </div>
      <div class="pr-copy" data-url="${escapeHtml(pr.url)}" title="Copy URL">
        ${copySvg()}
      </div>
    </div>
  `;
}

function copySvg() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>`;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

async function updateFooter() {
  const { intervalMinutes } = await getSettings();
  footerEl.textContent = `Syncs every ${intervalMinutes} minute${intervalMinutes === 1 ? "" : "s"} · Alt+Shift+P to sync`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function relativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function loadAll() {
  await loadStatus();
  await loadPRList();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.lastSync || changes.prList)) loadAll();
  if (area === "sync" && changes.settings) updateFooter();
});

loadAll();
updateFooter();
