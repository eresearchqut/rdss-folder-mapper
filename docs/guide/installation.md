# Installation

## Desktop GUI (Recommended)

Download the latest installer for your operating system from the [GitHub Releases](https://github.com/eresearchqut/rdss-folder-mapper/releases/latest) page.

| Platform | File | Notes |
|----------|------|-------|
| **macOS (Apple Silicon)** | `rdss-folder-mapper-gui-mac-arm64.dmg` | M1 / M2 / M3 Macs |
| **macOS (Intel)** | `rdss-folder-mapper-gui-mac-x64.dmg` | Intel-based Macs |
| **Windows** | `rdss-folder-mapper-gui-win.exe` | Installs for current user, no admin required |
| **Linux** | `rdss-folder-mapper-gui-linux.AppImage` | Make executable then run |

### macOS

1. Open the `.dmg` file.
2. Drag **RDSS Folder Mapper** into your Applications folder.
3. On first launch, macOS may show a security prompt — click **Open** to proceed.

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

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/eresearchqut/rdss-folder-mapper/main/download.ps1 | iex
```

### npm (any platform)

```bash
npm install -g rdss-folder-mapper
```

---

## Requirements

- An active account with your institution's Data Management Plan (DMP) service.
- Network access to the research storage server.
- macOS 11+, Windows 10+, or a modern Linux distribution.
