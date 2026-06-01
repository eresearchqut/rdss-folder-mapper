# RDSS Folder Mapper — Desktop GUI

A desktop application for university researchers to map RDSS research storage folders to their Desktop with a single click. Built with [Electron](https://www.electronjs.org/).

## What it does

- **Map Research Folders** — mounts your RDSS storage folders to `~/Desktop/RDSS Folders` so they appear like regular folders on your Desktop.
- **Remove Mappings** — cleanly unmounts and removes all mapped folders.
- **Live Activity Log** — shows real-time progress and any errors directly in the window.

## Requirements

- **Node.js 18+**
- **macOS** or **Linux**: SMB client (built-in on macOS; install `cifs-utils` on Linux)
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
│   └── renderer/
│       └── index.html # UI — buttons, status bar, activity log
└── dist/              # Compiled output (git-ignored)
    ├── main.js
    └── preload.js
```

## Packaging (future)

Use [Electron Forge](https://www.electronforge.io/) or [electron-builder](https://www.electron.build/) to bundle the app into a standalone installer for distribution.
