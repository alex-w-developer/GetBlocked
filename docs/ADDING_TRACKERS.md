# Adding Tracker Domains

The easiest first PR is adding one well-scoped tracker domain and one test fixture.

This page walks through the exact tracker-domain PR workflow.

For reported phishing, malware, or other unsafe domains, use the separate [community-list guide](UNSAFE_DOMAINS.md). Its source is `shared/unsafe-domains.json`; it is opt-in and independent of the tracker catalog and Decoy Mode.

## 1. Edit The Tracker Catalog

Open [shared/tracker-catalog.json](../shared/tracker-catalog.json).

Add one tracker entry with:

- `domain`
- `category`
- `label`
- `notes`

Allowed categories:

- `Analytics`
- `Ad tracking`
- `Social pixel`
- `Session replay`
- `Affiliate / attribution`
- `Email marketing`

Example tracker entry:

```json
{
  "domain": "tracker.example.com",
  "category": "Analytics",
  "label": "Example Analytics",
  "notes": "Product analytics collection endpoint"
}
```

Keep the domain narrow. Avoid broad platform domains, login providers, payment processors, captcha services, and core CDNs.

Chrome's [`requestDomains` matching](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#property-RuleCondition-requestDomains) includes all subdomains. If `example.com` is already listed, adding `cdn.example.com` does not add blocking coverage. The generator rejects unexplained parent/child overlaps and names both entries before writing generated files.

If a child needs to retain distinct metadata, add a nonempty `redundancyReason` to that child, for example `"Preserves the Social pixel category; the parent is Ad tracking."`. This retains the entry in generated rules and category mappings; it is not a blocking exception. The generator reports retained overlaps and rejects empty reasons or reasons whose parent is no longer in the catalog. See the [catalog audit](CATALOG_AUDIT.md) for the current decisions.

The catalog is also Decoy Mode's hard scope boundary. When the experimental mode is on, page-level `fetch`, XHR, and beacon calls to this domain become eligible for identifier replacement instead of the normal DNR block. Confirm that the entry is genuinely a tracker endpoint and not a payment, login, captcha, or other transactional service.

## 2. Add One Test Fixture

Open [test/tracker-test-set.json](../test/tracker-test-set.json).

Add one request example under the most relevant fixture, or create a small new fixture if needed.

Example test fixture request:

```json
{
  "url": "https://tracker.example.com/collect.js",
  "type": "script",
  "tracker": true,
  "category": "Analytics"
}
```

Use a non-sensitive example URL. Do not include private account pages, tokens, or personal data.

## 3. Generate Rules

Run:

```bash
npm run generate:rules
```

This regenerates:

- `rules/rules.json`
- `shared/config.js`

## 4. Run The Evidence Test

Run:

```bash
npm run test:evidence
```

Confirm the new fixture is blocked and category coverage still looks correct.

Requests with `tracker: true` must be blocked; requests with `tracker: false` must remain unblocked. Either mismatch fails the command and prints the fixture, request URL, page URL, and expected result. Add negative fixtures for nearby legitimate hosts where useful. This evaluator approximates DNR matching; it does not replace browser verification of registrable-domain/third-party behavior.

Also run the full suite so catalog scoping and Decoy Mode safety checks remain covered:

```bash
npm run check
```

## 5. Confirm Generated Files

Before opening a PR, quickly inspect:

- `rules/rules.json`: your domain should appear in the DNR `requestDomains` list.
- `shared/config.js`: your domain should appear under the right category mapping.

Do not edit these generated files by hand.

## 6. Open A PR

In your PR, include:

- The tracker domain.
- The category.
- Why it should be blocked.
- Any known breakage risk.
- Any Decoy Mode risk if the host accepts mixed tracking and transactional traffic.
- The commands you ran.

Small PRs are welcome. One domain plus one test fixture is enough.
