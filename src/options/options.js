import { getSettings, saveSettings } from "../shared/settings.js";
import { applyTheme } from "../shared/theme.js";
import { reportOsScheme } from "../shared/os-scheme.js";
import { elements } from "./dom.js";
import { loadForm, readFormSettings, resetForm } from "./form.js";

// True once the initial form load is done, so programmatic value-setting during
// load doesn't trigger a save-storm back to storage.
let ready = false;

/**
 * Persist the entire form. Appearance is applied live to this page, and the
 * background is notified so an open popup and the sync engine pick up changes
 * (new query, bookmarks toggled on/off, etc.) without a manual Save.
 */
async function persistAll({ notify = true } = {}) {
  const form = readFormSettings();
  const current = await getSettings();
  // Preserve runtime-managed state that isn't represented in the form.
  const settings = { ...form, pinnedPRs: current.pinnedPRs };
  await saveSettings(settings);
  applyTheme(settings);
  if (notify) {
    try {
      await chrome.runtime.sendMessage({ action: "settingsChanged" });
    } catch {
      // The service worker may be inactive while the options page is open.
    }
  }
}

// Debounce for text/number typing so we don't hit storage on every keystroke.
let saveTimer = null;
function persistDebounced(options) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistAll(options), 400);
}

// ─── Reset ─────────────────────────────────────────────────────────────────
elements.resetButton.addEventListener("click", async () => {
  resetForm();
  syncSwatchSelection();
  refreshFeatureCards();
  refreshToggleInputs();
  refreshDependencies();
  if (elements.fontSizeValue) elements.fontSizeValue.textContent = `${elements.fontSize.value}px`;
  await persistAll();
});

// ─── Auto-save wiring ────────────────────────────────────────────────────────
// Selects, checkboxes and range: save immediately on change.
// Text/number inputs: debounce while typing, and flush on blur/change.
function wireAutoSave() {
  const form = document.querySelector("body");
  if (!form) return;

  form.addEventListener("change", (event) => {
    if (!ready || !isFormControl(event.target)) return;
    clearTimeout(saveTimer); // supersede any pending debounced save
    persistAll();
  });

  form.addEventListener("input", (event) => {
    if (!ready || !isFormControl(event.target)) return;
    const el = event.target;

    // Appearance controls (accent color, font size) apply to this page live
    // while dragging so the change is visible before the debounced save lands.
    if (el === elements.accentColor || el === elements.fontSize) {
      applyTheme(readFormSettings());
    }

    // Range and color emit input continuously; still cheap, but debounce keeps
    // storage writes reasonable. Text/number also debounce while typing.
    if (el.matches('input[type="text"], input[type="number"], input[type="range"], input[type="color"], textarea')) {
      persistDebounced();
    }
  });
}

function isFormControl(el) {
  return el.matches("input, select, textarea");
}

// ─── Font-size slider label ──────────────────────────────────────────────────
if (elements.fontSize && elements.fontSizeValue) {
  elements.fontSize.addEventListener("input", () => {
    elements.fontSizeValue.textContent = `${elements.fontSize.value}px`;
  });
}

// ─── "0 = off" toggles ─────────────────────────────────────────────────────
// Each toggle enables/disables an associated number input. When off, the
// number field is greyed out (disabled) and the setting reads as 0.
function refreshToggleInputs() {
  document.querySelectorAll(".toggle-input[data-toggle-for]").forEach((toggle) => {
    const input = document.getElementById(toggle.dataset.toggleFor);
    if (!input) return;
    input.disabled = !toggle.checked;
    if (toggle.checked && (!input.value || Number(input.value) < Number(input.min || 1))) {
      input.value = toggle.dataset.default || input.min || 1;
    }
  });
}

document.querySelectorAll(".toggle-input[data-toggle-for]").forEach((toggle) => {
  toggle.addEventListener("change", refreshToggleInputs);
});
refreshToggleInputs();

