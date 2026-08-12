# Ofer's GitHub Tools

A Chrome extension that bundles personal GitHub productivity tools into one lightweight package — all powered by your existing GitHub session. No OAuth, no tokens, no backend.

## Features

### PR Bookmark Folder

Automatically maintains a bookmark folder with your open Pull Requests.

- **Automatic sync** every N minutes (configurable, default 5)
- **Draft indicator** — `[DRAFT]` prefix on draft PRs
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

The extension uses your existing GitHub browser session cookies via `credentials: "include"` fetch requests. No API tokens or OAuth registrations needed.

- **PR sync**: Fetches `github.com/pulls?q=...` with `Accept: application/json` to get structured PR data
- **Copilot tracking**: Fetches `github.com/settings/copilot` and parses the usage counter from the HTML

**If you can see your PRs at github.com/pulls and your Copilot usage at github.com/settings/copilot, this extension works.**

## Installation

### Chrome

1. Clone or download this repository
2. Generate icons (requires Node.js): `node scripts/create-icons.js`
3. Open `chrome://extensions/`
4. Enable "Developer mode" (top-right toggle)
5. Click "Load unpacked" and select the extension root directory
6. Ensure you are logged in to GitHub in Chrome

### Firefox

1. Clone or download this repository
2. Generate icons: `node scripts/create-icons.js`
3. Build the Firefox version: `node scripts/build-firefox.js`
4. Open `about:debugging#/runtime/this-firefox`
5. Click "Load Temporary Add-on" and select `firefox/manifest.json`

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
| `https://github.com/*` | Fetch PR listing and Copilot settings pages |

No `identity`, `tabs`, `scripting`, or `cookies` permissions requested.

## File Structure

```
├── manifest.json                 Extension manifest (MV3)
├── src/
│   ├── background/
│   │   ├── index.js              Service worker entry
│   │   ├── alarm.js              Alarm scheduling
│   │   └── sync.js              Sync orchestration (PRs + Copilot)
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
│   │   └── popup.js             Popup logic
│   └── options/
│       ├── options.html           Settings page
│       ├── options.css            Settings styles
│       └── options.js            Settings logic
├── scripts/
│   ├── create-icons.js           Icon generation
│   ├── create-store-assets.js   Store asset generation
│   └── build-firefox.js         Firefox build script
├── PRIVACY.md                    Privacy policy
└── README.md
```

## Attribution

Inspired by [PR Live Folder](https://github.com/shiruten/pr-live-folder) by shiruten. The PR bookmark sync concept and incremental folder update pattern originated there. Everything else — session-cookie auth, Copilot tracking, popup UI, settings — was built from scratch.

## License

MIT
