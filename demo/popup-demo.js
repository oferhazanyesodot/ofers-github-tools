const demoSettings = {
  query: "is:pr state:open archived:false sort:updated-desc author:@me",
  intervalMinutes: 5,
  copilotTracking: true,
  copilotCollapsed: false,
};

const demoData = {
  lastSync: { state: "ok", message: "6 open pull requests synced", timestamp: Date.now() - 93000 },
  prList: [
    { repo: "northstar-api", title: "Keep event results stable across retries", url: "https://github.com/demo-workspace/northstar-api/pull/482", updatedAt: new Date(Date.now() - 18 * 60000).toISOString() },
    { repo: "orbit-console", title: "Normalize questionnaire responses", url: "https://github.com/demo-workspace/orbit-console/pull/219", updatedAt: new Date(Date.now() - 2 * 3600000).toISOString() },
    { repo: "field-notes-service", title: "Tighten candidate schema validation", url: "https://github.com/demo-workspace/field-notes-service/pull/87", updatedAt: new Date(Date.now() - 5 * 3600000).toISOString() },
    { repo: "orbit-console", title: "Show load failures in node details", url: "https://github.com/demo-workspace/orbit-console/pull/214", isDraft: true, updatedAt: new Date(Date.now() - 24 * 3600000).toISOString() },
    { repo: "release-automation", title: "Add a timeout to the deployment job", url: "https://github.com/demo-workspace/release-automation/pull/31", updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { repo: "northstar-api", title: "Export request metrics for Prometheus", url: "https://github.com/demo-workspace/northstar-api/pull/475", updatedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
  ],
  copilotUsage: {
    used: 684,
    limit: 1000,
    percentage: 68,
    daysUntilReset: 11,
    projection: { status: "warning", projectedPercentage: 86, dailyRate: 29, workdaysRemaining: 8, message: "On track to use 86% by reset" },
  },
  copilotHistory: [
    { percentage: 35 }, { percentage: 41 }, { percentage: 48 }, { percentage: 52 },
    { percentage: 57 }, { percentage: 61 }, { percentage: 68 },
  ],
};

const demoGet = async (key) => ({ [key]: demoData[key] });

globalThis.chrome = {
  storage: {
    local: { get: demoGet },
    sync: { get: async () => ({ settings: demoSettings }), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  runtime: { openOptionsPage: () => {}, sendMessage: async () => {} },
  tabs: { create: () => {} },
};
