import { elements } from "./dom.js";
import { copySvg, escapeHtml, relativeTime } from "./format.js";

export async function loadPRList() {
  const data = await chrome.storage.local.get("prList");
  const prs = data.prList || [];

  if (prs.length === 0) {
    elements.prList.innerHTML = '<div class="pr-empty">No open PRs found</div>';
    return;
  }

  const sorted = [...prs].sort((a, b) => {
    if (a.isDraft === b.isDraft) return 0;
    return a.isDraft ? 1 : -1;
  });

  elements.prList.innerHTML = sorted.map(renderPRItem).join("");

  elements.prList.querySelectorAll(".pr-copy").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const url = button.dataset.url;
      navigator.clipboard.writeText(url);
      button.innerHTML = "✓";
      setTimeout(() => {
        button.innerHTML = copySvg();
      }, 1500);
    });
  });

  elements.prList.querySelectorAll(".pr-item").forEach((item) => {
    item.addEventListener("click", () => {
      chrome.tabs.create({ url: item.dataset.url });
    });
  });
}

function renderPRItem(pr) {
  const iconClass = pr.isDraft ? "pr-icon draft" : "pr-icon";
  const draftBadge = pr.isDraft ? '<span class="draft-badge">DRAFT</span>' : "";
  const time = pr.updatedAt ? relativeTime(new Date(pr.updatedAt).getTime()) : "";

  return `
    <div class="pr-item" data-url="${escapeHtml(pr.url)}">
      <svg class="${iconClass}" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>
      </svg>
      <div class="pr-content">
        <div class="pr-title">${escapeHtml(pr.title)}</div>
        <div class="pr-meta">
          <span class="pr-repo">${escapeHtml(pr.repo)}</span>
          ${draftBadge}
          <span>${time}</span>
        </div>
      </div>
      <div class="pr-copy" data-url="${escapeHtml(pr.url)}" title="Copy URL">
        ${copySvg()}
      </div>
    </div>
  `;
}
