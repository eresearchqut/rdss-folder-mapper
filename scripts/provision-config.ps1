<#
.SYNOPSIS
    Provisions the RDSS Folder Mapper deployment config for all users on this machine.

.DESCRIPTION
    Writes C:\ProgramData\RDSSFolderMapper\config.json with the supplied configuration.
    Run as SYSTEM or Administrator (e.g. via SCCM Application install script).

    CONFIG JSON
    -----------
    Replace the $config value below with your environment's deployment config before
    packaging this script for SCCM / Intune deployment.

    SCCM APPLICATION MODEL
    ----------------------
    Install script   : provision-config.ps1  (this file, run as SYSTEM)
    Uninstall script : provision-config-uninstall.ps1
    Detection method : Use a "File" detection rule —
                         Path : C:\ProgramData\RDSSFolderMapper
                         File : config.json
                         (Existence check is sufficient; add a version property to
                          config.json and use a "Registry or script" rule if you need
                          to detect config version changes.)

    CONFIG UPDATES WITHOUT REINSTALL
    ---------------------------------
    Use SCCM's built-in "Scripts" feature (or a new Application revision) to
    re-run this script with an updated $config value. The -Force flag on
    Set-Content overwrites the existing file in place.
#>

#Requires -RunAsAdministrator

# ── Edit the JSON block below before deploying ────────────────────────────────
$config = @'
{
  "apiUrl":        "https://your-api.example.com",
  "clientId":      "your-cognito-client-id",
  "authDomain":    "your-auth-domain.example.com",
  "callbackUrls":  ["http://localhost:35918/callback"],
  "adDomain":      "yourdomain",
  "remotePathNix": "smb://fileserver.example.com/projects",
  "remotePathWin": "\\\\fileserver.example.com\\Projects"
}
'@
# ─────────────────────────────────────────────────────────────────────────────

$dir  = Join-Path $env:ProgramData 'RDSSFolderMapper'
$file = Join-Path $dir 'config.json'

# Create directory if it does not exist
if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

# Write config (overwrites existing)
Set-Content -Path $file -Value $config.Trim() -Encoding UTF8 -Force

# Apply standard ProgramData ACL:
#   SYSTEM          : FullControl
#   Administrators  : FullControl
#   Users           : ReadAndExecute (read-only)
$acl = Get-Acl $dir
$acl.SetAccessRuleProtection($false, $true)  # inherit from parent (ProgramData default is correct)
Set-Acl -Path $dir -AclObject $acl

Write-Output "RDSS Folder Mapper config written to $file"
exit 0
