#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Command } from 'commander';
import { startCase } from 'lodash';
import truncate from '@stdlib/string-truncate';
import readlineSync from 'readline-sync';
import signale from 'signale';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../package.json');

import { FolderMapping, transformPlansToFolders } from './mapper';
import {
  getCredentialsFromKeychain,
  saveCredentialsToKeychain,
  clearCredentialsFromKeychain,
  saveMacInternetPassword,
  Credentials,
} from './secrets';
import { getOs, OsInfo } from './os';
import { setupFetchMiddleware, performLogin, getCachedToken, setCachedToken } from './auth';
import { loadFoldersConfig } from './config';
import {
  processFolderMapping,
  setupBaseDirectory,
  reset,
  sanitizeErrorMessage,
  isWindowsShareAccessible,
  isMounted,
  findExistingSmbMount,
  mountNixShare,
  mountMacViaFinder,
  mountLinuxViaGio,
  mountLinuxViaRclone,
  findGvfsMount,
  isCommandAvailable,
  aliasSubfolder,
  handleMountError,
  isHostReachable,
  extractHostname,
} from './mount';

// Export for tests and GUI
export { transformPlansToFolders, performLogin, getCachedToken, setCachedToken };
export type { AuthEvent } from './auth';
export type { PlanSummaryEntry } from './mapper';
export { reset, isHostReachable, extractHostname } from './mount';
export { getOs } from './os';
export { clearCredentialsFromKeychain, getCredentialsFromKeychain, saveCredentialsToKeychain, getMacInternetPasswordAccount } from './secrets';
export type { Credentials } from './secrets';

export type RefreshEvent =
  | { type: 'auth:start' }
  | { type: 'auth:browser-opened'; url: string }
  | { type: 'auth:complete' }
  | { type: 'profile:fetching' }
  | { type: 'plans:fetching' }
  | { type: 'plans:fetched'; count: number }
  | { type: 'plans:summary'; entries: import('./mapper').PlanSummaryEntry[] }
  | { type: 'mount:start'; total: number }
  | { type: 'mount:complete' };

// DMP_BASE_URL kept for backward-compat export; no longer used internally.
export const DMP_BASE_URL = process.env.DMP_BASE_URL;
export const BASE_DIR = path.join(os.homedir(), 'Desktop', 'RDSS Folders');

/** Default timeout (ms) for DMP API requests, guarding against an unresponsive server. */
export const API_TIMEOUT_MS = 30_000;

/**
 * fetch() with an abort-based timeout. Rejects with a clear, actionable error
 * when the server does not respond within `timeoutMs`, so the app reports the
 * stall instead of hanging indefinitely.
 */
export const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};


interface RefreshOptions {
  debug?: boolean;
  baseDir?: string;
  foldersFile?: string;
  host?: string;
  volume?: string;
  domain?: string;
  truncateLength?: number;
  refresh?: boolean;
  apiUrl?: string;
  clientId?: string;
  authDomain?: string;
  callbackUrls?: string[];
  force?: boolean;
  onProgress?: (current: number, total: number, folderName: string) => void;
  onEvent?: (event: RefreshEvent) => void;
  /** Called when no credentials are found in the keychain. Return credentials to use, or undefined to skip mounting. */
  onCredentialsRequired?: () => Promise<Credentials | undefined>;
}

const resolveCredentials = async (
  options: RefreshOptions,
  osInfo: OsInfo,
  baseRemotePath?: string,
): Promise<Credentials> => {
  const keychainCreds = getCredentialsFromKeychain(options.debug || false, osInfo);
  let { username, password, domain } = keychainCreds;

  domain = domain || options.domain;
  if (!username && password) {
    username = os.userInfo().username;
    if (options.debug)
      signale.info(`No username provided, defaulting to executing user: ${username}`);
  }

  // On Windows, shortcuts to a UNC share work with the user's existing Windows
  // session identity (domain-joined / Kerberos). If the share is already
  // reachable we skip prompting for SMB credentials entirely.
  if (osInfo.isWindows && !username && !password && baseRemotePath) {
    if (isWindowsShareAccessible(baseRemotePath, options.debug || false)) {
      if (options.debug)
        signale.debug('Share reachable with current Windows credentials; skipping credential prompt.');
      return { username, password, domain };
    }
  }

  if (!username && !password && options.onCredentialsRequired) {
    const provided = await options.onCredentialsRequired();
    if (provided) {
      if (provided.username || provided.password) {
        saveCredentialsToKeychain(provided, options.debug || false, osInfo);
      }
      return {
        username: provided.username,
        password: provided.password,
        domain: provided.domain || domain,
      };
    }
  }

  return { username, password, domain };
};


