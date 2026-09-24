/**
 * Branch enrichment.
 *
 * The /pulls dashboard payload does NOT include the head branch name, only the
 * head SHA. To group PRs by shared branch across repos we fetch each PR's page
 * as JSON (using the existing GitHub session — no token) and read the head ref
 * from the payload.
 *
 * Results are cached in chrome.storage.local keyed by PR url so a branch is
 * fetched once per PR, not on every sync. The cache is pruned to the PRs still
 * present so it can't grow unbounded.
 */

import { githubFetch } from "../background/github-transport.js";

// v2: the v1 cache stored raw channel tokens by mistake; bump to invalidate it.
const CACHE_KEY = "prBranchCache_v2";
// Cap how many uncached PRs we fetch per sync so a large list doesn't fire off
// dozens of requests at once. Remaining PRs get their branch on later syncs.
const MAX_FETCH_PER_SYNC = 20;

/**
 * Return each PR with a `branch` field filled in where we can determine it.
 * PRs that already carry a branch, or whose branch is cached, don't refetch.
 * @param {Array} prs
 * @returns {Promise<Array>}
 */
export async function enrichWithBranches(prs) {
  if (!Array.isArray(prs) || prs.length === 0) return prs;

  const store = await chrome.storage.local.get(CACHE_KEY);
  const cache = store[CACHE_KEY] || {};

  // Which PRs still need a branch resolved.
  const toFetch = prs.filter(
    (pr) => pr && pr.url && !(pr.branch && pr.branch.trim()) && !cache[pr.url]
  );

  let fetched = 0;
  for (const pr of toFetch) {
    if (fetched >= MAX_FETCH_PER_SYNC) break;
    const branch = await fetchBranch(pr);
    // Cache the result either way; "" records "looked, found nothing" so we
    // don't hammer the same PR every sync.
    cache[pr.url] = branch || "";
    fetched++;
  }

  // Apply cached branches onto the PR objects.
  const enriched = prs.map((pr) => {
    if (pr.branch && pr.branch.trim()) return pr;
    const cached = cache[pr.url];
    return cached ? { ...pr, branch: cached } : pr;
  });

  // Prune cache entries for PRs no longer in the list.
  const live = new Set(prs.map((pr) => pr.url));
  for (const url of Object.keys(cache)) {
    if (!live.has(url)) delete cache[url];
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });

  return enriched;
}

/**
 * Fetch a single PR's head branch by requesting its page as JSON. Returns the
 * branch name or "" if it can't be determined (never throws — a failed lookup
 * shouldn't break the whole sync).
 */
async function fetchBranch(pr) {
  try {
    const response = await githubFetch(pr.url, {
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    if (response.status !== 200) return "";
    return extractBranchFromPayload(text) || "";
  } catch (_) {
    return "";
  }
}

/**
 * Extract the head branch from a single-PR JSON payload text.
 *
 * The PR page payload doesn't expose a clean headRefName; instead it carries
 * base64 "channel" tokens whose decoded content includes the branch, e.g.
 *   {"c":"repo:1102484653:branch:fix/e2e-test-reliability","t":1790232735}
 * So we first try a clean field, then fall back to decoding those tokens and
 * pulling the branch out of the "repo:<id>:branch:<name>" pattern.
 */
function extractBranchFromPayload(text) {
  // 1) A genuine clean field, if GitHub ever provides one.
  const clean = text.match(/"headRefName"\s*:\s*"([^"]+)"/);
  if (clean && clean[1].trim()) return clean[1].trim();

  // 2) Decode base64 channel tokens and read the branch from them.
  //    Tokens look like "<base64>==--<hexsig>"; the base64 part is a JSON blob.
  const tokens = text.match(/[A-Za-z0-9+/]{40,}={0,2}(?:--[a-f0-9]{16,})?/g) || [];
  for (const token of tokens) {
    const b64 = token.split("--")[0];
    const branch = branchFromChannel(b64);
    if (branch) return branch;
  }
  return null;
}

/**
 * Decode one base64 channel token and pull the branch name out of the
 * "repo:<id>:branch:<name>" descriptor it contains. Returns null if the token
 * isn't a branch channel.
 */
function branchFromChannel(b64) {
  let decoded;
  try {
    decoded = atob(b64);
  } catch (_) {
    return null;
  }
  // Match ":branch:<name>" up to the next quote/colon-key boundary.
  const m = decoded.match(/:branch:([^"\\]+)/);
  return m ? m[1].trim() : null;
}
