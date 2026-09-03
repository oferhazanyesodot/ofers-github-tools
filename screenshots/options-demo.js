// Demo chrome stub for rendering the options page in screenshots. Injected
// before options.js so the page reads simulated settings and never touches
// real storage. Theme is read from the URL (?theme=dark|light|hello-kitty).
const params = new URLSearchParams(location.search);
const theme = params.get("theme") || "dark";

// Apply theme synchronously so screenshots don't depend on async theme setup.
if (theme && theme !== "system") {
  document.documentElement.setAttribute("data-theme", theme);
} else {
  document.documentElement.removeAttribute("data-theme");
}

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
  pinnedPRs: [],
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

globalThis.chrome = {
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    sync: { get: async () => ({ settings: demoSettings }), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  runtime: { openOptionsPage: () => {}, sendMessage: async () => {}, getContexts: async () => [] },
  tabs: { create: () => {} },
};
