/**
 * Options page script — load/save/import/export user settings.
 */

import { DEFAULTS, getSettings, saveSettings, exportSettings, importSettings } from "../shared/settings.js";

const queryEl = document.getElementById("query");
const intervalEl = document.getElementById("interval");
const folderNameEl = document.getElementById("folder-name");
const showDraftEl = document.getElementById("show-draft");
const groupByRepoEl = document.getElementById("group-by-repo");
const notificationsEl = document.getElementById("notifications");
const staleDaysEl = document.getElementById("stale-days");
const copilotTrackingEl = document.getElementById("copilot-tracking");
const copilotWorkdaysEl = document.getElementById("copilot-workdays");
const copilotAlertEl = document.getElementById("copilot-alert");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importExportArea = document.getElementById("import-export-area");
const toast = document.getElementById("toast");

// ─── Load ────────────────────────────────────────────────────────────────────

async function load() {
  const s = await getSettings();
  queryEl.value = s.query;
  intervalEl.value = s.intervalMinutes;
  folderNameEl.value = s.folderName;
  showDraftEl.checked = s.showDraftIndicator;
  groupByRepoEl.checked = s.groupByRepo;
  notificationsEl.checked = s.notifications;
  staleDaysEl.value = s.staleThresholdDays;
  copilotTrackingEl.checked = s.copilotTracking;
  copilotWorkdaysEl.value = s.copilotWorkDays;
  copilotAlertEl.value = s.copilotAlertThreshold;
}

// ─── Save ────────────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  const settings = {
    query: queryEl.value.trim() || DEFAULTS.query,
    intervalMinutes: Math.max(1, Math.min(60, parseInt(intervalEl.value, 10) || DEFAULTS.intervalMinutes)),
    folderName: folderNameEl.value.trim() || DEFAULTS.folderName,
    showDraftIndicator: showDraftEl.checked,
    groupByRepo: groupByRepoEl.checked,
    notifications: notificationsEl.checked,
    staleThresholdDays: Math.max(0, parseInt(staleDaysEl.value, 10) || 0),
    copilotTracking: copilotTrackingEl.checked,
    copilotWorkDays: Math.max(1, Math.min(7, parseInt(copilotWorkdaysEl.value, 10) || DEFAULTS.copilotWorkDays)),
    copilotAlertThreshold: Math.max(0, Math.min(100, parseInt(copilotAlertEl.value, 10) || 0)),
  };

  await saveSettings(settings);

  try {
    await chrome.runtime.sendMessage({ action: "settingsChanged" });
  } catch (_) {
    // Service worker may be inactive
  }

  showToast("Settings saved. Syncing now…");
});

// ─── Reset ───────────────────────────────────────────────────────────────────

resetBtn.addEventListener("click", () => {
  queryEl.value = DEFAULTS.query;
  intervalEl.value = DEFAULTS.intervalMinutes;
  folderNameEl.value = DEFAULTS.folderName;
  showDraftEl.checked = DEFAULTS.showDraftIndicator;
  groupByRepoEl.checked = DEFAULTS.groupByRepo;
  notificationsEl.checked = DEFAULTS.notifications;
  staleDaysEl.value = DEFAULTS.staleThresholdDays;
  copilotTrackingEl.checked = DEFAULTS.copilotTracking;
  copilotWorkdaysEl.value = DEFAULTS.copilotWorkDays;
  copilotAlertEl.value = DEFAULTS.copilotAlertThreshold;
});

// ─── Import / Export ─────────────────────────────────────────────────────────

exportBtn.addEventListener("click", async () => {
  const json = await exportSettings();
  importExportArea.value = json;
  importExportArea.select();
  showToast("Settings exported to text area.");
});

importBtn.addEventListener("click", async () => {
  const json = importExportArea.value.trim();
  if (!json) {
    showToast("Paste JSON into the text area first.");
    return;
  }

  const success = await importSettings(json);
  if (success) {
    await load(); // Refresh form
    try {
      await chrome.runtime.sendMessage({ action: "settingsChanged" });
    } catch (_) { /* ok */ }
    showToast("Settings imported successfully.");
  } else {
    showToast("Invalid JSON. Please check and try again.");
  }
});

// ─── Presets ─────────────────────────────────────────────────────────────────

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    queryEl.value = btn.dataset.query;
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

load();
