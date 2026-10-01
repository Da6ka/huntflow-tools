# huntflow-tools

[![CI](https://github.com/Da6ka/huntflow-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/Da6ka/huntflow-tools/actions/workflows/ci.yml) [![Release](https://img.shields.io/badge/release-v1.7.3-blue)](https://github.com/Da6ka/huntflow-tools/releases/latest)

Run your [Huntflow](https://huntflow.ru) recruiting day from the terminal instead of clicking through the web app. Pull up a vacancy's pipeline, check where a candidate stands, move someone forward or reject them with a reason, add a candidate straight from their CV. Type the commands yourself, or ask Claude to do it for you in plain language.

## What you can do with it

- **See your pipeline at a glance.** List open vacancies (all of them, or only yours), open one, and see everyone in it and the stage they're at. Filter the pipeline by stage.
- **Look things up fast.** Search applicants by name and narrow by vacancy, stage or tag. Read a candidate's details, resume, full stage history and comments. List rejection reasons, pipeline stages, tags, sources, divisions and the people on your account.
- **Move candidates.** Advance someone to the next stage, or reject them with the right reason attached, in a single command. A comment can go on the stage change itself.
- **Leave comments.** Add a personal note to a candidate, or a comment tied to a vacancy. Huntflow's API can't edit or delete a comment, so write them once.
- **Create, update and close vacancies.** Open a new one with a deadline, headcount, salary and priority. Change the description, requirements, conditions, salary or state later, and close it with a reason. Every write has a `--dry-run` preview.
- **Add a candidate from a CV.** Point it at a PDF and a vacancy; it reads the CV, creates the candidate, and files them at the stage you choose. You can set the source, tag, LinkedIn, GitHub, Telegram, location, a second email and a first comment in the same command. Handy for cold inbounds that skip your career page.
- **Add a candidate without a CV.** Name, vacancy and a few links are enough, for example for a profile you found on LinkedIn.
- **Attach a CV to someone already in your pipeline.** The public API only lets you add a resume when a candidate is first created. An advanced tool adds one to a record that already exists.
- **Reorder your pipeline stages.** In the web UI that's drag-and-drop only. An advanced tool does it in one command.
- **Take in website applications.** A Claude Code skill reads application emails from your company inbox, checks each person against Huntflow by email, phone and surname, adds the new ones with CV, source and tag, and lists who is already in Huntflow but never got a reply. It was built around one team's form email, so you tell it your form's sender and subject first.

## Quick start

About 10 minutes, once.

**You need:** Node 18 or newer, Python 3.9 or newer (no `npm install`, no extra packages), and a Huntflow account where you can create an API token. If the option is missing in your settings, ask your account admin.

**1. Download the tools**

```bash
git clone https://github.com/Da6ka/huntflow-tools.git
cd huntflow-tools
chmod +x setup.sh huntflow.js add_applicant.py reorder_stages.js
```

**2. Create your own API token.** In Huntflow open Settings (the gear), then API and webhooks, then Tokens, then Add token, then Generate new. Name the token after yourself, for example `huntflow-tools (yourname)`, and follow the link to get the **access token** and the **refresh token**. Every person needs a separate token. Regenerating or deleting yours never affects anyone else's.

**3. Save the tokens**

```bash
./setup.sh
```

Paste the access token, then the refresh token (the input is hidden). On macOS they go to the Keychain. On Linux, Windows and WSL they go to `~/.huntflow/tokens.json` (permissions 600). Tokens are never written into the repo.

**4. Find your account ID and save it.** The setup script prints the command. It is this one, with your access token in place of `$YOUR_ACCESS_TOKEN`:

```bash
curl -H "Authorization: Bearer $YOUR_ACCESS_TOKEN" https://api.huntflow.ru/v2/accounts
```

Take the numeric `id` from the answer and add it to `~/.zshrc` (or `~/.bashrc`), then open a new terminal:

```bash
export HUNTFLOW_ACCOUNT_ID=123456    # replace with your real ID
```

**5. Check that it works**

```bash
node huntflow.js me
# "Your Name (you@example.com)"
```

Optional: `bash smoke_test.sh` runs the full self-check. It only reads data and changes nothing in Huntflow. If the live checks fail with an invalid-token message, redo step 2.

## Using it with Claude

If you use [Claude Code](https://claude.com/claude-code), you can skip the commands and say what you want:

- "Show me the pipeline for the backend vacancy."
- "Move Ivan to the interview stage."
- "Add these two LinkedIn profiles to Huntflow for the data engineer role."
- "Reject this candidate, the reason is mismatched qualification."

Claude runs the tools for you and shows what it did. Writes to Huntflow can be previewed with `--dry-run` first.

**One-time connection.** This assumes you cloned the repo to `~/huntflow-tools`. Symlink the tools and the skills, so a `git pull` here updates what Claude runs:

```bash
mkdir -p ~/.claude/utils ~/.claude/skills
for f in huntflow.js add_applicant.py add_resume.js reorder_stages.js; do
  ln -s ~/huntflow-tools/$f ~/.claude/utils/$f
done
for s in huntflow-add huntflow-site-applications; do
  ln -s ~/huntflow-tools/.claude/skills/$s ~/.claude/skills/$s
done
```

Keep `HUNTFLOW_ACCOUNT_ID` in your shell profile (step 4 above). Inside this repo's folder Claude Code loads the skills without any symlinks.

### The `huntflow-add` skill

Adds candidates from any source: a LinkedIn profile, a spreadsheet row, a shortlist, a CV file. It checks whether the person is already in Huntflow, creates the record, attaches the CV, sets tag and source, links the candidate to the vacancy at the right stage, and reads everything back to confirm it saved. It also drafts, but never sends, rejection and invitation emails.

It finds your stages by role, not by name, so custom or non-English stage names work: the first stage is where candidates land, the reject stage is the one Huntflow marks as trash, and the "contacted" stage comes from your notes file (or it asks). Its default flow is intake, then contacted, then reject, never straight from intake to reject, and it never rejects anyone on its own, it asks you first. If your team works differently, say so in your [own notes file](#your-own-notes-for-claude). The details of what the Huntflow API silently ignores are in the skill's `SKILL.md`.

### The `huntflow-site-applications` skill

Loads job applications that arrive by email from a form on your website. It takes the letters from the last 30 days from your Gmail inbox, checks each person against Huntflow, downloads the CV, adds the new ones with source, tag and vacancy, marks the emails as read, and reports who is already in Huntflow but never got a reply.

It was built around one team's form email, so expect to adapt it. At the start it asks for your form's sender and subject (or reads them from your notes file). It needs a Gmail connector for the mailbox that receives the form emails and browser control for downloading attachments.

## Commands

### huntflow.js

| Command | Description |
| --- | --- |
| `me` | Current user |
| `vacancies [--open] [--mine]` | All vacancies (`--open`: only OPEN, `--mine`: only yours) |
| `vacancy <id>` | Vacancy details |
| `pipeline <vacancy_id> [status_id]` | Candidates in the vacancy pipeline (optionally filtered to one stage) |
| `applicant <id>` | Applicant details |
| `resume <applicant_id>` | Resume entries (externals) |
| `logs <applicant_id>` | Applicant pipeline history |
| `comments <applicant_id>` | Comments on an applicant |
| `comment <applicant_id> <text> [--vacancy <vid>]` | Add a comment; a personal note without `--vacancy`. The API has no edit or delete |
| `statuses` | Pipeline stages (IDs and labels) |
| `rejections` | Rejection reason catalog |
| `move <aid> <vid> <sid> [rid]` | Move applicant to a stage, optional rejection ID |
| `create-vacancy <position> --deadline <YYYY-MM-DD>` | Create a vacancy |
| `close <vid> [reason_id]` | Close a vacancy (optional close reason ID) |
| `update-vacancy <id>` | Update a vacancy (partial: only the fields you pass change) |
| `close-reasons` | Vacancy close reason catalog |
| `search <query>` | Search applicants. Optional filters: `--vacancy <id>`, `--status <id>`, `--tag <id>` (filters alone work too) |
| `coworkers` | Recruiters and other account members |
| `divisions` | Account divisions |
| `tags` | Account tags |
| `sources` | Resume sources, the ids for `--source` |
| `add <first> <last> --vacancy <vid>` | Create an applicant and attach them to a vacancy |

All commands accept `--json` for machine output.

**`create-vacancy` options:** `--hire <n>` (default: 1), `--division <id>`,
`--money <text>`, `--company <text>`, `--priority <0|1>`, `--state <OPEN|HOLD>`,
`--hidden`, `--dry-run`.

**`update-vacancy` options:** `--body <html>`, `--requirements <html>`,
`--conditions <html>` (the three description blocks), or their file forms
`--body-file <path>`, `--requirements-file <path>`, `--conditions-file <path>`
for long HTML; plus `--money <text>`, `--position <text>`,
`--state <OPEN|HOLD|CLOSED>`, `--dry-run`. Only the fields you pass are sent, the
rest are left untouched. Pass an empty string (e.g. `--conditions ""`) to clear a
field.

**`add` options:** `--status <sid>` (default: first pipeline stage),
`--position <text>`, `--location <text>`, `--linkedin <url>`, `--github <url>`,
`--email <addr>`, `--email2 <addr>` (secondary, the "2nd Email" field),
`--source <src_id>` (default: LinkedIn), `--tag <tag_id>`, `--no-tag`.

`add` creates the applicant without a CV. Use it for LinkedIn profiles,
spreadsheet rows and shortlist entries. When a CV file exists, use
[`add_applicant.py`](#add-a-candidate-from-a-cv-add_applicantpy) instead, which uploads and parses it.

**Example: reject an applicant**

```bash
# find the rejection reason
node huntflow.js rejections
# [300001] Mismatched qualification
# ...

# look up the reject stage
node huntflow.js statuses
# [200099] Reject (trash)

# move: applicant, vacancy, stage, reason
node huntflow.js move 500001 100001 200099 300001
```

**Example: pipeline snapshot** (needs [jq](https://jqlang.github.io/jq/))

```bash
node huntflow.js pipeline 100001 --json | jq '.[] | {id, name: (.last_name + " " + .first_name), status: .links[0].status}'
```

### Add a candidate from a CV: add_applicant.py

Creates a brand-new candidate from a CV file. Useful when someone emails a cover letter directly instead of going through your career page, or when you re-onboard a candidate from a previous engagement.

```bash
python3 add_applicant.py \
  --cv /path/to/cv.pdf \
  --vacancy-id 100001 \
  --status-id 200001 \
  --money "2400 EUR/mo" \
  --comment "Cold inbound. Self-rated English B2, UTC+5, open to contract."
```

The script does three things:

1. Uploads the CV to `/upload` with the `X-File-Parse: true` header (Huntflow's parser extracts name, email, phone and experience).
2. Creates the applicant via `POST /applicants` with the parsed data, attaching the file as an external.
3. Links the applicant to a vacancy with `POST /applicants/{id}/vacancy` at the chosen status, with the comment.

| Flag | Required | Notes |
| --- | --- | --- |
| `--cv PATH` | Yes | PDF, DOC, DOCX, RTF. Anything Huntflow's parser accepts. |
| `--vacancy-id INT` | Yes | Target vacancy. |
| `--status-id INT` | Yes | Pipeline stage at creation. `huntflow.js statuses` lists them. |
| `--comment TEXT` | No | Free-form note attached to the link (visible in the candidate's pipeline history). |
| `--first-name` / `--last-name` | No | Overrides the parsed name. |
| `--email` / `--phone` | No | Overrides parsed contacts. |
| `--position` | No | Position label on the applicant card. |
| `--money TEXT` | No | Salary expectation string. |
| `--linkedin URL` / `--github URL` | No | Questionary fields. |
| `--telegram HANDLE` | No | `name`, `@name` or a `t.me` link; stored in the applicant's social list. A handle with a space or under 5 characters is refused. |
| `--dry-run` | No | Parse the CV and print the body, don't POST. |

Huntflow's CV parser sometimes gets a phone or email wrong. Run with `--dry-run` first and check what it would send:

```bash
python3 add_applicant.py --cv cv.pdf --vacancy-id 100001 --status-id 200001 --dry-run
```

## Settings and advanced

Everything above works with the defaults. This part is for tuning and for the two tools that need a browser session.

### Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `HUNTFLOW_ACCOUNT_ID` | all | Your numeric account ID (required) |
| `HUNTFLOW_DEFAULT_TAG_ID` | `huntflow.js add` | Tag applied to new candidates. `--tag` and `--no-tag` override it |
| `HUNTFLOW_DEFAULT_SOURCE_ID` | `add_resume.js` | Default source for the attached CV (ids are per account, see `huntflow.js sources`) |
| `HUNTFLOW_TIMEOUT` | all | Request timeout in milliseconds (default 30000) |
| `HUNTFLOW_WEB_ORG` | `reorder_stages.js`, `add_resume.js` | Organization nickname from your Huntflow URL, for example `acme` |
| `HUNTFLOW_WEB_COOKIE` | `reorder_stages.js`, `add_resume.js` | Browser session cookie, see below |
| `HUNTFLOW_XSRF` | `reorder_stages.js`, `add_resume.js` | CSRF token override. Defaults to the `_xsrf` value in the cookie |

### Your own notes for Claude

Tag, source, status and vacancy IDs are different in every Huntflow account, so the skills carry none. If you create `~/.claude/huntflow-local.md`, the skills read it first and treat it as your account notes. It stays on your machine, outside the repo. Put in whatever is specific to you:

```
# My Huntflow notes
- Default tag: 123 (Inbound). Set HUNTFLOW_DEFAULT_TAG_ID=123.
- Website form: sender noreply@mycompany.com, subject "New application".
- Candidates from <country> are rejected without an interview (legal reasons).
- Our "contacted" stage is called "Reached out". We skip it for referrals.
- Our team writes in another language: use "<our label for application date>:" and "<our label for cover letter>:" in comments.
```

### Tell Claude where the tools are (optional)

If you want Claude to know the tools in every session, add a short block to your `~/.claude/CLAUDE.md`:

```
### Huntflow ATS
- Helper: `~/.claude/utils/huntflow.js` (read, move, close)
- Add applicant: `~/.claude/utils/add_applicant.py` (CV upload, create, link)
- Config: `HUNTFLOW_ACCOUNT_ID` env, tokens in Keychain (`huntflow-access-token`, `huntflow-refresh-token`)
- Common commands: `vacancies --open`, `pipeline <vid>`, `applicant <id>`, `logs <id>`, `move <aid> <vid> <sid> [rid]`
```

### Reorder pipeline stages: reorder_stages.js

The public API is read-only for pipeline stages: `huntflow.js statuses` lists them, but there is no public way to create, rename or reorder. This script uses the internal web API that the huntflow.ru web app itself calls, so it authenticates with your **browser session cookie** instead of the API token. Treat that cookie like a password.

Get the cookie from a logged-in huntflow.ru tab: DevTools, Network, any `/app/api/` request, Request Headers, `cookie`. Cookies are short-lived. On `401` or `403`, copy a fresh one.

| Command | Description |
| --- | --- |
| `list` | Stages in current display order (with IDs) |
| `move <id> before\|after <targetId>` | Move a stage relative to another |
| `set-order <id,id,id,...>` | Set an explicit order; any omitted stages keep their relative order at the end |

Both accept `--json` and `--dry-run` (show the resulting order without saving). The trash stage and virtual pseudo-stages are left out automatically.

```bash
export HUNTFLOW_WEB_ORG=acme
export HUNTFLOW_WEB_COOKIE='sessionid=...; _xsrf=...; ...'

# see current order and IDs
node reorder_stages.js list

# put stage 111111 ("Interview scheduled") right before 222222 ("Interview")
node reorder_stages.js move 111111 before 222222 --dry-run   # preview
node reorder_stages.js move 111111 before 222222             # save
```

### Add a CV to an existing candidate: add_resume.js

The public API accepts a resume only when a candidate is created: `POST /applicants/<id>/externals` returns 404. Huntflow support confirmed the only supported path is to create a new applicant with the CV and then merge the duplicates. This script automates exactly that, addressing the merge by explicit ids so it never relies on Huntflow's fuzzy automatic duplicate detection:

1. upload and parse the CV (public API),
2. create a temporary applicant carrying that resume (public API),
3. merge the temporary one into the target (internal web API), which moves the resume onto the target's card and removes the temporary record.

Step 3 needs the same session cookie as `reorder_stages.js`, plus `HUNTFLOW_ACCOUNT_ID`.

The merge reassigns the applicant's canonical id (the old id keeps resolving as an alias), the same as Huntflow's "Magic Button" enrichment. Huntflow's duplicate detection is asynchronous, so the script retries the merge when it answers `Unknown double`.

The script checks the session cookie before it creates anything. If the merge still fails, the temporary applicant stays in Huntflow, because the API cannot delete applicants. The script prints that record's id: merge or delete it in the UI before you run the script again.

```bash
export HUNTFLOW_ACCOUNT_ID=123456
export HUNTFLOW_WEB_ORG=acme
export HUNTFLOW_WEB_COOKIE='...; _xsrf=...; atoken=...'

# add cv.pdf to applicant 500001
node add_resume.js 500001 cv.pdf

# preview only: uploads, creates and merges nothing
node add_resume.js 500001 cv.pdf --dry-run

# create the temporary record but stop before merging (merge by hand in the UI)
node add_resume.js 500001 cv.pdf --keep-temp
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--source <id>` | `$HUNTFLOW_DEFAULT_SOURCE_ID` | Source for the resume (ids are per account; list them with `huntflow.js sources`) |
| `--auth-type <type>` | `NATIVE` | external `auth_type` |
| `--keep-temp` | off | create the temporary record, don't merge |
| `--json` | off | machine-readable output |
| `--dry-run` | off | print the plan; write nothing |

### How authentication works

The Huntflow API uses short-lived access tokens (about 5 minutes) and long-lived refresh tokens (about 14 days). The tools:

1. Read the access token from the macOS Keychain or from `~/.huntflow/tokens.json`.
2. On a 401, call `POST /token/refresh` with the refresh token.
3. Save the new pair back to the same place.

If you see "No refresh token" or "Token refresh failed", create a new token pair in Huntflow (step 2 of the quick start) and rerun `./setup.sh`.

### Security

- Tokens never appear in code or git history. Keychain or a local file only.
- `~/.huntflow/tokens.json` is written with permissions 600.
- `.gitignore` already excludes `tokens.json`, `*.pdf`, `*.docx` and other obvious leak surfaces.
- `reorder_stages.js` and the merge step of `add_resume.js` use Huntflow's internal web API with your browser session cookie. Keep it in an environment variable, never in a file or shell history you share. This API is undocumented and can change or be restricted without notice; check Huntflow's terms for your account before relying on it.
- Tokens are passed to the macOS `security` command as an argument, so they are visible in the process list for the moment that command runs. Use a single-user machine.
- `--comment-file` and the other `--*-file` flags read any path you give them and send the content to Huntflow. If an agent runs these commands for you, check the path first.
- Don't put private candidate data in `--comment` that you wouldn't want in the Huntflow audit log; a comment is visible to anyone with pipeline access.
- To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Changing the tools or the skills? See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks, the release steps and the skill trigger evals.

## License

MIT.
