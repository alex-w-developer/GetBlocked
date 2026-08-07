# Development Guide

This guide explains how GetBlocked! is structured and how to work on it locally.

## Local Setup

Install Node.js, then clone or open the project folder.

There are no runtime npm dependencies. The npm scripts use Node.js built-ins.

## Load The Unpacked Extension In Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select the GetBlocked! project folder.
5. Click Reload after changing extension files.

## Project Structure

- `manifest.json`: Chrome MV3 manifest.
- `background.js`: background service worker for page report state, Decoy Mode state/profile, rule switching, and URL-cleaning counts.
- `content-script.js`: scans pages locally for visible tracking signals.
- `decoy-bridge.js`: isolated-world document-start bridge for Decoy Mode configuration and counters.
- `decoy-interceptor.js`: main-world wrappers for eligible tracker `fetch`, XHR, and beacon calls.
- `popup/`: popup HTML, CSS, and JS.
- `shared/tracker-catalog.json`: maintained source of truth for tracker domains.
- `shared/tracking-params.json`: maintained source of truth for tracking URL parameters.
- `shared/config.js`: generated config for content script/category detection.
- `shared/decoy-transform.js`: reusable, locally tested request-field transformation helpers.
- `rules/rules.json`: generated Chrome DNR rules.
- `scripts/generate-rules.mjs`: catalog-to-rules generator.
- `scripts/evaluate-test-set.mjs`: local ruleset fixture test.
- `scripts/test-decoy.mjs`: Decoy Mode transformation and transaction-safety assertions.
- `test/tracker-test-set.json`: local tracker fixture set.

## Useful Commands

```bash
npm run check
npm run generate:rules
npm run test:evidence
npm run test:decoy
npm run test:browser
node --check background.js
node --check content-script.js
node --check decoy-bridge.js
node --check decoy-interceptor.js
node --check popup/popup.js
node --check scripts/generate-rules.mjs
node --check scripts/evaluate-test-set.mjs
node --check scripts/test-decoy.mjs
node --check scripts/browser-test.mjs
```

`npm run check` is the complete non-browser validation used by CI. The optional browser harness remains separate because compatible extension support is not available in every headless environment.

## Browser Test

`npm run test:browser` (`scripts/browser-test.mjs`) is an automated end-to-end check
that runs in a compatible Chromium-based browser with the unpacked extension loaded.

### What it does

1. Starts a minimal local HTTP server (Node `node:http`) on `localhost:8765` serving
   the project directory.
2. Launches Chrome with `--load-extension=<project-root>` and
   `--remote-debugging-port=9333` so the Chrome DevTools Protocol (CDP) is accessible.
3. Navigates to `test/manual-test.html` with tracking URL parameters:
   ```
   http://localhost:8765/test/manual-test.html?utm_source=test&utm_medium=browser&fbclid=abc123&gclid=xyz789
   ```
4. Waits for the extension's content script to fire at `document_idle`.
5. Connects directly to the GetBlocked! service worker and asserts via CDP:
   - **URL param strip**: `utm_source`, `utm_medium`, `fbclid`, and `gclid` are absent
     from the final `location.href` (stripped by the DNR redirect / queryTransform rules).
   - **Background report**: the service worker returns `{ ok: true, report: { localOnly: true, ... } }`
     with nonzero total page activity (tracker elements + tracking links + params removed).
   - **Rule switching**: Decoy Mode disables rule `1` without disabling URL-cleanup rule `1000`.
   - **Session profile**: repeated configuration reads return the same fake profile.
   - **Interception**: the manual fixture's fetch, XHR, and beacon identifiers are replaced and counted.
   - **Restoration**: the test turns Decoy Mode off and restores normal blocking before cleanup.
   - **No runtime exceptions**: no uncaught errors captured via `Runtime.exceptionThrown`.
6. Exits with code 0 on success, 1 on failure.
7. Cleans up: kills Chrome, removes the temp profile directory, closes the file server.

### No extra dependencies

The harness uses only Node.js built-ins (`node:http`, `node:net`, `node:child_process`,
`node:fs`, `node:crypto`, `node:os`). It speaks the WebSocket wire protocol directly
without any npm package.

### Environment variable overrides

| Variable | Default | Purpose |
|---|---|---|
| `CHROME_PATH` | auto-detected | Path to a compatible Chromium-family executable |
| `TEST_PORT` | `8765` | Local static file server port |
| `DEBUG_PORT` | `9333` | Chrome CDP remote debugging port |

### Headless caveat

The harness uses `--headless=new` and `--load-extension`. Some branded browser
builds ignore unpacked-extension flags in automation. The script prefers compatible
local builds, supports an explicit `CHROME_PATH`, and prints `SKIP` with exit code 0
when the browser cannot load the extension.

