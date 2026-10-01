Design Doc: huntflow-tools
===========================

Status: as-built (retroactive). Reflects the codebase as of 2026-07-13, with the structure and verification sections refreshed 2026-10-02.

Context and motivation
-----------------------

Huntflow's own UI is the only way to do most ATS tasks by hand — checking a
pipeline, moving a candidate, adding an inbound applicant from a CV. This repo
gives that same functionality a scriptable command-line surface, built
specifically to be called by an AI agent (Claude Code) via Bash, with `--json`
output on every command so results can be parsed rather than screen-scraped.

Goals:
- Read and mutate Huntflow data (vacancies, applicants, pipeline stages) from
  the CLI, with no dependencies beyond Node/Python stdlib.
- Survive unattended/repeated use: auto-refresh expired tokens, structured
  error output, non-zero exit codes an agent or script can branch on.
- Work for a small team sharing one Huntflow account, each with their own API
  token.

Non-goals:
- Not a full Huntflow API client — only the endpoints actually needed
  (vacancies, applicants, pipeline, close, search, divisions, tags, and now
  stage reordering via a separate path).
- Not a general-purpose OAuth library — token handling is Huntflow-specific
  and deliberately minimal.
- No GUI, no server component, no multi-tenant credential store.

Architecture overview
----------------------

Independent scripts, no shared code (each is small enough that a shared
module would cost more than it saves):

| Component            | Language | Talks to                          | Auth                          |
|-----------------------|----------|------------------------------------|--------------------------------|
| `huntflow.js`         | Node     | Public API (`api.huntflow.ru/v2`) | Bearer token (Keychain/file)   |
| `add_applicant.py`    | Python   | Public API                        | Bearer token (Keychain/file)   |
| `reorder_stages.js`   | Node     | Internal web API (`huntflow.ru/app/api/...`) | Session cookie + CSRF |
| `add_resume.js`       | Node     | Public API (upload, create) + internal web API (merge) | Bearer token + session cookie |
| `setup.sh`            | Bash     | —                                  | writes the Bearer token pair (interactive/local) |
| `.claude/hooks/session-start.sh` | Bash | — | writes the Bearer token pair (remote/cloud, from env) |

`huntflow.js` is the main surface: read operations (`me`, `vacancies`,
`vacancy`, `pipeline`, `applicant`, `resume`, `logs`, `statuses`,
`rejections`, `close-reasons`, `search`, `divisions`, `tags`) plus the two
writes needed for day-to-day recruiting (`move`, `close`). `add_applicant.py`
exists separately because it's a distinct workflow (multipart CV upload →
parse → create → link) that doesn't share command shape with the rest.

`reorder_stages.js` is architecturally the odd one out: the public API is
read-only for pipeline stage order, so there is no way to reorder stages
through the documented API at all. This script reverse-engineers the
`huntflow.ru` web app's own internal calls to do it, which is why it needs a
completely different auth mechanism (see below) rather than the account's API
token.

Auth model
-----------

Two unrelated auth schemes coexist, matching the two APIs in play:

**Bearer token (public API)** — `huntflow.js`, `add_applicant.py`:
- Access + refresh token pair, per Huntflow's own OAuth-style token endpoint.
- Storage priority: macOS Keychain (`huntflow-access-token` /
  `huntflow-refresh-token`, account `huntflow`) first, falling back to
  `~/.huntflow/tokens.json` (`chmod 600`) on non-macOS or if Keychain writes
  fail.
- On a 401, both scripts call `/token/refresh` once, save the new pair, and
  retry the original request using the *freshly returned* access token
  directly — not by re-reading storage, since a Keychain write can silently
  fall back to the token file and a re-read would then return the stale
  Keychain value.
- A 404 (not 401) means the server doesn't recognize the token at all
  (malformed/corrupt) — this is treated as unrecoverable and surfaced as-is,
  not retried, since refreshing a token the server never issued can't help.
- `setup.sh` is the only way tokens get written for local/interactive use; it
  prompts interactively (hidden input) and never accepts tokens as CLI args,
  so they never land in shell history or `ps`.
- `.claude/hooks/session-start.sh` writes the same `~/.huntflow/tokens.json`
  for remote/cloud sessions, where Keychain isn't available: it runs on
  `SessionStart` (registered in `.claude/settings.json`), and if
  `CLAUDE_CODE_REMOTE=true` and `HUNTFLOW_ACCESS_TOKEN`/`HUNTFLOW_REFRESH_TOKEN`
  are set as environment secrets, materializes them into the token file
  (atomic temp-file-then-rename, `chmod 600`, mirroring `writeTokenFile`).
  No-op locally and when the secrets aren't configured.

