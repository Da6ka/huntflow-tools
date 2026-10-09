# Changelog

## Unreleased

### Changed

- `huntflow.js` now refreshes the access token on Huntflow's `404 error.robot_token.not_found` as well as on 401, so an expired access token with a live refresh token self-heals. Other 404s (missing applicant/vacancy) still just surface.
- `huntflow-add` skill: do not `Read` CV PDFs (a single read returned ~900K characters of tool output); use `pdftotext` and read the text only.

### Added

- **`huntflow.js questionary <applicant_id>`**: reads an applicant's questionary custom fields (Location, LinkedIn, GitHub, 2nd email, personal sites). These are not in the `applicant` summary, so until now there was no way to read them from the CLI. Default output labels each field by its account title; `--json` returns the raw API object.

## v1.8.0 — 2026-10-02

### Added

- **`huntflow.js update-contacts <id> [--email <addr>] [--phone <num>]`**: sets email and/or phone on an existing applicant. Until now contacts could only be set at `add` time (email) or through the UI.

## v1.7.3 — 2026-10-02

Fixes from a code review. No new commands.

### Fixed

- **`add_applicant.py`**: a date range such as `2019-04 - 2021-06` is no longer read as a phone number when the CV parser finds none. A step-5 failure on a record with no resume entry now stops with a clear message instead of a traceback.
- **`huntflow.js add`**: warns when `--linkedin`, `--github`, `--location` or `--email2` are skipped because the account has no questionary field with that English title, instead of dropping them silently. If a step after the applicant is created fails, it prints the new applicant id and says the record is half set up, so a re-run does not create a duplicate.
- **`huntflow.js`**: warns when refreshed tokens could not be saved to Keychain or the token file.
- **`huntflow.js`**: text after a bare `--` is literal, so `comment 5 -- "note about --json"` keeps the flag word in the comment and does not switch to JSON output. Without `--`, behaviour is unchanged.
- **CI**: the CHANGELOG gate now also watches `add_resume.js`.

## v1.7.2 — 2026-10-02

Tagged release.
New in this version: the recruiter-first README and CONTRIBUTING, English-only skills and comments,
stage matching by role instead of by name, and `add_resume.js` checking the session cookie before it creates anything.
The repository history was squashed into a single commit for this release.

## 2026-10-02: README for recruiters, CONTRIBUTING for maintainers

### Changed

- **`README.md`**: rewritten for a recruiter who has never seen the repo. Install and first-run steps are one Quick start (the second "setup for new users" copy is gone), the token steps use English menu names, and Claude Code usage is explained in plain language before any symlinks. The two browser-session tools (`reorder_stages.js`, `add_resume.js`), the environment variables and the notes-file mechanism moved into a "Settings and advanced" section at the end. The skills are described by what they do and what they assume, including that `huntflow-add` ships one default status flow (New, Contacted, Reject) and `huntflow-site-applications` was built around one team's form email.
- **`DESIGN.md`**: lists `add_resume.js`, describes the current CI and test layers, and no longer names a specific bot as an example caller.
- **`CLAUDE.md`**: dropped the pointer to a personal global config file.
- **`examples/add_candidate.sh`** and the README examples use placeholder ids and a neutral comment instead of values from a real account.
- **`evals/`**: removed the two cases that graded a skill from outside this repo, and the flag that loaded it. Four cases remain.
- **English only**: the skills, the eval prompts and the code comments no longer contain Russian. Status names read New, Contacted and Reject. The comment that `huntflow-site-applications` writes on a new application now reads `Application date:` and `Cover letter:` (was Russian labels); a real candidate's name used as an example in that skill was replaced with a generic description. Stage names are custom per account, so the skills no longer match stages by name: intake is the first stage, reject is the stage of type `trash`, and the contacted stage comes from the local notes file or a question. The comment labels can also be overridden in the local notes file. No code behavior change.
- **`CHANGELOG.md`**: older entries no longer name a former employer, a private repo or team-specific rules; where they did, they now say what changed in neutral terms.

### Fixed

- **`add_resume.js`**: checks the session cookie with a read-only call before it uploads or creates anything, so a stale cookie no longer leaves a temporary applicant behind. If the merge still fails, it prints the temporary applicant's id and says to merge or delete it in the UI before re-running (the API cannot delete applicants). Unit test for the message added.

### Added

- **`CONTRIBUTING.md`**: checks before a PR, the PR and CHANGELOG rules, the release badge and skill version rule, how to run the skill checks and trigger evals. This content used to sit in the README.

## 2026-10-01: sourcing skills moved out

### Removed

