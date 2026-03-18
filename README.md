# Network Drive Mapper CLI

A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to RDSS shared network drives effortlessly. Supported on Windows, macOS, and Linux.

## Features

- **Cross-Platform**: Works seamlessly on Windows, macOS, and Linux.
- **Standalone Binaries**: Built with `pkg` so no Node.js runtime is required on the host system.
- **Easy Configuration**: Map multiple network drives using a simple local `folders.json` file.
- **Typescript & Commander**: Modern CLI built with robust types and standard command parsing.

## Requirements

- **Windows**: Windows 10/11
- **macOS**: macOS 10.15+ (requires SMB client, usually built-in)
- **Linux**: Requires `cifs-utils` or `smbclient` installed on the system.

## Installation

### macOS & Linux

You can install the latest release directly using the installation script:

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/install.sh | sh
```

### Windows

You can install the latest release using PowerShell:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/install.ps1 -OutFile install.ps1; .\install.ps1
```

Or using Command Prompt (`cmd`):

```cmd
certutil -urlcache -split -f "https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe" rdss-folder-mapper.exe
```

Alternatively, you can download the compiled binaries for your operating system from the releases page (or by building them locally with `npm run build`).

Available binaries:
- [🪟 Windows (`rdss-folder-mapper-win.exe`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe)
- [🍎 macOS (`rdss-folder-mapper-macos`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos)
- [🐧 Linux (`rdss-folder-mapper-linux`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux)

## Usage

Once installed/downloaded, you can use the `rdss-folder-mapper` command to manage your network drives. The CLI primarily operates with two actions: `refresh` (default) and `reset`.

### Command Line Options

```bash
rdss-folder-mapper --help

Usage: rdss-folder-mapper [options]

A cross-platform command-line interface (CLI) tool that allows you to create
local folder mappings to shared network drives effortlessly.

Options:
  --reset                    Remove all currently mapped folders
  --debug                    Enable debug logging
  -b, --base-dir <path>      Custom base folder location (default: ~/RDSS)
  -u --username <username>   Username for remote mapping
  -p, --password <password>  Password for remote mapping
  -f, --folders <path>       Custom folders JSON file location (default:
                             folders.json)
  -r, --remote-path <path>   Custom remote path
  -t, --truncate <number>    Truncate length for folder names (default: 40)
  -h, --help                 display help for command
```

### Refresh (Default)

Running the CLI without any options executes the `refresh` command. This reads your local `folders.json` file to retrieve your folder mappings and mounts them under a local parent folder named `RDSS`.

**Note:** The sync process will automatically remove any old drive mappings under the parent `RDSS` folder before creating the new ones.

```bash
rdss-folder-mapper
```

### Reset

To remove all currently mapped folders, use the `--reset` option.

```bash
rdss-folder-mapper --reset
```

## Configuration

The CLI reads from a local `folders.json` file (in the same directory you run the command from) that returns a JSON mapping containing a listing of all your available folders. Each drive entry includes:

- **id**: The short code and actual name of the folder. The remote location is derived from the Unix or Windows base path plus the id.
- **title**: The human-readable version of the folder name.
- **nickname**: An optional folder nickname.

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

This configuration will result in the following folder structure:

```text
~/RDSS/
├── Alpha [PRJ123]/
└── Project Beta Data [PRJ456]/
```

