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
import { setupFetchMiddleware, performLogin } from './auth';
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
  aliasSubfolder,
  handleMountError,
} from './mount';

// Export for tests and GUI
export { transformPlansToFolders, performLogin };
export type { AuthEvent } from './auth';
export { reset } from './mount';
export { getOs } from './os';
export { clearCredentialsFromKeychain, getCredentialsFromKeychain, saveCredentialsToKeychain } from './secrets';
export type { Credentials } from './secrets';

export type RefreshEvent =
  | { type: 'auth:start' }
  | { type: 'auth:browser-opened'; url: string }
  | { type: 'auth:complete' }
  | { type: 'plans:fetching' }
  | { type: 'plans:fetched'; count: number }
  | { type: 'mount:start'; total: number }
  | { type: 'mount:complete' };

// DMP_BASE_URL kept for backward-compat export; no longer used internally.
export const DMP_BASE_URL = process.env.DMP_BASE_URL;
export const BASE_DIR = path.join(os.homedir(), 'Desktop', 'RDSS Folders');


interface RefreshOptions {
  debug?: boolean;
  baseDir?: string;
  foldersFile?: string;
  remotePath?: string;
  remotePrefix?: string;
  adDomain?: string;
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
  let { username, password, adDomain } = keychainCreds;

  adDomain = adDomain || options.adDomain;
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
      return { username, password, adDomain };
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
        adDomain: provided.adDomain || adDomain,
      };
    }
  }

  return { username, password, adDomain };
};


