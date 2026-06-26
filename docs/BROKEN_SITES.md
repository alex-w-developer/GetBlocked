# Broken Site Reports

GetBlocked! tries to keep blocking conservative, but any tracker ruleset can occasionally break a website. Broken-site reports help keep the extension useful and low-breakage.

## What To Include

Please include:

- Site URL or domain.
- What broke.
- Browser and Chrome version.
- Whether disabling GetBlocked! fixes it.
- Which tracker category might be responsible, if known.
- Steps to reproduce.
- Screenshots or video if useful.
- Suggested fix, if you have one.
- Regression test idea, if possible.

Avoid sharing private account pages, tokens, personal data, or sensitive URLs.

## How To Investigate

Helpful checks:

1. Disable GetBlocked! and reload the page.
2. Re-enable GetBlocked! and reload the page.
3. Open Chrome DevTools Network panel.
4. Look for blocked third-party tracker domains near the broken feature.
5. Note the category if the domain is in `shared/tracker-catalog.json`.

## Possible Fixes

Possible fixes include:

- Narrow a rule.
- Reclassify a domain.
- Remove a high-breakage domain.
- Add a safe exception only if justified.

Exceptions should be rare and well explained. If a domain is used for login, payments, captcha, core media delivery, or site-critical CDN behavior, it may not belong in the blocker catalog.

## Good Broken-Site PRs

A good PR includes:

- The affected domain or tracker.
- A short explanation of the breakage.
- A conservative fix.
- A fixture or test update when possible.
- A note about what you tested manually.
