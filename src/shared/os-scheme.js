/**
 * Reports the OS color scheme (prefers-color-scheme) to the background so the
 * toolbar icon can follow the system when the extension theme is "system".
 * Runs from the popup/options pages, which have matchMedia; the service worker
 * does not.
 */

export function reportOsScheme() {
  if (typeof matchMedia !== "function" || !globalThis.chrome?.runtime) return;

  const mq = matchMedia("(prefers-color-scheme: dark)");
  const send = () => {
    const scheme = mq.matches ? "dark" : "light";
    try {
      chrome.runtime.sendMessage({ action: "osScheme", scheme }, () => {
        void chrome.runtime.lastError; // ignore "no receiver" when worker idle
      });
    } catch {
      /* extension context tearing down — ignore */
    }
  };

  send();
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", send);
  else if (typeof mq.addListener === "function") mq.addListener(send);
}
