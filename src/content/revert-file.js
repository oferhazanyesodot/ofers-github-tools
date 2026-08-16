/**
 * Revert File — Injects a "Revert file" option into the 3-dot ActionList menu
 * on each file in the PR Files Changed view.
 *
 * On click: shows confirm dialog, sends message to background, shows banner.
 * Uses window.oferTools from shared.js.
 */

(() => {
  "use strict";

  const REVERT_ITEM_CLASS = "ofer-revert-file-item";

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  /**
   * Get the file path from a file diff container.
   */
  function getFilePathFromContainer(container) {
    const pathEl = container.querySelector("[data-path]");
    if (pathEl) return pathEl.getAttribute("data-path");

    const titleEl = container.querySelector(".file-header a[title], .file-info a[title]");
    if (titleEl) return titleEl.getAttribute("title");

    const copyEl = container.querySelector("clipboard-copy[value]");
    if (copyEl) return copyEl.getAttribute("value");

    const nameLink = container.querySelector('a[href*="#diff-"]');
    if (nameLink) return nameLink.textContent.trim();

    const truncLink = container.querySelector(".Truncate a, .file-header a");
    if (truncLink) return truncLink.textContent.trim();

    return null;
  }

  /**
   * Detect file status from the file container.
   */
  function getFileStatus(container) {
    const badge = container.querySelector('[data-file-type], .diffstat-text, .Label');
    if (badge) {
      const badgeText = badge.textContent.trim().toLowerCase();
      if (badgeText.includes("added") || badgeText === "new") return "added";
      if (badgeText.includes("removed") || badgeText.includes("deleted")) return "removed";
      if (badgeText.includes("renamed")) return "renamed";
    }
    return "modified";
  }

  /**
   * Find the file diff container that a menu belongs to.
   */
  function findFileContainerForMenu(menu) {
    let el = menu;
    for (let i = 0; i < 20; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;

      if (el.getAttribute("data-details-container-group") === "file") return el;
      if (el.classList?.contains("file")) return el;
      if (el.id?.startsWith("diff-")) return el;
      if (el.getAttribute("data-tagsearch-path")) return el;
      if (el.getAttribute("data-file-header")) return el;
      if (el.getAttribute("data-path")) return el;

      const pathEl = el.querySelector(":scope > [data-path], :scope > .file-header, :scope > .file-info");
      if (pathEl) return el;

      const copyBtn = el.querySelector(":scope clipboard-copy[value], :scope [data-copy-feedback]");
      if (copyBtn && copyBtn.getAttribute("value")?.includes("/")) return el;

      if (el.querySelector("clipboard-copy") && el.querySelector("[data-path], a[title]")) return el;
    }
    return null;
  }

  // ─── REVERT MENU ITEM ─────────────────────────────────────────────────────

  /**
   * Send the revert request to the background service worker.
   */
  async function revertFileInPR(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "revertFile", payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.ok) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error || "Unknown error"));
        }
      });
    });
  }

  /**
   * Create the "Revert file" menu item, cloning the "Delete file" item for styling.
   */
  function createRevertMenuItem(filePath, fileStatus, metadata, menu) {
    const deleteItem = [...menu.querySelectorAll(':scope > li')].find(li => li.textContent.includes("Delete file"));

    let li;
    if (deleteItem) {
      li = deleteItem.cloneNode(true);
      li.className = REVERT_ITEM_CLASS + " " + deleteItem.className;
      const labelEl = li.querySelector('[data-component="ActionList.Item.Label"], [class*="ItemLabel"]');
      if (labelEl) labelEl.textContent = "Revert file";
      const iconContainer = li.querySelector('[data-component="ActionList.LeadingVisual"], [class*="LeadingVisual"]');
      if (iconContainer) {
        iconContainer.innerHTML = `<svg data-component="Octicon" aria-hidden="true" focusable="false" class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" display="inline-block" overflow="visible" style="vertical-align: text-bottom;"><path d="M1.22 6.28a.749.749 0 0 1 0-1.06l3.5-3.5a.749.749 0 1 1 1.06 1.06L3.561 5h7.188a4.25 4.25 0 0 1 0 8.5H8.25a.75.75 0 0 1 0-1.5h2.5a2.75 2.75 0 0 0 0-5.5H3.561l2.22 2.22a.749.749 0 1 1-1.06 1.06Z"/></svg>`;
      }
      const link = li.querySelector("a");
      if (link) {
        link.removeAttribute("href");
        link.style.cursor = "pointer";
        link.removeAttribute("aria-keyshortcuts");
      }
    } else {
      // Fallback: build manually
      li = document.createElement("li");
      li.setAttribute("role", "none");
      li.className = REVERT_ITEM_CLASS;
      const a = document.createElement("a");
      a.setAttribute("role", "menuitem");
      a.style.cssText = "text-decoration:none; display:flex; align-items:center; padding:6px 8px; border-radius:6px; gap:8px; color:var(--fgColor-danger,#cf222e); cursor:pointer;";
      a.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.22 6.28a.749.749 0 0 1 0-1.06l3.5-3.5a.749.749 0 1 1 1.06 1.06L3.561 5h7.188a4.25 4.25 0 0 1 0 8.5H8.25a.75.75 0 0 1 0-1.5h2.5a2.75 2.75 0 0 0 0-5.5H3.561l2.22 2.22a.749.749 0 1 1-1.06 1.06Z"/></svg> <span>Revert file</span>`;
      li.appendChild(a);
    }

    const label = li.querySelector('[data-component="ActionList.Item.Label"], [class*="ItemLabel"], span:last-child');

    const clickTarget = li.querySelector("a") || li;
    clickTarget.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const freshMetadata = await window.oferTools.getPRMetadataWithFallback(menu);
      if (!freshMetadata || !freshMetadata.baseBranch || !freshMetadata.headBranch) {
        window.oferTools.showBanner("Could not determine base/head branches. Make sure you're on a PR page.", "error");
        return;
      }

      const confirmed = await window.oferTools.showConfirmDialog(
        "Revert file",
        `Revert <strong>${filePath}</strong> to its state on <strong>${freshMetadata.baseBranch}</strong>?<br><br>This will create a commit on <strong>${freshMetadata.headBranch}</strong> that restores the file.`,
        "Revert",
        "ofer-dialog-btn-danger"
      );
      if (!confirmed) return;

      if (label) label.textContent = "Reverting…";
      clickTarget.style.pointerEvents = "none";
      clickTarget.style.opacity = "0.6";

      try {
        await revertFileInPR({
          owner: freshMetadata.owner,
          repo: freshMetadata.repo,
          baseBranch: freshMetadata.baseBranch,
          headBranch: freshMetadata.headBranch,
          filePath,
          status: fileStatus,
        });

        if (label) label.textContent = "✓ Reverted!";
        clickTarget.style.color = "var(--fgColor-success, var(--color-success-fg, #1a7f37))";
        window.oferTools.showBanner(`Successfully reverted ${filePath}`, "success");
        setTimeout(() => {
          // Navigate to conversation tab then back to force GitHub to re-fetch the diff
          const currentUrl = window.location.href;
          const prBase = currentUrl.replace(/\/(files|changes).*$/, "");
          // Go to conversation briefly, then redirect back
          window.location.href = prBase;
        }, 1000);
      } catch (err) {
        if (label) label.textContent = "✗ Failed";
        window.oferTools.showBanner(`Revert failed: ${err.message}`, "error");
        setTimeout(() => {
          if (label) label.textContent = "Revert file";
          clickTarget.style.pointerEvents = "auto";
          clickTarget.style.opacity = "1";
          clickTarget.style.color = "var(--fgColor-danger, var(--color-danger-fg, #cf222e))";
        }, 2000);
      }
    });

    return li;
  }

  /**
   * Try to inject "Revert file" into a dropdown/menu.
   */
  function injectRevertIntoMenu(menu) {
    if (!menu) return;
    if (menu.querySelector(`li.${REVERT_ITEM_CLASS}`)) return;

    const metadata = window.oferTools.getPRMetadata();
    if (!metadata) return;

    let filePath = null;
    let headBranch = metadata.headBranch;

    const editLink = menu.querySelector('a[href*="/edit/"]');
    const viewLink = menu.querySelector('a[href*="/blob/"]');
    const deleteLink = menu.querySelector('a[href*="/delete/"]');

    if (editLink) {
      const href = editLink.getAttribute("href");
      const editMatch = href.match(/\/edit\/([^?]+)/);
      if (editMatch) {
        const pathPart = editMatch[1];
        if (headBranch && pathPart.startsWith(encodeURIComponent(headBranch) + "/")) {
          filePath = decodeURIComponent(pathPart.substring(encodeURIComponent(headBranch).length + 1));
        } else if (headBranch && pathPart.startsWith(headBranch + "/")) {
          filePath = pathPart.substring(headBranch.length + 1);
        } else {
          if (deleteLink) {
            const delHref = deleteLink.getAttribute("href");
            const delMatch = delHref.match(/\/delete\/(.+)/);
            if (delMatch) {
              const delPath = delMatch[1];
              if (headBranch && delPath.startsWith(headBranch + "/")) {
                filePath = delPath.substring(headBranch.length + 1);
              }
            }
          }
          if (!filePath) {
            const parts = pathPart.split("/");
            if (headBranch) {
              const branchParts = headBranch.split("/");
              filePath = parts.slice(branchParts.length).join("/");
            } else {
              filePath = parts.slice(1).join("/");
            }
          }
        }
      }
    }

    if (!filePath && viewLink) {
      const href = viewLink.getAttribute("href");
      const blobMatch = href.match(/\/blob\/[^/]+\/(.+)/);
      if (blobMatch) {
        filePath = blobMatch[1];
      }
    }

    if (!filePath) {
      const fileContainer = findFileContainerForMenu(menu);
      if (fileContainer) {
        filePath = getFilePathFromContainer(fileContainer);
      }
    }

    if (!filePath) return;

    const fileContainer = findFileContainerForMenu(menu);
    const fileStatus = getFileStatus(fileContainer || menu);
    const revertItem = createRevertMenuItem(filePath, fileStatus, metadata, menu);

    // Insert before the "Delete file" item
    const listItems = menu.querySelectorAll(':scope > li');
    let deleteItem = null;
    for (const li of listItems) {
      if (li.textContent.includes("Delete file")) {
        deleteItem = li;
        break;
      }
    }

    if (deleteItem) {
      menu.insertBefore(revertItem, deleteItem);
    } else {
      menu.appendChild(revertItem);
    }
  }

  // ─── MENU OBSERVER (idempotent — only one observer created) ───────────────

  let menuObserverActive = false;

  function observeMenus() {
    if (menuObserverActive) return;
    menuObserverActive = true;

    const observer = new MutationObserver(() => {
      const menus = document.querySelectorAll('ul[role="menu"]');
      for (const menu of menus) {
        if (menu.querySelector(`.${REVERT_ITEM_CLASS}`)) continue;
        const menuText = menu.textContent || "";
        if (menuText.includes("View file") || menuText.includes("Edit file") || menuText.includes("Delete file")) {
          injectRevertIntoMenu(menu);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────────────

  function init() {
    observeMenus();
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
