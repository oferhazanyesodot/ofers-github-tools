/**
 * Copilot Usage Fetcher — retrieves usage data from GitHub Copilot settings page.
 *
 * Scrapes https://github.com/settings/copilot/features for:
 *  - Current usage (credits used)
 *  - Total limit (credits available)
 *  - Reset date
 */

/**
 * @typedef {Object} CopilotUsage
 * @property {number} used - Credits used this cycle
 * @property {number} limit - Total credits available
 * @property {string} resetDate - ISO date string of next reset
 * @property {number} daysUntilReset - Days until reset
 * @property {number} percentage - Usage percentage (0-100)
 * @property {number} fetchedAt - Timestamp when data was fetched
 */

/**
 * Fetch Copilot usage data from GitHub settings page.
 * @returns {Promise<CopilotUsage | null>} Usage data or null if not available/not logged in
 */
export async function fetchCopilotUsage() {
  try {
    const { githubFetch } = await import("../background/github-transport.js");
    const response = await githubFetch("https://github.com/settings/copilot", {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Check if logged in
    if (html.includes("/login") && html.includes("Sign in") && !html.includes("settings/copilot")) {
      return null;
    }

    return parseUsageFromHTML(html);
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Copilot usage fetch failed:", err.message);
    return null;
  }
}

/**
 * Parse usage data from the Copilot settings HTML.
 * Looks for patterns like "8,141 / 30,000 AI credits" and "Resets in X days on <date>"
 */
function parseUsageFromHTML(html) {
  // Match usage pattern: "X,XXX / XX,XXX AI credits" or "X / X AI credits"
  const usageMatch = html.match(/([\d,]+)\s*\/\s*([\d,]+)\s*AI\s*credits/i);
  if (!usageMatch) return null;

  const used = parseInt(usageMatch[1].replace(/,/g, ""), 10);
  const limit = parseInt(usageMatch[2].replace(/,/g, ""), 10);

  // Match reset info: "Resets in X days on <date>"
  const resetMatch = html.match(/Resets\s+in\s+(\d+)\s+days?\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  let daysUntilReset = 0;
  let resetDate = "";

  if (resetMatch) {
    daysUntilReset = parseInt(resetMatch[1], 10);
    resetDate = resetMatch[2];
  } else {
    // Fallback: try to find just the days
    const daysMatch = html.match(/Resets\s+in\s+(\d+)\s+days?/i);
    if (daysMatch) {
      daysUntilReset = parseInt(daysMatch[1], 10);
      const reset = new Date();
      reset.setDate(reset.getDate() + daysUntilReset);
      resetDate = reset.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }

  if (isNaN(used) || isNaN(limit) || limit === 0) return null;

  return {
    used,
    limit,
    resetDate,
    daysUntilReset,
    percentage: Math.round((used / limit) * 100),
    fetchedAt: Date.now(),
  };
}
