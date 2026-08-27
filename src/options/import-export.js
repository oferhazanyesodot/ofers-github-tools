import { exportSettings, importSettings } from "../shared/settings.js";
import { elements } from "./dom.js";
import { loadForm } from "./form.js";
import { showToast } from "./toast.js";

export function bindImportExport() {
  elements.exportButton.addEventListener("click", async () => {
    elements.importExportArea.value = await exportSettings();
    elements.importExportArea.select();
    showToast("Settings exported to text area.");
  });

  elements.importButton.addEventListener("click", async () => {
    const json = elements.importExportArea.value.trim();
    if (!json) {
      showToast("Paste JSON into the text area first.");
      return;
    }

    if (!await importSettings(json)) {
      showToast("Invalid JSON. Please check and try again.");
      return;
    }

    await loadForm();
    try {
      await chrome.runtime.sendMessage({ action: "settingsChanged" });
    } catch {
      // The service worker may be inactive while the options page is open.
    }
    showToast("Settings imported successfully.");
  });
}
