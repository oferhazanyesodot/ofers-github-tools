/**
 * Settings management — read/write user configuration from chrome.storage.sync.
 */

export const DEFAULTS = {
  query: "is:pr state:open archived:false sort:updated-desc author:@me",
  // Multiple search queries are fetched together and merged (de-duplicated by
  // PR URL). When empty, `query` above is used as the single query. This lets
  // you combine e.g. "authored by me" and "review requested from me".
  queries: [],
  intervalMinutes: 5,
  folderName: "GitHub PRs",
  showDraftIndicator: true,
  showDraftPRs: true, // when false, draft PRs are hidden from the popup list
  showCopyAllButton: true, // show the "Copy all URLs" button in the popup
  groupByRepo: false,
  notifications: true,
  staleThresholdDays: 0, // 0 = disabled, >0 = move to "Old PRs" subfolder
  excludeRepos: "", // comma-separated repo names/owners to skip when bookmarking
  autoGroupThreshold: 0, // when groupByRepo is off, auto-group once repo count >= this (0 = never)
  pinnedPRs: [], // array of PR urls the user has pinned/favorited
  bookmarksEnabled: true, // when false, don't mirror PRs to a bookmark folder
  copilotTracking: true,
  copilotWorkDays: 5, // 1-7, number of days per week you work
  copilotAlertThreshold: 80, // percentage at which to show a notification (0 = disabled)
  copilotCollapsed: false, // whether the copilot card is collapsed in popup

  // ─── Appearance ─────────────────────────────────────────────────────────
  theme: "system", // "system" | "light" | "dark" | "hello-kitty"
  accentColor: "#1f6feb", // highlight color for bars, badges, primary buttons
  density: "comfortable", // "comfortable" | "compact"
  fontSize: 12, // popup base font size in px (11-16)

  // ─── PR list display ──────────────────────────────────────────────────────
  dateFormat: "relative", // "relative" (2d ago) | "absolute" (Sep 1, 2026)
  sortOrder: "updated", // "updated" | "created" | "title" | "repo"
  showPRNumber: false, // prefix titles with #1234
  maxPRs: 0, // 0 = show all, otherwise cap the list
  showCommentCount: true, // show comment count
  showUnread: true, // show a dot for PRs you haven't read yet
  showCreatedAge: false, // show "opened Xd ago" (created) alongside updated time
  showNewTag: true, // tag PRs that appeared since the previous sync
  showRepoOwner: false, // show "owner/repo" instead of just "repo"
  fullTimestampTooltip: false, // always show exact date-time in the age tooltip
  openInCurrentTab: false, // open PRs in the current tab instead of a new one
  reuseExistingTab: true, // focus an already-open tab for the PR instead of duplicating

  // ─── Badge ─────────────────────────────────────────────────────────────────
  badgeEnabled: true, // when false, no toolbar badge text is shown
  badgeMode: "prCount", // "prCount" | "copilot"
};

/**
 * Load the current settings, merged with defaults for any missing keys.
 */
export async function getSettings() {
  const data = await chrome.storage.sync.get("settings");
  const s = data.settings || {};
  return {
    query: s.query || DEFAULTS.query,
    queries: Array.isArray(s.queries) ? s.queries.filter((q) => typeof q === "string" && q.trim()) : DEFAULTS.queries,
    intervalMinutes: s.intervalMinutes || DEFAULTS.intervalMinutes,
    folderName: s.folderName || DEFAULTS.folderName,
    showDraftIndicator: s.showDraftIndicator ?? DEFAULTS.showDraftIndicator,
    showDraftPRs: s.showDraftPRs ?? (s.hideDraftPRs != null ? !s.hideDraftPRs : DEFAULTS.showDraftPRs),
    showCopyAllButton: s.showCopyAllButton ?? DEFAULTS.showCopyAllButton,
    groupByRepo: s.groupByRepo ?? DEFAULTS.groupByRepo,
    notifications: s.notifications ?? DEFAULTS.notifications,
    staleThresholdDays: s.staleThresholdDays ?? DEFAULTS.staleThresholdDays,
    excludeRepos: s.excludeRepos ?? DEFAULTS.excludeRepos,
    autoGroupThreshold: s.autoGroupThreshold ?? DEFAULTS.autoGroupThreshold,
    pinnedPRs: Array.isArray(s.pinnedPRs) ? s.pinnedPRs : DEFAULTS.pinnedPRs,
    bookmarksEnabled: s.bookmarksEnabled ?? DEFAULTS.bookmarksEnabled,
    copilotTracking: s.copilotTracking ?? DEFAULTS.copilotTracking,
    copilotWorkDays: s.copilotWorkDays ?? DEFAULTS.copilotWorkDays,
    copilotAlertThreshold: s.copilotAlertThreshold ?? DEFAULTS.copilotAlertThreshold,
    copilotCollapsed: s.copilotCollapsed ?? DEFAULTS.copilotCollapsed,

    theme: s.theme ?? DEFAULTS.theme,
    accentColor: s.accentColor ?? DEFAULTS.accentColor,
    density: s.density ?? DEFAULTS.density,
    fontSize: s.fontSize ?? DEFAULTS.fontSize,

    dateFormat: s.dateFormat ?? DEFAULTS.dateFormat,
    sortOrder: s.sortOrder ?? DEFAULTS.sortOrder,
    showPRNumber: s.showPRNumber ?? DEFAULTS.showPRNumber,
    maxPRs: s.maxPRs ?? DEFAULTS.maxPRs,
    showCommentCount: s.showCommentCount ?? DEFAULTS.showCommentCount,
    showUnread: s.showUnread ?? DEFAULTS.showUnread,
    showCreatedAge: s.showCreatedAge ?? DEFAULTS.showCreatedAge,
    showNewTag: s.showNewTag ?? DEFAULTS.showNewTag,
    showRepoOwner: s.showRepoOwner ?? DEFAULTS.showRepoOwner,
    fullTimestampTooltip: s.fullTimestampTooltip ?? DEFAULTS.fullTimestampTooltip,
    openInCurrentTab: s.openInCurrentTab ?? DEFAULTS.openInCurrentTab,
    reuseExistingTab: s.reuseExistingTab ?? DEFAULTS.reuseExistingTab,

    badgeEnabled: s.badgeEnabled ?? DEFAULTS.badgeEnabled,
    badgeMode: s.badgeMode ?? DEFAULTS.badgeMode,
  };
}

