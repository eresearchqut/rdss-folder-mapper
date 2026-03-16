# Network Drive Mapper CLI

A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network drives effortlessly. Supported on Windows, macOS, and Linux.

## Features

- **Cross-Platform**: Works seamlessly on Windows, macOS, and Linux.
- **Easy Configuration**: Map multiple network drives using a simple configuration file or command-line arguments.
- **Persistent Mappings**: Optionally reconnect drives on startup.
- **Simple Installation**: Install quickly via `curl`.

## Installation

You can install the Network Drive Mapper CLI directly using `curl`. The project is hosted on GitHub.

### Linux & macOS

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-rpid-mapper/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/eresearchqut/rdss-rpid-mapper/main/install.ps1 -UseBasicParsing | Invoke-Expression
```

_(Or use curl alias in modern PowerShell)_

## Usage

Once installed, you can use the `drive-mapper` command to manage your network drives. The CLI primarily operates with two commands: `refresh` (default) and `reset`.

### Command Line Options

```bash
drive-mapper --help

Refresh drive mappings (Default command)

Options:
  --version  Show version number                                       [boolean]
  --reset    Remove all currently mapped folders                       [boolean]
  --help     Show help                                                 [boolean]
```

### Refresh (Default)

Running the CLI without any options executes the `refresh` command. This calls the RESTful API endpoint to retrieve your folder mappings and mounts them under a local parent folder named `RDSS`.

```bash
drive-mapper
```

### Reset

To remove all currently mapped folders, use the `--reset` option.

```bash
drive-mapper --reset
```

## API Integration

The CLI makes a request to a RESTful API that returns a JSON mapping file containing a listing of all your available drives. Each drive entry includes:

- **RPID**: The short code and actual name of the folder. The remote location is derived from the Unix or Windows base path plus the RPID.
- **title**: The human-readable version of the folder name.
- **nickname**: An optional folder nickname.

Example API JSON response:

```json
{
  "drives": [
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