export const refresh = async (options: RefreshOptions = {}): Promise<void> => {
  const osInfo = getOs();
  const {
    debug = false,
    baseDir = BASE_DIR,
    foldersFile = 'folders.json',
    remotePath,
    remotePrefix,
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

      options.onEvent?.({ type: 'auth:start' });
      const token = await performLogin({
        clientId,
        authDomain,
        callbackUrls,
        debug,
        force,
        onEvent: (e) => options.onEvent?.(e),
      }, osInfo);
      if (!token) {
        throw new Error('Failed to retrieve access token during login.');
      }

      options.onEvent?.({ type: 'plans:fetching' });

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
        const researcherResponse = await fetch(researcherUrl, { headers: authHeaders });
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

      const planUrl = `${apiUrl}/plan?includeArchived=true`;
      if (debug) signale.debug(`Fetching plans from ${planUrl}...`);
      const response = await fetch(planUrl, { headers: authHeaders });

      if (!response.ok) {
        throw new Error(`Failed to fetch plans: ${response.status} ${await response.text()}`);
      }

      const plansData = await response.json();

      const mappedFolders = transformPlansToFolders(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Array.isArray(plansData) ? plansData : (plansData as any).items || [],
        currentResearcherId,
        (title, reason) => signale.info(`Skipping folder "${title ?? '(untitled)'}" — ${reason}`),
        (title, reason) => { if (debug) signale.debug(`Including folder "${title ?? '(untitled)'}" — ${reason}`); },
      );

      options.onEvent?.({ type: 'plans:fetched', count: mappedFolders.folders.length });
      fs.writeFileSync(foldersFile, JSON.stringify(mappedFolders.folders, null, 2), 'utf8');
      signale.success(`Successfully mapped plans and saved to ${foldersFile}`);
    }

    const folders = await loadFoldersConfig(foldersFile, debug, osInfo);
    const mountsDir = setupBaseDirectory(baseDir, debug, osInfo);

    // Priority: explicit option / config.json > REMOTE_PATH env vars (CI/testing only)
    const envPath = osInfo.isWindows ? process.env.REMOTE_PATH_WIN : process.env.REMOTE_PATH_NIX;
    const baseRemotePath = remotePath || envPath;
    if (!baseRemotePath) {
      throw new Error(
        'No remote path configured. Set "remotePathNix" / "remotePathWin" in config.json, or use --remote-path.',
      );
    }

    credentials = await resolveCredentials(options, osInfo, baseRemotePath);

    options.onEvent?.({ type: 'mount:start', total: folders.length });

    if (osInfo.isWindows) {
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const folderRemotePath = `${baseRemotePath}\\${folder.id}`;

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
      const prefix = remotePrefix || process.env.REMOTE_PREFIX_NIX;
      const sharePath = prefix ? `${baseRemotePath}/${prefix}` : baseRemotePath;
      const server = baseRemotePath.replace(/^smb:\/\//, '').replace(/\/.*$/, '');
      const share = prefix || sharePath.replace(/^smb:\/\//, '').replace(/^[^/]*\/?/, '');
      const mountDirName = (prefix || share || 'share').replace(/[\\/]+/g, '_') || 'share';

      // Reuse an existing mount (prior run or Finder /Volumes mount) to avoid re-auth.
      let baseMountPath = findExistingSmbMount(server, share, debug);
      if (baseMountPath) {
        if (debug) signale.debug(`Reusing existing mount at ${baseMountPath}`);
      } else {
        baseMountPath = path.join(mountsDir, mountDirName);
        if (!isMounted(baseMountPath, baseMountPath, osInfo)) {
          signale.info(`Mounting share ${sharePath} to ${baseMountPath}`);
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
        if (osInfo.isMac && credentials?.username && credentials?.password) {
          saveMacInternetPassword(server, credentials.username, credentials.password, debug);
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
  .option('-r, --remote-path <path>', 'Custom remote path')
  .option('--remote-prefix <path>', 'Subpath/share within the remote path to mount (nix only)')
  .option('-t, --truncate <number>', 'Truncate length for folder names', (val) => parseInt(val, 10))
  .option('--refresh', 'Force login and fetch plans from DMP even if folders.json exists')
  .option('--force', 'Ignore existing token in keychain and force a new login')
  .action(async (options) => {
    const osInfo = getOs();
    let configOptions: Partial<RefreshOptions> = {};
    if (fs.existsSync('config.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        // Credentials must come from the keychain only, never from config.json
        delete parsed.username;
        delete parsed.password;
        delete parsed.domain;
        // Resolve platform-specific remote path from config.json when present
        if (!parsed.remotePath) {
          parsed.remotePath = osInfo.isWindows ? parsed.remotePathWin : parsed.remotePathNix;
        }
        if (!parsed.remotePrefix) {
          parsed.remotePrefix = osInfo.isWindows ? parsed.remotePrefixWin : parsed.remotePrefixNix;
        }
        configOptions = parsed;
      } catch (e) {
        signale.error('Warning: Failed to parse config.json', (e as Error).message);
      }
    }

    const finalOptions: RefreshOptions = {
      debug: options.debug ?? configOptions.debug,
      baseDir: options.baseDir ?? configOptions.baseDir,
      foldersFile: options.folders ?? configOptions.foldersFile,
      remotePath: options.remotePath ?? configOptions.remotePath,
      remotePrefix: options.remotePrefix ?? configOptions.remotePrefix,
      adDomain: configOptions.adDomain,
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
  .description('Set credentials in the keychain')
  .action(() => {
    const osInfo = getOs();
    const debug = program.opts().debug || false;
    const currentUser = os.userInfo().username;
    const usernameInput = readlineSync.question(
      `Enter username (leave blank to use current user - ${currentUser}): `,
    );
    const username = usernameInput.trim() || currentUser;

    const password = readlineSync.question('Enter password: ', {
      hideEchoBack: true,
    });

    const domainInput = readlineSync.question('Enter AD domain (optional): ');
    const adDomain = domainInput.trim() || undefined;

    saveCredentialsToKeychain({ username, password, adDomain }, debug, osInfo);
    signale.success('Successfully updated credentials in keychain.');
  });

program
  .command('clear-auth')
  .description('Clear all credentials from the keychain')
  .action(() => {
    const osInfo = getOs();
    const debug = program.opts().debug || false;
    clearCredentialsFromKeychain(debug, osInfo);
    signale.success('Successfully cleared credentials from keychain.');
  });

if (require.main === module) {
  program.parse(process.argv);
}
