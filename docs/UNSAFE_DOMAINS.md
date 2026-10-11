# Optional Community Domain List

The **Community domain list** switch in the popup enables an additional, local blocklist. It is off by default. When enabled, it blocks visits and requests to listed domains and their subdomains on all websites, including first-party requests and top-level navigation.

These are community reports, not independently verified phishing or malware determinations. The list may contain false positives or outdated reports, and it is not comprehensive protection against dangerous websites. If it blocks a legitimate site, turn this switch off. It is a bundled snapshot; the extension does not download updates or send domains or browsing data to a service.

The list is independent of the tracker catalog. Decoy Mode changes only tracker blocking and does not disable the community list or make its domains eligible for identifier replacement. The popup's tracker estimates and Decoy counters do not count community-list blocks.

## Where The List Came From

The initial 67 unique domains come from [Dev2023-Op's `rules/unsafe.json`](https://github.com/Dev2023-Op/GetBlocked/blob/769ef46d5a26358b274a7844879837e3d8ff835f/rules/unsafe.json), at commit `769ef46d5a26358b274a7844879837e3d8ff835f`. One duplicate `doga-mori.info` entry was removed. That fork's rule file was not registered in the manifest, so merely adding it did not activate blocking.

The original file provided no per-domain evidence, classification sources, or report dates. Its domains are therefore described as unverified community reports and remain opt-in. Attribution and the source snapshot are recorded in [shared/unsafe-domains.json](../shared/unsafe-domains.json).

## Which File To Edit

For this list, edit the `domains` array in **[shared/unsafe-domains.json](../shared/unsafe-domains.json)**. Use lowercase hostnames, such as `reported.example.test`, without a scheme, path, port, or wildcard. Entries also cover subdomains, so do not add a broad shared hosting service such as `vercel.app` when the report concerns only one tenant.

For ordinary analytics and tracking endpoints, continue using [shared/tracker-catalog.json](../shared/tracker-catalog.json) and the [tracker contribution guide](ADDING_TRACKERS.md). Unsafe-domain reports must not be added to the tracker catalog just to get them blocked: that would also expand Decoy Mode's request-rewriting scope.

Run `npm run generate:rules` after editing the list. [scripts/generate-rules.mjs](../scripts/generate-rules.mjs) validates it and generates [rules/unsafe.json](../rules/unsafe.json). Do not edit the generated rule file or add hostnames directly to the background or content scripts. The manifest registers the separate `getblocked_unsafe_domains` ruleset as disabled by default. Rule `2000` has higher priority than URL cleanup so a listed navigation is blocked immediately, even when its URL has tracking parameters.

Review and stage generated files before running `npm run check`, whose generated-file check compares against the Git index. Also run `npm run test:browser -- --required` with Chrome for Testing when changing blocking behavior. The browser fixture maps listed test hostnames to its local server; it does not visit those domains on the internet.

## Preference And Contributions

The switch takes effect immediately for new requests, and the choice is stored locally. Chrome persists enabled rulesets across browser sessions but resets them on extension updates; the service worker reapplies the saved preference on startup and install/update. The popup reads the actual enabled rulesets. A failed rule change does not save a new preference, and a failed storage write restores the previous rule state.

For new reports, include a public evidence source, the report date, the exact affected hostname, and any known legitimate use or false-positive risk in the PR. Recheck old reports before retaining them. Never include private URLs, credentials, tokens, or personal data. Keep hosted tenant names narrow and avoid broad platforms, payment processors, login providers, captcha services, and core CDNs.
