/**
 * Popup script — displays sync status and provides quick actions.
 */

import { getSettings } from "../shared/settings.js";

const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("sync-btn");
const optionsBtn = document.getElementById("options-btn");
const footerEl = document.getElementById("footer");

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

  await loadStatus();
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

  const messages = {
    ok: sync.message,
    error: `Error: ${sync.message}`,
    not_logged_in: "Not logged in to GitHub. Sign in at github.com first.",
  };

  statusEl.textContent = messages[sync.state] || sync.message || "Unknown state.";
}

// Live updates when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastSync) loadStatus();
  if (area === "sync" && changes.settings) updateFooter();
});

async function updateFooter() {
  const { intervalMinutes } = await getSettings();
  footerEl.textContent = `Syncs every ${intervalMinutes} minute${intervalMinutes === 1 ? "" : "s"} using your GitHub session`;
}

loadStatus();
updateFooter();
