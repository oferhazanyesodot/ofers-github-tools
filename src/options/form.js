import { DEFAULTS, getSettings } from "../shared/settings.js";
import { elements } from "./dom.js";

/**
 * Read a numeric field that has an on/off toggle. Returns 0 when the toggle
 * is off, otherwise the clamped value.
 */
function readToggledNumber(input, min, max, fallback) {
  const toggle = document.querySelector(`.toggle-input[data-toggle-for="${input.id}"]`);
  if (toggle && !toggle.checked) return 0;
  return Math.max(min, Math.min(max, parseInt(input.value, 10) || fallback));
}

/**
 * Set a toggled numeric field from a stored value. A value of 0 means "off":
 * the toggle is unchecked, the input disabled and seeded with its default so
 * that flipping the toggle back on shows a sensible number.
 */
function applyToggledNumber(input, value) {
  const toggle = document.querySelector(`.toggle-input[data-toggle-for="${input.id}"]`);
  const on = Number(value) > 0;
  if (toggle) {
    toggle.checked = on;
    input.disabled = !on;
  }
  input.value = on ? value : (toggle?.dataset.default || input.min || 1);
}

export async function loadForm() {
  const settings = await getSettings();
  applyFormSettings(settings);
}

export function readFormSettings() {
  const queries = parseQueryLines(elements.query.value);
  return {
    query: queries[0] || DEFAULTS.query,
    queries,
    intervalMinutes: Math.max(1, Math.min(60, parseInt(elements.interval.value, 10) || DEFAULTS.intervalMinutes)),
    folderName: elements.folderName.value.trim() || DEFAULTS.folderName,
    showDraftIndicator: elements.showDraft.checked,
    showDraftPRs: elements.showDraftPRs.checked,
    showCopyAllButton: elements.showCopyAll.checked,
    groupByRepo: elements.groupByRepo.checked,
    notifications: elements.notifications.checked,
    staleThresholdDays: readToggledNumber(elements.staleDays, 1, 365, 30),
    excludeRepos: elements.excludeRepos.value.trim(),
    autoGroupThreshold: readToggledNumber(elements.autoGroupThreshold, 2, 50, 3),
    bookmarksEnabled: elements.bookmarksEnabled.checked,
    copilotTracking: elements.copilotTracking.checked,
    copilotWorkDays: Math.max(1, Math.min(7, parseInt(elements.copilotWorkdays.value, 10) || DEFAULTS.copilotWorkDays)),
    copilotAlertThreshold: readToggledNumber(elements.copilotAlert, 1, 100, 80),

    theme: elements.theme.value || DEFAULTS.theme,
    accentColor: elements.accentColor.value || DEFAULTS.accentColor,
    density: elements.density.value || DEFAULTS.density,
    fontSize: Math.max(11, Math.min(16, parseInt(elements.fontSize.value, 10) || DEFAULTS.fontSize)),
    dateFormat: elements.dateFormat.value || DEFAULTS.dateFormat,
    sortOrder: elements.sortOrder.value || DEFAULTS.sortOrder,
    showPRNumber: elements.showPRNumber.checked,
    maxPRs: readToggledNumber(elements.maxPRs, 1, 100, 20),
    showCommentCount: elements.showCommentCount.checked,
    showUnread: elements.showUnread.checked,
    showCreatedAge: elements.showCreatedAge.checked,
    showNewTag: elements.showNewTag.checked,
    showRepoOwner: elements.showRepoOwner.checked,
    groupBySharedBranch: elements.groupBySharedBranch.checked,
    fullTimestampTooltip: elements.fullTimestampTooltip.checked,
    openInCurrentTab: elements.openInCurrentTab.checked,
    reuseExistingTab: elements.reuseExistingTab.checked,
    badgeEnabled: elements.badgeEnabled.checked,
    badgeMode: elements.badgeMode.value || DEFAULTS.badgeMode,
  };
}

export function resetForm() {
  applyFormSettings(DEFAULTS);
}

/**
 * Split the query textarea into a list of trimmed, non-empty, de-duplicated
 * queries (one per line).
 */
function parseQueryLines(value) {
  const seen = new Set();
  const out = [];
  for (const line of (value || "").split("\n")) {
    const q = line.trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

function applyFormSettings(settings) {
  // Prefer the multi-query list; fall back to the single query for older saves.
  const queries = Array.isArray(settings.queries) && settings.queries.length > 0
    ? settings.queries
    : [settings.query];
  elements.query.value = queries.join("\n");
  elements.interval.value = settings.intervalMinutes;
  elements.folderName.value = settings.folderName;
  elements.showDraft.checked = settings.showDraftIndicator;
  elements.showDraftPRs.checked = settings.showDraftPRs;
  elements.showCopyAll.checked = settings.showCopyAllButton;
  elements.groupByRepo.checked = settings.groupByRepo;
  elements.notifications.checked = settings.notifications;
  applyToggledNumber(elements.staleDays, settings.staleThresholdDays);
  elements.excludeRepos.value = settings.excludeRepos;
  applyToggledNumber(elements.autoGroupThreshold, settings.autoGroupThreshold);
  elements.bookmarksEnabled.checked = settings.bookmarksEnabled;
  elements.copilotTracking.checked = settings.copilotTracking;
  elements.copilotWorkdays.value = settings.copilotWorkDays;
  applyToggledNumber(elements.copilotAlert, settings.copilotAlertThreshold);

  elements.theme.value = settings.theme;
  elements.accentColor.value = settings.accentColor;
  elements.density.value = settings.density;
  elements.fontSize.value = settings.fontSize;
  if (elements.fontSizeValue) elements.fontSizeValue.textContent = `${settings.fontSize}px`;
  elements.dateFormat.value = settings.dateFormat;
  elements.sortOrder.value = settings.sortOrder;
  elements.showPRNumber.checked = settings.showPRNumber;
  applyToggledNumber(elements.maxPRs, settings.maxPRs);
  elements.showCommentCount.checked = settings.showCommentCount;
  elements.showUnread.checked = settings.showUnread;
  elements.showCreatedAge.checked = settings.showCreatedAge;
  elements.showNewTag.checked = settings.showNewTag;
  elements.showRepoOwner.checked = settings.showRepoOwner;
  elements.groupBySharedBranch.checked = settings.groupBySharedBranch;
  elements.fullTimestampTooltip.checked = settings.fullTimestampTooltip;
  elements.openInCurrentTab.checked = settings.openInCurrentTab;
  elements.reuseExistingTab.checked = settings.reuseExistingTab;
  elements.badgeEnabled.checked = settings.badgeEnabled;
  elements.badgeMode.value = settings.badgeMode;
}
