import { fetchCopilotUsage } from "../copilot/fetcher.js";
import { calculateProjection } from "../copilot/projection.js";
import { getSettings } from "../shared/settings.js";
import { checkCopilotThreshold } from "./notifications.js";
import { updateCopilotBadge } from "./badge.js";

export async function syncCopilotUsage() {
  const settings = await getSettings();
  if (!settings.copilotTracking) return;

  const { usage, error } = await fetchCopilotUsage();
  if (!usage) {
    // Preserve the last known usage so we can still show it, but attach the
    // error so the popup can explain what went wrong (and which URL failed).
    const previous = await chrome.storage.local.get("copilotUsage");
    await chrome.storage.local.set({
      copilotUsage: { ...(previous.copilotUsage || {}), error },
    });
    await updateCopilotBadge("error");
    return;
  }

  const projection = calculateProjection(usage, settings.copilotWorkDays);
  await recordDailyUsage(usage);
  await chrome.storage.local.set({ copilotUsage: { ...usage, projection, error: null } });
  await updateCopilotBadge(projection.status, usage);
  await checkCopilotThreshold(usage, projection, settings);
}

async function recordDailyUsage(usage) {
  const today = new Date().toISOString().slice(0, 10);
  const data = await chrome.storage.local.get("copilotHistory");
  const history = data.copilotHistory || [];
  const entry = { date: today, used: usage.used, limit: usage.limit, percentage: usage.percentage };
  const existingIndex = history.findIndex((item) => item.date === today);

  if (existingIndex >= 0) history[existingIndex] = entry;
  else history.push(entry);

  await chrome.storage.local.set({ copilotHistory: history.slice(-31) });
}
