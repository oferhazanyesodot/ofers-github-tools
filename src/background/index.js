/**
 * Background Service Worker — entry point.
 *
 * Registers Chrome event listeners and routes messages.
 * All heavy logic is delegated to focused modules.
 */

import { ALARM_NAME } from "../shared/constants.js";
import { setupAlarm } from "./alarm.js";
import { syncPRs } from "./sync.js";

// ─── Lifecycle Events ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarm();
  await syncPRs();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  await syncPRs();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await syncPRs();
  }
});

// ─── Keyboard Shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "sync-now") {
    await syncPRs();
  }
});

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case "syncNow":
      syncPRs().then(() => sendResponse({ done: true }));
      return true;

    case "settingsChanged":
      setupAlarm().then(() => syncPRs()).then(() => sendResponse({ done: true }));
      return true;

    case "revertFile":
      revertFileInPR(message.payload)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    default:
      return false;
  }
});

// ─── Revert File Logic ───────────────────────────────────────────────────────

/**
 * Revert a single file in a PR to its state on the base branch.
 * 
 * Uses GitHub's web endpoints (same as "Edit file" / "Delete file" in the UI).
 * Session cookies from github.com are sent automatically.
 * 
 * Strategy:
 * 1. Fetch the file editing page to get the CSRF authenticity token
 * 2. Get the file content from the base branch
 * 3. Submit the edit form to overwrite the file (or delete it)
 *
 * @param {object} payload
 * @param {string} payload.owner - Repository owner
 * @param {string} payload.repo - Repository name
 * @param {string} payload.baseBranch - Base branch (e.g. "main")
 * @param {string} payload.headBranch - PR head branch
 * @param {string} payload.filePath - Path of file to revert
 * @param {string} payload.status - File status: "added", "modified", "renamed", "removed"
 */
async function revertFileInPR({ owner, repo, baseBranch, headBranch, filePath, status }) {
  const repoBase = `https://github.com/${owner}/${repo}`;

  if (status === "added") {
    // File was added in PR — delete it from head branch
    await deleteFileViaWeb(repoBase, headBranch, filePath);
    return { action: "deleted", filePath };
  }

  if (status === "removed") {
    // File was deleted in PR — restore it from base branch
    const baseContent = await getFileContent(repoBase, baseBranch, filePath);
    await createFileViaWeb(repoBase, headBranch, filePath, baseContent);
    return { action: "restored", filePath };
  }

  // Modified — overwrite with base branch content
  const baseContent = await getFileContent(repoBase, baseBranch, filePath);
  await updateFileViaWeb(repoBase, headBranch, filePath, baseContent);
  return { action: "reverted", filePath };
}

/**
 * Get raw file content from a branch.
 */
async function getFileContent(repoBase, branch, filePath) {
  const url = `${repoBase}/raw/${branch}/${filePath}`;
  const res = await githubFetch(url);
  if (!res.ok) throw new Error(`Could not fetch file from ${branch}: ${res.status}`);
  return await res.text();
}

async function updateFileViaWeb(repoBase, branch, filePath, newContent) {
  const editPageUrl = `${repoBase}/edit/${branch}/${filePath}`;
  const editPage = await githubFetch(editPageUrl, {
    headers: { "Accept": "text/html" },
  });
  if (!editPage.ok) throw new Error(`Could not load edit page: ${editPage.status}`);
  const html = await editPage.text();

  const submitUrl = `${repoBase}/tree-save/${branch}/${filePath}`;
  const formData = extractEditFormData(html, submitUrl);
  if (!formData.authenticity_token) {
    throw new Error("Could not extract CSRF token. Are you logged in with write access?");
  }

  const body = new URLSearchParams({
    authenticity_token: formData.authenticity_token,
    filename: filePath,
    new_filename: filePath,
    content_changed: "true",
    value: newContent,
    message: `Revert "${filePath}" — restore to base branch version`,
    placeholder_message: "",
    description: "",
    commit_choice: "direct",
    target_branch: branch,
    quick_pull: "",
    ...(formData.commit && { commit: formData.commit }),
  });

  const submitRes = await githubFetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (submitRes.status === 422) {
    const responseText = await submitRes.text().catch(() => "");
    console.log("[Revert] Submit rejected (422):", responseText.substring(0, 500));
    const errData = responseText.match(/"error"\s*:\s*"([^"]+)"/);
    throw new Error(errData ? errData[1].replace(/<[^>]*>/g, "") : `Edit submission failed: 422`);
  }
}

