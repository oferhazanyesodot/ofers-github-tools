/**
 * Reset to Commit — Adds a small ↩ button next to commit SHA links in the PR
 * timeline that resets the head branch to that commit via force-push.
 *
 * Only targets links whose visible text matches a short SHA (/^[a-f0-9]{7,40}$/).
 * Uses window.oferTools from shared.js.
 */

(() => {
  "use strict";

  const RESET_BTN_CLASS = "ofer-reset-commit-btn";

  /**
   * Extract owner/repo/prNumber from the URL.
   */
  function getRepoInfo() {
    const match = window.location.pathname.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], prNumber: match[3] };
  }

  /**
   * Find the head branch name from DOM elements.
   */
  function getHeadBranch() {
    const headRef = document.querySelector('.head-ref a, .head-ref');
    if (headRef) return headRef.textContent.trim().split(":").pop().trim();

    const refs = document.querySelectorAll('.commit-ref, [class*="commit-ref"]');
    if (refs.length >= 2) return refs[1].textContent.trim().split(":").pop().trim();

    const fullText = document.body.innerText;
    const match = fullText.match(/wants to merge.*?into\s+\S+\s+from\s+([^\s\n]+)/);
    if (match) return match[1].trim();

    return null;
  }

  /**
   * Inject reset buttons next to commit SHA links.
   * Skips links that already have a button to prevent duplicates.
   */
  function injectCommitResetButtons() {
    if (!window.oferTools?.isPRPage()) return;

    const commitLinks = document.querySelectorAll('a[href*="/commit/"], a[href*="/commits/"]');

    for (const link of commitLinks) {
      const href = link.getAttribute("href") || "";
      const shaMatch = href.match(/\/commits?\/([a-f0-9]{7,40})/);
      if (!shaMatch) continue;

      const sha = shaMatch[1];

      // Only target links whose visible text looks like a short SHA
      const text = link.textContent.trim();
      if (!/^[a-f0-9]{7,40}$/.test(text)) continue;

      // Prevent duplicate buttons
      if (link.nextElementSibling?.classList?.contains(RESET_BTN_CLASS)) continue;
      if (link.parentElement?.querySelector(`.${RESET_BTN_CLASS}[data-sha="${sha}"]`)) continue;

      // Skip links inside code diff areas
      if (link.closest('td.blob-code, .diff-table, .highlight')) continue;

      // Create the reset button
      const btn = document.createElement("button");
      btn.className = RESET_BTN_CLASS;
      btn.setAttribute("data-sha", sha);
      btn.title = `Reset branch to this commit (${sha.substring(0, 7)})`;
      btn.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px 4px;
        margin-left: 4px;
        color: var(--fgColor-muted, var(--color-fg-muted, #8b949e));
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
        opacity: 0.6;
        transition: opacity 0.15s, color 0.15s;
      `;
      btn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.22 6.28a.749.749 0 0 1 0-1.06l3.5-3.5a.749.749 0 1 1 1.06 1.06L3.561 5h7.188a4.25 4.25 0 0 1 0 8.5H8.25a.75.75 0 0 1 0-1.5h2.5a2.75 2.75 0 0 0 0-5.5H3.561l2.22 2.22a.749.749 0 1 1-1.06 1.06Z"/></svg>`;

      btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; btn.style.color = "var(--fgColor-danger, #f85149)"; });
      btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.6"; btn.style.color = "var(--fgColor-muted, #8b949e)"; });

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const repoInfo = getRepoInfo();
        const headBranch = getHeadBranch();
        if (!repoInfo || !headBranch) {
          window.oferTools.showBanner("Could not determine repo/branch info.", "error");
          return;
        }

        const command = `gh api repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${headBranch} -X PATCH -f sha=${sha} -F force=true`;
        showCommandDialog(command, sha, headBranch);
      });

      link.after(btn);
    }
  }

  /**
   * Show a dialog with a copyable command to reset the branch.
   */
  function showCommandDialog(command, sha, branch) {
    window.oferTools.injectStyles();
    
    // Remove any existing dialog
    document.querySelector(".ofer-dialog-overlay")?.remove();
    
    const overlay = document.createElement("div");
    overlay.className = "ofer-dialog-overlay";
    
    const dialog = document.createElement("div");
    dialog.className = "ofer-dialog";
    dialog.style.maxWidth = "560px";
    
    dialog.innerHTML = `
      <h3>Reset branch to ${sha.substring(0, 7)}</h3>
      <p>Run this command to reset <strong>${branch}</strong> to this commit:</p>
      <div style="position: relative; margin-bottom: 16px;">
        <pre style="background: var(--bgColor-neutral-muted, #0d1117); border: 1px solid var(--borderColor-default, #30363d); border-radius: 6px; padding: 12px 16px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-all; color: var(--fgColor-default, #e6edf3); margin: 0; line-height: 1.5;">${command}</pre>
      </div>
      <div class="ofer-dialog-actions">
        <button class="ofer-copy-btn ofer-dialog-btn" style="display: inline-flex; align-items: center; gap: 6px;">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
          <span>Copy command</span>
        </button>
        <button class="ofer-dialog-btn" data-action="close">Close</button>
      </div>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const copyBtn = overlay.querySelector(".ofer-copy-btn");
    const copyLabel = copyBtn.querySelector("span");
    const copyIcon = copyBtn.querySelector("svg");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(command).then(() => {
        copyIcon.innerHTML = `<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>`;
        copyLabel.textContent = "Copied!";
        copyBtn.style.borderColor = "var(--fgColor-success, #3fb950)";
        copyBtn.style.color = "var(--fgColor-success, #3fb950)";
        setTimeout(() => { 
          copyIcon.innerHTML = `<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>`;
          copyLabel.textContent = "Copy command"; 
          copyBtn.style.borderColor = ""; 
          copyBtn.style.color = ""; 
        }, 2000);
      });
    });

    const cleanup = () => overlay.remove();
    overlay.querySelector('[data-action="close"]').addEventListener("click", cleanup);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
    document.addEventListener("keydown", function handler(e) {
      if (e.key === "Escape") { cleanup(); document.removeEventListener("keydown", handler); }
    });
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────────────

  let commitObserver = null;

  function init() {
    if (!window.oferTools?.isPRPage()) return;
    injectCommitResetButtons();

    // Observe for new timeline items (lazy-loaded commits)
    if (!commitObserver) {
      commitObserver = new MutationObserver(() => {
        injectCommitResetButtons();
      });
      commitObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Handle Turbo navigation
  document.addEventListener("turbo:load", init);
  document.addEventListener("turbo:render", init);
})();
