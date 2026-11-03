---
name: huntflow-add
description: Use when adding candidates to Huntflow from profiles, a shortlist or CV files, or completing an approved intake. For applications received through a website form, use huntflow-site-applications.
license: MIT
metadata:
  author: Da6ka
  version: "1.10.0"
  adapted-for: "Codex"
  source: "https://github.com/Da6ka/huntflow-tools"
---

# Huntflow candidate intake

Use the existing CLI helpers rather than recreating their API flow. Read account
notes from `~/.codex/huntflow-local.md` if present, otherwise
`~/.claude/huntflow-local.md`. Notes contain private account IDs and team rules;
do not copy them into a public repository. Current user instructions take priority.

## Runtime and authorization

Run commands with Codex's terminal execution tool. Installed helpers are in
`~/.codex/utils/`, linked to `~/huntflow-tools/`. Check those paths before use;
fall back to the source checkout if a link is missing. Do not run `setup.sh` or
copy Claude hooks as part of ordinary intake.

Set `HUNTFLOW_ACCOUNT_ID` from the account notes for the command environment.
Check access with `node ~/.codex/utils/huntflow.js me --json`. The Node helper
reads macOS Keychain, then `~/.huntflow/tokens.json`, then token environment
variables. The Python helper reads Keychain or the token file, without the Node
environment fallback. Never print credentials. If sandbox access fails, request
the narrow execution permission for the required command; do not move secrets
into the workspace to work around it.

Resolve live IDs with `vacancies --open`, `statuses`, `tags`, `sources` and
`rejections` (all accept `--json`). Account-note IDs are lookup hints, not proof
of current vacancy state. `add` defaults to LinkedIn source regardless of
`HUNTFLOW_DEFAULT_SOURCE_ID`; pass `--source` for other origins. Pass the
account's ownership tag explicitly when its environment default is uncertain.

Complete dedupe and show a concrete plan before asking for confirmation of
Huntflow writes. Include the candidate, vacancy, stage, source, tags, CV and
comment. Apply an existing confirmation only to its agreed scope. Reading is
allowed; uploading, creating, editing, moving and commenting need confirmation.
Do not edit Huntflow through browser or computer automation.

`add_applicant.py --dry-run` uploads the CV for parsing before printing the
applicant body. It is not an offline preview and needs upload authorization.
Before that authorization, extract CV text locally and show the proposed fields.
`huntflow.js add` has no dry-run flag.

## Dedupe before creating

Search account-wide by every available email, phone, surname and relevant name
variant. Do not limit dedupe to the target vacancy.

```bash
node ~/.codex/utils/huntflow.js search "<email>" --json
node ~/.codex/utils/huntflow.js search "<phone>" --json
node ~/.codex/utils/huntflow.js search "<surname>" --json
```

Inspect matches, including `questionary <id> --json` for secondary contacts.
A negative email search does not prove absence from secondary fields. A matching
contact is strong duplicate evidence; resolve shared or contradictory contacts
before merging identities. Flag duplicate profiles and multiple contacts explicitly.
Report existing applicants instead of creating another record. Linking an existing
applicant to a new vacancy is a separate proposed write.

## Choose the intake path

| Input | Helper |
| --- | --- |
| Profile, spreadsheet row or shortlist without a CV | `huntflow.js add` |
| Existing CV file | `add_applicant.py` |
| Website-form application email | Read `huntflow-site-applications` |

For LinkedIn, use the native Save to PDF export when a CV is needed. Do not
manufacture a resume from profile text. A missing PDF alone does not require
blocking a profile-based intake. Extract PDF text with `pdftotext` and inspect a
bounded portion rather than emitting binary or the entire file into chat.

After confirmation, without a CV:

```bash
node ~/.codex/utils/huntflow.js add "<first>" "<last>" \
  --vacancy <vid> --status <sid> --source <src_id> --tag <tag_id> \
  --email "<email>" --linkedin "<url>" --json
```

Other supported options: `--position`, `--location`, `--github`, `--email2`,
`--no-tag`. Omit unknown fields. This path has no `--phone` or `--telegram`
option. Use `update-contacts <id> --phone "<phone>" --json` for a confirmed
phone update on the created record.