async function deleteFileViaWeb(repoBase, branch, filePath) {
  const deletePageUrl = `${repoBase}/delete/${branch}/${filePath}`;
  const deletePage = await githubFetch(deletePageUrl);
  if (!deletePage.ok) throw new Error(`Could not load delete page: ${deletePage.status}`);
  const html = await deletePage.text();

  const formData = extractEditFormData(html);
  if (!formData.authenticity_token) {
    throw new Error("Could not extract CSRF token. Are you logged in with write access?");
  }

  const submitUrl = `${repoBase}/tree-save/${branch}/${filePath}`;
  const body = new URLSearchParams({
    authenticity_token: formData.authenticity_token,
    filename: filePath.split("/").pop(),
    message: `Revert "${filePath}" — remove file added in PR`,
    placeholder_message: "",
    description: "",
    commit_choice: "direct",
    target_branch: branch,
    quick_pull: "",
    ...(formData.commit && { commit: formData.commit }),
  });

  const submitRes = await githubFetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!submitRes.ok && submitRes.status !== 302 && submitRes.status !== 303) {
    throw new Error(`Delete submission failed: ${submitRes.status}`);
  }
}

async function createFileViaWeb(repoBase, branch, filePath, content) {
  const dirPath = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
  const newFileUrl = dirPath
    ? `${repoBase}/new/${branch}/${dirPath}`
    : `${repoBase}/new/${branch}`;

  const newFilePage = await githubFetch(newFileUrl);
  if (!newFilePage.ok) throw new Error(`Could not load new file page: ${newFilePage.status}`);
  const html = await newFilePage.text();

  const formData = extractEditFormData(html);
  if (!formData.authenticity_token) {
    throw new Error("Could not extract CSRF token. Are you logged in with write access?");
  }

  const fileName = filePath.split("/").pop();
  const submitUrl = dirPath
    ? `${repoBase}/tree-save/${branch}/${dirPath}`
    : `${repoBase}/tree-save/${branch}`;

  const body = new URLSearchParams({
    authenticity_token: formData.authenticity_token,
    filename: fileName,
    new_filename: fileName,
    content_changed: "true",
    value: content,
    message: `Revert "${filePath}" — restore deleted file`,
    placeholder_message: "",
    description: "",
    commit_choice: "direct",
    target_branch: branch,
    quick_pull: "",
    ...(formData.commit && { commit: formData.commit }),
  });

  const submitRes = await githubFetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!submitRes.ok && submitRes.status !== 302 && submitRes.status !== 303) {
    throw new Error(`Create submission failed: ${submitRes.status}`);
  }
}

/**
 * Extract form data (CSRF token, commit SHA, etc.) from a GitHub edit/delete page.
 */
