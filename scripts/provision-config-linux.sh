#!/usr/bin/env bash
# provision-config-linux.sh — Linux deployment config provisioning
#
# Writes /etc/RDSSFolderMapper/config.json for all users on this machine.
# Run as root (sudo or via your config management tool).
#
# Compatible with Ansible (shell/command task), Puppet (exec resource),
# Chef (execute resource), or a direct sudo call.

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

DIR="/etc/RDSSFolderMapper"
FILE="$DIR/config.json"

mkdir -p "$DIR"
printf '%s\n' "$CONFIG" > "$FILE"
chown root:root "$FILE"
chmod 644 "$FILE"

echo "RDSS Folder Mapper config written to $FILE"
