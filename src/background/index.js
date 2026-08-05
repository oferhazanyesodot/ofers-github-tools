/**
 * Background Service Worker — entry point.
 *
 * Registers Chrome event listeners and routes messages.
 * All heavy logic is delegated to focused modules.
 */

import { ALARM_NAME } from "../shared/constants.js";
import { setupAlarm } from "./alarm.js";
import { syncPRs } from "./sync.js";

// ─── Lifecycle Events ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarm();
  await syncPRs();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  await syncPRs();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await syncPRs();
  }
});

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case "syncNow":
      syncPRs().then(() => sendResponse({ done: true }));
      return true; // keep channel open for async

    case "settingsChanged":
      setupAlarm().then(() => syncPRs()).then(() => sendResponse({ done: true }));
      return true;

    default:
      return false; // not handled
  }
});
