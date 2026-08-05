/**
 * Alarm management — schedule and reset the periodic sync alarm.
 */

import { ALARM_NAME } from "../shared/constants.js";
import { getSettings } from "../shared/settings.js";

/**
 * Create (or recreate) the sync alarm with the user's configured interval.
 */
export async function setupAlarm() {
  const { intervalMinutes } = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: intervalMinutes });
}
