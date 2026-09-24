/**
 * GitHub JSON payload parser.
 *
 * Extracts the PR results array from GitHub's page JSON payload.
 * The payload structure is:
 *   { payload: { pullsDashboardSurfaceContentRoute: { results: [...] } } }
 */

/**
 * @typedef {Object} PR
 * @property {string} url
 * @property {string} repo
 * @property {string} title
 * @property {boolean} isDraft
 * @property {string} updatedAt - ISO date string
 * @property {number} number
 * @property {string} repoFullName - "owner/repo"
 * @property {string} branch - head ref/branch name (may be "")
 */

/**
 * Extract normalized PR objects from a GitHub JSON payload.
 * @param {object} data - Parsed JSON from GitHub
 * @returns {PR[] | null}
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

    prs.push({
      url,
      repo: repoName,
      repoFullName: repoNameWithOwner,
      title,
      number: item.number || 0,
      // Head branch name — used to group the same branch across repos. The
      // pulls dashboard payload isn't guaranteed to include it, so fall back
      // to "" and let the popup group by title in that case.
      branch: extractBranch(item),
      isDraft: item.isDraft || false,
      updatedAt: item.updatedAt || new Date().toISOString(),
      createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
      // Enrichment — only fields the pulls dashboard payload actually provides.
      commentCount: extractCommentCount(item),
      unread: item.isReadByCurrentUser === false,
    });
  }

  return prs.length > 0 ? prs : null;
}

/**
 * Extract a comment/conversation count if present.
 */
function extractCommentCount(item) {
  const raw =
    item.commentsCount ??
    item.totalCommentsCount ??
    item.comments?.totalCount ??
    item.commentCount;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

/**
 * Extract the head branch (source ref) name from a payload item, checking the
 * field spellings GitHub has used across payload versions. Returns "" when
 * none is present.
 */
function extractBranch(item) {
  // The /pulls dashboard payload does not currently carry the head branch (only
  // headSha), so this is normally "". If GitHub ever adds it, this picks it up
  // and the per-PR branch fetch in branches.js is skipped. Branch grouping
  // otherwise relies on that fetch.
  const direct =
    item.headRefName ??
    item.branch ??
    item.headBranch ??
    item.head?.ref;
  return typeof direct === "string" ? direct.trim() : "";
}

/**
 * Locate the results array within the payload using known paths,
 * falling back to a recursive search.
 */
function findResultsArray(data) {
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