/**
 * Derive a short human label for a query from its GitHub qualifiers, so PRs can
 * be attributed to the query that surfaced them.
 * @param {string} query
 * @returns {string}
 */
export function labelForQuery(query) {
  const q = (query || "").toLowerCase();
  if (/\breview-requested:/.test(q)) return "Review requested";
  if (/\bauthor:/.test(q)) return "Authored";
  if (/\bassignee:/.test(q)) return "Assigned";
  if (/\bmentions:/.test(q)) return "Mentions";
  if (/\breviewed-by:/.test(q)) return "Reviewed";
  if (/\binvolves:/.test(q)) return "Involves";
  return "PRs";
}

/**
 * Parse a single query line. Supports an optional "Label: query" prefix so the
 * user can name a query; otherwise a label is derived from the qualifiers.
 * @param {string} line
 * @returns {{label: string, query: string} | null}
 */
export function parseQueryLine(line) {
  const raw = (line || "").trim();
  if (!raw) return null;
  // A label prefix is "Word words: is:pr ...". We only treat the text before
  // the first colon as a label when what follows still looks like a query
  // (contains a GitHub qualifier like "is:" / "state:" / "author:").
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const maybeLabel = raw.slice(0, colon).trim();
    const rest = raw.slice(colon + 1).trim();
    // Treat "Prefix: query" as a label only when the prefix is plain words
    // (letters/spaces, not a GitHub qualifier) AND the remainder still looks
    // like a query. This avoids misreading "is:pr ..." as a label.
    const QUALIFIERS = /^(is|state|archived|sort|author|assignee|review-requested|mentions|involves|reviewed-by)$/i;
    const labelIsWords = /^[A-Za-z][A-Za-z ]{0,30}$/.test(maybeLabel) && !QUALIFIERS.test(maybeLabel);
    const restIsQuery = /\b(is|state|archived|sort|author|assignee|review-requested|mentions|involves|reviewed-by):/.test(rest);
    if (labelIsWords && restIsQuery) {
      return { label: maybeLabel, query: rest };
    }
  }
  return { label: labelForQuery(raw), query: raw };
}

/**
 * Resolve the effective list of {label, query} entries to fetch.
 * Falls back to the single `query` when no multi-queries are configured.
 * De-duplicates by query text.
 * @param {{query: string, queries?: string[]}} settings
 * @returns {Array<{label: string, query: string}>}
 */
export function resolveQueries(settings) {
  const lines = (settings.queries || []).length > 0 ? settings.queries : [settings.query];
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const parsed = parseQueryLine(line);
    if (!parsed || seen.has(parsed.query)) continue;
    seen.add(parsed.query);
    out.push(parsed);
  }
  return out.length > 0 ? out : [{ label: labelForQuery(settings.query), query: settings.query }];
}

/**
 * Persist settings to chrome.storage.sync.
 */
export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

/**
 * Toggle a PR url in the pinned list and persist it.
 * @param {string} url
 * @returns {Promise<string[]>} the updated pinned list
 */
export async function togglePinnedPR(url) {
  const settings = await getSettings();
  const pinned = new Set(settings.pinnedPRs);
  if (pinned.has(url)) {
    pinned.delete(url);
  } else {
    pinned.add(url);
  }
  const next = [...pinned];
  await saveSettings({ ...settings, pinnedPRs: next });
  return next;
}

/**
 * Export settings as a JSON string for sharing.
 */
export async function exportSettings() {
  const settings = await getSettings();
  return JSON.stringify(settings, null, 2);
}

/**
 * Import settings from a JSON string.
 * @returns {boolean} true if import succeeded
 */
export async function importSettings(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) return false;
    // Merge with defaults to ensure all keys exist
    const merged = { ...DEFAULTS, ...parsed };
    await saveSettings(merged);
    return true;
  } catch {
    return false;
  }
}
