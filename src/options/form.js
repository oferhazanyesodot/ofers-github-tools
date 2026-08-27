import { DEFAULTS, getSettings } from "../shared/settings.js";
import { elements } from "./dom.js";

export async function loadForm() {
  const settings = await getSettings();
  applyFormSettings(settings);
}

export function readFormSettings() {
  return {
    query: elements.query.value.trim() || DEFAULTS.query,
    intervalMinutes: Math.max(1, Math.min(60, parseInt(elements.interval.value, 10) || DEFAULTS.intervalMinutes)),
    folderName: elements.folderName.value.trim() || DEFAULTS.folderName,
    showDraftIndicator: elements.showDraft.checked,
    groupByRepo: elements.groupByRepo.checked,
    notifications: elements.notifications.checked,
    staleThresholdDays: Math.max(0, parseInt(elements.staleDays.value, 10) || 0),
    copilotTracking: elements.copilotTracking.checked,
    copilotWorkDays: Math.max(1, Math.min(7, parseInt(elements.copilotWorkdays.value, 10) || DEFAULTS.copilotWorkDays)),
    copilotAlertThreshold: Math.max(0, Math.min(100, parseInt(elements.copilotAlert.value, 10) || 0)),
  };
}

export function resetForm() {
  applyFormSettings(DEFAULTS);
}

function applyFormSettings(settings) {
  elements.query.value = settings.query;
  elements.interval.value = settings.intervalMinutes;
  elements.folderName.value = settings.folderName;
  elements.showDraft.checked = settings.showDraftIndicator;
  elements.groupByRepo.checked = settings.groupByRepo;
  elements.notifications.checked = settings.notifications;
  elements.staleDays.value = settings.staleThresholdDays;
  elements.copilotTracking.checked = settings.copilotTracking;
  elements.copilotWorkdays.value = settings.copilotWorkDays;
  elements.copilotAlert.value = settings.copilotAlertThreshold;
}
