export async function updatePRBadge(count) {
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}

export async function updateCopilotBadge(status) {
  const colors = { good: "#1f6feb", warning: "#bf8700", danger: "#cf222e" };
  await chrome.action.setBadgeBackgroundColor({ color: colors[status] || colors.good });
}
