# Installation

## Desktop GUI (Recommended)

Download the installer for your operating system directly:

| Platform | Download |
|----------|----------|
| **macOS** | [rdss-folder-mapper-gui-mac.dmg](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-mac.dmg) |
| **Windows** | [rdss-folder-mapper-gui-win.exe](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-win.exe) |
| **Linux** | [rdss-folder-mapper-gui-linux.AppImage](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-gui-linux.AppImage) |

All releases are also listed on the [GitHub Releases](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest) page.

### macOS

1. Open the `.dmg` file.
2. Drag **RDSS Folder Mapper** into your Applications folder.
3. On first launch, macOS may show a security prompt — right-click the app and choose **Open** to proceed.

### Windows

Run the `.exe` installer. It installs per-user and creates a Start Menu shortcut. No administrator rights are required.

### Linux

```bash
chmod +x rdss-folder-mapper-gui-linux.AppImage
./rdss-folder-mapper-gui-linux.AppImage
```

---

## Command-Line Interface (CLI)

The CLI is suitable for advanced users and automated workflows.

| Platform | Download |
|----------|----------|
| **macOS** | [rdss-folder-mapper-macos](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-macos) |
| **Windows** | [rdss-folder-mapper-win.exe](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-win.exe) |
| **Linux** | [rdss-folder-mapper-linux](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest/download/rdss-folder-mapper-linux) |

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.ps1 | iex
```

---

## Requirements

- An active account with your institution's Data Management Plan (DMP) service.
- Network access to the research storage server.
- macOS 11+, Windows 10+, or a modern Linux distribution.
