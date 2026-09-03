export function relativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function absoluteDate(timestamp) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a timestamp according to the user's dateFormat setting.
 * @param {number} timestamp
 * @param {"relative"|"absolute"} format
 */
export function formatDate(timestamp, format) {
  return format === "absolute" ? absoluteDate(timestamp) : relativeTime(timestamp);
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function copySvg() {
  return `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5c0-.138-.112-.25-.25-.25Z"/></svg>`;
}

export function sparklineColor(lastPercentage) {
  if (lastPercentage >= 80) return "#cf222e";
  if (lastPercentage >= 60) return "#bf8700";
  return "#2da44e";
}

export function sparklineFill(lastPercentage) {
  if (lastPercentage >= 80) return "rgba(207, 34, 46, 0.1)";
  if (lastPercentage >= 60) return "rgba(191, 135, 0, 0.1)";
  return "rgba(45, 164, 78, 0.1)";
}
