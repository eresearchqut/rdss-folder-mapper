# RDSS Folder Mapper — Desktop GUI

A desktop application for university researchers to map RDSS research storage folders to their Desktop with a single click. The GUI is built with [Tauri v2](https://v2.tauri.app/).

## What it does

- **Map Research Folders** — maps your RDSS storage folders to `~/Desktop/RDSS Folders` so they appear like regular folders on your Desktop.
- **Remove Mappings** — cleanly removes all mapped folders.
- **Live Activity Log** — shows real-time progress and any errors directly in the window.

## Architecture (Tauri)

Tauri's backend is Rust, so it cannot import the CLI's Node functions the way the
Electron worker did. Instead the Rust backend drives the existing
`rdss-folder-mapper` CLI binary as a **sidecar** (`tauri-plugin-shell`), streaming
its stdout/stderr to the renderer as `log` events.

```
gui/
├── src/renderer/
│   ├── index.html      # UI (reused unchanged from the Electron build)
│   └── tauri-shim.js   # Recreates the Electron `window.api` surface on Tauri invoke/event
├── src-tauri/
│   ├── src/lib.rs      # Rust commands; spawns the CLI sidecar, streams output
│   ├── binaries/       # CLI sidecar binary, named <name>-<target-triple> (git-ignored)
│   ├── capabilities/   # Tauri ACL (sidecar execute permission)
│   └── tauri.conf.json
└── copy-sidecar.js     # Copies cli/dist binary into src-tauri/binaries with the host triple
```

The Rust commands map 1:1 to the old IPC handlers:

| `window.api` call   | CLI invocation                              |
| ------------------- | ------------------------------------------- |
| `mapFolders`        | `rdss-folder-mapper --refresh --base-dir …` |
| `removeMappings`    | `rdss-folder-mapper … reset`                |
| `clearAuth`         | `rdss-folder-mapper clear-auth`             |
| `submitCredentials` | `rdss-folder-mapper auth` (via stdin)       |

### Deployment config

The CLI reads its deployment `config.json` (apiUrl/clientId/remotePath/…) from
its working directory, so the backend prepares a working dir under the app-data
folder and writes a `config.json` there, resolved at runtime in this order:

1. IT-provisioned **system config** (the same path the Electron build used):
   - Windows: `%PROGRAMDATA%\RDSSFolderMapper\config.json`
   - macOS: `/Library/Application Support/RDSSFolderMapper/config.json`
   - Linux: `/etc/RDSSFolderMapper/config.json`
2. A **developer override** dropped in the app config dir (git-ignored), e.g. on
   macOS `~/Library/Application Support/au.edu.qut.rdss-folder-mapper/config.json`.

If neither is present the CLI runs with an empty config and emits its normal
"OAuth config is not configured" error.

> **Do not commit `config.json`.** Even though the values are largely public
> (OAuth client id, public URLs), the deployment config is environment-specific
> and is provisioned per deployment, not bundled with the app. `config.json` is
> git-ignored repo-wide; keep it that way.

## Requirements

- **Node.js 18+**
- **Rust** toolchain (`cargo`, `rustc`) — see <https://www.rust-lang.org/tools/install>
- Tauri system prerequisites — see <https://v2.tauri.app/start/prerequisites/>
- **macOS** or **Linux**: SMB client (built-in on macOS; install `cifs-utils` on Linux)
- **Windows**: PowerShell (built-in on Windows 10/11)
- The CLI must be built first so its binary exists in `cli/dist/`.

## Development

From the **workspace root**:

```bash
npm install

# 1. Build the CLI (produces cli/dist/rdss-folder-mapper-* binaries)
npm run build --workspace=cli

# 2. Run the Tauri app in dev mode (copies the sidecar, then launches)
npm run tauri:dev --workspace=gui
```

## Packaging

```bash
# Build the CLI first, then bundle the Tauri app (.app/.dmg, .deb/.AppImage, .msi/.exe)
npm run build --workspace=cli
npm run tauri:build --workspace=gui
```

Output is written to `gui/src-tauri/target/release/bundle/`.

### Size

The Tauri shell binary is ~12 MB (vs Electron's ~100 MB runtime). The bundle size
is now dominated by the bundled CLI sidecar, which embeds a Node.js runtime
(~120 MB uncompressed, ~43 MB in the compressed macOS DMG).

## Notes / limitations

- Credentials: the CLI's `refresh` flow does not prompt for SMB credentials when
  run as a subprocess, so the GUI prompts on first run (gated by a marker file) and
  persists them via the `auth` subcommand into the OS keychain / Credential Manager.
- Structured `progress`/`event` updates were in-process callbacks under Electron;
  over a subprocess only stdout text is available, so the log pane streams raw CLI
  output. A machine-readable CLI output mode would restore richer progress UI.