- **Two sourcing skills** (calibration kickoff and ATS triage): both moved out to a separate repo. They describe a sourcing workflow (candidate research and scoring), not these tools, and still call `huntflow.js` and `add_applicant.py` from `~/.claude/utils/`. Existing symlinks in `~/.claude/skills` need repointing to the new location.
- **`README.md`**: the section on the two skills and the note about the email rule duplicated in the sourcing skills; the "Source a role with Claude" bullet.
- **`evals/`**: the four trigger cases for the two skills, and their names in the skill list. `validate-skills.mjs` finds skills by directory, so it needed no change.

## 2026-10-01: README feature list

### Changed

- **`README.md`**: "What you can do with it" now covers everything the tools and skills do: search filters, comments, creating and updating vacancies, the CV flags (source, tag, LinkedIn, GitHub, Telegram, location, second email), adding without a CV, website applications and the two sourcing skills. No behavior change.

## 2026-10-01: copyright holder

### Changed

- **`LICENSE`**: the copyright holder is now Daria Ivanova (was a company name). The MIT terms are unchanged.

## v1.7.1 — 2026-10-01

Earlier release. The repository history was squashed into one commit at v1.7.2, so there is no v1.7.1 tag here.
New in this version: `add_applicant.py --telegram`,
`coworkers`, search filters and `vacancies --mine`,
public-release hardening and the `comments` fix for empty entries.

## 2026-10-01: `add_applicant.py --telegram`

### Added

- **`add_applicant.py --telegram`** stores a Telegram handle in the applicant's social list. Accepts `name`, `@name` or a `t.me` link; an invalid handle (for example one split by a space in a PDF export) stops the run instead of being guessed.
- The `huntflow-site-applications` skill now says to build standard LinkedIn and GitHub URLs from bare handles in the CV.

## 2026-10-01: `coworkers`, search filters, `vacancies --mine`

### Added

- **`huntflow.js coworkers`** lists the account's members (recruiters, watchers) with id, role and email.
- **`huntflow.js search`** takes `--vacancy <id>`, `--status <id>` and `--tag <id>` to narrow results. Filters alone work without a query, e.g. `search --vacancy 123 --status 45`. Non-numeric filter values are rejected.
- **`huntflow.js vacancies --mine`** lists only the vacancies you own. Combines with `--open`.

## 2026-10-01: public-release hardening

### Changed

- **Per-account defaults are now config, not constants.** `add` applies a default tag only
  when `HUNTFLOW_DEFAULT_TAG_ID` is set (was a hardcoded tag id); `add_resume.js` takes its
  default source from `HUNTFLOW_DEFAULT_SOURCE_ID` (was a hardcoded id) and asks for
  `--source` when neither is set; `add_applicant.py` resolves questionary keys by field
  title instead of using fixed keys. To keep the old behavior, export both variables.

- **Skills no longer carry one team's data.** Account, vacancy, tag and source IDs, the
  hiring-pause and country rules, the form sender and the mailbox moved out of the four
  skills. They read an optional `~/.claude/huntflow-local.md` instead, which stays outside
  the repo.

### Fixed

- **`add_applicant.py`** creates the token file with mode 0600 from the start (it was
  written under the default umask and chmod-ed afterwards).
- **`add_resume.js`** warns when refreshed tokens cannot be saved instead of failing
  silently, escapes the upload filename, and prints the applicant name correctly in the
  `--dry-run` line.
