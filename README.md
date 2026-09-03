# Ofer's GitHub Tools

A Chrome extension that bundles personal GitHub productivity tools into one lightweight package — all powered by your existing GitHub session. No OAuth, no tokens, no backend.

## Features

### PR Review Tools

Tools that inject directly into GitHub's PR review interface.

- **Toggle All Viewed** — click the progress circle next to "X / Y viewed" to mark all files as viewed (or clear all). Clicks each checkbox sequentially with progress feedback.
- **Revert File** — in the 3-dot menu on any file in the diff, a "Revert file" option restores it to the base branch version with a single click. Creates a commit automatically on the PR branch.
- **Reset to Commit** — a small ↩ icon next to every commit SHA in the PR timeline. Click it to get a ready-to-paste `gh` CLI command that resets the branch to that commit.

### PR Bookmark Folder

Automatically maintains a bookmark folder with your open Pull Requests.

- **Automatic sync** every N minutes (configurable, default 5)
- **Draft indicator** — `[DRAFT]` prefix on draft PRs
- **Hide drafts** — optionally hide draft PRs from the popup list
- **Group by repo** — optional subfolders per repository
- **Desktop notifications** for new PRs
- **Stale PR detection** — moves untouched PRs to "Old PRs" subfolder
- **Configurable query** — presets for "My PRs", "Review Requested", "Assigned", "Mentions"
- **Custom folder name**
- **Keyboard shortcut** — `Alt+Shift+P` to sync instantly

### Copilot Usage Tracker

Monitors your GitHub Copilot AI credit consumption with projections.

- **Usage bar** — visual progress of credits used this cycle
- **Burn-rate projection** — calculates if you'll run out before reset based on your work schedule
- **Sparkline chart** — daily usage trend over the billing cycle
- **Badge color shift** — extension badge turns yellow/red when usage is concerning
- **Threshold alerts** — desktop notification when usage exceeds configured percentage
- **Configurable work days** — set 1-7 days/week for accurate projections
- **Collapsible card** — hide/show in popup, state persisted

### General

- **PR list in popup** — click to open, copy URL, relative timestamps
- **Badge count** — number of open PRs on the extension icon
- **Light/dark mode** — follows system theme
- **Import/export settings** — share config as JSON
- **Graceful failure** — never destroys bookmarks on errors

## How It Works

The extension uses your existing GitHub browser session cookies. No API tokens or OAuth registrations needed.

- **PR sync**: Fetches `github.com/pulls?q=...` with `Accept: application/json` to get structured PR data
- **Copilot tracking**: Fetches `github.com/settings/copilot/features` and parses the "Usage this cycle" counter from the HTML
- **Revert file**: Loads the GitHub edit page to extract a CSRF token, fetches the file from the base branch, and submits the edit form — same as manually editing via the GitHub web UI
- **Reset to commit**: Generates the `gh api` command for force-pushing a branch to a specific SHA

**If you can see your PRs at github.com/pulls and your Copilot usage at github.com/settings/copilot/features, this extension works.**

## Installation

### Chrome

1. Clone or download this repository
2. Generate icons (requires Node.js): `node scripts/create-icons.js`
3. Open `chrome://extensions/`
4. Enable "Developer mode" (top-right toggle)
5. Click "Load unpacked" and select the extension root directory
6. Ensure you are logged in to GitHub in Chrome

### Build (Chrome + Firefox, one package)

Build the universal upload package from the repository root:

```sh
node scripts/build.js
```

This produces a single `dist/ofers-github-tools-<version>.zip` that you upload to **both** the Chrome Web Store and Firefox AMO. One manifest serves both browsers: it declares both `background.service_worker` (Chrome) and `background.scripts` (Firefox), plus `browser_specific_settings.gecko` for Firefox. Each browser reads the fields it supports and ignores the rest (works in Chrome 121+ and Firefox 121+). The HTML-parsing fallback feature-detects `DOMParser` vs the Chrome offscreen document at runtime, so no browser-specific code is needed.

The script copies only extension runtime files, validates the manifest version and description length, and places `manifest.json` at the ZIP root.

Before submitting, provide the public URL for [PRIVACY.md](PRIVACY.md) in each store's privacy section. The listing must disclose the `bookmarks`, `cookies`, `offscreen`, `storage`, and `notifications` permissions, and explain that GitHub session cookies are used only for requests to `github.com`.

