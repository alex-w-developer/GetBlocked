# GetBlocked! Glossary

This glossary explains common extension and tracking terms used in GetBlocked! and its contributor documentation.

## Manifest V3

**Manifest V3 (MV3)** is the current Chrome extension platform used by GetBlocked!. The extension's `manifest.json` declares that it uses MV3, which defines how the extension is structured, what APIs it can use, and what permissions it needs.

In GetBlocked!, MV3 includes Chrome's `declarativeNetRequest` API for request rules and an extension service worker for background work.

**Example:** A browser extension with a `manifest.json` containing `"manifest_version": 3` is using Manifest V3.

## DNR

**DNR** stands for **Declarative Net Request**. Chrome's `declarativeNetRequest` API lets an extension describe rules for how matching network requests should be handled, such as blocking or redirecting them. Instead of inspecting every request in extension code, the extension provides rules that Chrome applies.

GetBlocked! uses DNR to block cataloged tracker domains in normal mode and to remove selected tracking parameters from top-level navigation.

**Example:** A rule can describe that a request such as:

`https://tracker.example/pixel.test`

should be blocked when it matches the extension's tracker rules.

GetBlocked! intentionally avoids the debug-only DNR feedback permission used for exact rule-match reporting.

## Tracker catalog

The **tracker catalog** is GetBlocked!'s curated list of domains known to be associated with common tracking activity.

The source catalog is stored in `shared/tracker-catalog.json`. Each entry includes a domain, category, label, and notes. The catalog is intentionally conservative to reduce website breakage.

**Example:** A catalog entry for `analytics.example` could identify it as an analytics tracker without storing any personal information.

The catalog is the source used to generate the extension's DNR rules and related configuration.

## Third-party request

A **third-party request** is a network request that is third-party relative to the web page or frame that initiated it.

Third-party does **not** simply mean "a different hostname." Chrome determines first-party versus third-party using the relationship between the request and the originating frame's domain. Related subdomains can therefore still belong to the same first-party site.

**Example:** If a page at:

`https://shop.example/checkout.test`

loads a resource from:

`https://cdn.example/assets.test`

the different subdomain does not automatically make that request third-party.

By contrast, a request from the same page to:

`https://tracker.test/pixel.example`

can be third-party because it belongs to a different site.

GetBlocked!'s normal blocking rules are deliberately scoped to known third-party tracker requests to reduce the risk of breaking normal site functionality.

## Tracking pixel

A **tracking pixel** is a small resource request used to record that a page, message, or other content was viewed or interacted with. Despite the name, it does not have to be literally a visible one-pixel image.

GetBlocked! can detect some visible tracking attempts, including pixels, based on resources that the current page exposes to its local content script.

**Example:** A page might reference:

`https://tracker.example/pixel.test`

to send a view signal when the page loads.

Detecting a possible tracking pixel is not the same as proving that a tracker received or processed the request.

## URL parameter

A **URL parameter** is information included in the query string of a URL after the `?`. Websites use parameters for many purposes, including navigation, search, application state, and campaign tracking.

GetBlocked! removes selected known tracking parameters while preserving generic parameters such as `ref` when they may be used for legitimate navigation.

**Example:**

`https://shop.example/page.test?utm_source=newsletter&ref=invite`

Here, `utm_source=newsletter` is a tracking parameter that GetBlocked! can remove, while `ref=invite` can be preserved.

No personal data is needed for these examples.

## Estimated tracker resources on this page

The popup's **Estimated tracker resources on this page** value is a local estimate of unique known-tracker resource URLs detected on the current page.

It is an estimate of tracker resources targeted by GetBlocked!'s blocking rules. It is **not** a Chrome-confirmed count of network requests that matched a DNR rule or were actually blocked.

For example, if the page exposes two unique resource URLs belonging to known tracker domains, the popup may show an estimate of `2`.

This count is intentionally limited by what GetBlocked! can observe locally and by the domains in its tracker catalog. It does not mean that every detected resource was successfully contacted, matched, or blocked.

In Decoy Mode, the popup uses **Reported Decoy replacements** instead. That estimate comes from page-world wrappers reporting a changed field. Pages can influence the count, and high-volume reports are limited. URL-cleaning activity is reported separately.

## Further reading

- [Chrome Manifest V3 documentation](https://developer.chrome.com/docs/extensions/develop/migrate/)
- [Chrome `declarativeNetRequest` API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [GetBlocked! Development Guide](DEVELOPMENT.md)
- [GetBlocked! README](../README.md)
