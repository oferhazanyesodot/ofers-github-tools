const demoReady = new URLSearchParams(location.search).has("demo") && !globalThis.chrome?.storage
  ? import("../../demo/popup-demo.js")
  : Promise.resolve();

demoReady.then(async () => {
  const { elements } = await import("./dom.js");
  const { bindCopilotActions, loadCopilotUsage } = await import("./copilot.js");
  const { loadPRList } = await import("./pr-list.js");
  const { loadStatus, updateFooter } = await import("./status.js");

  elements.optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  elements.syncButton.addEventListener("click", async () => {
    elements.syncButton.disabled = true;
    elements.syncButton.textContent = "Syncing…";

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
    if (area === "sync" && changes.settings) updateFooter();
  });

  bindCopilotActions();
  await loadAll();
  await updateFooter();
});
