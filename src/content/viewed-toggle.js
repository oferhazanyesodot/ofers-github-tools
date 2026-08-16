/**
 * Viewed Toggle — Makes the progress circle next to "X / Y viewed" clickable
 * to toggle all files viewed/unviewed.
 *
 * Only activates on PR files/changes pages.
 * Uses window.oferTools from shared.js.
 */

(() => {
  "use strict";

  const ENHANCED_ATTR = "data-ofer-viewed-enhanced";

  /**
   * Find the progress circle SVG next to the "X / Y viewed" text.
   */
  function findProgressCircle() {
    const allSpans = document.querySelectorAll("span, div, p");
    for (const el of allSpans) {
      if (/^\s*\d+\s*\/\s*\d+\s+viewed\s*$/.test(el.textContent.trim())) {
        const parent = el.parentElement;
        if (!parent) continue;

        const svg = parent.querySelector("svg") ||
                    (parent.previousElementSibling?.matches?.("svg") && parent.previousElementSibling) ||
                    (el.previousElementSibling?.matches?.("svg") && el.previousElementSibling);
        if (svg) return { circle: svg, counter: el, container: parent };

        const parentSvg = parent.parentElement?.querySelector(":scope > svg");
        if (parentSvg) return { circle: parentSvg, counter: el, container: parent.parentElement };
      }
    }
    return null;
  }

  /**
   * Parse viewed state from the counter text.
   * @returns {{ viewed: number, total: number } | null}
   */
  function parseViewedCounter(counterEl) {
    const match = counterEl.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return null;
    return { viewed: parseInt(match[1], 10), total: parseInt(match[2], 10) };
  }

  /**
   * Get all "Viewed" checkboxes/buttons on the page.
   */
  function getViewedToggles() {
    // New UI: buttons with aria-label
    const viewedBtns = document.querySelectorAll('button[aria-label="Viewed"]');
    const notViewedBtns = document.querySelectorAll('button[aria-label="Not Viewed"]');
    if (viewedBtns.length > 0 || notViewedBtns.length > 0) {
      return { type: "buttons", viewed: [...viewedBtns], notViewed: [...notViewedBtns] };
    }

    // Legacy UI: checkboxes
    const checkboxes = document.querySelectorAll('.js-reviewed-checkbox');
    if (checkboxes.length > 0) {
      const checked = [...checkboxes].filter((cb) => cb.checked);
      const unchecked = [...checkboxes].filter((cb) => !cb.checked);
      return { type: "checkboxes", viewed: checked, notViewed: unchecked };
    }

    // Fallback selectors
    const toggles = document.querySelectorAll('.js-reviewed-toggle, input[name="viewed"]');
    if (toggles.length > 0) {
      const checked = [...toggles].filter((t) => t.checked);
      const unchecked = [...toggles].filter((t) => !t.checked);
      return { type: "checkboxes", viewed: checked, notViewed: unchecked };
    }

    return { type: "none", viewed: [], notViewed: [] };
  }

  /**
   * Sequentially click elements with a short delay between each.
   */
  async function clickSequentially(elements) {
    for (let i = 0; i < elements.length; i++) {
      elements[i].click();
      if (i < elements.length - 1) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }

  /**
   * Enhance the progress circle to be clickable.
   */
  function enhanceProgressCircle() {
    const found = findProgressCircle();
    if (!found) return;

    const { circle, counter, container } = found;

    // Don't enhance twice
    if (container.getAttribute(ENHANCED_ATTR)) return;
    container.setAttribute(ENHANCED_ATTR, "true");

    const clickTarget = container;
    clickTarget.style.cursor = "pointer";
    clickTarget.title = "Click to toggle all files viewed/unviewed";

    clickTarget.addEventListener("mouseenter", () => { clickTarget.style.opacity = "0.7"; });
    clickTarget.addEventListener("mouseleave", () => { clickTarget.style.opacity = "1"; });

    clickTarget.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const counts = parseViewedCounter(counter);
      const toggles = getViewedToggles();

      if (!counts || toggles.type === "none") return;

      const allViewed = counts.viewed === counts.total;

      clickTarget.style.opacity = "0.4";
      clickTarget.style.pointerEvents = "none";

      if (allViewed) {
        await clickSequentially(toggles.viewed);
      } else {
        await clickSequentially(toggles.notViewed);
      }

      clickTarget.style.opacity = "1";
      clickTarget.style.pointerEvents = "auto";
    });
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────────────

  function init() {
    if (!window.oferTools?.isPRFilesPage()) return;
    enhanceProgressCircle();
  }

  // Observe for re-renders (GitHub may re-render the progress circle)
  let circleObserver = null;
  function startObserver() {
    if (circleObserver) return;
    circleObserver = new MutationObserver(() => {
      if (window.oferTools?.isPRFilesPage() && !document.querySelector(`[${ENHANCED_ATTR}]`)) {
        enhanceProgressCircle();
      }
    });
    circleObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Run on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { init(); startObserver(); });
  } else {
    init();
    startObserver();
  }

  // Handle Turbo navigation
  document.addEventListener("turbo:load", init);
  document.addEventListener("turbo:render", init);
})();
