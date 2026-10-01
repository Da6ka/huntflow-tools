---
name: huntflow-site-applications
description: Process job applications that arrive by email from a company website form into Huntflow. Finds the application emails in the team Gmail for the last 30 days, dedupes against Huntflow, downloads the CV, adds new candidates with source, tag, questionary fields and vacancy link, marks the emails read, and reports who is already in Huntflow but never got a reply. Use on "process the website applications", "load the site applications into Huntflow", "check new applications from the form", or any request to intake website applications.
license: MIT
compatibility: Requires Bash, ~/.claude/utils/add_applicant.py and huntflow.js, Huntflow credentials (Keychain), a Gmail connector for the mailbox that receives the form emails, and Chrome MCP logged into that mailbox for CV download.
metadata:
  author: Da6ka
  version: "1.7.3"
---

# huntflow-site-applications

Website applications into Huntflow. General intake rules (statuses, dedupe, links) live in `huntflow-add`; this skill only adds what is specific to the website flow. The CLI reads `HUNTFLOW_ACCOUNT_ID` from the environment.

This flow was built around one team's form email. The sender address, subject line, vacancy list, tag and source IDs, and team rules are in `~/.claude/huntflow-local.md` if it exists; read it first. Without it, ask the recruiter for the form's sender and subject, and look IDs up with `huntflow.js vacancies --open`, `tags`, `sources`, `statuses`.

## 1. Trigger

The recruiter asks to process website applications. Nothing runs on a schedule. Writes to Huntflow happen only after they have seen the plan (who is new, who is skipped).

## 2. Find the emails in Gmail

Search the form's sender and subject over the last 30 days, no UNREAD filter (Huntflow returns at most 30 records per request, so a longer window is not searchable). One thread can bundle several applicants: read every message.

Take the candidate's email from the body (`Name and email`), not from From:, which is the form's technical address. The body also has the position, the message and a website link. A CV PDF is attached.

## 3. Dedupe in Huntflow

Search each address separately, then phone, then surname:

```bash
node ~/.claude/utils/huntflow.js search "<query>" --json
```

A candidate counts as absent only when nothing matches by any address, phone or surname. A contact match is a duplicate in ~99% of cases; a different surname is not an argument against (it changes after marriage). Huntflow search seems to find email only in the main field, not in "Email 2", so a miss by email proves nothing (reported by the recruiter, not verified).

## 4. Who needs handling

- Not in Huntflow: full cycle (steps 5-10).
- In Huntflow: check outgoing mail. Gmail search `from:me to:(a OR b OR c) after:<response date>`. Do not check the response thread itself, the answer usually goes as a new message. Replies go from the same mailbox, so no other channel is checked. No outgoing mail: put a line in the final report, change nothing in Huntflow. Outgoing mail exists: skip.

## 5. Download the CV

Gmail connector cannot download attachments. Use Chrome MCP:

1. Open `https://mail.google.com/mail/u/0/#all/<msgId>` and confirm u/0 is still the right mailbox (accounts can swap slots). If it asks to sign in, stop and tell the recruiter.
2. `find` "Download attachment <file>", click. The file lands in ~/Downloads, sometimes only after about 2 minutes. Each retry leaves a `name (1).pdf` copy.
3. Fallback: the top-level "Add to Drive" button, then the Drive connector (`search_files` by exact title, filenames are often generic).

## 6. Add to Huntflow

```bash
python3 ~/.claude/utils/add_applicant.py --cv <pdf> \
  --vacancy-id <vid> --status-id <new_status_id> --comment "<New comment>" \
  --first-name "<as in CV>" --last-name "<as in CV>" --email <main> \
  --source-id <site_source_id> --tag-id <tag_id> --no-link-files \
  [--email2 <second>] [--linkedin <url>] [--github <url>] [--telegram <handle>] [--location "<text>"] --dry-run
```

Run with `--dry-run` first, show the body, then repeat without it. Names exactly as in the CV (form names can differ from the CV, e.g. a short form name versus the full legal name). Fix a name later with PATCH on the applicant (PUT is 405).

## 7. Field rules

- Main email = the one the application came from. Second address goes to the questionary field "2nd Email" (`--email2`). Third and later go into the comment.
- LinkedIn, GitHub and Location go through `--linkedin`, `--github`, `--telegram`, `--location`; the tool resolves the account's questionary keys by field title. Write only what the CV actually has, never invent a GitHub. If the CV gives a bare handle (`github: name`, `linkedin: name`), build the standard URL: `https://github.com/<name>`, `https://www.linkedin.com/in/<name>`. Telegram (`tg: @name`) goes into the applicant's social list via `--telegram name` (no `@`). A handle that looks broken, for example split by a space after a PDF export (`@jane doe_dev`), is not guessed: ask the user for the real one.
- The comment of the intake-stage status log: `Application date: DD.MM.YYYY` (Gmail date, in the team's timezone). If the letter has real text, add `Cover letter:` and the letter verbatim. Those two labels are the English default; if the local notes file gives labels in another language (for a Russian-language team: `Дата отклика:` and `Сопроводительное:`), use those instead and keep them identical across candidates so the log stays searchable. If the body is only a website link, add nothing. The vacancy link is created without CV files (`--no-link-files`).

## 8. Vacancy

Match by the position in the form against `huntflow.js vacancies --open`. If no vacancy fits, ask the recruiter instead of guessing. Team rules about paused roles or talent pools come from the local notes file.

## 9. Tags

`POST /applicants/{id}/tags` replaces the whole set, so resend the default tag with any other tag you add. Add priority or campaign tags only when the recruiter names them.

## 10. Rejections

After intake offer a Gmail draft (bare, no signature, never sent) and a move to the contacted stage. The default order is intake stage, contacted stage, reject stage (roles as defined in `huntflow-add`, resolved from `huntflow.js statuses`, never by stage name; the local notes file can describe another flow), and the reject step only after the recruiter sent the email and said go. Ask which reason applies, do not infer (`huntflow.js rejections`; the field is `rejection_reason`). Location or work-authorization rules for specific countries come from the local notes file.

## 11. Mark read

After a successful Huntflow write, remove UNREAD from the source emails: `unlabel_message` or `unlabel_thread` with `["UNREAD"]`. `get_message` does not clear it. This is a side step after intake, never a selection filter.

## 12. Verify

Read each new candidate back and check: vacancy, status, tags (default tag present), source, questionary fields, and the CV on the external detail endpoint `/applicants/<id>/externals/<eid>` (the summary `files` is always `[]`).

## 13. Gotchas

- PUT of a source on an external drops the CV unless `files:[...]` is passed (the script does this).
- Edit a log with `PUT /applicants/<id>/logs/<log_id> {comment, files:[]}`. DELETE and PATCH give 405, so stray comments cannot be removed by API.
- The API cannot merge or delete candidates, or unlink them from a vacancy. Hand these to the recruiter.
- Huntflow pulls emails automatically from senders already in the ATS. That CV lands on the email, not in the Resume section.
- `api()` in the helper calls `sys.exit(1)` on any HTTP error: wrap probes.

## 14. Final report

Short. Candidate names as hyperlinks `https://huntflow.ru/app/my/<org>/search/applicants/{id}?q={url-encoded name}` (the `q` param is required). Sections: added (vacancy, status), skipped as duplicate, in Huntflow but no reply from us, needs the recruiter's decision. No emoji, no dashes.
