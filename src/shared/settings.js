/**
 * Settings management — read/write user configuration from chrome.storage.sync.
 */

export const DEFAULTS = {
  query: "is:pr state:open archived:false sort:updated-desc author:@me",
  intervalMinutes: 5,
  folderName: "GitHub PRs",
  showDraftIndicator: true,
  groupByRepo: false,
  notifications: true,
  staleThresholdDays: 0, // 0 = disabled, >0 = move to "Old PRs" subfolder
  copilotTracking: true,
  copilotWorkDays: 5, // 1-7, number of days per week you work
  copilotAlertThreshold: 80, // percentage at which to show a notification (0 = disabled)
  copilotCollapsed: false, // whether the copilot card is collapsed in popup
};

/**
 * Load the current settings, merged with defaults for any missing keys.
 */
export async function getSettings() {
  const data = await chrome.storage.sync.get("settings");
  const s = data.settings || {};
  return {
    query: s.query || DEFAULTS.query,
    intervalMinutes: s.intervalMinutes || DEFAULTS.intervalMinutes,
    folderName: s.folderName || DEFAULTS.folderName,
    showDraftIndicator: s.showDraftIndicator ?? DEFAULTS.showDraftIndicator,
    groupByRepo: s.groupByRepo ?? DEFAULTS.groupByRepo,
    notifications: s.notifications ?? DEFAULTS.notifications,
    staleThresholdDays: s.staleThresholdDays ?? DEFAULTS.staleThresholdDays,
    copilotTracking: s.copilotTracking ?? DEFAULTS.copilotTracking,
    copilotWorkDays: s.copilotWorkDays ?? DEFAULTS.copilotWorkDays,
    copilotAlertThreshold: s.copilotAlertThreshold ?? DEFAULTS.copilotAlertThreshold,
    copilotCollapsed: s.copilotCollapsed ?? DEFAULTS.copilotCollapsed,
  };
}

/**
 * Persist settings to chrome.storage.sync.
 */
export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

/**
 * Export settings as a JSON string for sharing.
 */
export async function exportSettings() {
  const settings = await getSettings();
  return JSON.stringify(settings, null, 2);
}

/**
 * Import settings from a JSON string.
 * @returns {boolean} true if import succeeded
 */
export async function importSettings(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) return false;
    // Merge with defaults to ensure all keys exist
    const merged = { ...DEFAULTS, ...parsed };
    await saveSettings(merged);
    return true;
  } catch {
    return false;
  }
}
