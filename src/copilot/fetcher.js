/**
 * Copilot Usage Fetcher — retrieves usage data from GitHub Copilot settings page.
 *
 * Scrapes https://github.com/settings/copilot/features for:
 *  - Current usage (credits used)
 *  - Total limit (credits available)
 *  - Reset date
 */

// Static import — dynamic import() is disallowed in MV3 service workers.
import { githubFetch } from "../background/github-transport.js";

/**
 * @typedef {Object} CopilotUsage
 * @property {number} used - Credits used this cycle
 * @property {number} limit - Total credits available
 * @property {string} resetDate - ISO date string of next reset
 * @property {number} daysUntilReset - Days until reset
 * @property {number} percentage - Usage percentage (0-100)
 * @property {number} fetchedAt - Timestamp when data was fetched
 */

const COPILOT_USAGE_URL = "https://github.com/settings/copilot/features";

/**
 * @typedef {Object} CopilotFetchError
 * @property {string} message - Human-readable failure reason
 * @property {string} url - The URL that was being fetched
 * @property {number} [status] - HTTP status code, when available
 * @property {number} fetchedAt - Timestamp when the failure occurred
 */

/**
 * @typedef {Object} CopilotFetchResult
 * @property {CopilotUsage | null} usage - Parsed usage, or null on failure
 * @property {CopilotFetchError | null} error - Failure details, or null on success
 */

/**
 * Fetch Copilot usage data from GitHub settings page.
 * Always resolves with a result object; on failure `error` explains why
 * (including the URL) so the UI can surface it instead of hiding silently.
 * @returns {Promise<CopilotFetchResult>}
 */
export async function fetchCopilotUsage() {
  const url = COPILOT_USAGE_URL;
  try {
    const response = await githubFetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return fail(`GitHub returned HTTP ${response.status}`, url, response.status);
    }

    const html = await response.text();

    // Check if logged in
    if (html.includes("/login") && html.includes("Sign in") && !html.includes("settings/copilot")) {
      return fail("Not signed in to GitHub", url, response.status);
    }

    const usage = parseUsageFromHTML(html);
    if (!usage) {
      return fail("Couldn't find usage on the page — GitHub's layout may have changed", url, response.status);
    }

    return { usage, error: null };
  } catch (err) {
    console.warn("[GitHub PR Bookmarks] Copilot usage fetch failed:", err.message);
    return fail(err.message || "Network request failed", url);
  }
}

/**
 * Build a failure result.
 * @returns {CopilotFetchResult}
 */
function fail(message, url, status) {
  return {
    usage: null,
    error: { message, url, status, fetchedAt: Date.now() },
  };
}

/**
 * Parse usage data from the Copilot settings HTML.
 * Looks for patterns like "8,141 / 30,000 AI credits" and "Resets in X days on <date>"
 */
function parseUsageFromHTML(html) {
  // The settings page can contain more than one "X / Y AI credits" figure
  // (e.g. an org-wide/included allowance and the per-cycle usage). Prefer the
  // value tied to the "Usage this cycle" section so we report actual usage.
  const usageMatch = matchCycleUsage(html) || html.match(/([\d,]+)\s*\/\s*([\d,]+)\s*AI\s*credits/i);
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

/**
 * Find the "X / Y AI credits" figure that belongs to the "Usage this cycle"
 * section. Scans a window of text after the "Usage this cycle" label so we
 * don't accidentally pick up an unrelated allowance number elsewhere on the page.
 * @returns {RegExpMatchArray | null}
 */
function matchCycleUsage(html) {
  const anchor = html.search(/Usage\s+this\s+cycle/i);
  if (anchor === -1) return null;

  // Look within a bounded window after the anchor for the credits figure.
  const window = html.slice(anchor, anchor + 4000);
  return window.match(/([\d,]+)\s*\/\s*([\d,]+)\s*AI\s*credits/i);
}
