import { getSettings } from "../shared/settings.js";

export async function updatePRBadge(count) {
  const { badgeEnabled, badgeMode } = await getSettings();
  if (!badgeEnabled) return await clearBadge();
  if (badgeMode !== "prCount") return; // Copilot mode owns the badge
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}

async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
}

export async function updateCopilotBadge(status, usage) {
  const { badgeEnabled, badgeMode } = await getSettings();
  if (!badgeEnabled) return await clearBadge();
  if (badgeMode !== "copilot") return; // PR count mode owns the badge
  const colors = { good: "#1f6feb", warning: "#bf8700", danger: "#cf222e", error: "#6e7781" };
  await chrome.action.setBadgeBackgroundColor({ color: colors[status] || colors.good });
  // Show the usage percentage when we have it, otherwise a status dot.
  const text = usage && typeof usage.percentage === "number" ? `${usage.percentage}%` : "•";
  await chrome.action.setBadgeText({ text });
}
