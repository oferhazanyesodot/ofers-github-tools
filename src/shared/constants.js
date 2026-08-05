/**
 * Shared constants used across the extension.
 */

export const ALARM_NAME = "github-pr-sync";
export const GITHUB_PULLS_BASE = "https://github.com/pulls?q=";

/**
 * Build the full GitHub pulls URL from a search query string.
 * @param {string} query - e.g. "is:pr state:open author:@me"
 * @returns {string}
 */
export function buildPRUrl(query) {
  return GITHUB_PULLS_BASE + encodeURIComponent(query).replace(/%20/g, "+");
}
