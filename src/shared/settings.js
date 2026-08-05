/**
 * Settings management — read/write user configuration from chrome.storage.sync.
 */

export const DEFAULTS = {
  query: "is:pr state:open archived:false sort:updated-desc author:@me",
  intervalMinutes: 5,
  folderName: "GitHub PRs",
};

/**
 * Load the current settings, merged with defaults for any missing keys.
 * @returns {Promise<{query: string, intervalMinutes: number, folderName: string}>}
 */
export async function getSettings() {
  const data = await chrome.storage.sync.get("settings");
  const s = data.settings || {};
  return {
    query: s.query || DEFAULTS.query,
    intervalMinutes: s.intervalMinutes || DEFAULTS.intervalMinutes,
    folderName: s.folderName || DEFAULTS.folderName,
  };
}

/**
 * Persist settings to chrome.storage.sync.
 * @param {{query?: string, intervalMinutes?: number, folderName?: string}} settings
 */
export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}
