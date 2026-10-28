# Lasso — Privacy Policy (draft for the Chrome Web Store)

_Last updated: 2026-10-26. Replace the contact line before publishing._

**Lasso does not collect, transmit or sell your data.**

- **Page content** is read only when you invoke Lasso on a page (the toolbar icon, or an origin you enabled). It is processed entirely inside your browser and is never sent anywhere. Lasso makes no network requests.
- **Stored on your device** (`chrome.storage.local`): a small per-site profile (site name, first/last visit time, visit count, last pattern kind) and, from Milestone B, the extraction recipes you save. You can clear them at any time by removing the extension or its data.
- **No accounts, no analytics, no advertising, no third-party code.**
- **Permissions:** required `activeTab`, `scripting`, `sidePanel`, `storage`, and host access to `http://*/*` and `https://*/*`. Chrome warns at install that Lasso can read and change data on websites. The engine is injected only when you open Lasso and start Inspect, and page content is never transmitted. You can restrict or revoke site access at any time in Chrome’s extension settings, and clear the local visit history from the Page view (“Clear all site history”).
- If a future optional feature uses the network (for example a bring-your-own-key assistant), it will be off by default, require its own permission, and this policy will be updated first.

Contact: <your-email-or-issue-tracker-url>
