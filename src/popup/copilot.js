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
    chrome.tabs.create({ url: "https://github.com/settings/copilot" });
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