/**
 * Normalize a configured remote into a platform-appropriate base path. Accepts a
 * bare host ("rstore.qut.edu.au"), an `smb://` URL, or a `\\` UNC path and
 * formats it for the current OS: `smb://host` on nix, `\\host` on Windows. This
 * lets a single `host` value be shared across platforms.
 */
export const formatRemoteBase = (value: string, osInfo: OsInfo): string => {
  const bare = value
    .replace(/^smb:\/\//i, '')
    .replace(/^\\\\/, '')
    .replace(/^\/+/, '');
  return osInfo.isWindows ? `\\\\${bare.replace(/\//g, '\\')}` : `smb://${bare.replace(/\\/g, '/')}`;
};

/**
 * Trim leading and trailing slashes/backslashes from a string. Uses index walks
 * rather than a regex to avoid polynomial backtracking on adversarial input.
 */
export const trimSlashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === '/' || value[start] === '\\')) start++;
  while (end > start && (value[end - 1] === '/' || value[end - 1] === '\\')) end--;
  return value.slice(start, end);
};

/**
 * Read config.json and derive the bare SMB server host (e.g. "rstore.qut.edu.au")
 * from the configured remote path for the current platform. Returns undefined
 * when config.json is missing/unparseable or no remote path is configured.
 */
const readRemoteServer = (osInfo: OsInfo): string | undefined => {
  if (!fs.existsSync('config.json')) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const raw = parsed.host;
    if (!raw) return undefined;
    return formatRemoteBase(raw, osInfo)
      .replace(/^smb:\/\//, '')
      .split('/')[0];
  } catch {
    return undefined;
  }
};


