# Privacy Policy — Ofer's GitHub Tools

**Last updated:** August 2026

## Summary

This extension does not sell or share personal data with third parties. It processes GitHub account and pull request data locally to provide its features.

## What data is accessed

- The extension fetches `https://github.com/pulls` using your existing browser session to read your open pull request list.
- The extension fetches `https://github.com/settings/copilot` using your existing browser session to read your Copilot AI credit usage.
- Requests are sent only to `github.com` and use your existing GitHub session.
- No analytics, telemetry, or tracking of any kind exists in this extension.

## What data is stored

- **Locally only:** Sync status, PR list, Copilot usage data, and daily usage history are stored in `chrome.storage.local`.
- **Synced settings:** Extension settings are stored in `chrome.storage.sync` and may be synchronized through your Google account when Chrome Sync is enabled.
- **Bookmarks:** PR titles and URLs are written to a local bookmark folder. These sync only if you have Chrome bookmark sync enabled (controlled by your Chrome settings, not this extension).

## What data is NOT collected

- No personal information is sold or shared with third parties
- No browsing history
- The extension reads GitHub session cookies through Chrome's cookies API when authenticated write requests are needed. Cookie values are used only to make requests to `github.com`, are not stored by the extension, and are not sent to third parties.
- No analytics or usage metrics
- No data is transmitted to any third-party server

## Network requests

The extension makes two requests per sync cycle (default every 5 minutes):

1. `https://github.com/pulls?q=...` — fetches your open PR list
2. `https://github.com/settings/copilot` — fetches your Copilot usage stats (if tracking is enabled)

No other network requests are made. No external services are contacted.

## Permissions explained

| Permission | Purpose |
|---|---|
| `bookmarks` | Manage the PR bookmark folder |
| `alarms` | Schedule periodic sync |
| `storage` | Store sync status, PR list, usage data, and settings locally |
| `offscreen` | Parse HTML (fallback only) |
| `notifications` | Desktop alerts for new PRs and usage thresholds (optional) |
| `cookies` | Read GitHub session cookies for authenticated requests to `github.com`; values are not stored |
| `https://github.com/*` | Fetch PR list and Copilot settings pages |

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/oferhazanyesodot/ofers-github-tools).