**Session cookie (internal web API)** — `reorder_stages.js` only:
- No token endpoint exists for this API; auth is a copy-pasted browser
  session `Cookie` header (`HUNTFLOW_WEB_COOKIE`) plus a CSRF token
  (`HUNTFLOW_XSRF`, defaulted from the cookie's `_xsrf` value).
- Cookies are short-lived by nature; there's no refresh path — a 401/403
  just tells the user to copy a fresh cookie from DevTools. This is accepted
  as inherent to using an undocumented internal API rather than something to
  engineer around.

Error handling and UX
-----------------------

Both `huntflow.js` and `add_applicant.py` follow the same contract:

- Exit code `0`: success. `1`: generic error. `2`: auth/token failure
  specifically (expired/invalid token, failed refresh) — chosen so calling
  scripts (e.g. a bot or scheduled job) can distinguish "re-auth needed"
  from any other failure without parsing text.
- `--json` mode: on success, the result JSON goes to stdout. On failure, a
  structured object (`{"error": true, "code": ..., "status": ..., "body": ...}`)
  goes to stderr instead of prose, so automated callers get parseable output
  in both outcomes. Human mode instead prints a one-line message.
- `reorder_stages.js` doesn't carry `--json` error structure (it's an
  interactive/manual tool, not called from automation) but does add a hint
  on 401/403 ("session cookie is likely stale") since that's the single most
  common failure mode for cookie auth.

Design decisions and tradeoffs
--------------------------------

Pulled from CHANGELOG.md history — the reasoning behind choices that aren't
obvious from the code alone:

- **Atomic token writes** (temp file + rename, `0600` throughout): a crash
  mid-write must never leave a truncated `tokens.json`, since that would lock
  out both scripts with no recovery but re-running `setup.sh`.
- **Per-endpoint pagination caps**: `/vacancies` accepts `count=100` but
  `/applicants` (used by `pipeline`) caps at 30 and returns HTTP 400 above
  that. A prior change bumped both to 100 for fewer round-trips and broke
  `pipeline` outright; the fix was endpoint-specific, not a blanket revert.
- **`resume` only swallows 404s**: an early version treated any error while
  fetching an external resume as "no resume found," which silently hid
  auth/network failures behind a misleading empty result.
- **Session-based auth for `reorder_stages.js` instead of extending the
  Bearer-token model**: the internal API doesn't accept the account's API
  token at all, so there was no way to unify the two auth paths without
  Huntflow itself exposing a documented reorder endpoint.

Known accepted limitations
----------------------------

- **Token briefly visible via `ps` during Keychain writes**: `security
  add-generic-password` takes the secret as a CLI argument, which is visible
  to other processes owned by the same user for the duration of the call.
  Reviewed and left as-is: the exposure is same-user-only and momentary, any
  process that could read it via `ps` could read the Keychain directly
  anyway, and `security` has no clean non-interactive alternative (an
  interactive prompt, temp file, or `expect` wrapper would either break
  auto-refresh or create a larger leak surface). Real mitigation would be
  shorter-lived/narrower-scoped tokens, not hiding argv.
- **`reorder_stages.js` has no auth refresh path** — by design, since the
  internal API has no refresh endpoint; a stale cookie always requires a
  manual re-copy from the browser.
- **Huntflow's CV parser is imperfect** (`add_applicant.py`): known to
  mis-extract fields like phone/email from résumé text. `--phone`/`--email`
  overrides and `--dry-run` exist specifically so a human checks parsed
  output before it's posted on real (non-dry-run) runs.

Verification
-------------

CI (see badge in README.md) runs two layers: a direct `node --check`/
`py_compile` syntax pass over the entry points, then `validate-skills.mjs`,
then `smoke_test.sh`, which re-checks syntax locally, runs the unit tests
(`test_huntflow.js`, `test_add_resume.js`, `test_parse.py`,
`test_raw_request.py`, `test_token_file.py`), and adds live read-only checks (`me`,
`statuses`, `vacancies --open`) against the configured account when
`HUNTFLOW_ACCOUNT_ID` is set.

`reorder_stages.js` only gets the syntax pass — nothing exercises its actual
API calls, automated or otherwise, since its session-cookie auth can't be
provisioned in CI. A manual `node reorder_stages.js list` run (or `--dry-run`
for `move`/`set-order`) is the only way to catch a regression there.

Per `CLAUDE.md`, any change to `huntflow.js` or `add_applicant.py` is expected
to be verified by re-running it before being considered done; changes that
can't be exercised this way should say so explicitly rather than being
reported as verified.
