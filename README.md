# Network Drive Mapper CLI

A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network drives effortlessly. Supported on Windows, macOS, and Linux.

## Features

- **Cross-Platform**: Works seamlessly on Windows, macOS, and Linux.
- **Standalone Binaries**: Built with `pkg` so no Node.js runtime is required on the host system.
- **Easy Configuration**: Map multiple network drives using a simple local `folders.json` file.
- **Typescript & Commander**: Modern CLI built with robust types and standard command parsing.

## Installation

You can download the compiled binaries for your operating system from the releases page (or by building them locally with `npm run build`).

Available binaries:
- [🪟 Windows (`rdss-rpid-mapper-win.exe`)](https://github.com/eresearchqut/rdss-rpid-mapper/releases/latest/download/rdss-rpid-mapper-win.exe)
- [🍎 macOS (`rdss-rpid-mapper-macos`)](https://github.com/eresearchqut/rdss-rpid-mapper/releases/latest/download/rdss-rpid-mapper-macos)
- [🐧 Linux (`rdss-rpid-mapper-linux`)](https://github.com/eresearchqut/rdss-rpid-mapper/releases/latest/download/rdss-rpid-mapper-linux)

## Usage

Once installed/downloaded, you can use the `rdss-rpid-mapper` command to manage your network drives. The CLI primarily operates with two actions: `refresh` (default) and `reset`.

### Command Line Options

```bash
rdss-rpid-mapper --help

Usage: rdss-rpid-mapper [options]

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
  -h, --help                 display help for command
```

### Refresh (Default)

Running the CLI without any options executes the `refresh` command. This reads your local `folders.json` file to retrieve your folder mappings and mounts them under a local parent folder named `RDSS`.

**Note:** The sync process will automatically remove any old drive mappings under the parent `RDSS` folder before creating the new ones.

```bash
rdss-rpid-mapper
```

### Reset

To remove all currently mapped folders, use the `--reset` option.

```bash
rdss-rpid-mapper --reset
```

## Configuration Data

The CLI reads from a local `folders.json` file (in the same directory you run the command from) that returns a JSON mapping containing a listing of all your available folders. Each drive entry includes:

- **RPID**: The short code and actual name of the folder. The remote location is derived from the Unix or Windows base path plus the RPID.
- **title**: The human-readable version of the folder name.
- **nickname**: An optional folder nickname.

Example `folders.json`:

```json
{
  "folders": [  
    {
      "RPID": "PRJ123",
      "title": "Project Alpha Data",
      "nickname": "Alpha"
    },
    {
      "RPID": "PRJ456",
      "title": "Project Beta Data"
    }
  ]
}
```

## Requirements

- **Windows**: Windows 10/11
- **macOS**: macOS 10.15+ (requires SMB client, usually built-in)
- **Linux**: Requires `cifs-utils` or `smbclient` installed on the system.
