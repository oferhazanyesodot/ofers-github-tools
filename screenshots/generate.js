/**
 * Generate realistic Chrome Web Store screenshots by rendering the real popup
 * and options UI with fully simulated data (no real PRs/repos), across themes.
 *
 * Drives the locally-installed Chrome via puppeteer-core so it can wait for the
 * async UI (PR list, Copilot card) to finish rendering before capturing.
 *
 * Usage: node screenshots/generate.js
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
const STAGE = path.join(__dirname, "stage");

// A tiny static server — modules can't load over file:// (CORS), so serve the
// staged tree over http://localhost for the capture.
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
function startServer(rootDir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(rootDir, urlPath);
    if (!filePath.startsWith(rootDir)) { res.writeHead(403); return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function findBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("No Chrome/Edge found for headless screenshots.");
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  copyDir(path.join(ROOT, "src"), path.join(STAGE, "src"));
  copyDir(path.join(ROOT, "demo"), path.join(STAGE, "demo"));

  // Options host: inject demo chrome stub before options.js.
  const optionsHtml = fs.readFileSync(path.join(STAGE, "src/options/options.html"), "utf8");
  fs.writeFileSync(
    path.join(STAGE, "src/options/options-screenshot.html"),
    optionsHtml.replace(
      '<script src="options.js" type="module">',
      '<script src="options-demo.js"></script>\n  <script src="options.js" type="module">'
    )
  );
  fs.copyFileSync(path.join(__dirname, "options-demo.js"), path.join(STAGE, "src/options/options-demo.js"));

  // Popup host: inject demo stub + deterministic entry (static imports).
  const popupHtml = fs.readFileSync(path.join(STAGE, "src/popup/popup.html"), "utf8");
  fs.writeFileSync(
    path.join(STAGE, "src/popup/popup-screenshot.html"),
    popupHtml.replace(
      '<script src="popup.js" type="module">',
      '<script src="popup-demo.js"></script>\n  <script src="popup-screenshot-entry.js" type="module">'
    )
  );
  fs.copyFileSync(path.join(STAGE, "demo/popup-demo.js"), path.join(STAGE, "src/popup/popup-demo.js"));
  fs.copyFileSync(path.join(__dirname, "popup-screenshot-entry.js"), path.join(STAGE, "src/popup/popup-screenshot-entry.js"));
}



const shots = [
  { file: "src/popup/popup-screenshot.html", q: "demo=1&theme=dark", out: "popup-dark.png", w: 412, h: 760, waitFor: ".pr-item", selector: "body" },
  { file: "src/popup/popup-screenshot.html", q: "demo=1&theme=light", out: "popup-light.png", w: 412, h: 760, waitFor: ".pr-item", selector: "body" },
  { file: "src/popup/popup-screenshot.html", q: "demo=1&theme=hello-kitty", out: "popup-kitty.png", w: 412, h: 760, waitFor: ".pr-item", selector: "body" },
  { file: "src/options/options-screenshot.html", q: "theme=dark", out: "options-dark.png", w: 1120, h: 940, waitFor: ".card", selector: null },
  { file: "src/options/options-screenshot.html", q: "theme=light", out: "options-light.png", w: 1120, h: 940, waitFor: ".card", selector: null },
];

(async () => {
  stage();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const server = await startServer(STAGE);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: "new",
    args: ["--hide-scrollbars", "--force-color-profile=srgb"],
  });

  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 2 });
    console.log(`Rendering ${s.out} ...`);
    await page.goto(`${base}/${s.file}?${s.q}`, { waitUntil: "networkidle0", timeout: 30000 });
    try {
      await page.waitForSelector(s.waitFor, { timeout: 8000 });
    } catch {
      console.warn(`  (warning: '${s.waitFor}' not found for ${s.out})`);
    }
    // Small settle for canvas/sparkline paint.
    await new Promise((r) => setTimeout(r, 400));

    const outFile = path.join(OUT, s.out);
    if (s.selector) {
      const el = await page.$(s.selector);
      await el.screenshot({ path: outFile });
    } else {
      await page.screenshot({ path: outFile });
    }
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(`\nRaw screenshots written to ${path.relative(ROOT, OUT)}`);
  console.log("Next: node screenshots/compose.js");
})();
