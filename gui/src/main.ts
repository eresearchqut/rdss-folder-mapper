import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import { BASE_DIR } from 'rdss-folder-mapper';

let mainWindow: BrowserWindow | null = null;
let activeWorker: import('worker_threads').Worker | null = null;
let cancelRequested = false;
const logLines: string[] = [];

// ─── Config ──────────────────────────────────────────────────────────────────

interface Config {
  debug: boolean;
  baseDir: string;
}

const defaultConfig = (): Config => ({
  debug: false,
  baseDir: BASE_DIR,
});

// Deployment config fields read from config.json alongside the binary/app.
interface DeploymentConfig {
  apiUrl?: string;
  clientId?: string;
  authDomain?: string;
  callbackUrls?: string[];
  adDomain?: string;
  remotePath?: string;
  remotePathNix?: string;
  remotePathWin?: string;
}

const configPath = () => path.join(app.getPath('userData'), 'config.json');

const loadConfig = (): Config => {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
};

/**
 * Returns the OS-appropriate path for the IT-provisioned system config file.
 *   Windows : C:\ProgramData\RDSSFolderMapper\config.json
 *   macOS   : /Library/Application Support/RDSSFolderMapper/config.json
 *   Linux   : /etc/RDSSFolderMapper/config.json
 */
const systemDeploymentConfigPath = (): string => {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'RDSSFolderMapper', 'config.json');
    case 'darwin':
      return '/Library/Application Support/RDSSFolderMapper/config.json';
    default:
      return '/etc/RDSSFolderMapper/config.json';
  }
};

const parseDeploymentJson = (raw: string): DeploymentConfig => {
  const parsed = JSON.parse(raw);
  delete parsed.username;
  delete parsed.password;
  delete parsed.domain;
  return parsed as DeploymentConfig;
};

/**
 * Loads the deployment config, merging sources from lowest to highest priority:
 *   1. System config file  (IT-provisioned via SCCM / Jamf / script)
 *   2. Local config.json   (next to binary — developer / per-machine override)
 */
const loadDeploymentConfig = (): DeploymentConfig => {
  // Base layer: system-managed config deployed by IT
  let result: DeploymentConfig = {};
  try {
    const sysPath = systemDeploymentConfigPath();
    if (fs.existsSync(sysPath)) {
      result = parseDeploymentJson(fs.readFileSync(sysPath, 'utf8'));
    }
  } catch { /* ignore missing or malformed system config */ }

  // Override layer: local config.json next to the binary (dev / machine-specific)
  const localCandidates = [
    path.join(app.getAppPath(), '..', 'config.json'),
    path.join(process.cwd(), 'config.json'),
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        result = { ...result, ...parseDeploymentJson(fs.readFileSync(candidate, 'utf8')) };
        break;
      } catch { /* ignore parse errors */ }
    }
  }

  return result;
};

const saveConfig = (config: Config): void => {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
};

// ─── Window ───────────────────────────────────────────────────────────────────

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: 'RDSS Folder Mapper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  mainWindow.setMenuBarVisibility(false);
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Runs 'refresh', 'reset', or 'clear-auth' in a worker thread so the main
 * process event loop (and therefore the renderer) stays responsive during
 * blocking mount syscalls.
 */
