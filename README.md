<p align="center">
  <img src="assets/getblocked-logo.png" alt="GetBlocked! logo" width="760">
</p>

# GetBlocked!

**Cleaner pages. Fewer trackers. Local-only.**

GetBlocked! is a lightweight, local-only Chrome extension that helps reduce common third-party website tracking by blocking known tracker requests, cleaning tracking links, and explaining tracking attempts. An optional experimental Decoy Mode can instead let known tracker requests through while replacing supported analytics identifiers with one consistent fake browser-session profile.

It is built as a small, inspectable Manifest V3 project for people who want a friendly privacy tool and for contributors who want quick, useful pull requests.

## What GetBlocked! Does

- Blocks a curated starter list of known third-party tracker domains using Chrome `declarativeNetRequest`.
- Cleans common tracking URL parameters such as `utm_source`, `fbclid`, `gclid`, `dclid`, `mc_cid`, and similar campaign IDs.
- Detects visible tracking attempts such as pixels, suspicious scripts, tracking iframes, and tracking links.
- Shows a compact popup report with:
  - Blocked on this page
  - Decoyed on this page
  - Tracking links cleaned
  - Visible tracking attempts detected
  - Detected categories
- Keeps report data local in `chrome.storage.local`.
- Saves the Decoy Mode preference locally and keeps the generated fake profile only in `chrome.storage.session`.

## What GetBlocked! Can Block

GetBlocked! blocks a curated starter list of known third-party tracker domains and tracking URL parameters.

Current coverage includes:

- Analytics trackers
- Ad and retargeting trackers
- Social media pixels
- Session replay and heatmap tools
- Affiliate and attribution trackers
- Email marketing trackers
- Tracking URL parameters

The tracker list is intentionally conservative. Rules are limited to third-party requests to reduce website breakage.

When experimental Decoy Mode is on, the main tracker-blocking rule is disabled, but tracking-parameter cleanup remains enabled. Page-level `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon` calls to domains in the same catalog are intercepted where feasible.

## What GetBlocked! Cannot Do

- It does not block every tracker.
- It does not make users anonymous.
- It does not stop tracking after logging into an account.
- It does not stop server-side tracking.
- It does not fully prevent advanced fingerprinting.
- It is not meant to replace full-featured ad blockers.
- Decoy Mode cannot hide an IP address, TLS/network metadata, browser fingerprint, or identifiers added outside the supported request formats.
- Decoy Mode cannot rewrite image pixels, scripts, forms, WebSockets, or requests that begin before its session configuration is available.

## Experimental Decoy Mode

Decoy Mode is off by default. Use the clearly labeled **Experimental** toggle in the popup to enable it.

While enabled:

- Static rule `1`, the catalog-based third-party tracker blocker, is disabled.
- Static rule `1000`, tracking-parameter cleanup for top-level navigation, stays enabled.
- Known tracker requests made with `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon` are inspected in the page's main JavaScript world.
- Common analytics identifiers and profile fields, including anonymous, client, user, device, and session IDs plus supported email/name/phone fields, are replaced when their request format is supported.
- One coherent fake profile is reused across tabs for the current browser/extension session. It is discarded when Chrome restarts or the extension is reloaded, disabled, or updated.
- A request counts as decoyed only when at least one supported field is actually replaced.

Decoy Mode does not create requests and never changes event names, event types, order or transaction IDs, products, prices, amounts, currencies, conversions, purchases, or ad-click fields. Existing transactional events are not invented or reclassified. Because tracker requests are allowed to reach their destinations, those services may still observe the user's IP address and other network metadata. See [Decoy Mode details](docs/DECOY_MODE.md).

## How GetBlocked! Is Different

GetBlocked! is:

- Lightweight: small ruleset, simple popup, minimal moving parts.
- Local-only: no external analytics, telemetry, or remote logging.
- Open source: the rules, popup, and generation scripts are inspectable.
- Educational: categories and wording are designed to explain common tracking clearly.
- Beginner-friendly: small PRs can improve the tracker catalog, docs, tests, or UI.
- Not a replacement for full ad blockers: it focuses on common trackers and clear explanations.

## Why All Data Stays Local

GetBlocked! does not send browsing data to any server. The extension uses:

- `declarativeNetRequest` for local Chrome-managed request blocking.
- `chrome.storage.local` for page report data.
- `chrome.storage.session` for the in-memory Decoy Mode fake profile.
- A content script that scans the current page locally for visible tracking signals.

There are no extension-owned analytics, telemetry endpoints, remote logs, or bundled remote assets. In Decoy Mode, the page's existing tracker requests are intentionally allowed through with supported identifiers replaced; GetBlocked! does not initiate additional tracker requests.

