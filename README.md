# GitHub PR Bookmark Folder

A Chrome extension (Manifest V3) that automatically maintains a bookmark folder containing your open GitHub Pull Requests.

**No OAuth. No API tokens. No GitHub Apps. No backend. No admin approval required.**

## How It Works

This extension uses your existing GitHub browser session to fetch the PR listing page with `Accept: application/json`, which causes GitHub to return structured JSON data directly. It creates and maintains a **"GitHub PRs"** bookmark folder in your Bookmarks Bar.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3 Service Worker)       │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │  Alarm   │───▶│  Fetch   │───▶│ JSON Parser   │  │
│  │ (5 min)  │    │ (cookie) │    │ (payload)     │  │
│  └──────────┘    └──────────┘    └──────┬───────┘  │
│                                          │          │
│                                          ▼          │
│                                  ┌──────────────┐   │
│                                  │  Bookmark    │   │
│                                  │  Sync Engine │   │
│                                  └──────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Workflow

1. A Chrome alarm fires every 5 minutes
2. The service worker fetches `https://github.com/pulls?q=...author:@me` with `Accept: application/json`
3. The request includes credentials (your existing GitHub session cookie via host permission)
4. GitHub returns a JSON payload containing `pullsDashboardSurfaceContentRoute.results`
5. PR titles, repos, permalinks are extracted from the results array
6. The bookmark folder is incrementally updated (add/remove/reorder)

If the JSON approach fails, the extension falls back to fetching HTML and parsing embedded `<script>` data via an offscreen document.

### Data Source

The extension fetches this URL:
```
https://github.com/pulls?q=is%3Apr+state%3Aopen+archived%3Afalse+sort%3Aupdated-desc+author%3A%40me
```

With `Accept: application/json`, GitHub returns the same data that powers its React UI. No separate API endpoint is used.

## Installation

1. Clone or download this repository
2. Generate icons (requires Node.js): `node scripts/create-icons.js`
3. Open `chrome://extensions/` in Chrome
4. Enable "Developer mode" (top-right toggle)
5. Click "Load unpacked"
6. Select the extension root directory
7. Ensure you are logged in to GitHub in Chrome

The extension will immediately sync your open PRs into a "GitHub PRs" bookmark folder.

## Bookmark Folder Layout

```
GitHub PRs/
├── [DRAFT] repo-name - WIP feature branch
├── repo-name - Fix login bug
├── another-repo - Add unit tests
└── my-project - Update documentation
```

With **Group by Repo** enabled:
```
GitHub PRs/
├── repo-name/
│   ├── [DRAFT] WIP feature branch
│   └── Fix login bug
├── another-repo/
│   └── Add unit tests
└── Old PRs/
    └── my-project - Stale feature
```

