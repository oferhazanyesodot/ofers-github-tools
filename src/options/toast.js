import { elements } from "./dom.js";

let toastTimer = null;

export function showToast(message, duration = 3000) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), duration);
}
