# Privacy Policy — Ofer's GitHub Tools

**Last updated:** August 2026

## Summary

This extension does not collect, store, transmit, or share any personal data with third parties.

## What data is accessed

- The extension fetches `https://github.com/pulls` using your existing browser session to read your open pull request list.
- The extension fetches `https://github.com/settings/copilot` using your existing browser session to read your Copilot AI credit usage.
- No data is sent anywhere other than to `github.com`.
- No analytics, telemetry, or tracking of any kind exists in this extension.

## What data is stored

- **Locally only:** Sync status, PR list, Copilot usage data, daily usage history (for the sparkline chart), and settings are stored in `chrome.storage.local` and `chrome.storage.sync`. This never leaves your device (unless you have Chrome sync enabled for extension storage).
- **Bookmarks:** PR titles and URLs are written to a local bookmark folder. These sync only if you have Chrome bookmark sync enabled (controlled by your Chrome settings, not this extension).

## What data is NOT collected

- No personal information
- No browsing history
- No cookies or session tokens (the extension uses Chrome's built-in credential handling)
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
| `https://github.com/*` | Fetch PR list and Copilot settings pages |

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/oferhazanyesodot/ofers-github-tools).
