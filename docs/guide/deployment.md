# Deployment Guide (IT Administrators)

This page is for IT staff and service desk teams packaging RDSS Folder Mapper for
managed distribution — for example, publishing it to a self-service app portal
(Jamf Self Service on macOS, Company Portal / Intune or SCCM on Windows) and
provisioning the per-site configuration file.

It is intended to be linked directly from a service desk ticket requesting the
app be made available for installation.

## Installers

Every release publishes signed desktop installers. Download the latest from the
[GitHub Releases](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest)
page.

| Platform | File | Best for |
|----------|------|----------|
| macOS | [`rdss-folder-mapper-gui-mac.pkg`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-mac.pkg) | **Managed deployment (Jamf)** |
| macOS | [`rdss-folder-mapper-gui-mac.dmg`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-mac.dmg) | Manual / drag-to-Applications |
| Windows | [`rdss-folder-mapper-gui-win.exe`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-win.exe) | Self-service / per-user install |
| Linux | [`rdss-folder-mapper-gui-linux.AppImage`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-linux.AppImage) | Portable, no install |

For managed macOS deployment use the **`.pkg`** — it installs **RDSS Folder
Mapper** into `/Applications` non-interactively and works with Jamf's
`installer -target /` mechanism.

## Code signing & notarization

| Platform | Status |
|----------|--------|
| macOS | App signed with a **Developer ID Application** certificate, **notarized** by Apple, and stapled. The `.pkg` is signed with a **Developer ID Installer** certificate. Gatekeeper allows it without prompts. |
| Windows | The `.exe` is an NSIS installer. Authenticode signing can be added on request. |
| Linux | AppImages are not code-signed (no platform signing scheme). |

The macOS `.pkg` is therefore safe to upload to Jamf Self Service: it passes
Gatekeeper and requires no per-user security override.

## System configuration file

The app ships **without** any site-specific settings. To point users at your
institution's Data Management Planner and storage server, deploy a single
`config.json` to the system location for each OS. The app reads it automatically
on launch — users never edit it.

| OS | System config path |
|----|--------------------|
| Windows | `C:\ProgramData\RDSSFolderMapper\config.json` |
| macOS | `/Library/Application Support/RDSSFolderMapper/config.json` |
| Linux | `/etc/RDSSFolderMapper/config.json` |

::: tip Deploy the config with the app
The config file is independent of the installer, so you can ship it the same way
you ship the app — e.g. a Jamf configuration profile / script payload, an Intune
Win32 app dependency, or a post-install script. Set it once per machine.
:::

### File format

```json
{
  "apiUrl": "https://dmp.example.edu/api",
  "clientId": "your-oauth-client-id",
  "authDomain": "https://login.example.edu",
  "callbackUrls": ["http://127.0.0.1"],
  "domain": "EXAMPLE",
  "host": "research-storage.example.edu",
  "volume": "rdss"
}
```

| Field | Purpose |
|-------|---------|
| `apiUrl` | Base URL of the Data Management Planner API. |
| `clientId` | OAuth client ID used for the browser sign-in. |
| `authDomain` | OAuth authorization server / login domain. |
| `callbackUrls` | Allowed loopback redirect URIs for the OAuth callback. |
| `domain` | Optional Active Directory / SMB domain for the storage server. |
| `host` | Storage server hostname. The app derives `smb://host` (macOS/Linux) or `\\host` (Windows). |
| `volume` | Share/volume name on the storage server. |

::: warning Never include credentials
`config.json` must **not** contain a username or password — those fields are
stripped on load. Authentication is always per-user (browser OAuth for the DMP,
and OS-native credential prompts/keychain for SMB). The values above are
otherwise safe to distribute.
:::

::: warning macOS / Linux file ownership
Place the file at the system path with standard read permissions for all users
(e.g. `644`). On Windows, `C:\ProgramData` is already world-readable.
:::

::: warning Windows: save as UTF-8 *without* a BOM
PowerShell 5.1's `Set-Content -Encoding UTF8` writes a byte-order mark that the
app cannot parse. Use `Set-Content -Encoding utf8NoBOM` (PowerShell 7+) or write
the file with another editor to avoid a silently empty config.
:::

## Verifying a deployment

1. Install the app via the platform installer.
2. Place `config.json` at the system path above.
3. Launch the app. With **Debug** enabled on the Settings page, the app lists the
   config sources it read and whether each was found — use this to confirm the
   system config was picked up.

## Service desk checklist

When requesting the app be added to a self-service portal, include:

- The installer for the target platform (links above), or a pointer to the
  [latest release](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest).
- The `config.json` to deploy to the system path for that OS.
- A note that the macOS `.pkg` is signed + notarized and installs to
  `/Applications`.
