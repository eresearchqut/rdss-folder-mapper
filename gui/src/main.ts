import { app, BrowserWindow, ipcMain, dialog, shell, screen } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Worker } from 'worker_threads';
import { BASE_DIR, formatRemoteBase, getCredentialsFromKeychain, getMacInternetPasswordAccount, getOs } from 'rdss-folder-mapper';

let mainWindow: BrowserWindow | null = null;
let activeWorker: import('worker_threads').Worker | null = null;
let cancelRequested = false;
// OAuth token cached in the main process for the app session. Each refresh runs
// in a short-lived worker thread, so the token is held here (in memory only,
// never persisted) and passed into every worker to avoid re-logging in.
let cachedToken: string | undefined;
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
  domain?: string;
  host?: string;
  volume?: string;
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
  // Only user credentials are forbidden in config; the AD `domain` (e.g. "qutad")
  // is a legitimate, non-secret deployment setting and must be preserved so the
  // credentials dialog can skip prompting for it.
  delete parsed.username;
  delete parsed.password;
  return parsed as DeploymentConfig;
};

/**
 * Local deployment config.json candidates (developer / per-machine override),
 * checked in priority order. Shared by loadDeploymentConfig and getConfigSources
 * so both stay in sync.
 */
const localDeploymentConfigCandidates = (): string[] => [
  path.join(app.getAppPath(), '..', 'config.json'),
  path.join(process.cwd(), 'config.json'),
];

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
  for (const candidate of localDeploymentConfigCandidates()) {
    if (fs.existsSync(candidate)) {
      try {
        result = { ...result, ...parseDeploymentJson(fs.readFileSync(candidate, 'utf8')) };
        break;
      } catch { /* ignore parse errors */ }
    }
  }

  return result;
};

interface ConfigSource {
  label: string;
  path: string;
  loaded: boolean;
}

/**
 * Describes the config files the app reads and whether each was found, for
 * display on the settings page when debug is enabled. Useful for diagnosing
 * which config.json an installation actually picked up.
 */
const getConfigSources = (): ConfigSource[] => {
  const sources: ConfigSource[] = [];

  const userPath = configPath();
  sources.push({ label: 'User settings', path: userPath, loaded: fs.existsSync(userPath) });

  const sysPath = systemDeploymentConfigPath();
  sources.push({ label: 'System deployment config', path: sysPath, loaded: fs.existsSync(sysPath) });

  const localCandidates = localDeploymentConfigCandidates();
  const localLoaded = localCandidates.find(candidate => fs.existsSync(candidate));
  sources.push({
    label: 'Local override',
    path: localLoaded ?? localCandidates[0],
    loaded: Boolean(localLoaded),
  });

  return sources;
};

const saveConfig = (config: Config): void => {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
};

// ─── Window ───────────────────────────────────────────────────────────────────

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 650,
    resizable: false,
    title: 'RDSS Folder Mapper',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  mainWindow.setMenuBarVisibility(false);
};

/**
 * Bring the app window back to the foreground — used after the OAuth browser
 * tab hands control back to the app, so the user doesn't have to manually
 * switch back to it. Briefly toggles always-on-top to reliably steal focus
 * across platforms, and uses app.focus({ steal: true }) for macOS.
 */
const focusMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
  app.focus({ steal: true });
};

app.whenReady().then(() => {
  createWindow();
});

