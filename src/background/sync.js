/**
 * Sync orchestration — ties fetching, bookmark writing, status, and notifications together.
 */

import { fetchPRs } from "../fetcher/index.js";
import { synchronizeBookmarks } from "../bookmarks/index.js";
import { setStatus } from "../shared/status.js";
import { getSettings } from "../shared/settings.js";
import { fetchCopilotUsage } from "../copilot/fetcher.js";
import { calculateProjection } from "../copilot/projection.js";

/**
 * Perform a full sync cycle:
 *  1. Fetch PRs from GitHub
 *  2. Detect new PRs and notify
 *  3. Update bookmark folder
 *  4. Store PR list for popup display
 *  5. Update badge + status
 */
export async function syncPRs() {
  let prs;

  try {
    prs = await fetchPRs();
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Fetch failed:", err.message);
    await setStatus("error", err.message);
    return;
  }

  if (prs === null) {
    await setStatus("not_logged_in", "Not logged in to GitHub.");
    await updateBadge(0);
    return;
  }

  try {
    // Detect new PRs before updating
    await notifyNewPRs(prs);

    // Sync bookmarks
    await synchronizeBookmarks(prs);

    // Store PR list for the popup
    await chrome.storage.local.set({ prList: prs });

    // Update badge & status
    await updateBadge(prs.length);
    await setStatus("ok", `Synced ${prs.length} PRs at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.error("[GitHub PR Bookmarks] Bookmark sync error:", err.message);
    await setStatus("error", err.message);
  }

  // Sync Copilot usage (non-blocking, don't fail the main sync)
  try {
    await syncCopilotUsage();
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Copilot usage sync failed:", err.message);
  }
}

// ─── Copilot Usage ───────────────────────────────────────────────────────────

async function syncCopilotUsage() {
  const settings = await getSettings();
  if (!settings.copilotTracking) return;

  const usage = await fetchCopilotUsage();
  if (!usage) return;

  const projection = calculateProjection(usage, settings.copilotWorkDays);

  // Store daily history for sparkline
  await recordDailyUsage(usage);

  // Store usage data
  await chrome.storage.local.set({
    copilotUsage: {
      ...usage,
      projection,
    },
  });

  // Update badge color based on copilot status
  await updateBadgeColorForCopilot(projection.status);

  // Threshold notification
  await checkCopilotThreshold(usage, projection, settings);
}

async function recordDailyUsage(usage) {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const data = await chrome.storage.local.get("copilotHistory");
  const history = data.copilotHistory || [];

  // Update today's entry or add new one
  const existingIndex = history.findIndex((h) => h.date === today);
  const entry = { date: today, used: usage.used, limit: usage.limit, percentage: usage.percentage };

  if (existingIndex >= 0) {
    history[existingIndex] = entry;
  } else {
    history.push(entry);
  }

  // Keep only last 31 days
  const trimmed = history.slice(-31);
  await chrome.storage.local.set({ copilotHistory: trimmed });
}

async function updateBadgeColorForCopilot(status) {
  const colors = {
    good: "#1f6feb",
    warning: "#bf8700",
    danger: "#cf222e",
  };
  await chrome.action.setBadgeBackgroundColor({ color: colors[status] || "#1f6feb" });
}

async function checkCopilotThreshold(usage, projection, settings) {
  if (!settings.copilotAlertThreshold || settings.copilotAlertThreshold === 0) return;
  if (!settings.notifications) return;

  const data = await chrome.storage.local.get("copilotAlertSent");
  const alertSent = data.copilotAlertSent || {};

  // Alert key is based on the reset date to avoid re-alerting same cycle
  const cycleKey = usage.resetDate || "current";

  // Check if actual usage crossed threshold
  if (usage.percentage >= settings.copilotAlertThreshold && !alertSent[cycleKey]) {
    chrome.notifications.create("copilot-threshold", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Copilot Usage Alert",
      message: `You've used ${usage.percentage}% of your AI credits. ${projection.message}`,
      priority: 2,
    });

    alertSent[cycleKey] = true;
    await chrome.storage.local.set({ copilotAlertSent: alertSent });
  }

  // Also alert if projection shows danger and we haven't alerted for projection
  const projKey = `${cycleKey}_proj`;
  if (projection.status === "danger" && !alertSent[projKey]) {
    chrome.notifications.create("copilot-projection", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Copilot Credits Running Low",
      message: projection.message,
      priority: 2,
    });

    alertSent[projKey] = true;
    await chrome.storage.local.set({ copilotAlertSent: alertSent });
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function notifyNewPRs(currentPRs) {
  const settings = await getSettings();
  if (!settings.notifications) return;

  const data = await chrome.storage.local.get("knownPrUrls");
  const knownUrls = new Set(data.knownPrUrls || []);

  // On first run, just record URLs without notifying
  if (knownUrls.size === 0) {
    await chrome.storage.local.set({ knownPrUrls: currentPRs.map((pr) => pr.url) });
    return;
  }

  const newPRs = currentPRs.filter((pr) => !knownUrls.has(pr.url));

  if (newPRs.length > 0) {
    const title = newPRs.length === 1
      ? `New PR: ${newPRs[0].repo}`
      : `${newPRs.length} new PRs`;

    const message = newPRs.length === 1
      ? newPRs[0].title
      : newPRs.map((pr) => `${pr.repo} - ${pr.title}`).join("\n");

    // Chrome notifications API (no extra permission needed — included in MV3)
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: 1,
    });
  }

  // Update known URLs
  await chrome.storage.local.set({ knownPrUrls: currentPRs.map((pr) => pr.url) });
}

// ─── Badge ───────────────────────────────────────────────────────────────────

async function updateBadge(count) {
  const text = count > 0 ? String(count) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}
