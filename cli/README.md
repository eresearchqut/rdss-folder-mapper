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

- [🪟 Windows x64 (`rdss-folder-mapper-win.exe`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe)
- [🪟 Windows Arm64 (`rdss-folder-mapper-win-arm64.exe`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win-arm64.exe)
- [🍎 macOS Apple Silicon (`rdss-folder-mapper-macos-arm64`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos-arm64)
- [🍎 macOS Intel (`rdss-folder-mapper-macos`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos)
- [🐧 Linux x64 (`rdss-folder-mapper-linux`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux)
- [🐧 Linux Arm64 (`rdss-folder-mapper-linux-arm64`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux-arm64)

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
  -r, --remote-path <path>   Custom remote path
  -t, --truncate <number>    Truncate length for folder names (default: 40)
  --refresh                  Force login and fetch plans from DMP even if folders.json exists
  --dmp-base-url <url>       Base URL for DMP to fetch config
  --force                    Ignore existing token in keychain and force a new login
  -h, --help                 display help for command

Commands:
  reset                      Remove all currently mapped folders
  auth                       Set credentials in the keychain
  clear-auth                 Clear all credentials from the keychain
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

Store credentials in the system keychain (macOS Keychain / Windows Credential Manager / Linux secret-tool):

```bash
rdss-folder-mapper auth
rdss-folder-mapper clear-auth
```

## Configuration (`config.json`)

Place a `config.json` next to the executable to set default options:

```json
{
  "debug": true,
  "baseDir": "~/MyRDSS",
  "truncateLength": 30
}
```

_For security reasons, `username`, `password`, and `domain` cannot be set in `config.json`. Use `auth` instead._

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
