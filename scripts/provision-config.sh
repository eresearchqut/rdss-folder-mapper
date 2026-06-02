#!/usr/bin/env bash
# provision-config.sh — macOS deployment config provisioning
#
# Writes /Library/Application Support/RDSSFolderMapper/config.json
# for all users on this machine. Run as root (e.g. via Jamf policy script).
#
# JAMF DEPLOYMENT
# ---------------
# 1. Edit the CONFIG block below with your environment values.
# 2. Upload this script to Jamf Pro → Scripts.
# 3. Create a Policy that runs this script at Enrollment / Recurring Check-in.
# 4. Scope it to the relevant Smart Group or All Computers.
#
# For config updates, edit the script in Jamf and trigger the policy again —
# the script is idempotent and will overwrite the existing file.

set -euo pipefail

# ── Edit the JSON block below before deploying ────────────────────────────────
CONFIG='{
  "apiUrl":        "https://your-api.example.com",
  "clientId":      "your-cognito-client-id",
  "authDomain":    "your-auth-domain.example.com",
  "callbackUrls":  ["http://localhost:35918/callback"],
  "adDomain":      "yourdomain",
  "remotePathNix": "smb://fileserver.example.com/projects",
  "remotePathWin": "\\\\\\\\fileserver.example.com\\\\Projects"
}'
# ─────────────────────────────────────────────────────────────────────────────

DIR="/Library/Application Support/RDSSFolderMapper"
FILE="$DIR/config.json"

mkdir -p "$DIR"
printf '%s\n' "$CONFIG" > "$FILE"
chown root:wheel "$FILE"
chmod 644 "$FILE"

echo "RDSS Folder Mapper config written to $FILE"
