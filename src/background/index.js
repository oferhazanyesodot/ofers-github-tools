/**
 * Background service worker entrypoint.
 * Registers lifecycle events and routes messages to focused services.
 */

import { ALARM_NAME } from "../shared/constants.js";
import { setupAlarm } from "./alarm.js";
import { revertFileInPR } from "./revert-file.js";
import { syncPRs } from "./sync.js";

async function initialize() {
  await setupAlarm();
  await syncPRs();
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await syncPRs();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "sync-now") await syncPRs();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "syncNow") {
    syncPRs().then(() => sendResponse({ done: true }));
    return true;
  }

  if (message.action === "settingsChanged") {
    setupAlarm().then(syncPRs).then(() => sendResponse({ done: true }));
    return true;
  }

  if (message.action === "revertFile") {
    revertFileInPR(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
