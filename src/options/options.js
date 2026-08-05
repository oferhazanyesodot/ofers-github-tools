/**
 * Options page script — load/save user settings.
 */

import { DEFAULTS, getSettings, saveSettings } from "../shared/settings.js";

const queryEl = document.getElementById("query");
const intervalEl = document.getElementById("interval");
const folderNameEl = document.getElementById("folder-name");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const toast = document.getElementById("toast");

// ─── Load ────────────────────────────────────────────────────────────────────

async function load() {
  const settings = await getSettings();
  queryEl.value = settings.query;
  intervalEl.value = settings.intervalMinutes;
  folderNameEl.value = settings.folderName;
}

// ─── Save ────────────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  const settings = {
    query: queryEl.value.trim() || DEFAULTS.query,
    intervalMinutes: Math.max(1, Math.min(60, parseInt(intervalEl.value, 10) || DEFAULTS.intervalMinutes)),
    folderName: folderNameEl.value.trim() || DEFAULTS.folderName,
  };

  await saveSettings(settings);

  try {
    await chrome.runtime.sendMessage({ action: "settingsChanged" });
  } catch (_) {
    // Service worker may be inactive; alarm picks up on next wake
  }

  showToast();
});

// ─── Reset ───────────────────────────────────────────────────────────────────

resetBtn.addEventListener("click", () => {
  queryEl.value = DEFAULTS.query;
  intervalEl.value = DEFAULTS.intervalMinutes;
  folderNameEl.value = DEFAULTS.folderName;
});

// ─── Presets ─────────────────────────────────────────────────────────────────

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    queryEl.value = btn.dataset.query;
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showToast() {
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

load();
