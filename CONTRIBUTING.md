# Contributing

Everything here is for people changing the tools or the skills. If you only want to use them, the [README](README.md) is enough.

## Checks before a PR

```bash
bash smoke_test.sh            # offline checks, plus read-only live checks if HUNTFLOW_ACCOUNT_ID is set
node validate-skills.mjs      # skills against the Agent Skills spec
```

Nothing in the smoke test writes to Huntflow. `reorder_stages.js` and the merge step of `add_resume.js` need a browser session cookie, so CI cannot exercise them. Run `node reorder_stages.js list` or a `--dry-run` by hand after touching them.

## Process

- Every change goes through a PR. Never commit to `main`, including release housekeeping (CHANGELOG, badge bump).
- CI has two jobs. `smoke` runs the syntax checks, `validate-skills.mjs` and `smoke_test.sh`. `changelog` fails a PR that changes `huntflow.js`, `add_applicant.py`, `reorder_stages.js` or `setup.sh` without touching `CHANGELOG.md`. Add the `no-changelog` label when an entry is not warranted.
- CHANGELOG entries are dated, newest first.
- Behaviour, rules and version numbers change together with README, CHANGELOG and the skill text, in the same PR.
- Keep each change minimal: no speculative flags, no refactors of adjacent code. [DESIGN.md](DESIGN.md) explains why the scripts share no code.

## Releases

The release badge in `README.md` is a static shields.io badge. `validate-skills.mjs` reads the version from it and compares it with `metadata.version` in each `SKILL.md`, so the repo and both skills carry one number. After tagging a release, bump the badge and both skill versions together, or CI fails.

## Checking the skills

`node validate-skills.mjs` checks both skills against the [Agent Skills specification](https://agentskills.io/specification): frontmatter fields and their limits, `name` matching its directory (Claude Code loads a skill by directory, so a mismatch shows up as the skill never appearing), relative links that resolve, `metadata.version` matching the release badge, and unquoted values that real YAML would misread (a `: ` or ` #` inside them). CI runs it on every PR.

`node evals/run-trigger-evals.mjs` answers a different question: given a recruiter's sentence, which skill does Claude actually pick? The failure worth catching is one skill description pulling the other's work, and `huntflow-add` writes to a live ATS. The verdict comes from the tool trace rather than from a judge reading prose, and every run withholds Bash, Write, Edit and the web tools, so a skill can be chosen but cannot act. It calls the model and costs money (about $0.08 a case), so it is not in CI:

```bash
node evals/run-trigger-evals.mjs --dry       # list cases, spend nothing
node evals/run-trigger-evals.mjs --runs 3    # a trigger rate per case
```

Runs are capped at two turns, which keeps a triggered case from executing the whole workflow at full price. The cap matters only for cases where no skill should fire: a run that ends because of the cap has not established anything, so it reports as inconclusive rather than as a non-trigger. `--max-turns 5` settles one. A positive case needs no such care: the Skill call is the verdict the moment it appears.

## Formatter hooks

If your editor or agent reformats files on save, check `git diff --stat` after the first edit. A one-line change that shows hundreds of lines is a reformat, not your change; revert it and apply the edit another way.