const runInWorker = (type: 'refresh' | 'reset' | 'clear-auth', config: Config): Promise<{ success: boolean; cancelled: boolean }> =>
  new Promise((resolve) => {
    const deployConfig = loadDeploymentConfig();
    const osInfo = process.platform === 'win32';
    const deployRemotePath = deployConfig.remotePath
      ?? (osInfo ? deployConfig.remotePathWin : deployConfig.remotePathNix);

    const workerConfig = {
      ...deployConfig,
      debug: config.debug,
      baseDir: config.baseDir,
      remotePath: deployRemotePath,
    };

    const worker = new Worker(path.join(__dirname, 'worker.js'));
    activeWorker = worker;

    worker.on('message', (msg: { type: string; line?: string; current?: number; total?: number; folderName?: string; success?: boolean; event?: object }) => {
      if (msg.type === 'log') {
        logLines.push(msg.line ?? '');
        mainWindow?.webContents.send('log', msg.line);
      } else if (msg.type === 'progress') {
        mainWindow?.webContents.send('progress', {
          current: msg.current,
          total: msg.total,
          folderName: msg.folderName,
        });
      } else if (msg.type === 'event') {
        mainWindow?.webContents.send('event', msg.event);
      } else if (msg.type === 'credentials-required') {
        mainWindow?.webContents.send('credentials-required', { defaultUsername: os.userInfo().username });
      } else if (msg.type === 'done') {
        activeWorker = null;
        resolve({ success: msg.success ?? false, cancelled: false });
        worker.terminate();
      }
    });

    worker.on('error', (err: Error) => {
      activeWorker = null;
      mainWindow?.webContents.send('log', `✗ ${err.message}`);
      resolve({ success: false, cancelled: cancelRequested });
    });

    worker.on('exit', () => {
      activeWorker = null;
      resolve({ success: false, cancelled: cancelRequested });
    });

    worker.postMessage({ type, config: workerConfig });
  });

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (_event, config: Config) => {
  saveConfig(config);
});

ipcMain.handle('pick-folder', async () => {
  const cfg = loadConfig();
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select base folder for mappings',
    defaultPath: cfg.baseDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('has-shortcuts', () => {
  const cfg = loadConfig();
  const ignored = new Set(['.mounts', '.DS_Store', 'desktop.ini', 'Thumbs.db', '.mountignore']);
  try {
    return fs.readdirSync(cfg.baseDir).some(item => !ignored.has(item));
  } catch {
    return false;
  }
});

ipcMain.handle('open-log-file', async () => {
  const logPath = path.join(app.getPath('userData'), 'activity.log');
  const content = logLines.length > 0
    ? logLines.join('\n') + '\n'
    : '(No activity recorded yet)\n';
  fs.writeFileSync(logPath, content, 'utf8');
  await shell.openPath(logPath);
});

ipcMain.handle('open-base-dir', async () => {
  const cfg = loadConfig();
  const expanded = cfg.baseDir.replace(/^~/, os.homedir());
  await shell.openPath(expanded);
});

/**
 * On macOS, accessing the Desktop folder requires user permission (TCC).
 * If the base directory is inaccessible, prompt the user via the native
 * folder picker — this is the standard way to trigger the macOS permission
 * grant for unsigned/development builds.  Returns true if access is confirmed.
 */
const ensureBaseDirAccess = async (baseDir: string): Promise<boolean> => {
  try {
    if (fs.existsSync(baseDir)) {
      fs.readdirSync(baseDir);
    } else {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
  }

  // EPERM — ask the user to grant access via the native folder picker.
  mainWindow?.webContents.send('log', `⚠ Permission required: please select or confirm the folder location to grant access.`);
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Grant access to your mappings folder',
    message: 'RDSS Folder Mapper needs permission to access this folder. Please select it to continue.',
    defaultPath: baseDir,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled) return false;

  // Re-test access after the user has confirmed via the picker.
  try {
    fs.readdirSync(result.filePaths[0]);
    return true;
  } catch {
    return false;
  }
};

ipcMain.handle('map-folders', async () => {
  cancelRequested = false;
  const cfg = loadConfig();
  if (!(await ensureBaseDirAccess(cfg.baseDir))) {
    mainWindow?.webContents.send('log', `✗ Access to ${cfg.baseDir} was denied. Please grant permission in System Settings → Privacy & Security → Files and Folders.`);
    return { success: false, cancelled: false };
  }
  return runInWorker('refresh', cfg);
});

ipcMain.handle('remove-mappings', async () => {
  return runInWorker('reset', loadConfig());
});

ipcMain.handle('clear-auth', async () => {
  return runInWorker('clear-auth', loadConfig());
});

ipcMain.handle('submit-credentials', async (_event, credentials: { username: string; password: string; adDomain?: string }) => {
  activeWorker?.postMessage({ type: 'credentials-response', credentials });
});

ipcMain.handle('cancel-operation', () => {
  if (activeWorker) {
    cancelRequested = true;
    activeWorker.terminate().catch(() => {}); // fire-and-forget — don't block the renderer
    activeWorker = null;
  }
});
