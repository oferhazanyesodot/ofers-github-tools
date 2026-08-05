/**
 * GitHub JSON payload parser.
 *
 * Extracts the PR results array from GitHub's page JSON payload.
 * The payload structure is:
 *   { payload: { pullsDashboardSurfaceContentRoute: { results: [...] } } }
 */

/**
 * Extract normalized PR objects from a GitHub JSON payload.
 * @param {object} data - Parsed JSON from GitHub
 * @returns {Array<{url: string, repo: string, title: string}> | null}
 */
export function extractPRsFromPayload(data) {
  const results = findResultsArray(data);

  if (!results || !Array.isArray(results)) {
    return null;
  }

  const prs = [];
  for (const item of results) {
    if (item.itemType !== "pull_request") continue;

    const repoNameWithOwner = item.repoNameWithOwner || "";
    const repoName = repoNameWithOwner.split("/")[1] || repoNameWithOwner;
    const title = item.title || `PR #${item.number}`;
    const url = item.permalink || `https://github.com/${repoNameWithOwner}/pull/${item.number}`;

    prs.push({ url, repo: repoName, title });
  }

  return prs.length > 0 ? prs : null;
}

/**
 * Locate the results array within the payload using known paths,
 * falling back to a recursive search.
 */
function findResultsArray(data) {
  // Known payload structures (ordered by likelihood)
  const paths = [
    data?.payload?.pullsDashboardSurfaceContentRoute?.results,
    data?.pullsDashboardSurfaceContentRoute?.results,
    data?.props?.initialPayload?.pullsDashboardSurfaceContentRoute?.results,
  ];

  for (const candidate of paths) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  // Deep search as last resort
  return deepFindResults(data, 0);
}

/**
 * Recursively walk an object tree looking for a "results" array
 * whose first element has itemType === "pull_request".
 */
function deepFindResults(obj, depth) {
  if (depth > 5 || !obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0]?.itemType === "pull_request") return obj;
    for (const item of obj) {
      const found = deepFindResults(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (
        key === "results" &&
        Array.isArray(obj[key]) &&
        obj[key].length > 0 &&
        obj[key][0]?.itemType === "pull_request"
      ) {
        return obj[key];
      }
      const found = deepFindResults(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}
