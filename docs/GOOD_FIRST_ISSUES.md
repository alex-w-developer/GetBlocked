# Good First Issue Ideas

These issue ideas are designed to become small, focused pull requests. Copy any item into a GitHub Issue and add the suggested labels.

## Tracker-Domain Addition Issues

### 1. Add one analytics tracker fixture

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add one narrow analytics tracker domain and one test fixture.
- Files to edit: `shared/tracker-catalog.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Domain has category, label, notes; generated files updated; evidence test passes.

### 2. Add one ad retargeting tracker fixture

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add a narrowly scoped ad or retargeting endpoint.
- Files to edit: `shared/tracker-catalog.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Domain is not a broad platform domain and test coverage passes.

### 3. Add one social pixel tracker fixture

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add one social media pixel endpoint.
- Files to edit: `shared/tracker-catalog.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Category is `Social pixel`; generated config includes the domain.

### 4. Add one session replay tracker fixture

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add one session replay or heatmap endpoint.
- Files to edit: `shared/tracker-catalog.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Domain is narrow and does not break login/payment/captcha flows.

### 5. Add one affiliate attribution tracker fixture

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add one affiliate or attribution endpoint.
- Files to edit: `shared/tracker-catalog.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Domain is classified as `Affiliate / attribution` and fixture is covered.

### 6. Add one email marketing tracker fixture

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add one email marketing or marketing automation endpoint.
- Files to edit: `shared/tracker-catalog.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Domain is not a broad email platform domain unless narrowly justified.

### 7. Add one tracking URL parameter

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`
- Goal: Add one common tracking URL parameter to the cleaner.
- Files to edit: `shared/tracking-params.json`, `test/tracker-test-set.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Param appears in generated DNR redirect rule and evidence test still passes.

### 8. Add notes to existing tracker entries

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `tracker-domain`, `documentation`
- Goal: Improve labels/notes for five existing catalog entries.
- Files to edit: `shared/tracker-catalog.json`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: Notes are clearer and generated files remain in sync.

## Documentation Improvement Issues

### 9. Add screenshots to the README

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `documentation`
- Goal: Add local screenshots of the popup and manual test flow.
- Files to edit: `README.md`, optional image files
- Commands to run: None required
- Acceptance criteria: Screenshots do not include private browsing data.

### 10. Improve the broken-site guide

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `documentation`, `broken-site`
- Goal: Add clearer examples of good broken-site reports.
- Files to edit: `docs/BROKEN_SITES.md`
- Commands to run: None required
- Acceptance criteria: Guide remains beginner-friendly and privacy-safe.

### 11. Add glossary terms

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `documentation`
- Goal: Explain DNR, third-party requests, pixels, and URL parameters.
- Files to edit: `README.md` or a new docs file
- Commands to run: None required
- Acceptance criteria: Terms are explained in plain language.

### 12. Improve local install docs for new Chrome users

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `documentation`
- Goal: Make unpacked extension install steps clearer.
- Files to edit: `README.md`, `docs/DEVELOPMENT.md`
- Commands to run: None required
- Acceptance criteria: Steps are accurate and concise.

## UI Polish Issues

### 13. Improve empty category state copy

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `UI`
- Goal: Make the no-categories state clearer without fear-based language.
- Files to edit: `popup/popup.html`, `popup/popup.js`, `popup/popup.css`
- Commands to run: `node --check popup/popup.js`
- Acceptance criteria: Popup remains compact and factual.

### 14. Polish popup spacing on narrow widths

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `UI`
- Goal: Improve spacing and wrapping in the popup.
- Files to edit: `popup/popup.css`
- Commands to run: None required
- Acceptance criteria: Text does not overlap or clip.

### 15. Add a local-only visual indicator variant

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `UI`
- Goal: Improve the footer/local-only indicator.
- Files to edit: `popup/popup.html`, `popup/popup.css`
- Commands to run: `node --check popup/popup.js`
- Acceptance criteria: No external icons, fonts, or assets are added.

### 16. Improve category chip readability

- Difficulty: Easy
- Labels: `good first issue`, `help wanted`, `PR welcome`, `UI`
- Goal: Make category chips easier to scan.
- Files to edit: `popup/popup.css`
- Commands to run: None required
- Acceptance criteria: Color contrast stays calm and readable.

## Test/CI Improvement Issues

### 17. Add a generated-file sync checker script

- Difficulty: Medium
- Labels: `help wanted`, `PR welcome`, `tests`
- Goal: Add a script that fails if generated rules/config differ after generation.
- Files to edit: `scripts/`, `package.json`, `.github/workflows/ci.yml`
- Commands to run: `npm run generate:rules`, `npm run test:evidence`
- Acceptance criteria: CI catches out-of-sync generated files.

### 18. Expand category coverage reporting

- Difficulty: Medium
- Labels: `help wanted`, `PR welcome`, `tests`
- Goal: Make `scripts/evaluate-test-set.mjs` report more fixture detail.
- Files to edit: `scripts/evaluate-test-set.mjs`
- Commands to run: `npm run test:evidence`
- Acceptance criteria: Output remains concise and useful.

## Research Issues

### 19. Research low-breakage tracker candidates

- Difficulty: Medium
- Labels: `help wanted`, `PR welcome`, `research`, `safe expansion`
- Goal: Identify five narrow tracker domains that are unlikely to break websites.
- Files to edit: `docs/` or issue comments
- Commands to run: None required
- Acceptance criteria: Each candidate includes category, rationale, and breakage risk.

### 20. Research broken-site patterns

- Difficulty: Medium
- Labels: `help wanted`, `PR welcome`, `research`, `broken-site`
- Goal: Document common reasons privacy rules break websites.
- Files to edit: `docs/BROKEN_SITES.md`
- Commands to run: None required
- Acceptance criteria: Notes help contributors propose safer fixes.

### 21. Document Decoy Mode compatibility examples

- Difficulty: Beginner
- Labels: `good first issue`, `help wanted`, `PR welcome`, `documentation`, `MV3`
- Goal: Add non-transactional examples of supported and unsupported request-body formats to `docs/DECOY_MODE.md`.
- Files to edit: `docs/DECOY_MODE.md`
- Commands to run: `npm run check`
- Acceptance criteria: Examples use catalog-scoped test URLs, contain no personal data, do not create real requests, and preserve all event/transaction fields.
