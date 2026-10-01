#!/usr/bin/env bash
#
# Interactive setup for Huntflow tools.
# Saves tokens to macOS Keychain (if on macOS) or ~/.huntflow/tokens.json (other OS).

set -euo pipefail

echo "Huntflow Tools setup"
echo "===================="
echo

read -s -p "Huntflow access token: " ACCESS_TOKEN
echo
read -s -p "Huntflow refresh token: " REFRESH_TOKEN
echo

if [[ "$(uname)" == "Darwin" ]]; then
  echo "Saving tokens to macOS Keychain..."
  security add-generic-password -s "huntflow-access-token" -a "huntflow" -w "$ACCESS_TOKEN" -U
  security add-generic-password -s "huntflow-refresh-token" -a "huntflow" -w "$REFRESH_TOKEN" -U
  echo "Saved to Keychain (services huntflow-access-token / huntflow-refresh-token, account huntflow)."
else
  TOKEN_DIR="$HOME/.huntflow"
  TOKEN_FILE="$TOKEN_DIR/tokens.json"
  TMP_FILE="$TOKEN_FILE.tmp"
  mkdir -p "$TOKEN_DIR"
  # Create the file with 0600 up front so the tokens are never briefly world-readable,
  # then let Python serialize the JSON — this escapes any quotes/backslashes/`$` in the
  # tokens instead of substituting them via the shell (which would corrupt the file).
  # Written to a temp file then renamed, so a crash mid-write can't leave a
  # truncated/corrupt tokens.json behind.
  ( umask 077; : > "$TMP_FILE" )
  TOKEN_FILE="$TMP_FILE" ACCESS_TOKEN="$ACCESS_TOKEN" REFRESH_TOKEN="$REFRESH_TOKEN" python3 -c '
import json, os
with open(os.environ["TOKEN_FILE"], "w") as f:
    json.dump({"access_token": os.environ["ACCESS_TOKEN"],
               "refresh_token": os.environ["REFRESH_TOKEN"]}, f, indent=2)
'
  chmod 600 "$TMP_FILE"
  mv "$TMP_FILE" "$TOKEN_FILE"
  echo "Saved to $TOKEN_FILE (chmod 600)."
fi

echo
echo "Now fetch your ACCOUNT_ID:"
echo "  curl -H \"Authorization: Bearer \$ACCESS_TOKEN\" https://api.huntflow.ru/v2/accounts"
echo
echo "Then export it:"
echo "  export HUNTFLOW_ACCOUNT_ID=<your_account_id>"
echo
echo "Verify with: node huntflow.js me"
