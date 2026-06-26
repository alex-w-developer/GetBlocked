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
- `background.js`: background service worker for page report state and URL-cleaning counts.
- `content-script.js`: scans pages locally for visible tracking signals.
- `popup/`: popup HTML, CSS, and JS.
- `shared/tracker-catalog.json`: maintained source of truth for tracker domains.
- `shared/tracking-params.json`: maintained source of truth for tracking URL parameters.
- `shared/config.js`: generated config for content script/category detection.
- `rules/rules.json`: generated Chrome DNR rules.
- `scripts/generate-rules.mjs`: catalog-to-rules generator.
- `scripts/evaluate-test-set.mjs`: local ruleset fixture test.
- `test/tracker-test-set.json`: local tracker fixture set.

## Useful Commands

```bash
npm run generate:rules
npm run test:evidence
node --check background.js
node --check content-script.js
node --check popup/popup.js
node --check scripts/generate-rules.mjs
node --check scripts/evaluate-test-set.mjs
```

## How The Tracker Catalog Generates DNR Rules

`shared/tracker-catalog.json` contains tracker domains, categories, labels, and notes.

`npm run generate:rules` reads the catalog and generates:

- `rules/rules.json`: domain-based `declarativeNetRequest` rules.
- `shared/config.js`: category mappings used by the content script and popup.

Rules stay limited to `domainType: "thirdParty"` to reduce website breakage.

## How The Popup Works

The popup requests a local report from the background service worker. It shows:

- Blocked on this page
- Tracking links cleaned
- Visible tracking attempts detected
- Detected categories

It does not show a privacy score.

## How Content-Script Detection Works

`content-script.js` scans the current page for:

- Links/forms with tracking URL parameters.
- Images, iframes, scripts, and related elements pointing at known tracker domains.
- Visible tracking-looking elements.

The scan runs locally in the browser and sends category/count signals to the background service worker.

## MV3 And DNR Notes

GetBlocked! uses Manifest V3 and `declarativeNetRequest`.

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
