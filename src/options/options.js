import { saveSettings } from "../shared/settings.js";
import { elements } from "./dom.js";
import { bindImportExport } from "./import-export.js";
import { loadForm, readFormSettings, resetForm } from "./form.js";
import { showToast } from "./toast.js";

elements.saveButton.addEventListener("click", async () => {
  await saveSettings(readFormSettings());
  try {
    await chrome.runtime.sendMessage({ action: "settingsChanged" });
  } catch {
    // The service worker may be inactive while the options page is open.
  }
  showToast("Settings saved. Syncing now…");
});

elements.resetButton.addEventListener("click", resetForm);

document.querySelectorAll(".preset-btn").forEach((button) => {
  button.addEventListener("click", () => {
    elements.query.value = button.dataset.query;
  });
});

bindImportExport();
loadForm();