function extractEditFormData(html, submitPath) {
  const data = {};

  // Extract CSRF token from JSON csrf_tokens object
  const csrfJsonMatch = html.match(/"csrf_tokens"\s*:\s*\{([^}]+\}[^}]*)\}/);
  if (csrfJsonMatch) {
    try {
      const csrfBlock = `{${csrfJsonMatch[1]}}`;
      const tokens = JSON.parse(csrfBlock);
      for (const [path, methods] of Object.entries(tokens)) {
        if (methods.post) {
          if (submitPath && path.includes(submitPath.replace("https://github.com", ""))) {
            data.authenticity_token = methods.post;
            break;
          }
          if (!data.authenticity_token) {
            data.authenticity_token = methods.post;
          }
        }
      }
    } catch (e) {
      const tokenFromJson = html.match(/"csrf_tokens"[^}]*"post"\s*:\s*"([^"]+)"/);
      if (tokenFromJson) data.authenticity_token = tokenFromJson[1];
    }
  }

  // Fallback token patterns
  if (!data.authenticity_token) {
    const tokenMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/) ||
                       html.match(/value="([^"]+)"\s+name="authenticity_token"/) ||
                       html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) ||
                       html.match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/) ||
                       html.match(/"post"\s*:\s*"([A-Za-z0-9_-]{20,})"/);
    if (tokenMatch) data.authenticity_token = tokenMatch[1];
  }

  // Extract commit OID/SHA — needed to avoid "someone committed since you started editing" error
  // Pattern 1: JSON embedded in React props or page data
  const oidMatch = html.match(/"commitOid"\s*:\s*"([a-f0-9]{40})"/) ||
                   html.match(/"commit_oid"\s*:\s*"([a-f0-9]{40})"/) ||
                   html.match(/"sha"\s*:\s*"([a-f0-9]{40})"/) ||
                   html.match(/"headOid"\s*:\s*"([a-f0-9]{40})"/);
  if (oidMatch) data.commit = oidMatch[1];

  // Pattern 2: Form input
  if (!data.commit) {
    const commitMatch = html.match(/name="commit"\s+value="([a-f0-9]{40})"/) ||
                        html.match(/value="([a-f0-9]{40})"\s+name="commit"/);
    if (commitMatch) data.commit = commitMatch[1];
  }

  // Pattern 3: In a data attribute
  if (!data.commit) {
    const dataCommit = html.match(/data-commit-oid="([a-f0-9]{40})"/) ||
                       html.match(/data-blob-commit-oid="([a-f0-9]{40})"/);
    if (dataCommit) data.commit = dataCommit[1];
  }

  // Pattern 4: In the edit URL (sometimes contains the SHA)
  if (!data.commit) {
    // Look for a 40-char hex string near "commit" context
    const nearCommit = html.match(/commit[^"]*"([a-f0-9]{40})"/);
    if (nearCommit) data.commit = nearCommit[1];
  }

  return data;
}

/**
 * Reset a branch to a specific commit SHA.
 * Tries GitHub's internal web endpoints with session cookies.
 */
async function resetBranchToCommit({ owner, repo, branch, sha }) {
  const repoBase = `https://github.com/${owner}/${repo}`;

  // Strategy: Use GitHub's internal branch update endpoint
  // GitHub web UI uses POST to an internal endpoint with CSRF token
  
  // Get CSRF token from the repo page
  const repoPage = await githubFetch(`${repoBase}`, {
    headers: { "Accept": "text/html" },
  });
  if (!repoPage.ok) throw new Error(`Could not load repo page: ${repoPage.status}`);
  const html = await repoPage.text();

  // Find the CSRF token for the refs update endpoint
  let csrfToken = null;
  
  // Look for a general CSRF token in meta tag
  const metaMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/) ||
                    html.match(/<meta\s+content="([^"]+)"\s+name="csrf-token"/);
  if (metaMatch) csrfToken = metaMatch[1];

  // Look in csrf_tokens JSON block
  if (!csrfToken) {
    const postTokenMatch = html.match(/"post"\s*:\s*"([A-Za-z0-9_-]{20,})"/);
    if (postTokenMatch) csrfToken = postTokenMatch[1];
  }

  if (!csrfToken) {
    throw new Error("Could not get auth token. Run in terminal: git push origin " + sha + ":" + branch + " --force");
  }

  // Try the internal branch update - GitHub uses this for force-push via web
  const updateRes = await githubFetch(`${repoBase}/refs/heads/${branch}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      authenticity_token: csrfToken,
      sha: sha,
      force: "1",
    }).toString(),
  });

  if (updateRes.ok || updateRes.status === 200 || updateRes.status === 302) {
    return { branch, sha };
  }

  // If that didn't work, try the JSON variant
  const jsonRes = await githubFetch(`${repoBase}/refs/heads/${branch}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      authenticity_token: csrfToken,
      sha: sha,
      force: true,
    }),
  });

  if (jsonRes.ok || jsonRes.status === 200 || jsonRes.status === 302) {
    return { branch, sha };
  }

  const errText = await jsonRes.text().catch(() => "");
  throw new Error(`Branch reset failed (${jsonRes.status}). Run in terminal: git push origin ${sha}:${branch} --force`);
}

/**
 * Fetch from GitHub with session cookies attached.
 * In MV3 service workers, we need to read cookies explicitly and pass them as headers.
 */
async function githubFetch(url, options = {}) {
  // Get all cookies for github.com (both with and without leading dot)
  const cookies1 = await chrome.cookies.getAll({ domain: "github.com" });
  const cookies2 = await chrome.cookies.getAll({ domain: ".github.com" });
  const allCookies = [...cookies1, ...cookies2];
  // Deduplicate by name
  const seen = new Set();
  const uniqueCookies = allCookies.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
  const cookieHeader = uniqueCookies.map(c => `${c.name}=${c.value}`).join("; ");
  
  const headers = {
    ...(options.headers || {}),
    "Cookie": cookieHeader,
  };

  // For GET requests, follow redirects. For POST, don't follow (302 = success).
  const method = (options.method || "GET").toUpperCase();
  const redirect = method === "GET" ? "follow" : "manual";

  // For POST requests, add Origin and Referer headers (required for CSRF validation)
  if (method === "POST") {
    headers["Origin"] = "https://github.com";
    if (!headers["Referer"]) {
      headers["Referer"] = url;
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
    redirect,
  });

  // For POST requests, a 302/303 redirect means success
  if (method === "POST" && (res.status === 302 || res.status === 303 || res.type === "opaqueredirect")) {
    return { ok: true, status: 200, text: async () => "" };
  }

  return res;
}
