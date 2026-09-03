const demoReady = new URLSearchParams(location.search).has("demo") && !globalThis.chrome?.storage
  ? import("../../demo/popup-demo.js")
  : Promise.resolve();

const { getSettings } = await import("../shared/settings.js");
const { applyTheme } = await import("../shared/theme.js");

async function refreshTheme() {
  try {
    applyTheme(await getSettings());
  } catch {
    // storage may not be ready yet (e.g. demo mode before its stub loads)
  }
}

// Apply the saved theme as early as possible to avoid a flash of the wrong
// palette. Safe no-op if storage isn't available yet.
if (globalThis.chrome?.storage) await refreshTheme();

demoReady.then(async () => {
  // Re-apply once the demo/runtime environment is fully ready.
  await refreshTheme();

  // Report the OS scheme so the toolbar icon can follow the system theme.
  if (globalThis.chrome?.runtime) {
    const { reportOsScheme } = await import("../shared/os-scheme.js");
    reportOsScheme();
  }

  const { elements } = await import("./dom.js");
  const { bindCopilotActions, loadCopilotUsage } = await import("./copilot.js");
  const { loadPRList } = await import("./pr-list.js");
  const { loadStatus, updateFooter } = await import("./status.js");

  elements.optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  elements.syncButton.addEventListener("click", async () => {
    elements.syncButton.disabled = true;
    // Show a spinning arrow instead of the label while syncing.
    elements.syncButton.innerHTML =
      '<svg class="spin" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-label="Syncing">' +
      '<path d="M8 3a5 5 0 1 0 4.546 2.914.75.75 0 0 1 1.364-.626A6.5 6.5 0 1 1 8 1.5V0.25a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384l-2.36 1.966A.25.25 0 0 1 8 4.18V3Z"/>' +
      "</svg>";

    try {
      await chrome.runtime.sendMessage({ action: "syncNow" });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error("Sync trigger failed:", error);
    }

    await loadAll();
    elements.syncButton.disabled = false;
    elements.syncButton.textContent = "Sync Now";
  });

  async function loadAll() {
    await loadStatus();
    await loadPRList();
    await loadCopilotUsage();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.lastSync || changes.prList || changes.copilotUsage || changes.copilotHistory)) {
      loadAll();
    }
    if (area === "sync" && changes.settings) {
      updateFooter();
      refreshTheme();
      loadPRList();
      loadCopilotUsage();
    }
  });

  bindCopilotActions();
  await loadAll();
  await updateFooter();
});
