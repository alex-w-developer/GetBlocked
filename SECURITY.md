# Security Policy

GetBlocked! is a privacy-focused browser extension. Security and privacy reports are welcome.

## Reporting Security Or Privacy Issues

Use GitHub to send security or privacy findings privately to the maintainers. Include sanitized examples and the affected extension version. [Report a vulnerability](https://github.com/alex-w-developer/GetBlocked/security/advisories/new)

Helpful report details include:

- A clear description of the issue.
- Steps to reproduce.
- Affected files or extension behavior.
- Whether browsing data, local storage, permissions, or rule behavior are involved.
- Suggested fixes, if you have them.

## Local-Only Requirement

GetBlocked! should remain local-only.

- Browsing data should never be uploaded.
- External analytics should not be added.
- Telemetry should not be added.
- Remote logging should not be added.
- Remote scripts, fonts, or assets should not be added.

Experimental Decoy Mode does not change this extension-owned local-only requirement. It has no backend and creates no tracker traffic, but it intentionally allows the page's existing catalog-matched tracker requests to reach their remote destinations after supported identifier/profile replacement. Those destinations can still observe IP address and network metadata. Privacy reports should distinguish extension-owned network activity from page-owned traffic modified by Decoy Mode.

## Decoy Mode Safety Boundary

- Only exact domains and subdomains generated from `shared/tracker-catalog.json` may be targeted.
- The fake profile must remain in `chrome.storage.session` and must not contain user-derived data.
- Request wrappers must not create, replay, duplicate, or schedule network events.
- Event names/types and transactional fields such as purchases, conversions, orders, products, prices, amounts, currencies, and ad clicks must not be fabricated or rewritten.
- The popup must continue warning that allowed tracker requests can reveal IP/network metadata.

## Permission Expansion

Permission expansion is security-sensitive. Any PR that changes `manifest.json` permissions should explain:

- Why the permission is required.
- Why a narrower permission is not enough.
- How the permission affects user privacy.
- How the change was tested.

Do not add powerful or debug-only permissions unless there is a clear, reviewed, production-safe reason.
