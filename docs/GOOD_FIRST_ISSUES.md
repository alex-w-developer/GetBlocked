# Good First Issues

Start with the [live list of open good first issues](https://github.com/alex-w-developer/GetBlocked/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
Read the issue, its linked pull requests, and recent comments to see what is still available. If the list is empty, use the contributor guides below to propose a focused change.

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
