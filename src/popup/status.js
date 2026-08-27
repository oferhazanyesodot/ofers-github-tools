import { getSettings } from "../shared/settings.js";
import { elements } from "./dom.js";
import { relativeTime } from "./format.js";

export async function loadStatus() {
  const data = await chrome.storage.local.get("lastSync");
  const sync = data.lastSync;

  if (!sync) {
    elements.status.className = "status unknown";
    elements.status.textContent = "No sync yet. Click Sync Now to start.";
    return;
  }

  elements.status.className = `status ${sync.state}`;

  if (sync.state === "ok" && sync.timestamp) {
    elements.status.textContent = `${sync.message} (${relativeTime(sync.timestamp)})`;
  } else if (sync.state === "error") {
    elements.status.textContent = `Error: ${sync.message}`;
  } else if (sync.state === "not_logged_in") {
    elements.status.textContent = "Not logged in to GitHub. Sign in at github.com first.";
  } else {
    elements.status.textContent = sync.message || "Unknown state.";
  }
}

export async function updateFooter() {
  const { intervalMinutes } = await getSettings();
  elements.footer.textContent = `Syncs every ${intervalMinutes} minute${intervalMinutes === 1 ? "" : "s"} · Alt+Shift+P to sync`;
}