## How The Tracker Catalog Generates DNR Rules

`shared/tracker-catalog.json` contains tracker domains, categories, labels, and notes.

`npm run generate:rules` reads the catalog and generates:

- `rules/rules.json`: domain-based `declarativeNetRequest` rules.
- `shared/config.js`: category mappings used by the content script and popup.
- The same generated domain list scopes Decoy Mode, so request interception never expands beyond the maintained catalog.

Rules stay limited to `domainType: "thirdParty"` to reduce website breakage.

## How The Popup Works

The popup requests a local report from the background service worker. It shows:

- Blocked on this page
- Decoyed on this page
- Tracking links cleaned
- Visible tracking attempts detected
- Detected categories

It does not show a privacy score.

The popup also owns the **Decoy Mode (Experimental)** toggle. It asks the service worker to update the static-rule state before the saved setting changes, then refreshes the report. When the mode is on, the footer warns that tracker requests may still reveal IP and network metadata.

## How Content-Script Detection Works

`content-script.js` scans the current page for:

- Links/forms with tracking URL parameters.
- Images, iframes, scripts, and related elements pointing at known tracker domains.
- Visible tracking-looking elements.

The scan runs once at `document_idle`, stays local in the browser, and sends category/count signals to the background service worker. It intentionally avoids a long-lived DOM observer so reloading an unpacked extension does not leave stale callbacks in already-open tabs.

## How Decoy Mode Works

Decoy Mode is off by default. Its saved preference uses `chrome.storage.local`; its generated fake profile uses `chrome.storage.session`, which gives the service worker one coherent profile across tabs without persisting it beyond the browser/extension session.

Two document-start content-script declarations are used:

1. `shared/config.js`, `shared/decoy-transform.js`, and `decoy-interceptor.js` run in the page's `MAIN` world. This is required to wrap the page's own `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon` APIs.
2. `decoy-bridge.js` runs in the default isolated world. It can use extension messaging and relays the saved setting, session profile, and decoy-count messages across a one-time `MessageChannel` port transferred before page scripts run. The main-world interceptor ignores later connection attempts, which prevents ordinary page code from spoofing configuration or count messages over a fixed public channel.

Both declarations run in matching web frames. The interceptor checks every destination against the generated `TRACKER_DOMAINS` list before inspecting it. It never creates a request. See [Decoy Mode](DECOY_MODE.md) for supported fields, body formats, transaction safety, and privacy limits.

## MV3 And DNR Notes

GetBlocked! uses Manifest V3 and `declarativeNetRequest`.

The generated static ruleset intentionally keeps two stable rule IDs. `BLOCK_RULE_ID` (`1`) blocks catalog domains in normal mode. `CLEAN_URL_RULE_ID` (`1000`) removes tracking parameters from top-level navigation. `updateStaticRules()` disables only rule `1` in Decoy Mode and explicitly leaves rule `1000` enabled. The service worker reapplies the saved state on install/update and browser startup because static-rule overrides do not survive extension updates.

Avoid:

- Debug-only DNR feedback permissions.
- `webRequestBlocking`.
- Broad regex blocking rules.
- Broad platform-domain blocking.

Prefer domain-based DNR rules in generated `requestDomains`.

## Local-Only Privacy Rule

Do not add:

- External analytics
- Telemetry
- Remote logging
- Server calls
- Remote scripts, fonts, or assets

Report data should stay local in `chrome.storage.local`.

Decoy Mode is the narrow exception to the project's source-code guard against page network API wrappers. Only `decoy-interceptor.js` may reference `fetch`, `XMLHttpRequest`, or `sendBeacon`, and only to modify page-initiated requests to catalog domains. It must not initiate analytics traffic, fabricate events, or add extension-owned endpoints. The fake profile stays in `chrome.storage.session`.

## Verify No Unsafe Permissions Were Added

Check `manifest.json`. Current production permissions are:

- `declarativeNetRequest`
- `storage`
- `webNavigation`

Host permissions are limited to web pages so the extension can apply DNR rules and run the content script.

## Troubleshooting Extension Context Invalidation

When an unpacked extension is reloaded from `chrome://extensions`, content scripts that were injected into already-open tabs belong to the old extension context. Chrome can retain an `Extension context invalidated` entry in the extension Errors panel even after the source file has been fixed or updated.

After reloading GetBlocked! during development:

1. Clear existing entries in the extension Errors panel.
2. Refresh tabs that were open before the extension reload.
3. Reproduce the behavior and check whether a new error is created.

The GetBlocked! content script guards runtime messaging and stops its scanner when it detects an invalidated context. Previously recorded errors do not disappear automatically and may display the current source file beside an older saved line number.
