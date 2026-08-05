# Privacy Policy — GitHub PR Bookmark Folder

**Last updated:** August 2026

## Summary

This extension does not collect, store, transmit, or share any personal data.

## What data is accessed

- The extension fetches `https://github.com/pulls` using your existing browser session to read your open pull request list.
- No data is sent anywhere other than to `github.com`.
- No analytics, telemetry, or tracking of any kind exists in this extension.

## What data is stored

- **Locally only:** The last sync status (success/error timestamp) is stored in `chrome.storage.local` for display in the popup. This never leaves your device.
- **Bookmarks:** PR titles and URLs are written to a local bookmark folder. These sync only if you have Chrome bookmark sync enabled (controlled by your Chrome settings, not this extension).

## What data is NOT collected

- No personal information
- No browsing history
- No cookies or session tokens (the extension uses Chrome's built-in credential handling)
- No analytics or usage metrics
- No data is transmitted to any third-party server

## Network requests

The extension makes exactly one request per sync cycle (every 5 minutes) to:

```
https://github.com/pulls?q=is:pr+state:open+archived:false+sort:updated-desc+author:@me
```

No other network requests are made. No external services are contacted.

## Permissions explained

| Permission | Purpose |
|---|---|
| `bookmarks` | Manage the PR bookmark folder |
| `alarms` | Schedule periodic sync |
| `storage` | Store sync status locally |
| `offscreen` | Parse HTML (fallback only) |
| `https://github.com/*` | Fetch your PR list page |

## Contact

For questions about this privacy policy, open an issue on the [GitHub repository](https://github.com/oferhazanyesodot/pr-live-folder).
