import { getSettings } from "../shared/settings.js";

export async function notifyNewPRs(currentPRs) {
  const settings = await getSettings();
  if (!settings.notifications) return;

  const data = await chrome.storage.local.get("knownPrUrls");
  const knownUrls = new Set(data.knownPrUrls || []);
  if (knownUrls.size === 0) {
    await chrome.storage.local.set({ knownPrUrls: currentPRs.map((pr) => pr.url) });
    return;
  }

  const newPRs = currentPRs.filter((pr) => !knownUrls.has(pr.url));
  if (newPRs.length > 0) {
    const title = newPRs.length === 1 ? `New PR: ${newPRs[0].repo}` : `${newPRs.length} new PRs`;
    const message = newPRs.length === 1
      ? newPRs[0].title
      : newPRs.map((pr) => `${pr.repo} - ${pr.title}`).join("\n");
    chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 1 });
  }

  await chrome.storage.local.set({ knownPrUrls: currentPRs.map((pr) => pr.url) });
}

export async function checkCopilotThreshold(usage, projection, settings) {
  if (!settings.copilotAlertThreshold || !settings.notifications) return;

  const data = await chrome.storage.local.get("copilotAlertSent");
  const alertSent = data.copilotAlertSent || {};
  const cycleKey = usage.resetDate || "current";

  if (usage.percentage >= settings.copilotAlertThreshold && !alertSent[cycleKey]) {
    chrome.notifications.create("copilot-threshold", {
      type: "basic", iconUrl: "icons/icon128.png", title: "Copilot Usage Alert",
      message: `You've used ${usage.percentage}% of your AI credits. ${projection.message}`, priority: 2,
    });
    alertSent[cycleKey] = true;
  }

  const projectionKey = `${cycleKey}_proj`;
  if (projection.status === "danger" && !alertSent[projectionKey]) {
    chrome.notifications.create("copilot-projection", {
      type: "basic", iconUrl: "icons/icon128.png", title: "Copilot Credits Running Low",
      message: projection.message, priority: 2,
    });
    alertSent[projectionKey] = true;
  }

  await chrome.storage.local.set({ copilotAlertSent: alertSent });
}
