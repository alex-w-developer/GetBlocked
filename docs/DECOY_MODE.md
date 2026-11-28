# Decoy Mode (Experimental)

Decoy Mode is an optional experiment for replacing supported analytics identifiers instead of blocking every catalog-matched tracker request. It is off by default.

## What Changes When It Is On

Decoy Mode applies to **all websites**, including other open tabs and newly
visited sites. Turning it on in one site's popup pauses catalog tracker blocking
everywhere. The popup explains this before you
enable it and keeps the global warning visible while it is on.

The setting survives popup closure, browser restart, and extension updates. Turn
it off from any site's popup to restore catalog blocking on protected websites. Reload
pages after changing modes to repeat requests made under the previous mode.
URL cleanup remains enabled on protected sites in both modes.

The separate **Site protection** switch pauses URL cleanup and Decoy replacements for that exact top-level hostname, including its embedded frames. Reload open tabs on that host after changing the switch. Its parent and child hostnames keep their own settings. The community domain list remains independent.

The popup toggle saves `getblockedDecoyMode` in `chrome.storage.local`. The background service worker then uses `chrome.declarativeNetRequest.updateStaticRules()` to:

- Disable static rule `1`, the third-party tracker-domain blocking rule.
- Keep static rule `1000`, the top-level tracking-parameter cleanup rule, enabled.

Document-start scripts run in all matching web frames. `decoy-interceptor.js` runs in the page's `MAIN` world so it can wrap page-owned `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon`. `decoy-bridge.js` stays in the extension's isolated world and relays configuration and local counters to the service worker. Before page scripts run, the two worlds establish a one-time transferred `MessageChannel`; profile data and counters do not use a public, reusable window-message channel.

Only third-party requests to exact domains and subdomains in `shared/tracker-catalog.json` are eligible, matching the scope of the blocking rule that Decoy Mode disables. Decoy Mode does not broaden the tracker catalog or alter first-party requests when a user visits a catalog domain directly.

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

### Static Request Transformation Examples

The examples below illustrate how Decoy Mode transforms supported fields in existing, catalog-matched third-party tracker requests. They are **static examples only**: no requests are executed or sent.

For illustration, assume a page on `https://example.com` makes an existing request to the catalog-matched endpoint `https://api.segment.io/v1/track`.

The illustrative fake session profile contains:

```json
{
  "userId": "user_demo_42",
  "sessionId": "session_demo_42",
  "email": "casey.reed@example.invalid"
}
```

These profile values are illustrative, not actual generated values. The email uses the reserved `.invalid` domain. Decoy Mode uses its own generated session profile in practice.

#### JSON Body

Content-Type: `application/json`

**Before replacement:**

```json
{
  "event": "page_view",
  "user_id": "original-user-123",
  "session_id": "original-session-456",
  "properties": {
    "email": "person@example.com",
    "product": "demo-product",
    "quantity": 2,
    "amount": 19.95,
    "currency": "USD"
  }
}
```

**After replacement:**

```json
{
  "event": "page_view",
  "user_id": "user_demo_42",
  "session_id": "session_demo_42",
  "properties": {
    "email": "casey.reed@example.invalid",
    "product": "demo-product",
    "quantity": 2,
    "amount": 19.95,
    "currency": "USD"
  }
}
```

Only supported identifier and profile fields change. The event name, product, quantity, amount, and currency remain unchanged.

#### URL-Encoded Body

Content-Type: `application/x-www-form-urlencoded`

**Before replacement:**

```text
event=page_view&user_id=original-user-123&session_id=original-session-456&product=demo-product&quantity=2&amount=19.95&currency=USD
```

**After replacement:**

```text
event=page_view&user_id=user_demo_42&session_id=session_demo_42&product=demo-product&quantity=2&amount=19.95&currency=USD
```

The `user_id` and `session_id` fields are replaced using the same illustrative fake session profile. All other fields retain their original values.

#### Unsupported Binary Body

Binary request bodies are not transformed.

**Before replacement:**

```text
Body type: ArrayBuffer
Bytes (hexadecimal): 00 01 02 FF
```

**After replacement:**

```text
Body type: ArrayBuffer
Bytes (hexadecimal): 00 01 02 FF
```

The original binary body passes through unchanged, even if the request targets a catalog-matched tracker.

#### Configuration and Privacy Limitations

Transformations only apply after Decoy Mode is enabled and its asynchronous session configuration has reached the main-world interceptor. Requests made before configuration is ready may pass through without replacement.

Replacing supported identifiers does **not** conceal IP addresses, network or TLS metadata, request timing, headers, cookies, or other fingerprinting signals. Decoy Mode is not an anonymity mechanism.

These examples do not initiate network activity, create synthetic events, or modify transaction-related information.

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
