/**
 * Offscreen Document — HTML Parsing (fallback strategy).
 *
 * Used when the JSON fetch strategy fails and we need DOMParser
 * to extract PR data from embedded <script> tags or anchor links.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "parseHTML") {
    sendResponse(parsePage(message.html));
    return true;
  }
});

// ─── Main Entry ──────────────────────────────────────────────────────────────

function parsePage(html) {
  if (looksLikeLoginPage(html)) {
    return { loggedOut: true, prs: [] };
  }

  // Try embedded JSON first (fastest)
  const fromJSON = extractFromEmbeddedJSON(html);
  if (fromJSON?.length > 0) return { loggedOut: false, prs: fromJSON };

  // Try DOM-based script tag extraction
  const doc = new DOMParser().parseFromString(html, "text/html");

  const fromScripts = extractFromScriptTags(doc);
  if (fromScripts?.length > 0) return { loggedOut: false, prs: fromScripts };

  // Last resort: anchor link scraping
  const fromLinks = extractFromLinks(doc);
  return { loggedOut: false, prs: fromLinks };
}

// ─── Strategy: Embedded JSON in raw HTML ─────────────────────────────────────

function extractFromEmbeddedJSON(html) {
  const patterns = [
    /data-target="react-partial\.embeddedData"[^>]*>([\s\S]*?)<\/script>/g,
    /type="application\/json"[^>]*data-target[^>]*>([\s\S]*?)<\/script>/g,
    /<script[^>]*>([\s\S]*?)<\/script>/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const content = match[1].trim();
      if (!content.includes("pullsDashboardSurfaceContentRoute")) continue;

      try {
        const prs = extractPRsFromPayload(JSON.parse(content));
        if (prs?.length > 0) return prs;
      } catch (_) { /* not JSON */ }
    }
  }

  // Brute force: locate the payload key and extract the containing object
  const idx = html.indexOf('"pullsDashboardSurfaceContentRoute"');
  if (idx === -1) return null;

  const jsonStr = extractContainingObject(html, idx);
  if (!jsonStr) return null;

  try {
    return extractPRsFromPayload(JSON.parse(jsonStr));
  } catch (_) {
    return null;
  }
}

// ─── Strategy: DOM Script Tags ───────────────────────────────────────────────

function extractFromScriptTags(doc) {
  const scripts = doc.querySelectorAll(
    'script[type="application/json"][data-target="react-partial.embeddedData"], ' +
    'script[type="application/json"]'
  );

  for (const script of scripts) {
    const text = script.textContent.trim();
    if (!text.includes("pullsDashboardSurfaceContentRoute") && !text.includes("pull_request")) {
      continue;
    }
    try {
      const prs = extractPRsFromPayload(JSON.parse(text));
      if (prs?.length > 0) return prs;
    } catch (_) { /* skip */ }
  }

  return null;
}

// ─── Strategy: Anchor Links (legacy) ─────────────────────────────────────────

function extractFromLinks(doc) {
  const links = doc.querySelectorAll('a[href*="/pull/"]');
  const seen = new Set();
  const prs = [];

  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;

    const match = href.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
    if (!match) continue;

    const url = `https://github.com${href}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const repoName = match[1].split("/")[1] || match[1];
    prs.push({
      url,
      repo: repoName,
      title: link.textContent.trim() || `PR #${match[2]}`,
    });
  }

  return prs;
}

// ─── Shared Payload Parser ───────────────────────────────────────────────────

function extractPRsFromPayload(data) {
  const results =
    data?.payload?.pullsDashboardSurfaceContentRoute?.results ||
    data?.pullsDashboardSurfaceContentRoute?.results ||
    deepFindResults(data, 0);

  if (!Array.isArray(results)) return null;

  const prs = [];
  for (const item of results) {
    if (item.itemType !== "pull_request") continue;
    const repoNameWithOwner = item.repoNameWithOwner || "";
    prs.push({
      url: item.permalink || `https://github.com/${repoNameWithOwner}/pull/${item.number}`,
      repo: repoNameWithOwner.split("/")[1] || repoNameWithOwner,
      title: item.title || `PR #${item.number}`,
    });
  }

  return prs.length > 0 ? prs : null;
}

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
      if (key === "results" && Array.isArray(obj[key]) && obj[key][0]?.itemType === "pull_request") {
        return obj[key];
      }
      const found = deepFindResults(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function looksLikeLoginPage(html) {
  return html.includes('href="/login"') && html.includes("Sign in to GitHub");
}

/**
 * Given a position inside a JSON string, walk outward to find
 * the start/end of the containing top-level object.
 */
function extractContainingObject(str, innerIdx) {
  let start = innerIdx;
  let depth = 0;
  for (let i = innerIdx; i >= 0; i--) {
    if (str[i] === "}") depth++;
    if (str[i] === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }

  let end = start;
  depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "{") depth++;
    if (str[i] === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }

  return str.substring(start, end);
}
