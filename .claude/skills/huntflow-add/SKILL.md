---
name: huntflow-add
description: Add one or more candidates to the Huntflow ATS end to end — dedupe, create the applicant, attach the CV, set tags and source, link to a vacancy at the right pipeline stage, and verify every write by reading the records back. Use whenever candidates need to go into Huntflow, from any source (LinkedIn profile, spreadsheet row, website application, Juicebox or other shortlist), and for the rejection and invitation drafts that follow. Triggers on "add this candidate to Huntflow", "add these profiles to the ATS", "put them in Huntflow", or a batch of profiles handed over for intake.
license: MIT
compatibility: Requires Bash, this repo's huntflow.js and add_applicant.py on the machine, and Huntflow API credentials (see the README "Quick start"). Without them the skill can draft and plan, but every write step fails.
metadata:
  author: Da6ka
  version: "1.7.3"
---

# huntflow-add

End-to-end candidate intake for the Huntflow ATS. Wraps `huntflow.js add` and
`add_applicant.py` with the ordering rules and gotchas that the API does not
enforce on its own.

Tag, source, status and vacancy IDs are per-account. Look them up with
`huntflow.js tags`, `sources`, `statuses` and `vacancies --open` instead of
guessing. If `~/.claude/huntflow-local.md` exists, read it first: it holds this
user's account notes (IDs, team rules) and applies on top of everything below.

## Pick the path first

| Situation | Command |
| --- | --- |
| No CV file — LinkedIn URL, spreadsheet row, shortlist entry | `huntflow.js add` |
| A CV file exists — website application, emailed PDF | `add_applicant.py` |

`huntflow.js add` already applies the default tag, resolves the LinkedIn source,
writes questionary fields and links the vacancy in one call. `add_applicant.py`
uploads and parses the CV and links the vacancy. It sets tag and source only when
you pass `--tag-id` and `--source-id` (plus `--linkedin`, `--github`, `--location`,
`--email2` for questionary fields); without those flags it skips both, and you
make the separate calls below.

Applications that arrive by email from a website form: use
`huntflow-site-applications` instead.

## Step 1: dedupe before creating anything

```bash
node ~/.claude/utils/huntflow.js search "First Last" --json
```

Search account-wide, not just the target vacancy. If a match comes back, stop
and report it rather than creating a second record. A person who mass-applied to
several roles already exists.

## Step 2a: add without a CV

```bash
node ~/.claude/utils/huntflow.js add "First" "Last" \
  --vacancy <vid> \
  [--status <sid>] [--position <text>] [--location <text>] \
  [--linkedin <url>] [--github <url>] \
  [--email <addr>] [--email2 <addr>] \
  [--source <src_id>] [--tag <tag_id>] [--no-tag]
```

Defaults that are already correct — do not pass them explicitly:

- `--status` defaults to the first pipeline stage
- `--source` defaults to LinkedIn (resolved by `foreign: "LI"`, not hardcoded)
- `--tag` defaults to `$HUNTFLOW_DEFAULT_TAG_ID` when that is set, otherwise no tag

## Step 2b: add with a CV

```bash
python3 ~/.claude/utils/add_applicant.py --cv <path.pdf> --vacancy-id <vid> --status-id <sid>
```

For a LinkedIn candidate the CV should be LinkedIn's own **Save to PDF** export
(profile → ⋯ → Save to PDF), not a hand-built text file — it carries contacts
and full education that page text does not.

If you did not pass `--tag-id` and `--source-id`, set them by hand:

```bash
# tag
POST /accounts/<account>/applicants/<id>/tags  {"tags":[<tag_id>]}

# source, on the RESUME record — get <eid> from applicant.external[0].id
PUT /accounts/<account>/applicants/<id>/externals/<eid> \
  {"account_source":<src_id>,"data":{"body":""},"files":[<file_id>]}
```

List source IDs with `huntflow.js sources`.

## The four gotchas

1. **`tags` is silently dropped on create.** Neither the applicant-create body
   nor `PATCH /applicants/<id>` applies a tag — both return 200 and do nothing.
   Only `POST /applicants/<id>/tags` works. That POST **replaces** the whole set,
   so to remove one tag, re-post the set you want to keep.
2. **The source PUT detaches the CV.** Setting `account_source` without also
   passing `files:[<file_id>]` drops the file from the resume. The applicant
   *summary* always shows `external[].files` as `[]` — verify through the
   external *detail* endpoint instead.
3. **`data` is required on the source PUT.** Omitting it returns
   `400 value_error.missing /data`. `{"body":""}` is a valid empty payload.
4. **`count` caps at 30** on `/applicants` list calls. Page through; a higher
   count is a 400, not a truncated list.

## Status rules

Statuses are global within an account, not per status-group: a group only selects
and orders which ones appear. Get the IDs from `huntflow.js statuses`.

Stage names are custom in every account and can be in any language (Reject may be
called Declined, Отказ, Not a fit). This skill never matches a stage by its name.
It works with three roles, resolved from `huntflow.js statuses`:

- **intake**: the first stage in the list, where new candidates land.
- **reject**: the stage whose type is `trash`. There is exactly one.
- **contacted**: the stage that means "the decline or first message has been
  sent". Its position and name differ per team, so take it from the local notes
  file; if the notes do not say, show the stage list and ask which one it is.

Default flow, used when the local notes file does not describe another:

- **Never move intake → reject directly.** The sequence is always
  intake → contacted → reject, for real vacancies and for any "parking" pool.
- **Never move anyone to reject on your own initiative.** Stop at contacted and
  leave them there. Contacted means "the decline has been written to them", so
  the reject step waits until the recruiter has actually sent it, including when
  they say "reject them". Ask.

A team with a different flow (no contacted stage, or a different order) says so in
the local notes file, which wins over this default.

## Step 3: verify, then report

Read every record back — a 200 is not proof, given gotcha 1.

```bash
node ~/.claude/utils/huntflow.js applicant <id> --json   # tag, fields
node ~/.claude/utils/huntflow.js resume <id> --json      # source, CV attached
node ~/.claude/utils/huntflow.js logs <id> --json        # stage actually set
```

Report as a table, linking each candidate's name to their profile:

```
https://huntflow.ru/app/my/<org>/search/applicants/{id}?q={url-encoded name}
```

`<org>` is the nickname in your Huntflow URL. The `q` parameter is required —
without it the page loads a blank search shell.

## Drafts that follow

Rejection and invitation emails are **drafted, never sent**. Address the
candidate directly, not a shared forwarding address. Leave drafts bare — no
signature; the recruiter adds theirs in the mail UI and deletes drafts themselves.

When reading *why* someone was declined, the reason is the `rejection_reason`
dictionary ID on the reject log entry — the `comment` field is usually empty, so
a log dump showing only status and comment reads as "no reason recorded" and is
wrong. Ask which reason applies rather than inferring it
(`huntflow.js rejections` lists them).
