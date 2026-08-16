/**
 * Shared utilities for Ofer's GitHub Tools content scripts.
 *
 * Exposes a `window.oferTools` namespace with common helpers:
 *   - injectStyles()
 *   - showConfirmDialog(title, messageHTML, confirmLabel, confirmClass)
 *   - showBanner(message, type)
 *   - isPRFilesPage()
 *   - isPRPage()
 *   - getPRMetadata()
 *   - getPRMetadataWithFallback(menu)
 */

(() => {
  "use strict";

  if (window.oferTools) return; // already loaded

  const ns = {};
  window.oferTools = ns;

  // ─── STYLES ────────────────────────────────────────────────────────────────

  ns.injectStyles = function injectStyles() {
    if (document.getElementById("ofer-dialog-styles")) return;
    const style = document.createElement("style");
    style.id = "ofer-dialog-styles";
    style.textContent = `
      .ofer-dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: ofer-fade-in 0.15s ease;
      }
      @keyframes ofer-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .ofer-dialog {
        background: var(--bgColor-default, var(--color-canvas-default, #0d1117));
        border: 1px solid var(--borderColor-default, var(--color-border-default, #30363d));
        border-radius: 12px;
        padding: 24px;
        max-width: 440px;
        width: 90%;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        color: var(--fgColor-default, var(--color-fg-default, #e6edf3));
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      }
      .ofer-dialog h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }
      .ofer-dialog p {
        margin: 0 0 16px 0;
        font-size: 14px;
        color: var(--fgColor-muted, var(--color-fg-muted, #8b949e));
        line-height: 1.5;
      }
      .ofer-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .ofer-dialog-btn {
        padding: 5px 16px;
        font-size: 14px;
        font-weight: 500;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid var(--borderColor-default, var(--color-border-default, #30363d));
        background: var(--bgColor-default, var(--color-canvas-subtle, #161b22));
        color: var(--fgColor-default, var(--color-fg-default, #e6edf3));
        line-height: 20px;
      }
      .ofer-dialog-btn:hover {
        background: var(--bgColor-neutral-muted, var(--color-neutral-muted, #21262d));
      }
      .ofer-dialog-btn-danger {
        background: var(--bgColor-danger-emphasis, var(--color-danger-emphasis, #da3633));
        color: #fff;
        border-color: var(--bgColor-danger-emphasis, var(--color-danger-emphasis, #da3633));
      }
      .ofer-dialog-btn-danger:hover {
        background: #b62324;
      }
      .ofer-dialog-btn-primary {
        background: var(--bgColor-success-emphasis, var(--color-success-emphasis, #238636));
        color: #fff;
        border-color: var(--bgColor-success-emphasis, var(--color-success-emphasis, #238636));
      }
      .ofer-dialog-btn-primary:hover {
        background: #2ea043;
      }
    `;
    document.head.appendChild(style);
  };

  // Inject styles immediately so all features have them available
  ns.injectStyles();

  // ─── CONFIRM DIALOG ────────────────────────────────────────────────────────

  /**
   * Show a GitHub-styled confirmation dialog (overlay, centered, dark backdrop).
   * @param {string} title - Dialog heading
   * @param {string} messageHTML - Body content (HTML allowed)
   * @param {string} [confirmLabel="Confirm"] - Text for the confirm button
   * @param {string} [confirmClass="ofer-dialog-btn-danger"] - CSS class for confirm button
   * @returns {Promise<boolean>} resolves true if confirmed, false if cancelled
   */
  ns.showConfirmDialog = function showConfirmDialog(title, messageHTML, confirmLabel = "Confirm", confirmClass = "ofer-dialog-btn-danger") {
    ns.injectStyles();
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "ofer-dialog-overlay";
      overlay.innerHTML = `
        <div class="ofer-dialog">
          <h3>${title}</h3>
          <p>${messageHTML}</p>
          <div class="ofer-dialog-actions">
            <button class="ofer-dialog-btn" data-action="cancel">Cancel</button>
            <button class="ofer-dialog-btn ${confirmClass}" data-action="confirm">${confirmLabel}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => cleanup(false));
      overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => cleanup(true));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
      document.addEventListener("keydown", function handler(e) {
        if (e.key === "Escape") { cleanup(false); document.removeEventListener("keydown", handler); }
      });
    });
  };

  // ─── BANNER / TOAST ────────────────────────────────────────────────────────

  /**
   * Show a full-width banner notification at the top of the viewport.
   * @param {string} message - Text to display
   * @param {string} [type="error"] - "success" or "error"
   */
  ns.showBanner = function showBanner(message, type = "error") {
    // Remove any existing banner
    document.querySelector(".ofer-flash-banner")?.remove();

    const banner = document.createElement("div");
    banner.className = "ofer-flash-banner";
    const isSuccess = type === "success";
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999999;
      padding: 16px 24px;
      font-size: 14px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      animation: ofer-fade-in 0.15s ease;
      ${isSuccess
        ? "background: var(--bgColor-success-emphasis, #238636); color: #fff;"
        : "background: var(--bgColor-danger-emphasis, #da3633); color: #fff;"}
    `;

    const icon = isSuccess
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.343 13.657A8 8 0 1 1 13.66 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"/></svg>`;

    banner.innerHTML = `${icon}<span>${message}</span>`;
    document.body.appendChild(banner);

    setTimeout(() => {
      banner.style.transition = "opacity 0.3s, transform 0.3s";
      banner.style.opacity = "0";
      banner.style.transform = "translateY(-100%)";
    }, 3000);
    setTimeout(() => banner.remove(), 3500);
  };

  // ─── PAGE DETECTION ────────────────────────────────────────────────────────

  /** Returns true if the current URL is a PR files/changes page. */
  ns.isPRFilesPage = function isPRFilesPage() {
    return /\/pull\/\d+\/(files|changes)/.test(window.location.pathname);
  };

  /** Returns true if the current URL is any PR page. */
  ns.isPRPage = function isPRPage() {
    return /\/pull\/\d+/.test(window.location.pathname);
  };

  // ─── PR METADATA ──────────────────────────────────────────────────────────

  /**
   * Extract PR metadata (owner, repo, prNumber, baseBranch, headBranch) from
   * the current page URL and DOM elements.
   */
  ns.getPRMetadata = function getPRMetadata() {
    const match = window.location.pathname.match(/\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;

    const [, owner, repo, prNumber] = match;
    let baseBranch = null;
    let headBranch = null;

    // Strategy 1: .base-ref / .head-ref elements
    const baseRef = document.querySelector('.base-ref a, .base-ref');
    const headRef = document.querySelector('.head-ref a, .head-ref');
    if (baseRef) baseBranch = baseRef.textContent.trim().split(":").pop().trim();
    if (headRef) headBranch = headRef.textContent.trim().split(":").pop().trim();

    // Strategy 2: commit-ref class elements
    if (!baseBranch || !headBranch) {
      const refs = document.querySelectorAll('.commit-ref, [class*="commit-ref"]');
      if (refs.length >= 2) {
        baseBranch = baseBranch || refs[0].textContent.trim().split(":").pop().trim();
        headBranch = headBranch || refs[1].textContent.trim().split(":").pop().trim();
      }
    }

    // Strategy 3: "into BASE from HEAD" text pattern
    if (!baseBranch || !headBranch) {
      const headerArea = document.querySelector('.gh-header-meta, [class*="gh-header"], .pull-request-tab-header');
      const searchText = headerArea ? headerArea.innerText : document.querySelector('.js-issue-title, h1')?.parentElement?.innerText || "";
      const intoFrom = searchText.match(/into\s+([^\s]+)\s+from\s+([^\s]+)/);
      if (intoFrom) {
        baseBranch = baseBranch || intoFrom[1].trim();
        headBranch = headBranch || intoFrom[2].trim();
      }
      if (!baseBranch || !headBranch) {
        const fullText = document.body.innerText;
        const fullMatch = fullText.match(/wants to merge.*?into\s+([^\s]+)\s+from\s+([^\s\n]+)/);
        if (fullMatch) {
          baseBranch = baseBranch || fullMatch[1].trim();
          headBranch = headBranch || fullMatch[2].trim();
        }
      }
    }

    // Strategy 4: /tree/ links
    if (!baseBranch || !headBranch) {
      const treeLinks = document.querySelectorAll('a[href*="/tree/"]');
      for (const link of treeLinks) {
        const href = link.getAttribute("href") || "";
        if (href.includes(`/${owner}/${repo}/tree/`)) {
          const branch = href.split("/tree/")[1];
          if (branch && !baseBranch) {
            baseBranch = decodeURIComponent(branch);
          } else if (branch && !headBranch) {
            headBranch = decodeURIComponent(branch);
          }
        }
      }
    }

    return { owner, repo, prNumber, baseBranch, headBranch };
  };

  /**
   * Async version of getPRMetadata that fetches the PR conversation page
   * as fallback when branches can't be found in the current DOM.
   * @param {Element|null} menu - Optional menu element to extract branch from edit/delete links
   */
  ns.getPRMetadataWithFallback = async function getPRMetadataWithFallback(menu) {
    const metadata = ns.getPRMetadata();
    if (!metadata) return null;

    // If we already have branches, return immediately
    if (metadata.baseBranch && metadata.headBranch) return metadata;

    // Try to extract head branch from menu edit/delete links
    if (menu) {
      const editLink = menu.querySelector('a[href*="/edit/"]');
      const deleteLink = menu.querySelector('a[href*="/delete/"]');
      const link = editLink || deleteLink;
      if (link) {
        const href = link.getAttribute("href");
        const actionMatch = href.match(/\/[^/]+\/[^/]+\/(?:edit|delete)\/([^?]+)/);
        if (actionMatch) {
          metadata._branchAndPath = actionMatch[1];
        }
      }
    }

    // Fallback: fetch the PR conversation page to get branch info
    if (!metadata.baseBranch || !metadata.headBranch) {
      try {
        const prUrl = `https://github.com/${metadata.owner}/${metadata.repo}/pull/${metadata.prNumber}`;
        const res = await fetch(prUrl, {
          credentials: "include",
          headers: { "Accept": "text/html" },
        });
        if (res.ok) {
          const html = await res.text();

          const intoFrom = html.match(/into\s+<[^>]*>([^<]+)<\/[^>]*>\s+from\s+<[^>]*>([^<]+)<\//);
          if (intoFrom) {
            metadata.baseBranch = metadata.baseBranch || intoFrom[1].trim();
            metadata.headBranch = metadata.headBranch || intoFrom[2].trim();
          }

          if (!metadata.baseBranch || !metadata.headBranch) {
            const refPattern = /class="[^"]*commit-ref[^"]*"[^>]*>([^<]+)</g;
            const matches = [...html.matchAll(refPattern)].map(m => m[1].trim());
            if (matches.length >= 2) {
              metadata.baseBranch = metadata.baseBranch || matches[0].split(":").pop().trim();
              metadata.headBranch = metadata.headBranch || matches[1].split(":").pop().trim();
            }
          }

          if (!metadata.baseBranch || !metadata.headBranch) {
            const baseMatch = html.match(/base-ref[^>]*>([^<]+)</);
            const headMatch = html.match(/head-ref[^>]*>([^<]+)</);
            if (baseMatch) metadata.baseBranch = metadata.baseBranch || baseMatch[1].trim();
            if (headMatch) metadata.headBranch = metadata.headBranch || headMatch[1].trim();
          }
        }
      } catch (e) {
        // Fetch failed — branches remain null
      }
    }

    return metadata;
  };
})();
