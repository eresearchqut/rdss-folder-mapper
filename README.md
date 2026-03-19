# RDSS Folder Mapper CLI

A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to RDSS shared network folders. Supported on Windows, macOS, and Linux.

## Features

- **Cross-Platform**: Works seamlessly on Windows, macOS, and Linux.
- **Standalone Binaries**: Built with `pkg` so no Node.js runtime is required on the host system.
- **Easy Configuration**: Map multiple network drives using a simple local `folders.json` file.
- **Typescript & Commander**: Modern CLI built with robust types and standard command parsing.

## Requirements

- **Windows**: Windows 10/11
- **macOS**: macOS 10.15+ (requires SMB client, usually built-in)
- **Linux**: Requires `cifs-utils` or `smbclient` installed on the system.

## Download

### macOS & Linux

You can download the latest release directly using the download script:

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.sh | sh
```

### Windows

You can download the latest release using PowerShell:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.ps1 -OutFile download.ps1; .\download.ps1
```

Or download the latest version to your home directory using Command Prompt (`cmd`):

```cmd
curl -fsSL https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe -o "%USERPROFILE%\rdss-folder-mapper.exe"
```

Alternatively, you can download the compiled binaries for your operating system from the releases page (or by building them locally with `npm run build`).

Available binaries:

- [🪟 Windows (`rdss-folder-mapper-win.exe`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe)
- [🍎 macOS (`rdss-folder-mapper-macos`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos)
- [🐧 Linux (`rdss-folder-mapper-linux`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux)

### Folders Mapping (`folders.json`)

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

### Ignore Paths (`.mountignore`)

You can create a `.mountignore` file in the same directory as the executable to specify local folder names that should be ignored and kept intact during reset operations.

Example `.mountignore`:

```text
my-custom-folder
another-folder
```

_Note: Common metadata paths like `.DS_Store`, `desktop.ini`, and `Thumbs.db` are ignored by default._

## Usage

Once installed/downloaded, you can use the `rdss-folder-mapper` command to manage your network drives. The CLI primarily operates with two actions: `refresh` (default) and `reset`.

### Command Line Options

```bash
rdss-folder-mapper --help

Usage: rdss-folder-mapper [options] [command]

A cross-platform command-line interface (CLI) tool that allows you to create
local folder mappings to shared network drives effortlessly.

Options:
  --debug                    Enable debug logging
  -b, --base-dir <path>      Custom base folder location (default: ~/RDSS)
  -f, --folders <path>       Custom folders JSON file location (default:
                             folders.json)
  -r, --remote-path <path>   Custom remote path
  -t, --truncate <number>    Truncate length for folder names (default: 40)
  -d, --domain <domain>      Domain for remote mapping
  -h, --help                 display help for command

Commands:
  reset                      Remove all currently mapped folders
  auth                       Set credentials in the keychain
  clear-auth                 Clear all credentials from the keychain
  login                      Perform OAuth login to retrieve a token for fetching remote folders.json
```

## Configuration

### Default Options (`config.json`)

You can provide default CLI options using a `config.json` file in the same directory as the executable. The CLI will automatically read this file and apply the options, though any options provided directly via the command line will take precedence.

Supported options in `config.json`:

- `debug`: Enable debug logging (`boolean`)
- `baseDir`: Custom base folder location (`string`)
- `foldersFile`: Custom folders JSON file location (`string`)
- `remotePath`: Custom remote path (`string`)
- `truncateLength`: Truncate length for folder names (`number`)

Example `config.json`:

```json
{
  "debug": true,
  "baseDir": "~/MyRDSS",
  "truncateLength": 30
}
```

_Note: For security reasons, `username`, `password`, and `domain` cannot be specified in `config.json`. Use the `auth` command instead._

### Refresh (Default)

Running the CLI without any commands or options executes the `refresh` command. This reads your local `folders.json` file to retrieve your folder mappings and mounts them under a local parent folder named `RDSS`.

**Note:** The sync process will automatically remove any old drive mappings under the parent `RDSS` folder before creating the new ones.

```bash
rdss-folder-mapper
```

### Reset

To remove all currently mapped folders, use the `reset` command.

```bash
rdss-folder-mapper reset
```

### Authentication

To store your credentials securely in the system keychain (macOS Keychain or Linux secret-tool) so you don't have to provide them every time, use the `auth` command:

```bash
rdss-folder-mapper auth
```

You will be prompted to enter your username, password (which will be hidden), and an optional domain.

To clear these saved credentials:

```bash
rdss-folder-mapper clear-auth
```

### Remote Configuration & OAuth Login

You can download your `folders.json` from a protected remote URL by providing an HTTP/HTTPS path via the `-f, --folders` option or in your `config.json`.
When fetching the remote file, the CLI will automatically include an authorization token if you have previously logged in.

To perform an OAuth login and save the token securely to your keychain:

```bash
rdss-folder-mapper login --auth-url <authorization_url> --token-url <token_exchange_url> --client-id <your_client_id>
```

This command will:

1. Start a local server (default port 3000) to receive the callback.
2. Open your default web browser to the provided authorization URL.
3. Capture the authorization code and exchange it for a token at the token URL.
4. Save the returned `access_token` to your system keychain.

You can then run the `refresh` command with a remote URL:

```bash
rdss-folder-mapper -f https://api.example.com/my-folders.json
```
