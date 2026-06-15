# RDSS Folder Mapper CLI

A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to RDSS shared network folders. Supported on Windows, macOS, and Linux.

## Requirements

- **Windows**: Windows 10/11
- **macOS**: macOS 10.15+ (requires SMB client, usually built-in)
- **Linux**: Requires `cifs-utils` or `smbclient` installed on the system.

## Download

### macOS & Linux

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.sh | sh
```

### Windows

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.ps1 -OutFile download.ps1; .\download.ps1
```

Available binaries:

- [🪟 Windows (`rdss-folder-mapper-win.exe`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe)
- [🍎 macOS (`rdss-folder-mapper-macos`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos)
- [🐧 Linux (`rdss-folder-mapper-linux`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux)

## Folders Mapping (`folders.json`)

The CLI reads from a local `folders.json` file (in the same directory you run the command from). Each entry includes:

- **id**: Short code used to derive the remote path.
- **title**: Human-readable folder name.
- **nickname**: Optional override for the local folder name.

Example `folders.json`:

```json
{
  "folders": [
    {
      "id": "PRJ123",
      "title": "Project Alpha Data",
      "nickname": "Alpha"
    },
    {
      "id": "PRJ456",
      "title": "Project Beta Data"
    }
  ]
}
```

This will create:

```text
~/Desktop/RDSS Folders/
├── Alpha [PRJ123]/
└── Project Beta Data [PRJ456]/
```

## Ignore Paths (`.mountignore`)

Create a `.mountignore` file in the same directory as the executable to specify folders that should be left untouched during reset.

```text
my-custom-folder
another-folder
```

_Common metadata paths (`.DS_Store`, `desktop.ini`, `Thumbs.db`) are ignored by default._

## Usage

```bash
rdss-folder-mapper --help

Usage: rdss-folder-mapper [options] [command]

Options:
  --debug                    Enable debug logging
  -v, --version              Output the current version number
  -b, --base-dir <path>      Custom base folder location (default: ~/Desktop/RDSS Folders)
  -f, --folders <path>       Custom folders JSON file location (default: folders.json)
  -r, --host <host>          Custom remote host
  --volume <volume>          Share/volume within the host to mount (nix only)
  -t, --truncate <number>    Truncate length for folder names (default: 40)
  --refresh                  Force login and fetch plans from DMP even if folders.json exists
  --dmp-base-url <url>       Base URL for DMP to fetch config
  --force                    Ignore the in-memory token and force a new login
  -h, --help                 display help for command

Commands:
  reset                      Remove all currently mapped folders
  auth                       Store SMB credentials for connecting to the RDSS share
  clear-auth                 Clear stored SMB credentials
```

### Refresh (default)

Reads `folders.json` and mounts all folders under `~/Desktop/RDSS Folders`. Automatically removes stale mappings first.

```bash
rdss-folder-mapper
```

### Reset

Removes all currently mapped folders.

```bash
rdss-folder-mapper reset
```

### Authentication

How SMB credentials are handled depends on the platform:

- **macOS**: `auth` saves an SMB **Internet password** to the login keychain so
  the OS re-authenticates natively (no app-owned credential is stored). The
  username is read back from that keychain item on subsequent runs.
- **Linux**: `auth` stores the username/password/domain via `secret-tool`
  (Secret Service).
- **Windows**: the RDSS share is accessed with your logged-in session identity,
  so there is nothing to store — `auth` and `clear-auth` are informational.

```bash
rdss-folder-mapper auth
rdss-folder-mapper clear-auth
```

The OAuth token used to fetch plans from the DMP is held **in memory only** for
the duration of the process — it is never written to disk or the keychain.

## Configuration (`config.json`)

Place a `config.json` next to the executable to set default options:

```json
{
  "debug": true,
  "baseDir": "~/MyRDSS",
  "truncateLength": 30,
  "host": "rstore.example.edu",
  "volume": "Projects"
}
```

_For security reasons, `username`, `password`, and `domain` cannot be set in `config.json`. Use `auth` instead._

### Remote paths and the mount model

The remote server is configured with `host` (a bare host, e.g.
`rstore.example.edu`) plus a `volume` (the share/subpath, e.g. `Projects`).
The CLI formats `host` per platform automatically — `smb://host` on
macOS/Linux and `\\host` on Windows — so a single value works everywhere. (You
can still override per platform with `hostNix` / `hostWin` and
`volumeNix` / `volumeWin`, or with `--host` / `--volume`.)

- **macOS / Linux**: the share `host/prefix` is mounted **once** at
  `<baseDir>/.mounts/<prefix>`, and each folder `id` is aliased from
  `<baseDir>/<Name [id]>` to `.mounts/<prefix>/<id>`. This avoids repeated
  authentication prompts. On macOS the connection first tries the saved Internet
  password (no prompt); on a fresh machine you supply credentials once (via
  `auth` or the GUI prompt) and they are saved as an Internet password so future
  runs — and Finder — re-authenticate silently.
- **Windows**: each folder is mapped individually at `\\host\prefix\<id>`.

## Remote Configuration & OAuth Login

Fetch your `folders.json` from a DMP server using `--refresh`. Use `--force` to re-authenticate:

```bash
rdss-folder-mapper --refresh
rdss-folder-mapper --refresh --force
```

Or point to a remote folders file directly:

```bash
rdss-folder-mapper -f https://api.example.com/my-folders.json
```

## Building from Source

```bash
cd cli
npm install
npm run build   # compiles TS and builds standalone executables in cli/dist/
npm run test    # runs unit and integration tests
```
