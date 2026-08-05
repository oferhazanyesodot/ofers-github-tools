/**
 * GitHub PR Bookmark Folder — Options Page
 */

"use strict";

const DEFAULTS = {
  query: "is:pr state:open archived:false sort:updated-desc author:@me",
  intervalMinutes: 5,
  folderName: "GitHub PRs",
};

const queryEl = document.getElementById("query");
const intervalEl = document.getElementById("interval");
const folderNameEl = document.getElementById("folder-name");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const toast = document.getElementById("toast");

// Load saved settings
async function loadSettings() {
  const data = await chrome.storage.sync.get("settings");
  const settings = data.settings || DEFAULTS;
  queryEl.value = settings.query || DEFAULTS.query;
  intervalEl.value = settings.intervalMinutes || DEFAULTS.intervalMinutes;
  folderNameEl.value = settings.folderName || DEFAULTS.folderName;
}

// Save settings
saveBtn.addEventListener("click", async () => {
  const settings = {
    query: queryEl.value.trim() || DEFAULTS.query,
    intervalMinutes: Math.max(1, Math.min(60, parseInt(intervalEl.value, 10) || DEFAULTS.intervalMinutes)),
    folderName: folderNameEl.value.trim() || DEFAULTS.folderName,
  };

  await chrome.storage.sync.set({ settings });

  // Notify background to reload settings
  try {
    await chrome.runtime.sendMessage({ action: "settingsChanged" });
  } catch (e) {
    // Service worker might be inactive, alarm will pick up new settings
  }

  showToast();
});

// Reset to defaults
resetBtn.addEventListener("click", async () => {
  queryEl.value = DEFAULTS.query;
  intervalEl.value = DEFAULTS.intervalMinutes;
  folderNameEl.value = DEFAULTS.folderName;
});

// Preset buttons
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    queryEl.value = btn.dataset.query;
  });
});

function showToast() {
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

loadSettings();