// ─── Feature-card master toggles ───────────────────────────────────────────
// A toggle in a card header enables/disables the whole card. When off, the
// card body is dimmed and its controls are inert.
function refreshFeatureCards() {
  document.querySelectorAll(".toggle-input[data-feature-card]").forEach((toggle) => {
    const card = toggle.closest(".card");
    if (card) card.classList.toggle("feature-off", !toggle.checked);
  });
}

document.querySelectorAll(".toggle-input[data-feature-card]").forEach((toggle) => {
  toggle.addEventListener("change", refreshFeatureCards);
});
refreshFeatureCards();

// ─── Dependent toggles ─────────────────────────────────────────────────────
// A control only makes sense while its parent toggle is on; when off, the
// dependent field is disabled and dimmed.
const DEPENDENCIES = [
  // parent toggle → dependent field wrapper + control(s)
  { parent: "showDraftPRs", field: "show-draft-field", controls: ["showDraft"] },
  { parent: "badgeEnabled", field: "badge-mode-field", controls: ["badgeMode"] },
];

function refreshDependencies() {
  for (const dep of DEPENDENCIES) {
    const on = elements[dep.parent]?.checked;
    const field = document.getElementById(dep.field);
    if (field) field.classList.toggle("dependent-off", !on);
    for (const id of dep.controls) {
      if (elements[id]) elements[id].disabled = !on;
    }
  }
}

DEPENDENCIES.forEach((dep) => {
  elements[dep.parent]?.addEventListener("change", refreshDependencies);
});
refreshDependencies();

// ─── Accent color swatches ────────────────────────────────────────────────
// The hidden color input (#accent-color) stays the source of truth read by the
// form. Preset swatches set its value; the custom swatch hosts the native
// picker. `selected` state highlights whichever swatch matches the value.
const swatchContainer = document.getElementById("accent-swatches");
const customSwatch = document.getElementById("accent-custom");

function syncSwatchSelection() {
  if (!swatchContainer) return;
  const value = (elements.accentColor.value || "").toLowerCase();
  let matched = false;
  swatchContainer.querySelectorAll(".swatch[data-color]").forEach((sw) => {
    const isMatch = sw.dataset.color.toLowerCase() === value;
    sw.classList.toggle("selected", isMatch);
    if (isMatch) matched = true;
  });
  // No preset matched, so the value came from the custom picker.
  if (customSwatch) customSwatch.classList.toggle("selected", !matched);
}

if (swatchContainer) {
  swatchContainer.querySelectorAll(".swatch[data-color]").forEach((sw) => {
    sw.addEventListener("click", () => {
      elements.accentColor.value = sw.dataset.color;
      syncSwatchSelection();
      if (ready) persistAll();
    });
  });
  // The custom picker fires "input" (handled by auto-save) — just refresh state.
  elements.accentColor.addEventListener("input", syncSwatchSelection);
}

// Each preset button toggles its query on/off independently, so you can enable
// e.g. both "My PRs" and "Review requested" at once. The active state is
// reflected on the buttons and kept in sync with manual edits to the textarea.
function currentQueryLines() {
  return elements.query.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function syncPresetSelection() {
  const lines = new Set(currentQueryLines());
  document.querySelectorAll(".preset-btn").forEach((button) => {
    button.classList.toggle("selected", lines.has(button.dataset.query));
  });
}

document.querySelectorAll(".preset-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = button.dataset.query;
    const lines = currentQueryLines();
    const idx = lines.indexOf(preset);
    if (idx >= 0) {
      lines.splice(idx, 1); // toggle off
    } else {
      lines.push(preset); // toggle on
    }
    elements.query.value = lines.join("\n");
    syncPresetSelection();
    if (ready) persistAll();
  });
});

// Keep preset highlighting in sync when the user edits the textarea directly.
elements.query.addEventListener("input", syncPresetSelection);

// ─── Boot ────────────────────────────────────────────────────────────────────
wireAutoSave();
loadForm().then(() => {
  syncSwatchSelection();
  syncPresetSelection();
  refreshFeatureCards();
  refreshToggleInputs();
  refreshDependencies();
  ready = true;
});
getSettings().then(applyTheme);

// Report the OS scheme so the toolbar icon follows the system when theme=system.
reportOsScheme();
