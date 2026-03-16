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
curl -fsSL https://raw.githubusercontent.com/username/network-drive-mapper/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/username/network-drive-mapper/main/install.ps1 -UseBasicParsing | Invoke-Expression
```
*(Or use curl alias in modern PowerShell)*

*Note: Replace `username/network-drive-mapper` with the actual GitHub repository path once published.*

## Usage

Once installed, you can use the `drive-mapper` command to manage your network drives.

### Map a Single Drive

**Windows** (Maps `\\server\share` to drive letter `Z:`):
```bash
drive-mapper add --remote "\\server\share" --local "Z:"
```

**macOS / Linux** (Maps `smb://server/share` to `/mnt/share`):
```bash
drive-mapper add --remote "smb://server/share" --local "/mnt/share"
```

### List Active Mappings

```bash
drive-mapper list
```

### Remove a Mapping

```bash
drive-mapper remove --local "Z:" # On Windows
drive-mapper remove --local "/mnt/share" # On macOS/Linux
```

## Configuration File

You can also define your mappings in a `mappings.json` file for easier management of multiple drives:

```json
{
  "drives": [
    {
      "remote": "smb://server/share1",
      "local": "/mnt/share1"
    },
    {
      "remote": "smb://server/share2",
      "local": "/mnt/share2"
    }
  ]
}
```

Apply the configuration:
```bash
drive-mapper apply --file mappings.json
```

## Requirements

- **Windows**: Windows 10/11
- **macOS**: macOS 10.15+ (requires SMB client, usually built-in)
- **Linux**: Requires `cifs-utils` or `smbclient` installed on the system.
