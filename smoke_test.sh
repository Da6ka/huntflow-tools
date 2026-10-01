#!/usr/bin/env bash
#
# Smoke test for the Huntflow tools.
# Runs OFFLINE checks (syntax, help) that must always pass, then
# READ-ONLY live checks against the API. Never runs mutating
# operations (move / add_applicant), so it is safe to run anytime.
#
# Requires: HUNTFLOW_ACCOUNT_ID set and valid tokens in Keychain
# (or ~/.huntflow/tokens.json) for the live checks to pass.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0

ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

echo "== Offline checks =="

if node --check "$DIR/huntflow.js"; then ok "huntflow.js parses"; else bad "huntflow.js syntax"; fi
if node --check "$DIR/reorder_stages.js"; then ok "reorder_stages.js parses"; else bad "reorder_stages.js syntax"; fi
if python3 -m py_compile "$DIR/add_applicant.py"; then ok "add_applicant.py compiles"; else bad "add_applicant.py syntax"; fi
if bash -n "$DIR/setup.sh"; then ok "setup.sh parses"; else bad "setup.sh syntax"; fi
if python3 "$DIR/add_applicant.py" --help >/dev/null 2>&1; then ok "add_applicant.py --help"; else bad "add_applicant.py --help"; fi
if (unset HUNTFLOW_ACCOUNT_ID; node "$DIR/huntflow.js" --help >/dev/null 2>&1); then ok "huntflow.js --help without account ID"; else bad "huntflow.js --help without account ID"; fi
if (cd "$DIR" && python3 test_raw_request.py >/dev/null 2>&1); then ok "raw_request body encoding"; else bad "raw_request body encoding"; fi
if (cd "$DIR" && python3 test_token_file.py >/dev/null 2>&1); then ok "token file mode + upload filename escaping"; else bad "token file mode + upload filename escaping"; fi
if [[ "$(HUNTFLOW_ACCOUNT_ID=1 node "$DIR/huntflow.js" applicant "1/../x" 2>&1 || true)" == *"Invalid id"* \
   && "$(HUNTFLOW_ACCOUNT_ID=1 node "$DIR/huntflow.js" pipeline 1 "5&x=1" 2>&1 || true)" == *"Invalid id"* ]]; then ok "huntflow.js rejects non-numeric ids"; else bad "huntflow.js rejects non-numeric ids"; fi
if (cd "$DIR" && python3 test_parse.py >/dev/null 2>&1); then ok "CV contact recovery"; else bad "CV contact recovery"; fi
if (cd "$DIR" && node test_huntflow.js >/dev/null 2>&1); then ok "huntflow.js arg parsing + formatters"; else bad "huntflow.js unit tests"; fi
if (cd "$DIR" && node test_add_resume.js >/dev/null 2>&1); then ok "add_resume.js filename escaping + token warning"; else bad "add_resume.js unit tests"; fi

echo "== Live read-only checks =="

if [[ -z "${HUNTFLOW_ACCOUNT_ID:-}" ]]; then
  echo "  SKIP: HUNTFLOW_ACCOUNT_ID not set — skipping live checks"
else
  for cmd in me statuses coworkers "vacancies --open"; do
    if node "$DIR/huntflow.js" $cmd --json >/dev/null 2>&1; then
      ok "huntflow.js $cmd"
    else
      bad "huntflow.js $cmd (auth/network? check tokens)"
    fi
  done
fi

echo
echo "== $PASS passed, $FAIL failed =="
[[ $FAIL -eq 0 ]]