### Demo preview

The tracked `demo/` folder contains local-only preview fixtures and a GitHub-style composition page. Open `demo/demo-frame.html` in a browser to preview the popup with sample data. Demo files are excluded from the upload package.

### Load unpacked for testing

- **Chrome:** `chrome://extensions` → Developer mode → "Load unpacked" → select the repo root.
- **Firefox:** `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → select `manifest.json`.

## Privacy

- **No data leaves your browser.** Everything is processed locally.
- **No external servers** contacted (only github.com).
- **No telemetry** collected.
- **No credentials stored.** Relies on Chrome's existing session.
- **Bookmarks are local.** They sync only if you have Chrome bookmark sync enabled.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Permissions

| Permission | Why |
|---|---|
| `bookmarks` | Create and manage the PR bookmark folder |
| `alarms` | Schedule periodic sync |
| `storage` | Store sync status, PR list, usage data, and settings |
| `offscreen` | Offscreen document for HTML fallback parsing |
| `notifications` | Desktop alerts for new PRs and usage thresholds |
| `cookies` | Read GitHub session cookies for authenticated API calls (revert file) |
| `https://github.com/*` | Fetch PR listing, Copilot settings, and file edit pages |

No `identity`, `tabs`, or `scripting` permissions requested.

## File Structure

```
├── manifest.json                 Extension manifest (MV3)
├── src/
│   ├── background/
│   │   ├── index.js              Service worker entry and message routing
│   │   ├── alarm.js              Alarm scheduling
│   │   ├── sync.js               PR sync orchestration
│   │   ├── copilot-sync.js       Copilot persistence and projection
│   │   ├── notifications.js      PR and Copilot notifications
│   │   ├── badge.js              Badge state updates
│   │   ├── github-transport.js   Authenticated GitHub requests
│   │   └── revert-file.js        Web-based file revert service
│   ├── content/
│   │   ├── shared.js             Shared dialogs, banners, and page helpers
│   │   ├── viewed-toggle.js      Toggle all files viewed/unviewed
│   │   ├── revert-file.js        Revert file menu injection
│   │   └── reset-commit.js      Reset branch to commit button
│   ├── fetcher/
│   │   ├── index.js              PR fetch strategies (JSON + HTML fallback)
│   │   └── parser.js            JSON payload parser
│   ├── copilot/
│   │   ├── fetcher.js            Copilot usage page scraper
│   │   └── projection.js        Burn-rate calculation and projections
│   ├── bookmarks/
│   │   └── index.js              Bookmark folder sync engine
│   ├── shared/
│   │   ├── constants.js          Shared constants
│   │   ├── settings.js           Settings management
│   │   └── status.js            Sync status persistence
│   ├── offscreen/
│   │   ├── offscreen.html        Offscreen document shell
│   │   └── offscreen.js         DOM-based HTML parser (fallback)
│   ├── popup/
│   │   ├── popup.html            Extension popup
│   │   ├── popup.css             Popup styles (light/dark)
│   │   ├── popup.js              Popup orchestration
│   │   ├── dom.js                Popup DOM bindings
│   │   ├── status.js             Sync status and footer
│   │   ├── pr-list.js            Pull request list
│   │   ├── copilot.js            Copilot usage display
│   │   └── format.js              Display and SVG helpers
│   └── options/
│       ├── options.html           Settings page
│       ├── options.css            Settings styles
│       ├── options.js             Settings orchestration
│       ├── dom.js                 Settings DOM bindings
│       ├── form.js                Form state and validation
│       ├── import-export.js        Settings import/export
│       └── toast.js               Toast notifications
├── scripts/
│   ├── create-icons.js           Icon generation
│   └── build.js                  Universal build (Chrome + Firefox, one zip)
├── screenshots/                  Store screenshot generation (dev-only)
├── PRIVACY.md                    Privacy policy
└── README.md
```

## Attribution

Inspired by [PR Live Folder](https://github.com/shiruten/pr-live-folder) by shiruten. The PR bookmark sync concept and incremental folder update pattern originated there. Everything else — session-cookie auth, Copilot tracking, PR review tools, popup UI, settings — was built from scratch.

## License

MIT
