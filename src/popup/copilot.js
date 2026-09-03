import { getSettings, saveSettings } from "../shared/settings.js";
import { elements } from "./dom.js";
import { sparklineColor, sparklineFill } from "./format.js";

export function bindCopilotActions() {
  elements.copilotCollapse.addEventListener("click", async (event) => {
    event.stopPropagation();
    const isCollapsed = elements.copilotBody.classList.toggle("collapsed");
    elements.copilotCollapse.textContent = isCollapsed ? "▸" : "▾";

    const settings = await getSettings();
    settings.copilotCollapsed = isCollapsed;
    await saveSettings(settings);
  });

  elements.copilotTitle.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://github.com/settings/copilot/features" });
  });
}

export async function loadCopilotUsage() {
  const settings = await getSettings();
  if (!settings.copilotTracking) {
    elements.copilotUsage.classList.add("hidden");
    return;
  }

  const data = await chrome.storage.local.get("copilotUsage");
  const usage = data.copilotUsage;
  if (!usage) {
    elements.copilotUsage.classList.add("hidden");
    return;
  }

  elements.copilotUsage.classList.remove("hidden");
  elements.copilotBody.classList.toggle("collapsed", settings.copilotCollapsed);
  elements.copilotCollapse.textContent = settings.copilotCollapsed ? "▸" : "▾";

  const hasUsageData = typeof usage.used === "number" && typeof usage.limit === "number";

  // Surface any fetch error so failures aren't silent.
  if (usage.error) {
    renderError(usage.error, hasUsageData);
  } else {
    elements.copilotError.classList.add("hidden");
  }

  // If we only have an error and no usage numbers, stop after showing it.
  if (!hasUsageData) {
    elements.copilotStats.textContent = "—";
    elements.copilotBarContainer.classList.add("hidden");
    elements.copilotDetails.textContent = "";
    elements.copilotProjection.textContent = "";
    elements.copilotSparkline.style.display = "none";
    return;
  }
  elements.copilotBarContainer.classList.remove("hidden");

  const { used, limit, percentage, daysUntilReset, projection } = usage;
  const remaining = limit - used;
  elements.copilotStats.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()}`;
  elements.copilotBar.style.width = `${Math.min(percentage, 100)}%`;
  elements.copilotBar.className = `copilot-bar ${projection?.status || "good"}`;
  elements.copilotBarContainer.title = `${used.toLocaleString()} used / ${remaining.toLocaleString()} remaining of ${limit.toLocaleString()} credits`;

  if (projection) {
    elements.copilotBarProjected.style.width = `${Math.min(projection.projectedPercentage, 100)}%`;
    elements.copilotBarProjected.className = `copilot-bar-projected ${projection.status}`;
  }

  elements.copilotDetails.textContent = `${percentage}% used · Resets in ${daysUntilReset} days · ~${projection?.dailyRate || 0} credits/workday · ${projection?.workdaysRemaining || 0} workdays left`;
  if (projection) {
    elements.copilotProjection.textContent = projection.message;
    elements.copilotProjection.className = `copilot-projection ${projection.status}`;
  }

  await renderSparkline();
}

function renderError(error, hasUsageData) {
  const time = new Date(error.fetchedAt || Date.now()).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusPart = error.status ? ` (HTTP ${error.status})` : "";
  const prefix = hasUsageData ? "Couldn't refresh" : "Couldn't load usage";

  elements.copilotError.classList.remove("hidden");
  elements.copilotError.textContent = "";

  const line = document.createElement("div");
  line.className = "copilot-error-msg";
  line.textContent = `⚠️ ${prefix}: ${error.message}${statusPart} · ${time}`;
  elements.copilotError.appendChild(line);

  if (error.url) {
    const urlLine = document.createElement("div");
    urlLine.className = "copilot-error-url";
    urlLine.textContent = error.url;
    urlLine.title = error.url;
    elements.copilotError.appendChild(urlLine);
  }

  if (hasUsageData) {
    const stale = document.createElement("div");
    stale.className = "copilot-error-stale";
    stale.textContent = "Showing last known values.";
    elements.copilotError.appendChild(stale);
  }
}

async function renderSparkline() {
  const data = await chrome.storage.local.get("copilotHistory");
  const history = data.copilotHistory || [];
  if (history.length < 2) {
    elements.copilotSparkline.style.display = "none";
    return;
  }

  elements.copilotSparkline.style.display = "block";
  const context = elements.copilotSparkline.getContext("2d");
  const width = elements.copilotSparkline.width;
  const height = elements.copilotSparkline.height;
  const padding = 2;
  context.clearRect(0, 0, width, height);

  const points = history.map((entry) => entry.percentage);
  const max = Math.max(...points, 100);
  const stepX = (width - padding * 2) / (points.length - 1);
  context.beginPath();
  context.strokeStyle = sparklineColor(points[points.length - 1]);
  context.lineWidth = 1.5;
  context.lineJoin = "round";
  context.lineCap = "round";

  points.forEach((point, index) => {
    const x = padding + index * stepX;
    const y = height - padding - (point / max) * (height - padding * 2);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  context.lineTo(padding + (points.length - 1) * stepX, height - padding);
  context.lineTo(padding, height - padding);
  context.closePath();
  context.fillStyle = sparklineFill(points[points.length - 1]);
  context.fill();
}
