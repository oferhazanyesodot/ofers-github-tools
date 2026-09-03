/**
 * Read or update the AMO (Firefox) store listing metadata and screenshots via
 * the addons.mozilla.org API v5. Credentials come from env vars so nothing
 * secret is written to disk:
 *   WEB_EXT_API_KEY, WEB_EXT_API_SECRET
 *
 * Usage:
 *   node scripts/amo-listing.js get                 # show current listing
 *   node scripts/amo-listing.js describe            # set summary + description
 *   node scripts/amo-listing.js screenshots         # upload store screenshots
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");

const GUID = "github-pr-bookmarks@oferhazanyesodot";
const HOST = "addons.mozilla.org";
const ROOT = path.join(__dirname, "..");

const issuer = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;
if (!issuer || !secret) { console.error("Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET"); process.exit(1); }

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function jwt() {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: issuer, jti: crypto.randomUUID(), iat, exp: iat + 120 }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function request(method, apiPath, { json, raw, headers } = {}) {
  return new Promise((resolve, reject) => {
    const body = json ? Buffer.from(JSON.stringify(json)) : raw || null;
    const opts = {
      hostname: HOST, path: apiPath, method,
      headers: {
        Authorization: `JWT ${jwt()}`,
        Accept: "application/json",
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = [];
      res.on("data", (c) => data.push(c));
      res.on("end", () => {
        const text = Buffer.concat(data).toString();
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Build a multipart/form-data body for image upload.
function multipart(fields, fileField, filePath) {
  const boundary = "----ght" + crypto.randomBytes(8).toString("hex");
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  const fileBuf = fs.readFileSync(filePath);
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${path.basename(filePath)}"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  ));
  parts.push(fileBuf, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── Listing content ─────────────────────────────────────────────────────────
const SUMMARY = "Sync your open GitHub PRs to bookmarks, track Copilot usage, and add handy PR review tools — all from your existing GitHub session.";

const DESCRIPTION = `Ofer's GitHub Tools bundles several personal GitHub productivity tools into one lightweight extension, powered entirely by your existing GitHub session. No OAuth, no tokens, no backend, no telemetry.

PR BOOKMARK FOLDER
Keeps a bookmark folder in sync with your open pull requests.
• Automatic background sync every few minutes (configurable)
• Pin/favorite important PRs so they stay on top
• Group by repository, exclude noisy repos, and auto-archive stale PRs
• Draft indicator, PR numbers, comment counts, and an "unread" dot
• A "New" tag on PRs that appeared since the last sync
• Desktop notifications for new PRs
• Keyboard shortcut (Alt+Shift+P) to sync instantly

COPILOT USAGE TRACKER
Keep an eye on your GitHub Copilot credit consumption.
• Visual usage bar for the current billing cycle
• Burn-rate projection that estimates whether you'll run out before reset
• Daily-usage sparkline trend
• Optional threshold alerts and a toolbar badge that shifts color

PR REVIEW TOOLS
Small helpers injected right into GitHub's PR interface.
• Toggle all files as viewed with one click
• Revert a single file to the base branch
• Copy a ready-to-run command to reset a branch to any commit

APPEARANCE
• Light, dark, and system themes plus an accent color and a fun Hello Kitty theme
• Adjustable density and font size
• Settings auto-save as you change them

HOW IT WORKS
The extension reads your open PRs from github.com/pulls and your Copilot usage from your GitHub settings, using the session you're already signed in with. If you can see those pages in your browser, the extension works. Everything is processed locally — no data ever leaves your browser.`;

// ─── Commands ────────────────────────────────────────────────────────────────
async function get() {
  const res = await request("GET", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/`);
  console.log("HTTP", res.status);
  const a = res.body;
  if (typeof a !== "object") return console.log(a);
  console.log("slug:", a.slug, "| status:", a.status);
  console.log("name:", JSON.stringify(a.name));
  console.log("summary:", JSON.stringify(a.summary));
  console.log("categories:", JSON.stringify(a.categories));
  console.log("previews:", (a.previews || []).length);
  console.log("has_description:", !!a.description);
  console.log("icon_url:", a.icon_url);
  console.log("icons:", JSON.stringify(a.icons));
}

async function describe() {
  const res = await request("PATCH", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/`, {
    json: {
      summary: { "en-US": SUMMARY },
      description: { "en-US": DESCRIPTION },
    },
  });
  console.log("describe → HTTP", res.status);
  if (res.status >= 400) console.log(JSON.stringify(res.body, null, 2));
  else console.log("summary/description updated.");
}

const SHOTS = [
  { file: "store-assets/screenshot-1-themes.png", caption: "Popup in dark, light, and Hello Kitty themes" },
  { file: "store-assets/screenshot-2-settings.png", caption: "Full settings — every feature is configurable" },
  { file: "store-assets/screenshot-3-settings-light.png", caption: "Settings in light theme" },
];

async function uploadShot(s, pos) {
  const abs = path.join(ROOT, s.file);
  if (!fs.existsSync(abs)) { console.warn("  missing:", s.file); return; }
  const { body, contentType } = multipart(
    { position: String(pos), "caption[en-US]": s.caption },
    "image", abs
  );
  const res = await request("POST", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/previews/`, {
    raw: body, headers: { "Content-Type": contentType },
  });
  console.log(`  ${path.basename(s.file)} → HTTP ${res.status}${res.status >= 400 ? " " + JSON.stringify(res.body) : ""}`);
  return res.status;
}

// Full (re)upload: clears existing previews then uploads all.
async function screenshots() {
  const cur = await request("GET", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/`);
  for (const p of (cur.body.previews || [])) {
    const del = await request("DELETE", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/previews/${p.id}/`);
    console.log("  removed existing preview", p.id, "→", del.status);
  }
  for (let i = 0; i < SHOTS.length; i++) await uploadShot(SHOTS[i], i);
}

// Sync: only upload screenshots that aren't already present (by count/position),
// so a rate-limited run can be resumed without deleting what's already up.
async function screenshotsSync() {
  const cur = await request("GET", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/`);
  const have = (cur.body.previews || []).length;
  console.log(`  ${have} preview(s) already present; uploading the rest.`);
  for (let i = have; i < SHOTS.length; i++) await uploadShot(SHOTS[i], i);
}

// Upload a custom listing icon (128x128 PNG) via multipart PATCH.
async function icon() {
  const abs = path.join(ROOT, "icons", "icon128.png");
  if (!fs.existsSync(abs)) { console.warn("  missing icons/icon128.png"); return; }
  const { body, contentType } = multipart({}, "icon", abs);
  const res = await request("PATCH", `/api/v5/addons/addon/${encodeURIComponent(GUID)}/`, {
    raw: body, headers: { "Content-Type": contentType },
  });
  console.log("icon → HTTP", res.status);
  if (res.status >= 400) console.log(JSON.stringify(res.body, null, 2));
  else console.log("  icon_url:", res.body.icon_url);
}

const cmd = process.argv[2] || "get";
({ get, describe, screenshots, "screenshots-sync": screenshotsSync, icon }[cmd] || get)().catch((e) => { console.error(e); process.exit(1); });