Bookmarks are ordered by most recently updated (matching GitHub's sort order).

## Features

- **Automatic sync** — PRs sync every N minutes (configurable, default 5)
- **Draft indicator** — `[DRAFT]` prefix on draft PRs
- **Group by repo** — optional subfolders per repository
- **Desktop notifications** — alerts when new PRs appear (e.g., review requests)
- **Stale PR detection** — PRs untouched for X days move to an "Old PRs" subfolder
- **PR list in popup** — click to open, copy URL button, relative timestamps
- **Keyboard shortcut** — `Alt+Shift+P` to trigger sync instantly
- **Configurable query** — presets for "My PRs", "Review Requested", "Assigned", "Mentions"
- **Custom folder name** — name the bookmark folder whatever you want
- **Import/export settings** — share config as JSON
- **Badge count** — number of open PRs shown on the extension icon
- **Light/dark mode** — popup and settings page follow your system theme
- **Graceful failure** — never destroys bookmarks on errors

## Why OAuth Is Intentionally Avoided

Many GitHub organizations restrict OAuth Apps and GitHub Apps:

- They require **administrator approval** before users can authorize them
- Security teams may block third-party OAuth applications entirely
- Some organizations have blanket policies denying all new OAuth integrations
- Personal Access Tokens may be restricted by organization SAML/SSO policies

This extension **requires zero administrator approval** because:

- It never registers as a GitHub OAuth App
- It never requests API access tokens
- It never sends Authorization headers
- It only uses the session cookie Chrome already has from your normal GitHub login
- It only reads a page you can already visit manually

**If you can see your PRs at github.com/pulls, this extension works.**

## Privacy Considerations

- **No data leaves your browser.** Everything is processed locally.
- **No external servers** are contacted (only github.com).
- **No telemetry** is collected.
- **No credentials are stored.** The extension relies on Chrome's existing session.
- **No `cookies` permission** is requested. The `credentials: "include"` fetch option uses the session naturally.
- **Bookmarks are local.** They sync only if you have Chrome bookmark sync enabled (your choice).

## Permissions Explained

| Permission | Why |
|---|---|
| `bookmarks` | Create and manage the PR bookmark folder |
| `alarms` | Schedule periodic sync |
| `storage` | Store sync status, PR list, and settings |
| `offscreen` | Create offscreen document for HTML fallback parsing |
| `notifications` | Desktop alerts for new PRs (optional, can be disabled) |
| `https://github.com/*` | Fetch the PR listing page with session cookies |

No other permissions are requested. Specifically:
- No `identity` (no OAuth)
- No `tabs` (no tab access)
- No `scripting` (no content script injection)
- No `cookies` (no cookie reading)

## Known Limitations

1. **Requires active GitHub session** — You must be logged in to GitHub in Chrome. If you log out, syncing pauses gracefully.

2. **HTML parsing fragility** — If GitHub stops returning JSON for the `Accept: application/json` header, the extension falls back to HTML parsing via an offscreen document. The parser is isolated for easy updates.

3. **Rate limiting** — Fetching a page every 5 minutes is very conservative, but GitHub could theoretically rate-limit aggressive use. The extension makes exactly one request per sync cycle.

4. **No real-time updates** — Changes appear within your configured interval (default 5 min). Use "Sync Now" or `Alt+Shift+P` for immediate updates.

5. **Service Worker lifecycle** — Chrome may suspend the service worker between alarms. The alarm API ensures it wakes up reliably.

6. **Private repositories** — Works with private repos as long as your session has access to them (which it does if you can see them on github.com).

## Error Handling

The extension handles failures gracefully:

- **Not logged in**: Detected and reported in popup. No bookmarks modified.
- **Network errors**: Logged and skipped. Bookmarks preserved.
- **Unexpected HTML**: Parser returns empty list, existing bookmarks kept.
- **GitHub unavailable**: Treated as transient error. Retries on next alarm.

**Bookmarks are never destroyed due to temporary failures.**

## Files

```
├── manifest.json                 Extension manifest (MV3, ES modules)
├── icons/                        Extension icons (generated)
├── src/
│   ├── background/
│   │   ├── index.js              Service worker entry — lifecycle + message routing
│   │   ├── alarm.js              Alarm scheduling
│   │   └── sync.js              Sync orchestration (fetch → bookmarks → badge)
│   ├── fetcher/
│   │   ├── index.js              Fetch strategies (JSON primary, HTML fallback)
│   │   └── parser.js            JSON payload extraction logic
│   ├── bookmarks/
│   │   └── index.js              Bookmark folder sync engine
│   ├── shared/
│   │   ├── constants.js          Shared constants
│   │   ├── settings.js           User settings (read/write chrome.storage.sync)
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
│       ├── options.css            Settings styles (light/dark)
│       └── options.js            Settings logic
├── scripts/
│   ├── create-icons.js           Icon generation (dev tool)
│   └── create-store-assets.js   Store asset generation (dev tool)
├── PRIVACY.md                    Privacy policy
└── README.md
```

## Attribution & Inspiration

This extension is inspired by [PR Live Folder](https://github.com/shiruten/pr-live-folder) by shiruten.

### What was reused/inspired

| Aspect | Source | Notes |
|---|---|---|
| Core concept | PR Live Folder | Bookmark folder containing PRs |
| Folder sync strategy | PR Live Folder | Incremental update pattern (add/remove/reorder) |
| Bookmark deduplication | PR Live Folder | Search-by-title to avoid duplicate folders |
| Folder naming convention | PR Live Folder | `repo - title` format |
| Alarm-based scheduling | PR Live Folder | Periodic background sync |

### What was completely rewritten

| Component | Reason |
|---|---|
| Authentication layer | Replaced OAuth/API tokens with session-cookie fetch |
| Data retrieval | Replaced GitHub REST API with JSON page payload (`Accept: application/json`) |
| JSON parser | New; extracts PRs from `pullsDashboardSurfaceContentRoute.results` |
| HTML fallback parser | New; parses embedded JSON from script tags via offscreen document |
| Manifest permissions | Reduced to minimum (no identity, no cookies) |
| Service worker structure | Rewritten for Manifest V3 patterns |
| Popup UI | New design with PR list, copy URLs, relative timestamps, dark mode |
| Options page | Full settings: query presets, display options, import/export |
| Notifications | Desktop alerts for new PRs |
| Keyboard shortcut | Alt+Shift+P to sync |
| Error handling | New; designed for fetch/parse failure modes |

### Why scraping was chosen over OAuth

1. **Zero admin approval** — OAuth Apps require organization administrator review
2. **No token management** — No storage of sensitive credentials
3. **No registration** — No GitHub App or OAuth App to register and maintain
4. **Simpler architecture** — No token refresh, no scopes, no redirect URIs
5. **Works everywhere** — Functions in any organization regardless of OAuth policies
6. **Privacy** — No data shared with any third party; no external server

The extension requests the same URL a user visits in their browser, but with `Accept: application/json` to receive structured data directly from GitHub's server-side rendering pipeline. This avoids both the GitHub REST/GraphQL API and fragile HTML scraping.

## License

This project is inspired by [PR Live Folder](https://github.com/shiruten/pr-live-folder) which is licensed under the MIT License. Original copyright notices are preserved where applicable.

MIT License — See PR Live Folder for original attribution.
