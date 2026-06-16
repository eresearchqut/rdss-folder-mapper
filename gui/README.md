# RDSS Folder Mapper — Desktop GUI

A desktop application for university researchers to map RDSS research storage folders to their Desktop with a single click. Built with [Electron](https://www.electronjs.org/).

## What it does

- **Map Research Folders** — mounts your RDSS storage folders to `~/Desktop/RDSS Folders` so they appear like regular folders on your Desktop.
- **Remove Mappings** — cleanly unmounts and removes all mapped folders.
- **Live Activity Log** — shows real-time progress and any errors directly in the window.

## Requirements

- **Node.js 18+**
- **macOS** or **Linux** — SMB mount backend:
  - **macOS**: built-in SMB client.
  - **Linux**: GVfs (`gio`, pre-installed on GNOME/Cinnamon/XFCE) by default; on
    other desktops install `rclone` for a userspace FUSE mount, or `cifs-utils`
    for the `sudo mount -t cifs` fallback.
- **Windows**: PowerShell (built-in on Windows 10/11)
- The CLI package must be built before starting the GUI (handled automatically by the root `start:gui` script)

## Development Setup

From the **workspace root**:

```bash
# Install all workspace dependencies
npm install

# Build the CLI package, then launch the GUI
npm run start:gui
```

Or manually:

```bash
# 1. Build the CLI so the GUI can import it
npm run build:ts --workspace=cli

# 2. Start the GUI
npm run start --workspace=gui
```

## Architecture

```
gui/
├── src/
│   ├── main.ts        # Electron main process — IPC handlers, calls CLI functions
│   ├── preload.ts     # Context bridge — exposes safe API to renderer
│   ├── worker.ts      # Worker thread — runs each map/remove off the main process
│   └── renderer/
│       └── index.html # UI — buttons, status bar, activity log
└── dist/              # Compiled output (git-ignored)
    ├── main.js
    ├── preload.js
    └── worker.js
```

## Packaging

The GUI is packaged with [electron-builder](https://www.electron.build/) into
platform installers (`.dmg`, `.exe`, `.AppImage`). Build for the current OS with:

```bash
npm run dist --workspace=gui
```

Releases are produced automatically by the `release` GitHub workflow when a
version tag is pushed.
