# Good First Issues

Start with the [live list of open good first issues](https://github.com/alex-w-developer/GetBlocked/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
GitHub issue status is authoritative; the tasks below may be claimed or completed
later. Check status and comments before starting.

## Small tasks to choose from

| Issue | Contribution | Starting files |
| --- | --- | --- |
| [#32](https://github.com/alex-w-developer/GetBlocked/issues/32) | Connect switch help text and announce popup status updates | `popup/popup.html`, `popup/popup.js` |
| [#38](https://github.com/alex-w-developer/GetBlocked/issues/38) | Explain extension and tracking terms in a short glossary | `README.md`, `docs/DEVELOPMENT.md`, new `docs/GLOSSARY.md` |
| [#39](https://github.com/alex-w-developer/GetBlocked/issues/39) | Show static Decoy Mode before/after examples | `docs/DECOY_MODE.md`, `shared/decoy-transform.js` |
| [#40](https://github.com/alex-w-developer/GetBlocked/issues/40) | Respect reduced-motion settings for the popup switch | `popup/popup.css` |
| [#41](https://github.com/alex-w-developer/GetBlocked/issues/41) | Test duplicate and broad-domain generator guards | `scripts/test-tooling.mjs`, `scripts/generate-rules.mjs` |

Each issue includes a reason, acceptance criteria, verification steps, and scope
boundaries. These are deliberately small changes; no new permissions or runtime
dependencies are needed. Larger privacy, bridge, and site-scope tasks remain in
the general backlog and are not labeled as first contributions.

## How to start

1. Read the issue and check for an existing assignee or PR. Comment that you are
   starting so contributors can coordinate.
2. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the
   [development guide](DEVELOPMENT.md) to create a focused branch and load the
   unpacked extension if the issue needs browser verification.
3. Make only the scoped change. Ask questions in the issue or open a draft PR if
   setup or implementation needs discussion.
4. Run the issue's verification steps. For code or test changes, run
   `npm run check`; for browser behavior, report the manual checks actually done.
5. Open a PR referencing the issue with a short change summary and test results.

If you want to add a tracker, read [Adding Trackers](ADDING_TRACKERS.md) first.
Identify a specific narrow endpoint and supporting evidence before opening an
issue; category-only requests and domains already covered by a parent do not make
useful starter tasks. Ambiguous URL parameters such as `ref` are preserved to avoid
breaking application links.

## Completed work

Screenshots, broken-site examples, generated-file sync validation, standard icons,
catalog overlap checks, document-base URL resolution, and JSON error filenames
have already been delivered. Do not recreate these tasks from older idea lists.
Use the live issue search before proposing new work.
