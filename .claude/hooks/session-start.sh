#!/bin/bash
# Materializes ~/.huntflow/tokens.json from HUNTFLOW_ACCESS_TOKEN /
# HUNTFLOW_REFRESH_TOKEN env vars (set as environment secrets), so
# huntflow.js can authenticate in remote sessions where macOS Keychain
# isn't available. No-op locally and when the secrets aren't configured.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -z "${HUNTFLOW_ACCESS_TOKEN:-}" ] || [ -z "${HUNTFLOW_REFRESH_TOKEN:-}" ]; then
  exit 0
fi

TOKEN_DIR="$HOME/.huntflow"
TOKEN_FILE="$TOKEN_DIR/tokens.json"
TMP_FILE="$TOKEN_FILE.tmp"
mkdir -p "$TOKEN_DIR"
# Write to a temp file then rename, so a crash mid-write can't leave a
# truncated/corrupt tokens.json behind (mirrors huntflow.js's writeTokenFile).
( umask 077; : > "$TMP_FILE" )
TOKEN_FILE="$TMP_FILE" ACCESS_TOKEN="$HUNTFLOW_ACCESS_TOKEN" REFRESH_TOKEN="$HUNTFLOW_REFRESH_TOKEN" python3 -c '
import json, os
with open(os.environ["TOKEN_FILE"], "w") as f:
    json.dump({"access_token": os.environ["ACCESS_TOKEN"],
               "refresh_token": os.environ["REFRESH_TOKEN"]}, f, indent=2)
'
chmod 600 "$TMP_FILE"
mv "$TMP_FILE" "$TOKEN_FILE"
