# Decoy Mode (Experimental)

Decoy Mode is an optional experiment for replacing supported analytics identifiers instead of blocking every catalog-matched tracker request. It is off by default.

## What Changes When It Is On

The popup toggle saves `getblockedDecoyMode` in `chrome.storage.local`. The background service worker then uses `chrome.declarativeNetRequest.updateStaticRules()` to:

- Disable static rule `1`, the third-party tracker-domain blocking rule.
- Keep static rule `1000`, the top-level tracking-parameter cleanup rule, enabled.

Document-start scripts run in all matching web frames. `decoy-interceptor.js` runs in the page's `MAIN` world so it can wrap page-owned `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon`. `decoy-bridge.js` stays in the extension's isolated world and relays configuration and local counters to the service worker. Before page scripts run, the two worlds establish a one-time transferred `MessageChannel`; profile data and counters do not use a public, reusable window-message channel.

Only exact domains and subdomains in `shared/tracker-catalog.json` are eligible. Decoy Mode does not broaden the tracker catalog.

## The Fake Session Profile

The service worker creates one profile and stores it in `chrome.storage.session`. The same values are reused across tabs and frames while the browser/extension session remains active. Chrome clears the profile when the browser restarts or the extension is reloaded, disabled, or updated.

Supported replacements include common forms of:

- Anonymous, client, user, visitor, customer, profile, device, and session IDs.
- Email address.
- First, last, full, display, and user names.
- Phone number.

The generated email uses the reserved `.invalid` domain, and the phone number uses a North American fictional `555-01xx` range. The profile contains no user-derived personal data.

## Supported Request Formats

Decoy Mode can replace supported fields in:

- URL query strings.
- JSON string bodies.
- URL-encoded string bodies and `URLSearchParams`.
- `FormData` string fields.
- Textual `Request` bodies that can be cloned safely by the `fetch` wrapper.

Binary, locked, already-consumed, unsupported, and streaming bodies pass through unchanged. Image pixels, script tags, iframes, CSS resources, HTML form navigation, WebSockets, WebTransport, and browser- or library-internal traffic that bypasses the wrapped APIs are not rewritten. A very early request may also run before the asynchronous session configuration reaches the main-world wrapper.

The popup increments **Decoyed on this page** only when at least one supported query or body field was replaced. Intercepted requests with no supported fields are not counted.

## Transaction Safety

Decoy Mode does not create, replay, duplicate, or schedule requests. It does not change event names or types, and it does not rewrite transaction/order IDs, products, items, prices, amounts, quantities, currencies, revenue, purchase/conversion markers, or ad-click fields.

An existing page may still send a real transactional event to a tracker because the blocking rule is off. Decoy Mode changes only supported identifier/profile fields inside that already-existing request; it never turns another event into a purchase, conversion, or click.

## Privacy Limits

Decoy Mode is not anonymity. A tracker request that reaches a remote service can still expose or enable inference from:

- IP address and network/TLS metadata.
- Request timing, headers, cookies, and server-issued identifiers.
- Browser and device fingerprinting signals.
- Account state or identifiers outside the supported fields/formats.
- Transaction details that Decoy Mode intentionally does not alter.

Normal blocking mode provides the stronger default for preventing catalog-matched third-party tracker requests. Turn Decoy Mode off in the popup to restore the existing blocking rule immediately.

## Local Data And Network Behavior

The preference, per-tab counters, and fake session profile stay in extension storage. GetBlocked! has no analytics, telemetry, remote logging, or extension-owned backend. Decoy Mode never sends its own synthetic events; it only modifies eligible page-initiated requests before the page sends them to tracker destinations it already chose.

## Verification

Run:

```bash
npm run check
npm run test:browser
```

`npm run check` includes focused transformation assertions that verify profile consistency, catalog scoping, identifier replacement, and preservation of purchase/conversion/transaction fields. The browser test loads the unpacked extension when a compatible Chrome installation is available.
