# Release Checklist

Releases are prepared in a focused PR and published by a maintainer after review.
This checklist covers Git tags and GitHub Releases; it does not publish to a
browser store or require publishing credentials in the repository.

## Version policy

Keep `manifest.json` and `package.json` on the same numeric `major.minor.patch`
version. The current baseline is `0.2.0` in both files. There is no intentional
version divergence: the manifest identifies the extension, while package metadata
identifies the tooling for that same checkout. If a lockfile is introduced, update
its package version too. Use `v<version>` for the corresponding Git tag.

## Prepare the release PR

1. Start from current GitHub `main`. Review merged changes since the last release
   tag; for the first release, review the current implementation.
2. Update both version fields together. Use a patch for fixes, a minor version for
   compatible additions, and a major version for incompatible changes. During
   `0.x`, call out any incompatible change explicitly.
3. Run `npm run generate:rules`, review the generated diff, then stage intended
   changes before `npm run check` (the sync check compares against the Git index).
4. Run `npm run test:browser -- --required` with Chrome for Testing through
   `CHROME_PATH`. Both `validate` and `browser` CI jobs must pass. Record browser
   version and any manual verification; an unavailable browser is not a pass.
5. Check permissions, local storage changes, normal/Decoy Mode behavior, and site
   compatibility. Update the relevant docs and include any migration steps.
6. Draft release notes in the PR. Include user-visible changes, fixes with issue
   links, contributor credit, privacy/permission and compatibility considerations,
   known limitations, and validation performed. State when there are no new
   permissions; do not claim anonymity or exact network-block counts.

## Publish after merge

1. Confirm the release PR is merged, both CI jobs passed on that commit, and the
   version fields agree. Select that exact commit, rather than an advancing branch.
2. Check that `v<version>` does not already exist. Create an annotated tag at the
   selected commit and push that tag. Do not move or overwrite existing tags.
3. Create a GitHub Release for that tag using the reviewed notes. Mark experiments
   as a prerelease when appropriate. GitHub's source archives can be used to load
   the extension unpacked; this is not a browser-store installation.
4. Download the tagged source and confirm the documented unpacked installation
   works. Verify the GitHub Release points to the intended tag and commit.

If a release has a bug, prepare a new patch release instead of rewriting its tag.
No release is created merely by adding or following the preparation documentation.
