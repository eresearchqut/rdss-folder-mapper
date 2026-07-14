# RDSS Folder Mapper — Desktop GUI

A desktop application for university researchers to map RDSS research storage folders to their Desktop with a single click. Built with [Electron](https://www.electronjs.org/).

## What it does

- **Map Research Folders** — mounts your RDSS storage folders to `~/Desktop/RDSS Folders` so they appear like regular folders on your Desktop.
- **Remove Mappings** — cleanly unmounts and removes all mapped folders.
- **Live Activity Log** — shows real-time progress and any errors directly in the window.

## Requirements

- **Node.js 18+**
- **macOS** or **Linux** — SMB mount backend:
  - **macOS**: built-in SMB client.
  - **Linux**: GVfs (`gio`, pre-installed on GNOME/Cinnamon/XFCE) by default; on
    other desktops install `rclone` for a userspace FUSE mount, or `cifs-utils`
    for the `sudo mount -t cifs` fallback.
- **Windows**: PowerShell (built-in on Windows 10/11)
- The CLI package must be built before starting the GUI (handled automatically by the root `start:gui` script)

## Development Setup

From the **workspace root**:

```bash
# Install all workspace dependencies
npm install

# Build the CLI package, then launch the GUI
npm run start:gui
```

Or manually:

```bash
# 1. Build the CLI so the GUI can import it
npm run build:ts --workspace=cli

# 2. Start the GUI
npm run start --workspace=gui
```

## Architecture

```
gui/
├── src/
│   ├── main.ts        # Electron main process — IPC handlers, calls CLI functions
│   ├── preload.ts     # Context bridge — exposes safe API to renderer
│   ├── worker.ts      # Worker thread — runs each map/remove off the main process
│   └── renderer/
│       └── index.html # UI — buttons, status bar, activity log
└── dist/              # Compiled output (git-ignored)
    ├── main.js
    ├── preload.js
    └── worker.js
```

## Packaging

The GUI is packaged with [electron-builder](https://www.electron.build/) into
platform installers (`.dmg`, `.exe`, `.AppImage`). Build for the current OS with:

```bash
npm run dist --workspace=gui
```

Releases are produced automatically by the `release` GitHub workflow when a
version tag is pushed.

## Code signing

Signing is applied automatically by the `release` workflow **only when the
relevant secrets are present**. Forks, pull requests, and local builds produce
working but unsigned artifacts (the signing steps skip gracefully).

### macOS

Signed with a Developer ID certificate and notarized via the `afterSign` hook in
`build/notarize.js`. Configured through the `MAC_CERT_*` and `APPLE_*` repository
secrets.

### Windows — Azure Trusted Signing (current setup)

The Windows `.exe` is signed with [Azure Trusted
Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/), Microsoft's
managed, publicly-trusted signing service (~US$10/month, keys held in Microsoft's
HSM — no hardware token to manage). electron-builder's native `azureSignOptions`
runs `Invoke-TrustedSigning` on the Windows runner.

Configure these in the repository (Settings → Secrets and variables → Actions):

**Secrets** (Microsoft Entra ID app registration used for `EnvironmentCredential`):

| Secret | Purpose |
| --- | --- |
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_CLIENT_ID` | App registration (service principal) client ID |
| `AZURE_CLIENT_SECRET` | App registration client secret (also gates the signed build) |

**Variables** (non-secret Trusted Signing account details):

| Variable | Purpose |
| --- | --- |
| `AZURE_TS_ENDPOINT` | Trusted Signing account endpoint, e.g. `https://eus.codesigning.azure.net` |
| `AZURE_TS_ACCOUNT` | Trusted Signing account name |
| `AZURE_TS_PROFILE` | Certificate profile name |
| `WIN_PUBLISHER_NAME` | Publisher name, exactly as on the certificate |

The service principal needs the **Trusted Signing Certificate Profile Signer**
role on the account. Trusted Signing requires one-time organisation identity
validation before certificates can be issued.

To sign a local Windows build, set the `AZURE_*` env vars and run:

```bash
npm run dist --workspace=gui -- \
  "--config.win.azureSignOptions.publisherName=<name>" \
  "--config.win.azureSignOptions.endpoint=<endpoint>" \
  "--config.win.azureSignOptions.codeSigningAccountName=<account>" \
  "--config.win.azureSignOptions.certificateProfileName=<profile>"
```

Verify the result with `signtool verify /pa /v <installer>.exe`.

> What the Azure tenant managers need to provision (accounts, roles, identity
> validation, and the exact secrets/variables to hand back) is summarised in
> [`WINDOWS_SIGNING.md`](../WINDOWS_SIGNING.md) at the repository root.