## Install Locally In Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Choose Load unpacked.
5. Select the GetBlocked! project folder.
6. Pin GetBlocked! and open the popup on normal web pages.

The production build avoids debug-only DNR feedback permissions. The popup uses local page signals plus Chrome's production DNR action-count badge as a page-level estimate. In normal mode, blocking and URL cleanup are enforced by MV3 `declarativeNetRequest`; in Decoy Mode, only the blocking rule is disabled.

## Contribute In 10 Minutes

The easiest way to contribute is to add one tracker domain.

1. Edit [shared/tracker-catalog.json](shared/tracker-catalog.json).
2. Add one fixture in [test/tracker-test-set.json](test/tracker-test-set.json).
3. Run `npm run generate:rules`.
4. Run `npm run test:evidence`.
5. Open a PR.

PRs are welcome for tracker-domain additions, broken-site tests, UI polish, docs, and test improvements. You do not need to ask before opening a small, focused PR.

## How The Tracker Catalog Works

Tracker domains are maintained in [shared/tracker-catalog.json](shared/tracker-catalog.json).

Each tracker entry includes:

- `domain`
- `category`
- `label`
- `notes`

Tracking URL parameters are maintained in [shared/tracking-params.json](shared/tracking-params.json).

After changing the catalog or tracking parameter list, regenerate the derived extension files:

```bash
npm run generate:rules
```

This updates:

- [rules/rules.json](rules/rules.json), used by Chrome `declarativeNetRequest`.
- [shared/config.js](shared/config.js), used by page detection and to scope Decoy Mode to the tracker catalog.

Do not edit generated rules/config by hand unless you also update the generator or source catalog.

## Run Tests

Run the same local validation layers that CI uses:

```bash
npm run check
```

This regenerates rules, runs the evidence fixture, checks JavaScript syntax,
parses JSON data files, verifies generated files are in sync, and runs the
privacy/safety guardrails.

Useful individual checks:

```bash
npm run generate:rules
npm run test:evidence
npm run test:decoy
npm run check:syntax
npm run check:json
npm run check:generated
npm run check:safety
```

Run the automated browser test with a compatible Chromium-family browser:

```bash
npm run test:browser
```

This launches Chrome with the unpacked extension loaded, navigates to
`test/manual-test.html` with common tracking URL parameters, and verifies:

- Tracking parameters (`utm_source`, `fbclid`, `gclid`, …) are removed from the
  final page URL by the extension's `declarativeNetRequest` redirect rules.
- The extension background service worker returns a report with nonzero page
  activity detected by the content script.
- Decoy Mode disables only the blocking rule, reuses one session profile,
  preserves URL cleanup, counts modified requests, and restores normal mode.
- No unexpected runtime exceptions are thrown by the extension.

No npm packages are required. The test uses only Node.js built-ins and Chrome's
remote debugging protocol (CDP). Some branded browser builds ignore
`--load-extension`; if no compatible browser is found or the unpacked extension
does not load, the test exits with code 0 and prints a skip notice.

Override defaults with environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `CHROME_PATH` | auto-detected | Path to a compatible Chromium-family executable |
| `TEST_PORT` | `8765` | Local static file server port |
| `DEBUG_PORT` | `9333` | Chrome CDP remote debugging port |

## Manual Browser Check

After loading the unpacked extension, start a simple local server from this folder:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/test/manual-test.html?utm_source=demo&utm_medium=test&fbclid=manual
```

With GetBlocked! enabled and Decoy Mode off, the tracking parameters should be removed from the page URL and known third-party tracker requests should be blocked. The popup should show page-level tracker activity.

Then turn on **Decoy Mode (Experimental)** in the popup and reload the fixture. URL cleanup should continue, supported identifiers in the fixture's `fetch`, XHR, and beacon calls should be replaced, and **Decoyed on this page** should increase. The tracker requests themselves may still fail because the example endpoints reject test/CORS traffic; the counter records the local replacement attempt. Turn Decoy Mode off again to restore normal blocking.

## Contributor Links

- [Contributing guide](CONTRIBUTING.md)
- [Adding trackers](docs/ADDING_TRACKERS.md)
- [Broken sites](docs/BROKEN_SITES.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Decoy Mode](docs/DECOY_MODE.md)
- [Good first issues](docs/GOOD_FIRST_ISSUES.md)
- [Labels guide](docs/LABELS.md)
- [Launch copy](docs/LAUNCH_COPY.md)
- [Security policy](SECURITY.md)

## License

MIT License. See [LICENSE](LICENSE).
