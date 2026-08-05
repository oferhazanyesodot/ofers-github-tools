/**
 * GitHub PR Bookmark Folder - Popup Script
 * Displays sync status and provides manual sync trigger.
 */

"use strict";

const statusEl = document.getElementById("status");
const syncBtn = document.getElementById("sync-btn");

// Load and display current status
async function loadStatus() {
  const data = await chrome.storage.local.get("lastSync");
  const sync = data.lastSync;

  if (!sync) {
    statusEl.className = "status unknown";
    statusEl.textContent = "No sync performed yet. Click Sync Now to start.";
    return;
  }

  statusEl.className = `status ${sync.state}`;

  switch (sync.state) {
    case "ok":
      statusEl.textContent = sync.message;
      break;
    case "error":
      statusEl.textContent = `Error: ${sync.message}`;
      break;
    case "not_logged_in":
      statusEl.textContent = "Not logged in to GitHub. Please sign in at github.com first.";
      break;
    default:
      statusEl.textContent = sync.message || "Unknown state.";
  }
}

// Trigger a manual sync via message to service worker
syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";

  // Send message to background to trigger sync
  try {
    await chrome.runtime.sendMessage({ action: "syncNow" });
    // Wait a moment for the sync to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (err) {
    console.error("Sync trigger failed:", err);
  }

  await loadStatus();
  syncBtn.disabled = false;
  syncBtn.textContent = "Sync Now";
});

// Listen for storage changes to update status in real-time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastSync) {
    loadStatus();
  }
});

// Initial load
loadStatus();