// Quit when the window is closed on every platform (including macOS, which would
// otherwise keep the app running in the background after the window closes).
app.on('window-all-closed', () => {
  app.quit();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive the SMB server (host, without scheme or share) from the deployment
 * config, used to look up the platform-native keychain entry. Returns undefined
 * when no host is configured.
 */
const deploymentServer = (): string | undefined => {
  const deployConfig = loadDeploymentConfig();
  const host = deployConfig.host;
  if (!host) return undefined;
  return formatRemoteBase(host, getOs())
    .replace(/^smb:\/\//, '')
    .split('/')[0];
};

/** Append a line to the activity log and forward it to the renderer. */
const appendLog = (line: string) => {
  logLines.push(line);
  mainWindow?.webContents.send('log', line);
};

/**
 * Runs 'refresh', 'reset', or 'clear-auth' in a worker thread so the main
 * process event loop (and therefore the renderer) stays responsive during
 * blocking mount syscalls.
 */
const runInWorker = (type: 'refresh' | 'reset' | 'clear-auth', config: Config): Promise<{ success: boolean; cancelled: boolean }> =>
  new Promise((resolve) => {
    const deployConfig = loadDeploymentConfig();
    const deployRemotePath = deployConfig.host;
    const deployRemotePrefix = deployConfig.volume;

    if (config.debug) {
      const loaded = getConfigSources().filter(source => source.loaded);
      if (loaded.length === 0) {
        appendLog('⬤ debug   No config file found; using built-in defaults.');
      } else {
        loaded.forEach(source => appendLog(`⬤ debug   Loaded ${source.label} from ${source.path}`));
      }
    }

    const workerConfig = {
      ...deployConfig,
      debug: config.debug,
      baseDir: config.baseDir,
      host: deployRemotePath,
      volume: deployRemotePrefix,
      token: cachedToken,
      foldersFile: path.join(app.getPath('userData'), 'folders.json'),
    };

    const worker = new Worker(path.join(__dirname, 'worker.js'));
    activeWorker = worker;

    worker.on('message', (msg: { type: string; line?: string; current?: number; total?: number; folderName?: string; success?: boolean; event?: object; token?: string }) => {
      if (msg.type === 'log') {
        logLines.push(msg.line ?? '');
        mainWindow?.webContents.send('log', msg.line);
      } else if (msg.type === 'token') {
        cachedToken = msg.token;
      } else if (msg.type === 'progress') {
        mainWindow?.webContents.send('progress', {
          current: msg.current,
          total: msg.total,
          folderName: msg.folderName,
        });
      } else if (msg.type === 'event') {
        // The OAuth browser tab takes focus during login; once auth completes
        // and control returns to the app, pull the window back to the front.
        if ((msg.event as { type?: string })?.type === 'auth:complete') {
          focusMainWindow();
        }
        mainWindow?.webContents.send('event', msg.event);
      } else if (msg.type === 'credentials-required') {
        // On macOS the username is stored on the SMB Internet password; prefer it
        // so the dialog shows (and lets the user update) the saved account.
        let defaultUsername = os.userInfo().username;
        if (process.platform === 'darwin' && deployRemotePath) {
          try {
            const server = formatRemoteBase(deployRemotePath, getOs())
              .replace(/^smb:\/\//, '')
              .split('/')[0];
            defaultUsername = getMacInternetPasswordAccount(server, config.debug ?? false) ?? defaultUsername;
          } catch { /* fall back to the OS login name */ }
        }
        mainWindow?.webContents.send('credentials-required', {
          defaultUsername,
          domainConfigured: Boolean(deployConfig.domain),
        });
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

ipcMain.handle('get-config-sources', () => getConfigSources());

ipcMain.handle('get-resolved-config', () => loadDeploymentConfig());

// Lets the renderer grow/shrink the window to fit its visible content. Width is
// kept fixed; height is clamped to the work area so the window never exceeds the
// screen. Used to make the settings page adaptive as diagnostics are revealed.
ipcMain.handle('resize-content-height', (_event, contentHeight: number) => {
  if (!mainWindow || typeof contentHeight !== 'number' || !Number.isFinite(contentHeight)) return;
  const [width] = mainWindow.getContentSize();
  const workAreaHeight = screen.getDisplayMatching(mainWindow.getBounds()).workArea.height;
  const height = Math.round(Math.min(Math.max(contentHeight, 360), workAreaHeight - 40));
  if (mainWindow.getContentSize()[1] === height) return;
  // The window is non-user-resizable; macOS ignores programmatic resizes while
  // resizable is false, so toggle it just for this call. Width stays fixed.
  const wasResizable = mainWindow.isResizable();
  if (!wasResizable) mainWindow.setResizable(true);
  mainWindow.setContentSize(width, height);
  if (!wasResizable) mainWindow.setResizable(false);
});

ipcMain.handle('open-config-file', async (_event, filePath: string) => {
  // Only allow opening a path that is a known, currently-loaded config source,
  // never an arbitrary path supplied by the renderer.
  const source = getConfigSources().find(s => s.path === filePath && s.loaded);
  if (!source) return false;
  const error = await shell.openPath(source.path);
  return error === '';
});

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

ipcMain.handle('open-rdss-help', () => {
  return shell.openExternal('https://docs.eres.qut.edu.au/rdss-faqs#rds-faqs-heading-target');
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
  cachedToken = undefined;
  return runInWorker('clear-auth', loadConfig());
});

/**
 * Reports whether any app-relevant credentials are stored in the OS keychain, so
 * the renderer can show a "Clear Key Chain" button only when there is something
 * to clear. Windows uses the session identity (nothing stored) so always false.
 */
ipcMain.handle('has-stored-credentials', async () => {
  const cfg = loadConfig();
  const osInfo = getOs();
  if (osInfo.isWindows) return false;
  if (osInfo.isMac) {
    const server = deploymentServer();
    if (!server) return false;
    return !!getMacInternetPasswordAccount(server, cfg.debug ?? false);
  }
  const creds = getCredentialsFromKeychain(cfg.debug ?? false, osInfo);
  return !!(creds.username || creds.password);
});

ipcMain.handle('submit-credentials', async (_event, credentials: { username: string; password: string; domain?: string }) => {
  activeWorker?.postMessage({ type: 'credentials-response', credentials });
});

ipcMain.handle('cancel-operation', () => {
  if (activeWorker) {
    cancelRequested = true;
    activeWorker.terminate().catch(() => {}); // fire-and-forget — don't block the renderer
    activeWorker = null;
  }
});
