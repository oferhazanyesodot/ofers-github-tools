/**
 * GitHub transport with the active browser session attached.
 */

export async function githubFetch(url, options = {}) {
  const cookies1 = await chrome.cookies.getAll({ domain: "github.com" });
  const cookies2 = await chrome.cookies.getAll({ domain: ".github.com" });
  const allCookies = [...cookies1, ...cookies2];
  const seen = new Set();
  const uniqueCookies = allCookies.filter((cookie) => {
    if (seen.has(cookie.name)) return false;
    seen.add(cookie.name);
    return true;
  });
  const cookieHeader = uniqueCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  const headers = {
    ...(options.headers || {}),
    Cookie: cookieHeader,
  };
  const method = (options.method || "GET").toUpperCase();
  const redirect = options.redirect || (method === "GET" ? "follow" : "manual");

  if (method === "POST") {
    headers.Origin = "https://github.com";
    if (!headers.Referer) headers.Referer = url;
  }

  const response = await fetch(url, { ...options, headers, redirect });

  if (method === "POST" && (response.status === 302 || response.status === 303 || response.type === "opaqueredirect")) {
    return { ok: true, status: 200, text: async () => "" };
  }

  return response;
}