After confirmation, with a CV:

```bash
python3 ~/.codex/utils/add_applicant.py --cv "<path.pdf>" \
  --vacancy-id <vid> --status-id <sid> --source-id <src_id> \
  --tag-id <tag_id> --no-link-files \
  --first-name "<first>" --last-name "<last>" --email "<email>" \
  --comment "<approved comment>"
```

Optional flags: `--phone`, `--position`, `--linkedin`, `--github`, `--telegram`,
`--location`, `--email2`; `--tag-id` is repeatable. Use `--no-link-files` by
default: the CV is already attached to the resume, so the vacancy log need not
attach it again. Without source and tag flags the Python helper skips both.

If a write fails partway through, read the account state and identify the created
record before any retry. Do not rerun creation blindly. If a CV upload or another
flow returns a different applicant ID, re-resolve identity before the next write.
Complete only missing operations within the confirmed scope.

## API invariants

- Tags on create or applicant PATCH are silently ignored. The working endpoint
  is `POST /accounts/<account>/applicants/<id>/tags` with `{"tags":[...]}`.
  It replaces the whole set: preserve existing tags when editing an applicant.
- Updating source uses `PUT .../applicants/<id>/externals/<eid>`. Preserve the
  existing `data` and `files` as well as the desired `account_source`. Omitting
  `files` detaches the CV; omitting `data` fails. Applicant summary file lists
  can be empty; inspect the external detail record through `resume --json`.
- Applicant list requests have a maximum `count=30`. Follow all pages.
  This page size does not limit the number of days searchable in Gmail.
- Custom fields require `questionary`; they are not part of applicant summary.

## Stages and rejection

Resolve stage roles from live statuses and account notes, including the vacancy's
stage group when relevant. The CLI's default is the first account status; pass
the intended stage explicitly. The trash type identifies a rejection stage;
the contacted role comes from team rules.

Follow the account's intake, contacted, rejection sequence and any explicitly
approved exception. A saved email draft is not evidence of contact. Do not move
an applicant to Contacted merely because a draft exists. Where team rules require
an actual sent email before rejection, verify it and obtain the required go-ahead.
Ask for the rejection reason if absent; never infer its dictionary ID.

For an approved move:

```bash
node ~/.codex/utils/huntflow.js move <aid> <vid> <sid> <rejection_id> --json
node ~/.codex/utils/huntflow.js logs <aid> --json
```

Omit `<rejection_id>` for a move without a rejection reason. Obtain the vacancy
from live vacancy/pipeline data. Text logs omit stage and reason; JSON logs show
`vacancy`, `status` and `rejection_reason`. Follow `total_pages` when needed.

For pipeline reporting, use comments, scorecards and dates to establish whether
interviews occurred. Do not interpret a stage as waiting for the interview.
Before a manager update, show candidate, stage, last event date and interview
held (yes/no/unknown), plus total pipeline and unprocessed inbound counts. Wait
for table confirmation before writing the manager prose.

## Verify and report

Read every affected record back; an HTTP 200 or helper DONE line is insufficient.

```bash
node ~/.codex/utils/huntflow.js applicant <id> --json
node ~/.codex/utils/huntflow.js questionary <id> --json
node ~/.codex/utils/huntflow.js resume <id> --json
node ~/.codex/utils/huntflow.js logs <id> --json
```

Check the vacancy link, stage, source, preserved CV, tags and custom fields against
the plan. Report verified results, duplicates, partial failures and unresolved
decisions separately. Link every candidate name with the account's org nickname:
`https://huntflow.ru/app/my/<org>/search/applicants/<id>?q=<URL-encoded full name>`.

Rejection and invitation emails are unsent Gmail drafts only. Use the available
Gmail connector after verifying its mailbox. Address the candidate's actual email,
leave out the signature, and do not send, delete drafts or update contact stages
as a side effect. A rejection reason is the reject log's `rejection_reason`, not
necessarily its comment. Use the appropriate candidate-writing skill when drafting.