export const refresh = async (options: RefreshOptions = {}): Promise<void> => {
  const osInfo = getOs();
  const {
    debug = false,
    baseDir = BASE_DIR,
    foldersFile = 'folders.json',
    host,
    volume,
    truncateLength = 40,
    refresh: doRefresh = false,
    apiUrl,
    clientId,
    authDomain,
    callbackUrls,
  } = options;

  setupFetchMiddleware(debug);

  signale.info('Refreshing drive mappings...');
  let credentials: Credentials | undefined;
  try {
    if (options.force && fs.existsSync(foldersFile)) {
      if (debug) signale.debug(`Force option provided, removing existing ${foldersFile}`);
      fs.rmSync(foldersFile, { force: true });
    }

    if (doRefresh || !fs.existsSync(foldersFile)) {
      signale.info(`${foldersFile} not found or refresh requested. Fetching plans from DMP...`);
      const force = options.force || false;
      if (!clientId || !authDomain || !callbackUrls?.length) {
        throw new Error(
          'OAuth config (clientId, authDomain, callbackUrls) is not configured. Set these in config.json.',
        );
      }
      if (!apiUrl) {
        throw new Error('apiUrl is not configured. Set "apiUrl" in config.json.');
      }

      // Pre-flight connectivity check: test if the SMB host is reachable before
      // starting authentication. If the user is not on the network/VPN, this
      // provides early feedback without attempting slow/hanging SMB operations.
      if (host) {
        const hostname = extractHostname(host);
        signale.info(`Checking connectivity to ${hostname}...`);
        const reachable = await isHostReachable(hostname, 3000, debug);
        if (!reachable) {
          throw new Error(
            `Can't reach ${hostname}. You need to be on the QUT network or VPN.`,
          );
        }
        signale.success(`Host ${hostname} is reachable.`);
      }

      options.onEvent?.({ type: 'auth:start' });
      const token = await performLogin({
        clientId,
        authDomain,
        callbackUrls,
        debug,
        force,
        onEvent: (e) => options.onEvent?.(e),
      });
      if (!token) {
        throw new Error('Failed to retrieve access token during login.');
      }

      options.onEvent?.({ type: 'profile:fetching' });

      const authHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };

      // Fetch the current user's researcher record so we can filter read-only collaborations.
      let currentResearcherId: string | undefined;
      try {
        const researcherUrl = `${apiUrl}/researcher`;
        if (debug) signale.debug(`Fetching researcher profile from ${researcherUrl}...`);
        const researcherResponse = await fetchWithTimeout(researcherUrl, { headers: authHeaders });
        if (researcherResponse.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const researcherData = await researcherResponse.json() as any;
          // Handle both a direct object { id } and an array [ { id } ]
          const record = Array.isArray(researcherData) ? researcherData[0] : researcherData;
          currentResearcherId = record?.id;
          if (currentResearcherId) {
            signale.info(`Researcher profile resolved — ID: ${currentResearcherId}`);
          } else {
            signale.warn(`Researcher profile returned no id field; collaborator read-only filter will be skipped. Response: ${JSON.stringify(record)}`);
          }
        } else {
          signale.warn(`Could not fetch researcher profile (${researcherResponse.status}); collaborator read-only filter will be skipped.`);
        }
      } catch (err) {
        signale.warn(`Researcher profile fetch failed; collaborator read-only filter will be skipped. ${sanitizeErrorMessage(err)}`);
      }

      const planUrl = `${apiUrl}/plan?includeArchived=false`;
      options.onEvent?.({ type: 'plans:fetching' });
      if (debug) signale.debug(`Fetching plans from ${planUrl}...`);
      const response = await fetchWithTimeout(planUrl, { headers: authHeaders });

      if (!response.ok) {
        throw new Error(`Failed to fetch plans: ${response.status} ${await response.text()}`);
      }

      const plansData = await response.json();

      const mappedFolders = transformPlansToFolders(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Array.isArray(plansData) ? plansData : (plansData as any).items || [],
        currentResearcherId,
        (title, reason, id) => signale.info(`Skipping folder "${title ?? '(untitled)'}" [${id}] — ${reason}`),
        (title, reason, id) => { if (debug) signale.debug(`Including folder "${title ?? '(untitled)'}" [${id}] — ${reason}`); },
      );

      options.onEvent?.({ type: 'plans:fetched', count: mappedFolders.folders.length });
      options.onEvent?.({ type: 'plans:summary', entries: mappedFolders.summary });
      fs.writeFileSync(foldersFile, JSON.stringify(mappedFolders.folders, null, 2), 'utf8');
      signale.success(`Successfully mapped plans and saved to ${foldersFile}`);
    }

    const folders = await loadFoldersConfig(foldersFile, debug);
    const mountsDir = setupBaseDirectory(baseDir, debug, osInfo);

    // Priority: explicit option / config.json > REMOTE_PATH env vars (CI/testing only)
    const envPath = osInfo.isWindows ? process.env.REMOTE_PATH_WIN : process.env.REMOTE_PATH_NIX;
    const rawRemotePath = host || envPath;
    if (!rawRemotePath) {
      throw new Error(
        'No remote host configured. Set "host" in config.json, or use --host.',
      );
    }
    const baseRemotePath = formatRemoteBase(rawRemotePath, osInfo);

    // The share/subpath to mount, shared across platforms (e.g. "Projects").
    const prefix =
      volume ||
      (osInfo.isWindows ? process.env.REMOTE_PREFIX_WIN : process.env.REMOTE_PREFIX_NIX);

    credentials = undefined;

    options.onEvent?.({ type: 'mount:start', total: folders.length });
    if (osInfo.isWindows) {
      const winPrefix = prefix ? `\\${trimSlashes(prefix)}` : '';
      // Probe the actual share path (e.g. \\host\Projects), not the bare server
      // root: Test-Path on a server with no share always fails, which would
      // wrongly trigger a credential prompt even when the share is reachable via
      // the user's Windows session identity.
      const shareProbePath = `${baseRemotePath}${winPrefix}`;
      credentials = await resolveCredentials(options, osInfo, shareProbePath);
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const folderRemotePath = `${baseRemotePath}${winPrefix}\\${folder.id}`;

        processFolderMapping({
          folderMapping: folder,
          baseDir,
          mountsDir,
          remotePath: folderRemotePath,
          truncateLength,
          credentials,
          debug,
          osInfo,
        });

        if (options.onProgress) {
          options.onProgress(i + 1, folders.length, folder.title || folder.id);
        }
      }
    } else {
      // nix: connect to the share root once, then alias each subfolder into it.
      const sharePath = prefix ? `${baseRemotePath}/${prefix}` : baseRemotePath;
      const server = baseRemotePath.replace(/^smb:\/\//, '').split('/')[0];
      const share = prefix || sharePath.replace(/^smb:\/\//, '').split('/').slice(1).join('/');
      const mountDirName = (prefix || share || 'share').replace(/[\\/]+/g, '_') || 'share';

      // Reuse an existing mount (prior run or Finder /Volumes mount) to avoid re-auth.
      let baseMountPath = findExistingSmbMount(server, share, debug);
      if (baseMountPath) {
        if (debug) signale.debug(`Reusing existing mount at ${baseMountPath}`);
      } else if (osInfo.isMac) {
        // macOS: delegate to Finder/NetFS. macOS handles authentication and
        // keychain storage natively — the system prompt offers "remember in my
        // keychain" and reuses it silently next time — so the app never manages
        // SMB credentials on macOS.
        signale.info(`Mounting share ${sharePath} via Finder`);
        try {
          mountMacViaFinder(sharePath, debug);
        } catch (error: unknown) {
          handleMountError(error, sharePath, '/Volumes', '/Volumes', undefined, debug, osInfo);
          options.onEvent?.({ type: 'mount:complete' });
          return;
        }
        baseMountPath = findExistingSmbMount(server, share, debug);
        if (!baseMountPath) {
          process.exitCode = 1;
          signale.error(`Could not locate the mounted share for ${sharePath} after mounting.`);
          options.onEvent?.({ type: 'mount:complete' });
          return;
        }
      } else {
        // Linux: prefer gio/GVfs (no sudo, desktop keyring, native prompt) — the
        // direct equivalent of the macOS Finder mount. Fall back to a credentialed
        // `sudo mount -t cifs` when gio/GVfs is unavailable (e.g. headless hosts).
        const gvfsMount = findGvfsMount(server, share, debug);
        if (gvfsMount) {
          if (debug) signale.debug(`Reusing existing GVfs mount at ${gvfsMount}`);
          baseMountPath = gvfsMount;
        } else if (isCommandAvailable('gio')) {
          signale.info(`Mounting share ${sharePath} via GVfs (gio)`);
          try {
            mountLinuxViaGio(sharePath, debug);
          } catch (error: unknown) {
            handleMountError(error, sharePath, '/run/user', '/run/user', undefined, debug, osInfo);
            options.onEvent?.({ type: 'mount:complete' });
            return;
          }
          baseMountPath = findGvfsMount(server, share, debug);
          if (!baseMountPath) {
            process.exitCode = 1;
            signale.error(`Could not locate the mounted share for ${sharePath} after mounting.`);
            options.onEvent?.({ type: 'mount:complete' });
            return;
          }
        } else if (isCommandAvailable('rclone')) {
          // Cross-desktop fallback for systems without GVfs (KDE, bare window
          // managers): mount as a userspace FUSE mount via rclone. Owned by the
          // user (read+write, no sudo) and unmounted with fusermount -u.
          baseMountPath = path.join(mountsDir, mountDirName);
          if (!isMounted(baseMountPath, baseMountPath, osInfo)) {
            signale.info(`Mounting share ${sharePath} via rclone (FUSE)`);
            credentials = await resolveCredentials(options, osInfo, baseRemotePath);
            try {
              mountLinuxViaRclone({
                server,
                share,
                mountPath: baseMountPath,
                credentials,
                debug,
              });
            } catch (error: unknown) {
              handleMountError(
                error,
                sharePath,
                baseMountPath,
                baseMountPath,
                credentials?.password,
                debug,
                osInfo,
              );
              options.onEvent?.({ type: 'mount:complete' });
              return;
            }
          }
        } else {
          // Fallback: mount the share once with credentials from secret-tool (or a prompt).
          baseMountPath = path.join(mountsDir, mountDirName);
          if (!isMounted(baseMountPath, baseMountPath, osInfo)) {
            signale.info(`Mounting share ${sharePath} to ${baseMountPath}`);
            credentials = await resolveCredentials(options, osInfo, baseRemotePath);
            try {
              mountNixShare({
                remotePath: sharePath,
                mountPath: baseMountPath,
                credentials,
                debug,
                osInfo,
              });
            } catch (error: unknown) {
              handleMountError(
                error,
                sharePath,
                baseMountPath,
                baseMountPath,
                credentials?.password,
                debug,
                osInfo,
              );
              options.onEvent?.({ type: 'mount:complete' });
              return;
            }
          }
        }
      }

      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        aliasSubfolder({ folderMapping: folder, baseDir, baseMountPath, truncateLength, debug });
        if (options.onProgress) {
          options.onProgress(i + 1, folders.length, folder.title || folder.id);
        }
      }
    }
    options.onEvent?.({ type: 'mount:complete' });
    signale.success('Refresh complete.');
  } catch (error: unknown) {
    process.exitCode = 1;
    const msg = sanitizeErrorMessage(error, credentials?.password);
    signale.error('Error during refresh:', msg);
    throw error; // Re-throw so GUI worker can capture the error message
  }
};


