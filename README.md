<p align="center">
  <img src="assets/getblocked-logo.png" alt="GetBlocked! logo" width="760">
</p>

# GetBlocked!

**Cleaner pages. Fewer trackers. Local-only.**

GetBlocked! is a lightweight, local-only Chrome extension that helps reduce common third-party website tracking by blocking known tracker requests, cleaning tracking links, and explaining tracking attempts.

It is built as a small, inspectable Manifest V3 project for people who want a friendly privacy tool and for contributors who want quick, useful pull requests.

## What GetBlocked! Does

- Blocks a curated starter list of known third-party tracker domains using Chrome `declarativeNetRequest`.
- Cleans common tracking URL parameters such as `utm_source`, `fbclid`, `gclid`, `dclid`, `mc_cid`, and similar campaign IDs.
- Detects visible tracking attempts such as pixels, suspicious scripts, tracking iframes, and tracking links.
- Shows a compact popup report with:
  - Blocked on this page
  - Tracking links cleaned
  - Visible tracking attempts detected
  - Detected categories
- Keeps report data local in `chrome.storage.local`.

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

## What GetBlocked! Cannot Do

- It does not block every tracker.
- It does not make users anonymous.
- It does not stop tracking after logging into an account.
- It does not stop server-side tracking.
- It does not fully prevent advanced fingerprinting.
- It is not meant to replace full-featured ad blockers.

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
- A content script that scans the current page locally for visible tracking signals.

There are no external analytics, telemetry endpoints, remote logs, or bundled remote assets in the extension.

## Install Locally In Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Choose Load unpacked.
5. Select the GetBlocked! project folder.
6. Pin GetBlocked! and open the popup on normal web pages.

The production build avoids debug-only DNR feedback permissions. The popup uses local page signals plus Chrome's production DNR action-count badge as a page-level estimate, while blocking and URL-cleaning rules remain enforced by MV3 `declarativeNetRequest`.

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
- [shared/config.js](shared/config.js), used by the content script and popup category detection.

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
npm run check:syntax
npm run check:json
npm run check:generated
npm run check:safety
```

## Manual Browser Check

After loading the unpacked extension, start a simple local server from this folder:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/test/manual-test.html?utm_source=demo&utm_medium=test&fbclid=manual
```

With GetBlocked! enabled, the tracking parameters should be removed from the page URL and the popup should show page-level tracker activity. For a before/after check, compare the browser Network panel with the extension disabled and then enabled.

## Contributor Links

- [Contributing guide](CONTRIBUTING.md)
- [Adding trackers](docs/ADDING_TRACKERS.md)
- [Broken sites](docs/BROKEN_SITES.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Good first issues](docs/GOOD_FIRST_ISSUES.md)
- [Labels guide](docs/LABELS.md)
- [Launch copy](docs/LAUNCH_COPY.md)
- [Security policy](SECURITY.md)

## License

MIT License. See [LICENSE](LICENSE).
