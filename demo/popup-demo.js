// Standalone demo/screenshot stub. Provides a fully simulated `chrome` API with
// fake repos and PRs so the popup renders realistically for store screenshots
// without touching any real GitHub data. Theme and feature flags can be driven
// from the URL, e.g. popup.html?demo=1&theme=dark
const params = new URLSearchParams(location.search);
const theme = params.get("theme") || "dark";

// Apply theme synchronously for screenshots so the render doesn't depend on the
// async settings→applyTheme chain resolving within the capture window.
if (theme && theme !== "system") {
  document.documentElement.setAttribute("data-theme", theme);
} else {
  document.documentElement.removeAttribute("data-theme");
}
if (params.get("accent")) {
  document.documentElement.style.setProperty("--accent", params.get("accent"));
}

const H = 3600000;
const D = 86400000;

const demoSettings = {
  query: "is:pr state:open archived:false sort:updated-desc author:@me",
  intervalMinutes: 5,
  folderName: "GitHub PRs",
  showDraftIndicator: true,
  showDraftPRs: true,
  showCopyAllButton: true,
  groupByRepo: false,
  notifications: true,
  staleThresholdDays: 14,
  excludeRepos: "",
  autoGroupThreshold: 0,
  pinnedPRs: ["https://github.com/lumina-labs/orbit-console/pull/482"],
  bookmarksEnabled: true,
  copilotTracking: true,
  copilotWorkDays: 5,
  copilotAlertThreshold: 85,
  copilotCollapsed: false,

  theme,
  accentColor: "#1f6feb",
  density: "comfortable",
  fontSize: 12,

  dateFormat: "relative",
  sortOrder: "updated",
  showPRNumber: true,
  maxPRs: 0,
  showCommentCount: true,
  showUnread: true,
  showCreatedAge: false,
  showNewTag: true,

  badgeEnabled: true,
  badgeMode: "prCount",
};

const demoData = {
  lastSync: { state: "ok", message: "6 open pull requests synced", timestamp: Date.now() - 62000 },
  prList: [
    { repo: "orbit-console", number: 482, title: "Keep event results stable across retries", url: "https://github.com/lumina-labs/orbit-console/pull/482", repoFullName: "lumina-labs/orbit-console", commentCount: 13, unread: true, createdAt: new Date(Date.now() - 4 * D).toISOString(), updatedAt: new Date(Date.now() - 18 * 60000).toISOString() },
    { repo: "northstar-api", number: 277, title: "Normalize questionnaire responses on ingest", url: "https://github.com/lumina-labs/northstar-api/pull/277", repoFullName: "lumina-labs/northstar-api", commentCount: 5, createdAt: new Date(Date.now() - 6 * D).toISOString(), updatedAt: new Date(Date.now() - 2 * H).toISOString() },
    { repo: "northstar-api", number: 271, title: "Add local dev hot-reload workflow", url: "https://github.com/lumina-labs/northstar-api/pull/271", repoFullName: "lumina-labs/northstar-api", commentCount: 4, unread: true, createdAt: new Date(Date.now() - 3 * D).toISOString(), updatedAt: new Date(Date.now() - 7 * D).toISOString() },
    { repo: "field-notes-service", number: 87, title: "Tighten candidate schema validation", url: "https://github.com/lumina-labs/field-notes-service/pull/87", repoFullName: "lumina-labs/field-notes-service", commentCount: 2, createdAt: new Date(Date.now() - 5 * D).toISOString(), updatedAt: new Date(Date.now() - 5 * H).toISOString() },
    { repo: "orbit-console", number: 214, title: "Show load failures in node details", url: "https://github.com/lumina-labs/orbit-console/pull/214", repoFullName: "lumina-labs/orbit-console", isDraft: true, createdAt: new Date(Date.now() - 8 * D).toISOString(), updatedAt: new Date(Date.now() - 1 * D).toISOString() },
    { repo: "release-automation", number: 31, title: "Add a timeout to the deployment job", url: "https://github.com/lumina-labs/release-automation/pull/31", repoFullName: "lumina-labs/release-automation", createdAt: new Date(Date.now() - 20 * D).toISOString(), updatedAt: new Date(Date.now() - 16 * D).toISOString() },
  ],
  newPrUrls: ["https://github.com/lumina-labs/northstar-api/pull/271"],
  copilotUsage: {
    used: 6840,
    limit: 30000,
    percentage: 23,
    daysUntilReset: 18,
    projection: { status: "good", projectedPercentage: 61, dailyRate: 380, workdaysRemaining: 13, message: "On track — ~61% projected by reset" },
  },
  copilotHistory: [
    { percentage: 6 }, { percentage: 9 }, { percentage: 12 }, { percentage: 14 },
    { percentage: 17 }, { percentage: 20 }, { percentage: 23 },
  ],
};

const demoGet = async (keys) => {
  if (typeof keys === "string") return { [keys]: demoData[keys] };
  if (Array.isArray(keys)) {
    const out = {};
    for (const k of keys) out[k] = demoData[k];
    return out;
  }
  return { ...demoData };
};

globalThis.chrome = {
  storage: {
    local: { get: demoGet, set: async () => {} },
    sync: { get: async () => ({ settings: demoSettings }), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  runtime: { openOptionsPage: () => {}, sendMessage: async () => {}, getContexts: async () => [] },
  tabs: { create: () => {} },
};
