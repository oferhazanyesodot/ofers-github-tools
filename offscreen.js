/**
 * Offscreen document for HTML parsing.
 * Service workers don't have DOMParser, so we use an offscreen document
 * which has full DOM access.
 */

"use strict";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "parseHTML") {
    const result = parsePRsFromPage(message.html);
    sendResponse(result);
    return true;
  }
});

/**
 * Parses PRs from the GitHub pulls page response.
 *
 * GitHub embeds PR data as JSON inside <script> tags with specific data attributes.
 * The page payload contains a `pullsDashboardSurfaceContentRoute.results` array.
 *
 * Strategy order:
 * 1. Extract JSON from <script type="application/json" data-target="react-partial.embeddedData">
 * 2. Extract JSON from <script data-type="react-partial"> elements
 * 3. Regex-based extraction of the payload JSON from the raw HTML
 * 4. Fallback: DOM-based link extraction (legacy)
 */
function parsePRsFromPage(html) {
  // Check for login page indicators first
  if (html.includes('href="/login"') && html.includes("Sign in to GitHub")) {
    return { loggedOut: true, prs: [] };
  }

  // Strategy 1: Try to find the embedded JSON payload directly from the raw text
  // GitHub embeds the data in a JSON structure with "pullsDashboardSurfaceContentRoute"
  let prs = extractFromEmbeddedJSON(html);
  if (prs && prs.length > 0) {
    return { loggedOut: false, prs };
  }

  // Strategy 2: Parse as DOM and look for script tags with embedded data
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  prs = extractFromScriptTags(doc);
  if (prs && prs.length > 0) {
    return { loggedOut: false, prs };
  }

  // Strategy 3: Fallback to link-based extraction
  prs = extractFromLinks(doc);
  return { loggedOut: false, prs: prs || [] };
}

/**
 * Strategy 1: Extract PR data from embedded JSON in the raw HTML.
 * GitHub includes a JSON payload containing pullsDashboardSurfaceContentRoute.
 */
function extractFromEmbeddedJSON(html) {
  // Look for the payload pattern in the raw HTML
  // It appears inside script tags as JSON with the results array
  const patterns = [
    // React partial embedded data
    /data-target="react-partial\.embeddedData"[^>]*>([\s\S]*?)<\/script>/g,
    // Alternative: data-type attribute
    /type="application\/json"[^>]*data-target[^>]*>([\s\S]*?)<\/script>/g,
    // Generic script with the payload key
    /<script[^>]*>([\s\S]*?)<\/script>/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const content = match[1].trim();
      if (!content.includes("pullsDashboardSurfaceContentRoute")) {
        continue;
      }

      try {
        const data = JSON.parse(content);
        const prs = extractPRsFromPayload(data);
        if (prs && prs.length > 0) {
          return prs;
        }
      } catch (e) {
        // Not valid JSON, continue searching
      }
    }
  }

  // Direct search: find the JSON object containing the results key
  // Sometimes GitHub nests it differently
  const payloadStart = html.indexOf('"pullsDashboardSurfaceContentRoute"');
  if (payloadStart !== -1) {
    // Walk backwards to find the opening brace of the containing object
    let braceStart = payloadStart;
    let depth = 0;
    for (let i = payloadStart; i >= 0; i--) {
      if (html[i] === '}') depth++;
      if (html[i] === '{') {
        if (depth === 0) {
          braceStart = i;
          break;
        }
        depth--;
      }
    }

    // Walk forward to find the matching closing brace
    let braceEnd = braceStart;
    depth = 0;
    for (let i = braceStart; i < html.length; i++) {
      if (html[i] === '{') depth++;
      if (html[i] === '}') {
        depth--;
        if (depth === 0) {
          braceEnd = i + 1;
          break;
        }
      }
    }

    try {
      const jsonStr = html.substring(braceStart, braceEnd);
      const data = JSON.parse(jsonStr);
      const prs = extractPRsFromPayload(data);
      if (prs && prs.length > 0) {
        return prs;
      }
    } catch (e) {
      // Failed to parse extracted JSON
    }
  }

  return null;
}

/**
 * Strategy 2: Extract from script tags in the parsed DOM.
 */
function extractFromScriptTags(doc) {
  // Look for React partial embedded data scripts
  const scripts = doc.querySelectorAll(
    'script[type="application/json"][data-target="react-partial.embeddedData"], ' +
    'script[type="application/json"]'
  );

  for (const script of scripts) {
    const content = script.textContent.trim();
    if (!content.includes("pullsDashboardSurfaceContentRoute") &&
        !content.includes("pull_request")) {
      continue;
    }

    try {
      const data = JSON.parse(content);
      const prs = extractPRsFromPayload(data);
      if (prs && prs.length > 0) {
        return prs;
      }
    } catch (e) {
      // Not valid JSON
    }
  }

  return null;
}

/**
 * Navigate the JSON payload structure to find the PR results array.
 * Handles both direct payload and nested structures.
 */
function extractPRsFromPayload(data) {
  // Direct structure: { payload: { pullsDashboardSurfaceContentRoute: { results: [...] } } }
  let results = null;

  if (data?.payload?.pullsDashboardSurfaceContentRoute?.results) {
    results = data.payload.pullsDashboardSurfaceContentRoute.results;
  } else if (data?.pullsDashboardSurfaceContentRoute?.results) {
    results = data.pullsDashboardSurfaceContentRoute.results;
  } else {
    // Deep search for the results array
    results = deepFindResults(data);
  }

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
      url: url,
      repo: repoName,
      title: title,
    });
  }

  return prs;
}

/**
 * Recursively search an object for a "results" array containing pull_request items.
 */
function deepFindResults(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0]?.itemType === "pull_request") {
      return obj;
    }
    for (const item of obj) {
      const found = deepFindResults(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (key === "results" && Array.isArray(obj[key]) &&
          obj[key].length > 0 && obj[key][0]?.itemType === "pull_request") {
        return obj[key];
      }
      const found = deepFindResults(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Strategy 3 (Fallback): Extract PRs from anchor links in the DOM.
 */
function extractFromLinks(doc) {
  const links = doc.querySelectorAll('a[href*="/pull/"]');
  const seen = new Set();
  const prs = [];

  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;

    const match = href.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
    if (!match) continue;

    const fullUrl = `https://github.com${href}`;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    const repoFullName = match[1];
    const repoName = repoFullName.split("/")[1] || repoFullName;
    const title = link.textContent.trim() || `PR #${match[2]}`;

    prs.push({
      url: fullUrl,
      repo: repoName,
      title: title,
    });
  }

  return prs;
}