const program = new Command();

program
  .name('rdss-folder-mapper')
  .description(
    'A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network folders effortlessly.',
  )
  .version(version, '-v, --version', 'Output the current version number')
  .option('--debug', 'Enable debug logging')
  .option('-b, --base-dir <path>', 'Custom base folder location (default: ~/Desktop/RDSS Folders)')
  .option('-f, --folders <path>', 'Custom folders JSON file location (default: folders.json)')
  .option('-r, --host <host>', 'Custom remote host')
  .option('--volume <volume>', 'Share/volume within the host to mount (nix only)')
  .option('-t, --truncate <number>', 'Truncate length for folder names', (val) => parseInt(val, 10))
  .option('--refresh', 'Force login and fetch plans from DMP even if folders.json exists')
  .option('--force', 'Ignore existing token in keychain and force a new login')
  .action(async (options) => {
    let configOptions: Partial<RefreshOptions> = {};
    if (fs.existsSync('config.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        // Credentials must come from the keychain only, never from config.json
        delete parsed.username;
        delete parsed.password;
        configOptions = parsed;
      } catch (e) {
        signale.error('Warning: Failed to parse config.json', (e as Error).message);
      }
    }

    const finalOptions: RefreshOptions = {
      debug: options.debug ?? configOptions.debug,
      baseDir: options.baseDir ?? configOptions.baseDir,
      foldersFile: options.folders ?? configOptions.foldersFile,
      host: options.host ?? configOptions.host,
      volume: options.volume ?? configOptions.volume,
      domain: configOptions.domain,
      truncateLength: options.truncate ?? configOptions.truncateLength,
      refresh: options.refresh,
      apiUrl: configOptions.apiUrl,
      clientId: configOptions.clientId,
      authDomain: configOptions.authDomain,
      callbackUrls: configOptions.callbackUrls,
      force: options.force,
    };

    if (finalOptions.debug) {
      const logOptions = { ...finalOptions };
      signale.debug('Using options:', JSON.stringify(logOptions, null, 2));
    }

    refresh(finalOptions).catch((e) => signale.error(e));
  });

