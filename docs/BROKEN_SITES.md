# Broken Site Reports

GetBlocked! tries to keep blocking conservative, but any tracker ruleset can occasionally break a website. Broken-site reports help keep the extension useful and low-breakage.

## What To Include

Please include:

- Site URL or domain.
- What broke.
- Browser and OS version.
- Whether disabling GetBlocked! fixes it.
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

If you are not sure which domain caused the breakage:

1. Open `chrome://extensions` → GetBlocked! → **Service Worker**.
2. Check the console output for blocked request details.
3. Or disable GetBlocked! → reload → re-enable one rule at a time to isolate the culprit.

## Common Breakage Patterns

| Pattern | Example | Likely Fix |
|---|---|---|
| Form submission blocked | Payment or signup form hangs on submit | Move domain from blocker to exception list if it is a login/payment dependency |
| Video player fails | Embedded video shows error or black screen | Narrow rule to specific path instead of entire domain |
| Login redirect loop | SSO provider keeps redirecting back to login page | Reclassify domain as `Essential / login` or remove from catalog |
| Image gallery broken | Product images or lightbox does not load | Remove or narrow the CDN-like domain |
| Captcha fails | "Are you a human?" check never completes | Remove the captcha provider domain from the blocker catalog |

## Possible Fixes

Once you have identified the culprit, possible fixes include:

- **Narrow a rule** → Restrict blocking to a specific subdomain or path instead of the entire domain.
- **Reclassify a domain** → Move a domain from a blocking category to an exception list if it serves a non-tracking function (e.g., login, payments).
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

You do not need to file a report if:

- **GetBlocked! is working as designed** — blocked tracker domains may still appear in the Network panel; that is expected.
- **A known tracker domain is blocked** — check `shared/tracker-catalog.json` first.
- **The site works after reloading** — some breakage is transient and not caused by the extension.