- **`huntflow.js`** rejects non-numeric ids (including `pipeline`'s status argument) before they reach a URL, and `add` prints a note when no tag was applied.

### Added

- `test_add_resume.js`: offline tests for multipart filename escaping and the token-save warning in `add_resume.js`. `test_token_file.py`: token file mode and upload filename escaping in `add_applicant.py`. A `num` unit test in `test_huntflow.js`, and smoke checks for the id guard (including `pipeline`'s status argument). All run from `smoke_test.sh`.
- `SECURITY.md`, a `permissions: contents: read` block and SHA-pinned actions in CI, and
  security notes in the README.

## 2026-10-01: `comments` skips empty entries

### Fixed

- **`huntflow.js comments`** no longer prints blank `date | ` lines. Huntflow returns
  email log entries as type COMMENT with a null `comment`; the text output now skips
  them (`--json` still returns everything).

## v1.7.0 — 2026-10-01

Tagged release.
New in this version: the `comments`, `comment` and `sources` commands and `move --comment` /
`--comment-file`.

## 2026-10-01: comments and sources commands

### Added

- **`huntflow.js comments <id>`, `comment <id> <text> [--vacancy <vid>]`, `sources`**:
  read and add comments on an existing applicant, and list resume sources. Found by
  comparing against Gaivoronsky/huntflow-mcp, which had them as tools. Comments
  cannot be edited or deleted through the API.

## v1.6.0 — 2026-09-30

Tagged release.
New in this version: the `huntflow-site-applications` skill and the `add_applicant.py`
source, tag and questionary flags,
plus the skills, validator and trigger eval added since v1.5.0 (the entries below, down
to 2026-09-26).

## 2026-09-30: website applications get their own skill

### Added

- **`huntflow-site-applications` skill**: the flow for loading website applications
  into Huntflow, previously described only in memory and a handover note.
- **`add_applicant.py` flags**: `--source-id`, `--tag-id` (repeatable), `--linkedin`,
  `--github`, `--location`, `--email2`, `--no-link-files`. With `--tag-id` and
  `--source-id` the script now sets tag and source itself; the source PUT keeps the
  CV attached. The post-link steps are not yet tested against live Huntflow, only
  `--dry-run` is.

### Changed

- **`huntflow-add`** no longer says `add_applicant.py` never sets tag or source,
  and points website applications to the new skill.

## 2026-09-28: the skills get a validator and a trigger eval

### Fixed

- **Sourcing skill frontmatter** (a skill since moved out of this repo): the dash cleanup before it left
  `optional: without them` unquoted in `compatibility`. YAML reads `: ` inside a plain
  value as a nested mapping, the whole frontmatter failed to parse, and Claude Code
  showed the skill with no description. Now a semicolon.
- **`validate-skills.mjs` catches that class of break**: an unquoted value containing
  `: ` fails the build, and so does one containing ` #`, which YAML silently truncates
  as a comment. The cleanup passed CI with the broken file because the validator's own parser
  is more lenient than YAML.

### Added

- **`move --comment` / `--comment-file`**: `move` could set a `rejection_reason` but not
  attach a comment, so written feedback had to be pasted into the Huntflow UI by hand.
  Both flags now pass a `comment` into the status-change body; `--comment-file` mirrors
  `update-vacancy`'s `--*-file` flags for long multiline blocks.
- **`validate-skills.mjs`**: checks all three skills in `.claude/skills/` against the
  [Agent Skills specification](https://agentskills.io/specification): frontmatter
  fields and their limits, `name` matching its directory, relative links that resolve,
  and `metadata.version` matching the README release badge. Rules ported from
  another skills repo's validator, which exists because the spec's own
  (`agentskills/skills-ref`) needs Python and uv. Runs in CI on every PR.
- **`evals/trigger-cases.csv`** and **`evals/run-trigger-evals.mjs`**: ten cases
  measuring which skill Claude picks for a given recruiter sentence. Three skills here
  share one workflow and a fourth sits beside them in its own repo, so the
  failure worth catching is a description pulling a neighbour's work, and
  `huntflow-add` writes to a live ATS. The verdict comes from the tool trace, not from
  a judge reading prose, so it is deterministic. Every run withholds Bash, Write, Edit
  and the web tools: a skill can be chosen but cannot act, and no measurement can
  reach the Huntflow API. Not in CI: it calls the model, about $0.08 a case.
  A flag loaded the neighbouring skill from its own checkout to grade the two
  boundary cases; without it they reported as skipped (the flag and cases were later removed).
  First full pass (10 cases, 3 runs each, $1.95): every case 3 of 3, including both
  boundary cases. No skill here claimed the neighbour's work and it claimed none of
  theirs. One case needed a second look rather than a bare pass: `none-funnel-report`
  ended all three runs at the turn cap, so silence there was not a decision. Runs cut
  short that way now report as inconclusive instead of counting as non-triggers, and
  `--max-turns` raises the cap; re-run at 5 turns, one run of three decided cleanly and
  no skill fired. A negative case that invites tool use is the one shape this harness
  answers weakly, and that is now visible in its output rather than hidden in a pass.

### Changed

- **README "Using inside Claude Code"**: said to drop two scripts into
  `~/.claude/utils/`. There are four, the skills call them from that path, and a
  copy goes stale on the next `git pull`, so it now symlinks all four from the checkout.
- **`huntflow-add`**: calls `add_applicant.py` with its real flags, `--vacancy-id`
  and `--status-id`. The short `--vacancy` / `--status` only worked because argparse
  accepts unambiguous prefixes, and a new flag starting with the same word would break it.
- **All three `SKILL.md` files**: added `license`, `compatibility` and
  `metadata` (`author`, `version`). `compatibility` states what each skill needs to
  run at all: the CLI and Huntflow credentials for all three, browser control for
  one of the sourcing skills, an optional meeting-notes tool for the other. The
  skills are versioned with the repo, so all three carry `1.5.0` and the validator
  fails the build if a release bumps the badge without them.

## 2026-09-26: sourcing skills moved in

### Added

- Two sourcing skills (calibration and triage, both since moved out of this repo),
  moved here unchanged from `~/.claude/skills` (where they had no version control
  of their own) because both call `huntflow.js` and `add_applicant.py` directly.
- **`README.md`**: a section describing both skills and how to symlink them.

## v1.5.0 — 2026-09-17

Tagged release,
the current latest tag. New in this version: the `update-vacancy` command — the 2026-09-17 entry
directly below. Everything else is inherited from v1.4.0 and earlier.

## 2026-09-17 — huntflow.js: update-vacancy command

### Added

- **`update-vacancy <id>`**: edit an existing vacancy's fields via a partial
  `PATCH /vacancies/<id>` (the same method `close` already uses), so only the
  fields passed are sent and the rest are left untouched. Supports the three HTML
  description blocks `--body` / `--requirements` / `--conditions` (with
  `--body-file` / `--requirements-file` / `--conditions-file` for long HTML), plus
  `--money`, `--position`, `--state <OPEN|HOLD|CLOSED>`, and `--dry-run`. Fills the
  gap where the public API v2 has no dedicated description-edit helper; previously
  a vacancy body could only be set by hand in the web UI or a one-off script.
- **`README.md`**: command-table row and an options block for `update-vacancy`.

## v1.4.0 — 2026-09-03

Tagged release,
the current latest tag. New in this version: the `huntflow.js --help` fix and the
`add`/`create-vacancy` README docs — the two 2026-08-29
entries below, authored before v1.3.0 but merged after it was tagged. Everything
else below is inherited from v1.3.0 and earlier.

## v1.3.0 — 2026-09-03

Tagged release.
Added `add_resume.js` (the entry directly below); also carries the huntflow-add
skill, the README lead rewrite, and the birthday guard from the entries down to
the v1.2.0 marker.

## 2026-09-03 — add_resume.js: attach a CV to an existing applicant

### Added

- **`add_resume.js`**: adds a résumé to an applicant who already exists —
  something neither the public API (`POST /applicants/<id>/externals` → 404, and
  externals are create-time only) nor a single internal call can do. Huntflow
  support confirmed the only supported path is "create a new applicant with the
  CV, then merge". The script automates it end to end: upload + parse the CV
  (public API), create a temp applicant carrying it (public API), then merge the
  temp **into** the target by explicit id via the internal web API
  (`POST /app/api/my/<org>/applicant/merge/<keep>/<remove>`). Addressing the
  merge by id avoids Huntflow's fuzzy async auto-dedup, which was observed to
  create duplicates when relied on. Reuses `huntflow.js`' Bearer-token handling
  for the public calls and `reorder_stages.js`' session-cookie auth
  (`HUNTFLOW_WEB_COOKIE`) for the merge. Retries the merge on a transient
  `Unknown double` while duplicate detection catches up; refuses a target with no
  name; `--dry-run`, `--keep-temp`, `--source`, `--auth-type`, `--json` flags.
- **`README.md`**: an `add_resume.js` section and a `What's included` entry.

### Notes

- The merge reassigns the applicant's canonical id (the old id resolves as an
  alias), like the "Magic Button" enrichment. Verification follows the canonical
  id and confirms the file through each external's *detail* endpoint, since the
  applicant summary always reports `external[].files` as `[]`.

## 2026-08-29 — huntflow.js: `--help` works before the account ID is set

### Fixed

- **`huntflow.js`**: `--help` and a bare invocation exited 1 with
  `ERROR: HUNTFLOW_ACCOUNT_ID env var is not set` instead of printing usage.
  The account-id guard ran before command dispatch, so the one place `add` and
  `create-vacancy` were documented refused to run until you were already set
  up — which is why both stayed undiscoverable long enough to be missing from
  the README too. The guard now skips a help-only invocation; every other
  command still requires the variable.
- **`smoke_test.sh`**: asserts `huntflow.js --help` succeeds with
  `HUNTFLOW_ACCOUNT_ID` unset. `add_applicant.py --help` was already covered;
  the missing mirror check is what let this through.

## 2026-08-29 — README: document `add` and `create-vacancy`

### Changed

- **`README.md`**: the `huntflow.js` command table was missing `add` and
  `create-vacancy` — both have shipped (the `add` command
  and the `create-vacancy` work) but were only discoverable through `--help`.
  Both are now in the table in the same order as the help output, with their
  option lists below it and a note on when to reach for `add_applicant.py`
  instead of `add`. No behavior change.

## 2026-08-29 — huntflow-add skill

### Added

- **`.claude/skills/huntflow-add/SKILL.md`**: packages candidate intake as a
  Claude Code skill — path selection between `huntflow.js add` and
  `add_applicant.py`, account-wide dedupe, the tag/source calls the Python
  script skips, and a read-back verification step. Encodes the rules the API
  doesn't enforce: `tags` silently dropped on create, the source PUT detaching
  the CV without `files`, `count` capping at 30, New → Contacted → Reject never
  skipped, no move to Reject without an explicit go-ahead, and a hiring-pause
  rule (later moved to the local notes file). Loads automatically inside the repo; symlink into `~/.claude/skills/`
  to use it elsewhere.
- **`README.md`**: a `The huntflow-add skill` subsection under *Using inside
  Claude Code* covering what the skill does and how to symlink it.

## 2026-08-11 — README: lead with what-you-can-do before technical detail

### Changed

- **`README.md`**: reordered so a recruiter sees the practical workflows
  first. New plain-language lead paragraph and a **What you can do with it**
  section (see pipeline, move candidates, add from CV, look things up, reorder
  stages) sit above a divider that hands off to setup, auth, and the command
  reference. No content removed — install/auth/command tables are unchanged,
  just moved below the intro.

## 2026-08-03 — add_applicant.py: guard non-scalar parsed birthday

### Fixed

- **`add_applicant.py`**: the applicant-create body forwarded Huntflow's parsed
  `birthdate` verbatim. When the parser returns it as a dict (or empty) instead
  of a scalar, the POST failed with `HTTP 400 type_error … expected date,
  string, bytes, int or float @ /birthday`, aborting the add after the CV had
  already uploaded. Now only a `str`/`int`/`float` birthday is forwarded;
  anything else is dropped. Surfaced while bulk-adding website applicants whose
  CVs carried a date of birth.

## 2026-07-30 — huntflow.js: set email on `add`

### Added

- **`huntflow.js`**: `add` now takes `--email <addr>` and `--email2 <addr>`.
  `--email` sets the primary address (PATCHed after create, since the create
  body silently drops `email`); `--email2` writes the secondary address into
  the "2nd Email" questionary field (additional info in the UI), resolved by title like
  the existing `--linkedin`/`--location` flags. Previously an email had to be
  attached by a separate manual PATCH after the applicant was created.
- **`test_huntflow.js`**: offline unit tests for `huntflow.js`'s pure helpers
  (`parseAddOpts` arg parsing — including the new `--email`/`--email2` flags,
  `--no-tag` handling, and missing-value/unknown-flag errors — plus the
  `formatVacancy`/`formatApplicant`/`formatPipelineApplicant` formatters).
  Wired into `smoke_test.sh`. `huntflow.js` now exports these helpers and only
  runs the CLI when invoked directly (`require.main === module`), so importing
  it for tests no longer requires `HUNTFLOW_ACCOUNT_ID`.

## v1.2.0 — 2026-07-30

Tagged release.
Everything below this line is included in v1.2.0; the entries above it shipped in
the later releases marked at the top (v1.3.0 and v1.4.0).

## 2026-07-30 — add_applicant.py: recover contacts from CV text, refuse nameless records

### Fixed

- **`add_applicant.py`**: when Huntflow's CV parser returns an empty
  name/email/phone (common — it happened on two real applications in a row), the
  script no longer silently creates an `Unknown Unknown` applicant with no
  contacts. It now falls back to scanning the extracted CV text for an email and
  phone, and **refuses to create a record without a name** (exit with a message
  to re-run with `--first-name`/`--last-name`) rather than writing `Unknown`.

### Added

- **`add_applicant.py`**: `first_email` repairs a TLD split across a PDF line
  break (`gmail.co\nm` → `gmail.com`) but only when a 1-2 letter orphan completes
  a known TLD, so a trailing word (`gmail.com\nPortfolio`) is never swallowed.
  `first_phone` prefers a number on a line that names a phone and ignores
  sub-9-digit runs like year ranges (`2024 - 2024`).
- **`test_parse.py`**: offline unit tests for both helpers (wrapped TLD, trailing
  word, genuine `.co`, year-range exclusion). Wired into `smoke_test.sh`.

### Notes

- Recovered email/phone are printed as a `Contacts:` line and are worth eyeballing
  against the CV — text extraction is imperfect, so the recovery is best-effort,
  not authoritative.

## 2026-07-30 — move: choose POST vs PUT by checking existing vacancy links

### Fixed

- **`huntflow.js`**: `move` now looks up the applicant's existing vacancy links
  (`GET /applicants/{id}`) and picks **PUT** (already linked → change status) or
  **POST** (not linked → attach) deterministically. It previously always issued
  PUT, so moving an applicant not yet on the target vacancy failed with a
  `400 validation_error`. Costs one extra GET per move — the price of choosing
  the method reliably instead of guessing from an error status.

### Notes

- Verified live against a linked applicant (PUT) and an unlinked one (POST); both
  succeed. An earlier attempt caught `405` and fell back to POST, but the unlinked
  case actually returns `400`, not `405` — so the error-code guess was the wrong
  premise and the link check replaced it.

## 2026-07-17 — Document the PR-only workflow in CLAUDE.md

### Added

- **`CLAUDE.md`**: the repo is PR-based — feature branch, PR, merge; no direct
  commits to `main`, including release housekeeping. The rule lived only in
  chat, and `git log` argues against it: v1.0.0's own housekeeping (`cf6acbd`,
  `ec30dc3`, `9148d0a`, `d1348a4`) went straight to `main`, so a session
  reconstructing the convention from history would get it backwards.
  Also documents the `changelog` CI job and its `no-changelog` escape hatch.
  Documentation only; no behavior change.

## 2026-07-17 — Require a CHANGELOG entry in CI when a tool changes

### Added

- **`.github/workflows/ci.yml`**: a `changelog` job fails a PR that touches
  `huntflow.js`, `add_applicant.py`, `reorder_stages.js`, or `setup.sh` without
  touching `CHANGELOG.md`. The `add` command shipped with no entry and was
  only noticed while cutting v1.1.0, by which point the release notes would have
  omitted it entirely.

### Notes

- Scoped to the tool files, so doc- and CI-only PRs are unaffected.
- Labelling a PR `no-changelog` skips the check, for tool changes that genuinely
  don't warrant an entry (a comment typo, a rename). Without an escape hatch the
  check would be noise, and a noisy check gets ignored.

## 2026-07-17 — Add `create-vacancy` command to huntflow.js

### Added

- **`huntflow.js`**: `create-vacancy <position> --deadline <YYYY-MM-DD>` creates
  a vacancy. Previously the only way to open one from the CLI was a hand-rolled
  API call; `huntflow.js` could `close` a vacancy but not create one.
  Options: `--hire <n>` (default: 1), `--division <id>`, `--money <text>`,
  `--company <text>`, `--priority <0|1>`, `--state <OPEN|HOLD>` (default: OPEN),
  `--hidden`, `--dry-run`.
- **`huntflow.js`**: `--dry-run` on `create-vacancy` prints the request body
  without POSTing, mirroring the same flag in `add_applicant.py`. Lets the
  command be exercised without leaving a junk vacancy in the account — the API
  has no vacancy delete, only close.

### Notes

- `--deadline` is required rather than defaulted: the API rejects a vacancy
  without `fill_quotas` (the hiring plan), and a silently invented deadline is
  worse than an explicit ask.
- `--division` is likewise explicit — the correct division is not inferable from
  the position, and defaulting to the account's first one would be a silent
  wrong answer.

## 2026-07-17 — Fix silently dropped `str` request bodies in add_applicant.py

### Fixed

- **`add_applicant.py`**: `raw_request()` encoded `dict`/`list` and `bytes`
  bodies but not `str`, so a `str` body was silently dropped and the request
  went out empty — while still carrying `Content-Type: application/json`,
  because that header is set on `body is not None`. The API answered
  `HTTP 400 value_error.missing / field required`, which reads as a request
  schema problem rather than "your body never arrived". `str` bodies are now
  encoded, matching `huntflow.js`, which passes `JSON.stringify(...)`
  everywhere.

### Added

- **`test_raw_request.py`**: covers `raw_request()` body encoding for `str`,
  `dict`, `bytes`, `None`, and unsupported types. Stubs `urlopen`, so it needs
  no token or network. `smoke_test.sh` runs it as an offline check.

### Notes

- Any other body type now raises `TypeError` naming the type, so the next
  unsupported type fails loudly instead of becoming another empty request.
- Non-JSON paths are unaffected: `upload_cv()` builds its multipart body as
  `bytes` and still takes the `bytes` branch.
- These are the repo's first tests. Stdlib `unittest` rather than pytest, to
  avoid adding a dependency for one file.

## 2026-07-16 — Add `add` command to huntflow.js

### Added

- **`huntflow.js`**: `add <first> <last> --vacancy <vid>` creates a lightweight
  applicant and attaches it to a vacancy. Fills the gap between `add_applicant.py`
  (which needs a CV file to parse) and sourcing work, where the name and a profile
  link are often all there is.
  Options: `--status <sid>` (default: first pipeline stage), `--position <text>`,
  `--linkedin <url>`, `--github <url>`, `--location <text>`, `--source <src_id>`
  (default: LinkedIn), `--tag <tag_id>` (default at the time: one team's tag, now `$HUNTFLOW_DEFAULT_TAG_ID`), `--no-tag`.

### Notes

- Questionary keys and the LinkedIn source id are resolved at runtime rather than
  hardcoded, so `--linkedin`/`--github`/`--location` don't depend on opaque
  account-specific keys.

## 2026-07-13 — Fix release badge for private repo

### Fixed

- **`README.md`**: the dynamic `img.shields.io/github/v/release/...` badge
  shows "no releases or repo not found" because shields.io calls the GitHub
  API unauthenticated, and this repo is private. Switched to a static
  `img.shields.io/badge/release-v1.0.0-blue` badge instead.
- **`CLAUDE.md`**: documented that the release badge is static and must be
  bumped by hand after each new release.

## 2026-07-13 — Add release version badge to README

### Added

- **`README.md`**: shields.io badge showing the latest GitHub release
  version, next to the CI badge. Documentation only; no behavior change.

## v1.1.0 — 2026-07-17

Tagged release.
Everything below this line is included in v1.1.0; entries above it target the
next version.

## v1.0.0 — 2026-07-13

First tagged release.
Everything below this line is included in v1.0.0; entries above it target the
next version.

## 2026-07-13 — Fix DESIGN.md gaps found in review

### Fixed

- **`DESIGN.md`**: added `.claude/hooks/session-start.sh` as a fifth
  component in the architecture table and auth model — it's provisioned
  Bearer tokens for remote/cloud sessions since 2026-07-10 but was missing
  from the doc entirely, which also made the "`setup.sh` is the only way
  tokens get written" claim wrong (now scoped to local/interactive use).
  Also added `close-reasons` to the `huntflow.js` command inventory, where
  it had been omitted. Documentation only; no behavior change.

## 2026-07-13 — Atomic tokens.json writes for setup.sh and session-start.sh

### Fixed

- **`setup.sh`**: the non-macOS `tokens.json` write is now atomic (temp file +
  rename), matching the pattern already used in `huntflow.js`/`add_applicant.py`
  — a crash mid-write can no longer leave a truncated/corrupt token file.
- **`.claude/hooks/session-start.sh`**: same atomic-write fix for the
  `tokens.json` it provisions from env vars in cloud sessions.

### Changed

- **`CLAUDE.md`**: also offer a `CHANGELOG.md` update after a merged PR, not
  just after a push.

## 2026-07-13 — Add DESIGN.md

### Added

- **`DESIGN.md`**: retroactive design doc covering the four components,
  the two auth schemes (Bearer/Keychain for the public API vs.
  session-cookie for `reorder_stages.js`'s internal-API path), error-handling
  conventions, and the design tradeoffs/limitations already noted throughout
  this changelog. Documentation only; no behavior change.

## 2026-07-10 — Add SessionStart hook to provision Huntflow tokens in cloud sessions

### Added

- **`.claude/hooks/session-start.sh`**: writes `~/.huntflow/tokens.json` from
  `HUNTFLOW_ACCESS_TOKEN`/`HUNTFLOW_REFRESH_TOKEN` env vars, so `huntflow.js`
  can authenticate in remote/cloud sessions where macOS Keychain isn't
  available. No-op locally and when the secrets aren't configured on the
  environment.
- **`.claude/settings.json`**: registers the hook to run on `SessionStart`.

## 2026-07-02 — Add `reorder_stages.js` (pipeline stage manager)

### Added

- **`reorder_stages.js`**: manage pipeline stage order, which the public API
  can't do (`/vacancies/statuses` is read-only). Uses Huntflow's **internal web
  API** instead — `GET /app/api/my/<org>/vacancy/status` to read and
  `PUT /app/api/my/<org>/settings/statuses` (JSON array of `{id, name}`, array
  position = order) to save. Commands: `list`, `move <id> before|after <target>`,
  `set-order <id,id,...>`; supports `--json` and `--dry-run`.
- Auth is **session-based**, not the Bearer token the other tools use: set
  `HUNTFLOW_WEB_ORG` and `HUNTFLOW_WEB_COOKIE` (a logged-in browser Cookie
  header). The CSRF token defaults to the `_xsrf` cookie value (override with
  `HUNTFLOW_XSRF`). Cookies are short-lived; refresh on 401/403.

## 2026-07-02 — Add `close` command for vacancies

### Added

- **`close <vid> [reason_id]`** (`huntflow.js`): closes a vacancy via
  `PATCH /vacancies/{id}` with `{state: "CLOSED"}`. The close reason is optional
  (this account doesn't require one); pass a reason ID to set it.
- **`close-reasons`**: lists the account's vacancy close reasons (IDs + labels),
  mirroring `rejections`.

## 2026-07-01 — Genericize README before going public

### Changed

- **`README.md`**: replaced the concrete `HUNTFLOW_ACCOUNT_ID` value with a
  `<your-account-id>` placeholder, and standardized the company name
  in the text. No behavior change — prep for making the repo public.

## 2026-07-01 — Add project `CLAUDE.md`

### Added

- **`CLAUDE.md`**: editing guidelines for AI agents working in this repo —
  simplicity and surgical-change discipline, verify via `smoke_test.sh`, and the
  existing commit/CHANGELOG habits. Documentation only; no change to the tools.

## 2026-07-01 — Fix broken `pipeline` command

### Fixed

- **`pipeline` was returning HTTP 400** (`huntflow.js`): the paginator requested
  `count=100`, but Huntflow's `/applicants` endpoint caps `count` at 30 (only
  `/vacancies` allows 100). A prior "fetch 100 per page" change over-applied the
  bump to this endpoint, breaking `pipeline` entirely. Reverted to `count=30`;
  pagination still fetches every candidate across pages.

## 2026-07-01 — Scriptable error output

### Added

- **JSON error output** (`huntflow.js`): when `--json` is set, failures now emit
  a parseable object on stderr (`{"error":true,"code":...,"status":...,"body":...}`)
  instead of human-readable text, so automation gets structured output on failure
  as well as success. stdout stays clean. `code` is `auth_expired` (exit 2) for an
  invalid/expired token, `error` otherwise.
- **Explicit `-h` / `--help`** (`huntflow.js`): documented as real cases rather
  than relying on the unknown-command fall-through. (`add_applicant.py` already
  has argparse's `-h`/`--help`.)

## 2026-07-01 — Small robustness follow-ups

Three targeted fixes from a second review pass. No changes to how the tools are
used — same commands, same flags.

### Fixed

- **Atomic token writes** (`huntflow.js` + `add_applicant.py`): the token file
  is now written to a temp file and renamed into place, so a crash mid-write can
  no longer leave a truncated/corrupt `~/.huntflow/tokens.json` and lock you out.

### Added

- **`HUNTFLOW_TIMEOUT` env var** (`huntflow.js` + `add_applicant.py`): overrides
  the hardcoded request timeout (Node: milliseconds; Python: seconds). Defaults
  to 30s when unset — useful for slow CV uploads.
- **Exit code 2 for auth failures**: an invalid/expired token or a failed refresh
  now exits `2` instead of the generic `1`, so scripts (e.g. the briefing bot) can
  distinguish "re-auth needed" from other errors.

## 2026-07-01 — Prep for team sharing

- Added an MIT `LICENSE` file (copyright the company) to back the license
  already stated in the README.
- Fixed the clone URL in the README's Installation section — it pointed at a
  `<your-fork>` placeholder; now uses the real repo URL.
- Repository shared with collaborators with write access.

## 2026-07-01 — Review & hardening

Deep code review followed by a round of fixes. No changes to how the tools are
used — same commands, same flags.

### Fixed

**Token storage**
- `huntflow.js`: the token file is now re-locked to `0600` on every write. The
  `mode` option on `writeFileSync` is ignored when the file already exists, so a
  rewrite could previously leave `~/.huntflow/tokens.json` world-readable.
- `setup.sh`: `tokens.json` is now serialized with a real JSON writer (under
  `umask 077`) instead of an unquoted shell heredoc. Tokens containing `"`, `\`,
  or `$` could previously corrupt the file or be shell-expanded. Affects the
  Linux/WSL path only (macOS uses the Keychain).
- `huntflow.js` + `add_applicant.py`: on a 401, the retry now uses the
  freshly-issued access token directly instead of re-reading storage, avoiding a
  rare stale-Keychain read after a refresh.

**Robustness**
- `vacancies` / `pipeline` paginators guard against malformed responses instead
  of throwing, and fetch 100 items per page (was 30) — fewer round-trips.
- `resume` only swallows genuine 404s now; auth/network errors surface instead
  of being reported as "no resume found."
- Argument parsing no longer drops query fragments beginning with `--`
  (e.g. `search --foo`).

**Docs**
- README: CV upload uses the `X-File-Parse: true` header, not `?parse=true`.
- README + `--help`: documented the optional `pipeline <vacancy_id> [status_id]`
  stage filter.

### Reviewed but intentionally not changed

Setup/refresh pass tokens as a command-line argument to macOS `security`, which
is briefly visible via `ps` to the **same user**. Left as-is on purpose: the
exposure is same-user only and momentary, and any process that could read it can
already read the Keychain directly — so it leaks nothing new. `security` offers
no clean non-interactive alternative, and the workarounds (interactive prompt,
temp files, `expect`) either break auto-refresh or create a larger leak surface.
Documented as a known, accepted limitation. Real defense-in-depth here would come
from shorter-lived / narrower-scoped tokens, not from hiding argv.

### Note for `add_applicant.py` users

Huntflow's CV parser is imperfect (in testing it mis-read a date range as the
phone and missed an email in the résumé body). Eyeball the parsed fields and use
`--phone` / `--email` overrides on real runs. `--dry-run` prints exactly what
will be posted without creating anything.
