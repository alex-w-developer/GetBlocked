# Broken Site Reports

GetBlocked! tries to keep blocking conservative, but any tracker ruleset can occasionally break a website. Broken-site reports help keep the extension useful and low-breakage.

## What To Include

Please include:

- Site URL or domain.
- What broke.
- Browser and OS version.
- Whether disabling GetBlocked! fixes it.
- Whether Decoy Mode was off or on when the problem occurred.
- Which tracker category might be responsible, if known.
- Steps to reproduce.
- Screenshots or video if useful.
- Suggested fix, if you have one.
- Regression test idea, if possible.

Avoid sharing private account pages, tokens, personal data, or sensitive URLs.

## Example Report

A good broken-site report looks like this:

> **Site**: `example-checkout.com`
> **What broke**: The payment form submit button does nothing after clicking. No JS console errors.
> **Browser**: Chrome 125 on Windows 11
> **Disabling GetBlocked! fixes it**: Yes — the form submits immediately when the extension is off.
> **Steps to reproduce**: 1. Go to example-checkout.com/cart. 2. Fill in shipping details. 3. Click "Place Order." 4. Nothing happens.
> **Suspected category**: Session replay — the site uses a heatmapping script that also handles form events.
> **Suggested fix**: Remove or narrow the `heatmap-tracker.net` domain if it is not a core analytics dependency, or reclassify it as a soft dependency.

A bad report is vague:

> ~~"Checkout broken on example-checkout.com. Plz fix."~~

The more detail you provide, the faster a maintainer can reproduce and verify the fix.

## How To Investigate

Helpful checks:

1. Disable GetBlocked! and reload the page. Confirm the feature works again.
2. Re-enable GetBlocked! and reload the page. Confirm the feature breaks again.
3. Open Chrome DevTools (**F12**) → **Network** tab.
4. Filter by `blocked` or look for red-highlighted requests (`net::ERR_BLOCKED_BY_CLIENT`).
5. Note blocked domains near the broken feature (e.g., a form submission depends on a blocked analytics script).
6. Check if the domain is in `shared/tracker-catalog.json` and note its category.

If Decoy Mode was on, repeat once with it off. Normal mode can break a page by blocking a catalog domain; Decoy Mode can expose a different compatibility problem if a tracker library rejects a replaced identifier or unsupported request bodies pass through unchanged. Include both results, but never test with a real purchase or conversion merely to exercise Decoy Mode.

Keep the page's Network panel open, enable **Preserve log**, and repeat the failing action. Compare the affected host, resource type, initiator and redirect URL with the relevant entry in the tracker catalog or optional community list. Chrome can show `ERR_BLOCKED_BY_CLIENT` for other extensions as well. Repeat in a clean profile with only GetBlocked! enabled to identify which extension is responsible.

## Common Breakage Patterns

| Pattern | Example | Likely Fix |
|---|---|---|
| Form submission blocked | Payment or signup form hangs on submit | Remove the login/payment hostname from the catalog or narrow the entry to its tracking subdomain |
| Video player fails | Embedded video shows error or black screen | Narrow rule to specific path instead of entire domain |
| Login redirect loop | SSO provider keeps redirecting back to login page | Remove the essential hostname or narrow the blocking entry |
| Image gallery broken | Product images or lightbox does not load | Remove or narrow the CDN-like domain |
| Captcha fails | "Are you a human?" check never completes | Remove the captcha provider domain from the blocker catalog |
| Analytics library errors only in Decoy Mode | Tracker rejects a replaced test identifier | Record the request format and narrow the supported field mapping without changing event or transaction fields |

## Possible Fixes

Once you have identified the culprit, possible fixes include:

- **Narrow a rule** → Restrict blocking to a specific subdomain or path instead of the entire domain.
- **Review the catalog entry** → All tracker categories feed the same blocking rule. Remove or narrow an entry when it includes an essential dependency.
- **Remove a high-breakage domain** → If a domain breaks common site functionality and has no clear replacement, remove it from the blocker catalog entirely.
- **Add a safe exception** → Only if narrowly justified and well explained.

Exceptions should be rare and well explained. If a domain is used for login, payments, captcha, core media delivery, or site-critical CDN behavior, it may not belong in the blocker catalog.

## Good Broken-Site PRs

A good PR includes:

- The affected domain or tracker.
- A short explanation of the breakage.
- A conservative fix.
- A fixture or test update when possible (see `test/tracker-test-set.json`).
- A note about what you tested manually and in which browser.

A good PR description:

> **Domain**: `heatmap-tracker.net`
> **Breakage**: Login button on `app.example.com` does nothing when clicked.
> **Fix**: Removed `heatmap-tracker.net` from the blocker catalog. The domain is used by a third-party auth SDK that the site relies on for login.
> **Manual testing**: Loaded `app.example.com` with the extension enabled before and after the change. Login works after the fix. No visible tracking regressions on the homepage.

## When Not To File A Broken-Site Report

Seeing a known tracker request in DevTools while Decoy Mode is on is expected. The experimental mode allows catalog-matched requests through where normal mode blocks them; the popup counter only indicates requests whose supported fields were changed. Those requests can still expose IP and network metadata.

You do not need to file a report if:

- **GetBlocked! is working as designed** — blocked tracker domains may still appear in the Network panel; that is expected.
- **A known tracker domain is blocked** — check `shared/tracker-catalog.json` first.
- **The site works after reloading** — some breakage is transient and not caused by the extension.
