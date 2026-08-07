# Adding Tracker Domains

The easiest first PR is adding one well-scoped tracker domain and one test fixture.

This page walks through the exact tracker-domain PR workflow.

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