program
  .command('reset')
  .description('Remove all currently mapped folders')
  .action(() => {
    const opts = program.opts();
    const osInfo = getOs();
    reset(opts.debug, opts.baseDir || BASE_DIR, osInfo);
  });

program
  .command('auth')
  .description('Store SMB credentials for connecting to the RDSS share')
  .action(() => {
    const osInfo = getOs();
    const debug = program.opts().debug || false;

    if (osInfo.isWindows) {
      signale.info(
        'On Windows the RDSS share is accessed with your logged-in session identity; no credentials need to be stored.',
      );
      return;
    }

    const currentUser = os.userInfo().username;
    const usernameInput = readlineSync.question(
      `Enter username (leave blank to use current user - ${currentUser}): `,
    );
    const username = usernameInput.trim() || currentUser;

    const password = readlineSync.question('Enter password: ', {
      hideEchoBack: true,
    });

    if (osInfo.isMac) {
      const server = readRemoteServer(osInfo);
      if (!server) {
        signale.error(
          'Could not determine the SMB server from config.json. Set "host".',
        );
        process.exitCode = 1;
        return;
      }
      saveMacInternetPassword(server, username, password, debug);
      signale.success(`Saved SMB credentials for ${server} to the macOS keychain.`);
      return;
    }

    const domainInput = readlineSync.question('Enter AD domain (optional): ');
    const domain = domainInput.trim() || undefined;
    saveCredentialsToKeychain({ username, password, domain }, debug, osInfo);
    signale.success('Successfully updated credentials in keychain.');
  });

program
  .command('clear-auth')
  .description('Clear stored SMB credentials')
  .action(() => {
    const osInfo = getOs();
    const debug = program.opts().debug || false;

    if (osInfo.isWindows) {
      signale.info(
        'On Windows the RDSS share uses your logged-in session identity; there are no stored credentials to clear.',
      );
      return;
    }

    const server = osInfo.isMac ? readRemoteServer(osInfo) : undefined;
    clearCredentialsFromKeychain(debug, osInfo, server);
    signale.success('Successfully cleared credentials.');
  });

if (require.main === module) {
  program.parse(process.argv);
}
