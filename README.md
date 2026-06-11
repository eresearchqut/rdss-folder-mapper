# RDSS Folder Mapper

> 📖 **[Full documentation → eresearchqut.github.io/rdss-folder-mapper](https://eresearchqut.github.io/rdss-folder-mapper/)**

A monorepo containing the CLI tool and desktop GUI for mapping RDSS research storage folders to your Desktop. Supported on Windows, macOS, and Linux.

## Packages

| Package | Description |
|---|---|
| [`cli/`](./cli/) | Command-line tool — map and manage research storage folders from a terminal or scheduled task |
| [`gui/`](./gui/) | Desktop GUI — a simple one-click interface built with Tauri, designed for researchers |

## Features

- **Cross-Platform**: Works on Windows, macOS, and Linux.
- **Standalone CLI Binaries**: Built with Node.js SEA — no runtime required on the host.
- **Desktop GUI**: Tauri app with a clean one-click interface designed for university researchers.
- **Easy Configuration**: Map multiple network drives using a simple `folders.json` file.

## Requirements

- **Windows**: Windows 10/11
- **macOS**: macOS 10.15+ (SMB client built-in)
- **Linux**: Requires `cifs-utils` installed

## Quick Start — GUI (Recommended for researchers)

Download the installer for your platform from the [latest release](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest):

| Platform | Download |
|---|---|
| 🪟 Windows | [`rdss-folder-mapper-gui-win.exe`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-win.exe) |
| 🍎 macOS (Apple Silicon) | [`rdss-folder-mapper-gui-mac-arm64.dmg`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-mac-arm64.dmg) |
| 🍎 macOS (Intel) | [`rdss-folder-mapper-gui-mac-x64.dmg`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-mac-x64.dmg) |
| 🐧 Linux | [`rdss-folder-mapper-gui-linux.AppImage`](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-linux.AppImage) |

> **macOS note:** If macOS blocks the app on first launch, right-click the `.dmg` and choose **Open**, then click **Open** in the dialog.

> **Linux note:** Make the AppImage executable first: `chmod +x rdss-folder-mapper-gui-linux.AppImage`

## Quick Start — CLI

### macOS & Linux

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.sh | sh
```

### Windows

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.ps1 -OutFile download.ps1; .\download.ps1
```

Download binaries directly:

- [🪟 Windows (`rdss-folder-mapper-win.exe`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe)
- [🍎 macOS (`rdss-folder-mapper-macos`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos)
- [🐧 Linux (`rdss-folder-mapper-linux`)](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux)

## Development

```bash
npm install                        # install all workspace dependencies
npm run build                      # build CLI
npm run test                       # run CLI tests
npm run start:gui                  # build CLI + launch GUI (development)
npm run build --workspace=cli      # build CLI only
npm run dist --workspace=gui       # package GUI installer for current OS
```

For full CLI documentation, see [`cli/README.md`](./cli/README.md).  
For GUI documentation, see [`gui/README.md`](./gui/README.md).

