// Deterministic entry point for screenshotting the popup. Unlike popup.js it
// avoids a chain of dynamic imports (which don't reliably resolve in headless
// file:// captures) — it statically imports the real render modules and runs
// them once. Uses whatever chrome stub the host injected.
import { getSettings } from "../shared/settings.js";
import { applyTheme } from "../shared/theme.js";
import { loadPRList } from "./pr-list.js";
import { loadStatus, updateFooter } from "./status.js";
import { loadCopilotUsage } from "./copilot.js";

const settings = await getSettings();
applyTheme(settings);
await loadStatus();
await loadPRList();
await loadCopilotUsage();
await updateFooter();
