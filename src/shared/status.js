/**
 * Status helpers — persist and read the last sync status.
 */

/**
 * Write the sync status to local storage.
 * @param {"ok" | "error" | "not_logged_in"} state
 * @param {string} message
 */
export async function setStatus(state, message) {
  await chrome.storage.local.set({
    lastSync: { state, message, timestamp: Date.now() },
  });
}

/**
 * Read the last sync status from local storage.
 * @returns {Promise<{state: string, message: string, timestamp: number} | null>}
 */
export async function getStatus() {
  const data = await chrome.storage.local.get("lastSync");
  return data.lastSync || null;
}
