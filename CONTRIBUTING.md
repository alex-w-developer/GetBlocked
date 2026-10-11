# Contributing To GetBlocked!

Thanks for helping improve GetBlocked! The project is intentionally small, local-only, and beginner-friendly. The best contributions are focused pull requests that are easy to review.

## Quick Start

1. Choose an [open good first issue](https://github.com/alex-w-developer/GetBlocked/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). Comment when you start so contributors can coordinate, then fork or clone the repository and create a focused branch.
2. Make a small focused change.
3. Run the relevant commands:

```bash
npm run check
```

4. Open a pull request referencing the issue, summarize what changed, and list the checks you actually ran. Draft PRs and questions about setup are welcome.

For tracker-domain PRs, start with [docs/ADDING_TRACKERS.md](docs/ADDING_TRACKERS.md).

For a separate list of reported unsafe domains, use [docs/UNSAFE_DOMAINS.md](docs/UNSAFE_DOMAINS.md). Edit `shared/unsafe-domains.json` and run `npm run generate:rules`; the generated `rules/unsafe.json` is registered in the manifest and controlled by the opt-in popup switch. Include evidence and report dates with new reports.

## Local Development

Load the extension locally:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select the GetBlocked! project folder.
5. Reload the extension after file changes.

Useful files:

- `manifest.json`: MV3 extension manifest.
- `rules/rules.json`: generated DNR rules.
- `shared/tracker-catalog.json`: source tracker catalog.
- `shared/config.js`: generated content-script config.
- `shared/decoy-transform.js`: request-field replacement helpers.
- `content-script.js`: visible tracking-signal detection.
- `decoy-bridge.js`: isolated-world Decoy Mode bridge.
- `decoy-interceptor.js`: experimental main-world request wrappers.
- `background.js`: local report, rule-mode, session-profile, and URL-cleaning state.
- `popup/`: popup UI.

## How To Run Tests

Regenerate derived files:

```bash
npm run generate:rules
```

Run the evidence fixture:

```bash
npm run test:evidence
```

Run the complete local check suite:

```bash
npm run check
```

For Decoy Mode work, also run `npm run test:browser` when a compatible local Chromium-family browser is available. See [docs/DECOY_MODE.md](docs/DECOY_MODE.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

For release preparation, use the [release checklist](docs/RELEASING.md).

## How To Add A Tracker Domain

The easiest first PR is adding one well-scoped tracker domain and one test fixture.

1. Edit `shared/tracker-catalog.json`.
2. Add a tracker entry with `domain`, `category`, `label`, and `notes`.
3. Add one fixture in `test/tracker-test-set.json`.
4. Run `npm run generate:rules`.
5. Run `npm run test:evidence`.
6. Confirm `rules/rules.json` and `shared/config.js` changed as expected.
7. Open a PR.

More detail: [docs/ADDING_TRACKERS.md](docs/ADDING_TRACKERS.md).

## How To Report Or Fix A Broken Site

For broken sites, include:

- Site URL or domain.
- What broke.
- Steps to reproduce.
- Chrome version and OS.
- Whether disabling GetBlocked! fixes it.
- Whether Decoy Mode was off or on.
- Suspected tracker category or domain, if known.
- Screenshot or video when useful.

Possible fixes include narrowing a rule, reclassifying a domain, removing a high-breakage domain, or adding a carefully justified safe exception.

More detail: [docs/BROKEN_SITES.md](docs/BROKEN_SITES.md).

## How To Open A Good PR

Good PRs are:

- Small and focused.
- Easy to reproduce or verify.
- Clear about privacy and breakage risk.
- Paired with a test fixture when changing the tracker catalog.
- Honest about limitations.

You do not need to ask before opening a small PR for tracker-domain additions, broken-site tests, docs, UI polish, or test improvements.

## PR Checklist

- [ ] I kept the change small and focused.
- [ ] I updated docs if behavior changed.
- [ ] I ran `npm run generate:rules` if the catalog or params changed.
- [ ] I ran `npm run test:evidence`.
- [ ] I ran `npm run check`.
- [ ] I ran relevant JSON/JS syntax checks.
- [ ] I did not add broad/high-breakage domains.
- [ ] I did not add exaggerated privacy claims.

## Safety Rules

- Do not add broad/high-breakage domains.
- Do not block broad platform domains like `google.com`, `facebook.com`, `youtube.com`, `amazon.com`, `github.com`, `microsoft.com`, `cloudflare.com`, `stripe.com`, `paypal.com`, etc.
- Do not block payment processors.
- Do not block login providers.
- Do not block captcha services.
- Do not block core CDNs.
- Do not add external analytics, telemetry, remote calls, or logging.
- Do not initiate, duplicate, replay, or fabricate tracker events. Decoy Mode may only modify eligible page-initiated requests to catalog domains.
- Do not rewrite purchase, conversion, transaction, revenue, product, currency, or ad-click fields.
- Do not reintroduce `declarativeNetRequestFeedback`.
- Do not reintroduce `webRequestBlocking`.
- Do not reintroduce privacy score.
- Do not add exaggerated privacy claims.
