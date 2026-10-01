# huntflow-tools

CLI helpers for the Huntflow ATS (`huntflow.js`, `add_applicant.py`). Behavioral guidelines for editing them.

## Simplicity first

Minimum code that solves the problem — nothing speculative.
- No features, flags, or config beyond what was asked.
- No abstractions for single-use code; no error handling for impossible cases.
- If it could be half the lines, rewrite it.

## Surgical changes

Touch only what the request needs.
- Don't "improve" adjacent code, comments, or formatting; don't refactor what isn't broken.
- Match the existing style of the file, even if you'd do it differently.
- Notice unrelated dead code? Mention it — don't delete it unless asked.
- Remove only the imports/vars your own change orphaned.
- Every changed line should trace directly to the request.

## Verify before "done"

Run `./smoke_test.sh` after changes; report the actual result, not "looks right." If a change can't be exercised by the smoke test, say what you did and didn't verify.

## After editing

Ask before committing/pushing — don't assume. After a push or a merged pull request, offer to update `CHANGELOG.md`.

## Everything goes through a PR

Cut a feature branch, open a PR, merge it. Never commit to `main` directly — including release housekeeping (CHANGELOG marker, badge bump).

The git history misleads here: v1.0.0's own housekeeping (`cf6acbd`, `ec30dc3`, `9148d0a`, `d1348a4`) went straight to `main`, so `git log` suggests small changes skip the PR. They don't.

A CI job fails any PR that changes `huntflow.js`, `add_applicant.py`, `reorder_stages.js`, or `setup.sh` without touching `CHANGELOG.md` — the `add` command shipped with no entry that way. Label the PR `no-changelog` to skip it when an entry genuinely isn't warranted.

## After a new release

The README's release badge is a static shields.io badge, and `validate-skills.mjs` reads the version from it to check the skills' `metadata.version`. Keep it static (a dynamic badge would break the validator). After tagging a new release, update the badge version in `README.md` to match.
