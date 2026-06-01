# Command-Line Interface (CLI)

The CLI is for advanced users who prefer the terminal, or who want to automate folder mapping in scripts.

## Usage

```
rdss-folder-mapper [options] [command]
```

## Commands

| Command | Description |
|---------|-------------|
| *(default)* | Refresh folder mappings (equivalent to `--refresh`). |
| `reset` | Remove all existing mappings and create them fresh. |
| `auth` | Save authentication credentials to the system keychain. |
| `clear-auth` | Remove saved credentials from the system keychain. |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `-V, --version` | — | Print the version number and exit. |
| `-d, --debug` | `false` | Enable verbose debug logging. |
| `-b, --base-dir <path>` | `~/Desktop/RDSS Folders` | Directory where folder shortcuts are created. |
| `-r, --remote-path <path>` | From `config.json` | Network path to your institution's research storage. |
| `-f, --folders <path>` | `folders.json` | Custom path to a folders JSON file. |
| `-t, --truncate <number>` | — | Truncate folder name display to this many characters. |
| `--refresh` | — | Refresh mappings without removing existing ones first. |
| `--force` | — | Re-create mappings even if they already exist. |

## Examples

**Map folders with default settings:**

```bash
rdss-folder-mapper
```

**Map to a custom directory:**

```bash
rdss-folder-mapper --base-dir ~/Documents/Research
```

**Reset all mappings (remove then re-create):**

```bash
rdss-folder-mapper reset
```

**Enable debug output:**

```bash
rdss-folder-mapper --debug
```

**Save credentials to the keychain:**

```bash
rdss-folder-mapper auth
```

## Configuration

CLI flags override values read from a `config.json` file placed in the working directory (next to the binary). This file is provided by your IT administrator and contains deployment-specific settings such as the remote storage path and OAuth credentials.

User preferences (base directory, debug mode) are stored separately by the Desktop GUI at:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/RDSS Folder Mapper/config.json` |
| Windows | `%APPDATA%\RDSS Folder Mapper\config.json` |
| Linux | `~/.config/RDSS Folder Mapper/config.json` |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (details printed to stderr) |
