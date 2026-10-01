# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting (Security tab, "Report a vulnerability") on this repo. You
will get a reply within a week. This is a small personal project, so there is no
bounty and no formal SLA.

## What the tools handle

- Huntflow API access and refresh tokens (macOS Keychain, or `~/.huntflow/tokens.json`
  with mode 0600).
- A Huntflow browser session cookie, read from an env var, for the internal web API
  calls in `reorder_stages.js` and `add_resume.js`.
- Candidate data (names, contacts, CVs) on its way to and from Huntflow.

Nothing is sent anywhere except `api.huntflow.ru` and `huntflow.ru`. The tools have
no telemetry and no other dependencies.

## Known limits

- Tokens reach the macOS `security` command as an argument, so they are briefly
  visible in the process list.
- `--*-file` flags read any local path you pass and upload the content.
- The internal web API is undocumented and may change or be restricted by Huntflow.
- The `SessionStart` hook in `.claude/settings.json` only acts when
  `CLAUDE_CODE_REMOTE=true` and both `HUNTFLOW_ACCESS_TOKEN` and
  `HUNTFLOW_REFRESH_TOKEN` are set; otherwise it exits without doing anything.

## If a token leaks

Revoke it in Huntflow (Settings, Integrations, API Tokens), create a new pair, and
rerun `./setup.sh`.
