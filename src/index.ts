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

import { FolderMapping, transformPlansToFolders } from './mapper';
import {
  getCredentialsFromKeychain,
  saveCredentialsToKeychain,
  clearCredentialsFromKeychain,
} from './secrets';
import { getOs, OsInfo } from './os';
import { setupFetchMiddleware, performLogin } from './auth';
import { fetchDmpConfig, loadFoldersConfig, DmpConfig } from './config';
import { processFolderMapping, setupBaseDirectory, reset, sanitizeErrorMessage } from './mount';

// Export for tests
export { transformPlansToFolders, performLogin };

export const REMOTE_PATH_WIN = process.env.REMOTE_PATH_WIN || '\\\\rstore.qut.edu.au\\Projects';
export const REMOTE_PATH_NIX = process.env.REMOTE_PATH_NIX || 'smb://rstore.qut.edu.au/projects';
export const BASE_DIR = path.join(os.homedir(), 'RDSS');


interface RefreshOptions {
  debug?: boolean;
  baseDir?: string;
  username?: string;
  password?: string;
  foldersFile?: string;
  remotePath?: string;
  truncateLength?: number;
  domain?: string;
  refresh?: boolean;
  dmpBaseUrl?: string;
  dmpConfig?: DmpConfig;
  port?: number;
  force?: boolean;
}

const resolveCredentials = (
  options: RefreshOptions,
  osInfo: OsInfo,
): {
  username?: string;
  password?: string;
  domain: string;
} => {
  let { username, password, domain } = options;
  if (!username || !password || !domain) {
    const keychainCreds = getCredentialsFromKeychain(options.debug || false, osInfo);
    username = username || keychainCreds.username;
    password = password || keychainCreds.password;
    domain = domain || keychainCreds.domain;
  }
  domain = domain || 'qutad';
  if (!username && password) {
    username = os.userInfo().username;
    if (options.debug)
      signale.info(`No username provided, defaulting to executing user: ${username}`);
  }
  return { username, password, domain };
};


export const refresh = async (options: RefreshOptions = {}): Promise<void> => {
  const osInfo = getOs();
  const {
    debug = false,
    baseDir = BASE_DIR,
    foldersFile = 'folders.json',
    remotePath,
    truncateLength = 40,
    refresh: doRefresh = false,
    dmpBaseUrl = 'https://dev-data-mgmt-plan.qut.edu.au',
    dmpConfig: passedDmpConfig,
  } = options;

  setupFetchMiddleware(debug);

  const dmpConfig = passedDmpConfig || (await fetchDmpConfig(dmpBaseUrl, debug));

  signale.info('Refreshing drive mappings...');
  try {
    const { username, password, domain } = resolveCredentials(options, osInfo);

    if (options.force && fs.existsSync(foldersFile)) {
      if (debug) signale.debug(`Force option provided, removing existing ${foldersFile}`);
      fs.rmSync(foldersFile, { force: true });
    }

    if (doRefresh || !fs.existsSync(foldersFile)) {
      signale.info(`${foldersFile} not found or refresh requested. Fetching plans from DMP...`);
      const port = options.port || 3000;
      const force = options.force || false;

      const token = await performLogin({ dmpConfig: dmpConfig || {}, port, debug, force }, osInfo);
      if (!token) {
        throw new Error('Failed to retrieve access token during login.');
      }

      const planUrl = `${dmpConfig?.dmpApiUrl}/plan?includeArchived=true`;
      if (debug) signale.debug(`Fetching plans from ${planUrl}...`);
      const response = await fetch(planUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch plans: ${response.status} ${await response.text()}`);
      }

      const plansData = await response.json();

      const mappedFolders = transformPlansToFolders(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Array.isArray(plansData) ? plansData : (plansData as any).items || [],
      );

      fs.writeFileSync(foldersFile, JSON.stringify(mappedFolders, null, 2), 'utf8');
      signale.success(`Successfully mapped plans and saved to ${foldersFile}`);
    }

    const folders = await loadFoldersConfig(foldersFile, debug, osInfo);
    const mountsDir = setupBaseDirectory(baseDir, debug, osInfo);

    const baseRemotePath = remotePath || (osInfo.isWindows ? REMOTE_PATH_WIN : REMOTE_PATH_NIX);

    for (const drive of folders) {
      const folderRemotePath = `${baseRemotePath}${osInfo.isWindows ? '\\' : '/'}${drive.id}`;

      processFolderMapping({
        folderMapping: drive,
        baseDir,
        mountsDir,
        remotePath: folderRemotePath,
        truncateLength,
        username,
        password,
        domain,
        debug,
        osInfo,
      });
    }
    signale.success('Refresh complete.');
  } catch (error: unknown) {
    process.exitCode = 1;
    const msg = sanitizeErrorMessage(error, options.password);
    signale.error('Error during refresh:', msg);
  }
};


const program = new Command();

program
  .name('rdss-folder-mapper')
  .description(
    'A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network folders effortlessly.',
  )
  .option('--debug', 'Enable debug logging')
  .option('-b, --base-dir <path>', 'Custom base folder location (default: ~/RDSS)')
  .option('-f, --folders <path>', 'Custom folders JSON file location (default: folders.json)')
  .option('-r, --remote-path <path>', 'Custom remote path')
  .option('-t, --truncate <number>', 'Truncate length for folder names', (val) => parseInt(val, 10))
  .option('-d, --domain <domain>', 'Domain for remote mapping')
  .option('--refresh', 'Force login and fetch plans from DMP even if folders.json exists')
  .option(
    '--dmp-base-url <url>',
    'Base URL for DMP to fetch config',
    'https://dev-data-mgmt-plan.qut.edu.au',
  )
  .option('-p, --port <port>', 'Local port to listen for the callback', (val) => parseInt(val, 10))
  .option('--force', 'Ignore existing token in keychain and force a new login')
  .action(async (options) => {
    let configOptions: Partial<RefreshOptions> = {};
    if (fs.existsSync('config.json')) {
      try {
        const parsed = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        delete parsed.username;
        delete parsed.password;
        delete parsed.domain;
        configOptions = parsed;
      } catch (e) {
        signale.error('Warning: Failed to parse config.json', (e as Error).message);
      }
    }

    const dmpBaseUrl =
      options.dmpBaseUrl ??
      process.env.RDSS_DMP_BASE_URL ??
      configOptions.dmpBaseUrl ??
      'https://dev-data-mgmt-plan.qut.edu.au';

    const finalOptions: RefreshOptions = {
      debug: options.debug ?? configOptions.debug,
      baseDir: options.baseDir ?? configOptions.baseDir,
      username: process.env.RDSS_USERNAME,
      password: process.env.RDSS_PASSWORD,
      foldersFile: options.folders ?? configOptions.foldersFile,
      remotePath: options.remotePath ?? configOptions.remotePath,
      truncateLength: options.truncate ?? configOptions.truncateLength,
      domain: options.domain ?? process.env.RDSS_DOMAIN,
      refresh: options.refresh,
      dmpBaseUrl,
      port:
        options.port ??
        (process.env.CALLBACK_PORT ? parseInt(process.env.CALLBACK_PORT, 10) : undefined) ??
        configOptions.port,
      force: options.force,
    };

    if (finalOptions.debug) {
      const logOptions = { ...finalOptions };
      if (logOptions.password) logOptions.password = '***';
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
    if (osInfo.isWindows) {
      signale.error('Keychain storage is not supported on Windows.');
      process.exit(1);
    }

    const debug = program.opts().debug || false;
    const currentUser = os.userInfo().username;
    const usernameInput = readlineSync.question(
      `Enter username (leave blank to use current user - ${currentUser}): `,
    );
    const username = usernameInput.trim() || currentUser;

    const password = readlineSync.question('Enter password: ', {
      hideEchoBack: true,
    });

    const domainInput = readlineSync.question('Enter domain (optional): ');
    const domain = domainInput.trim() || undefined;

    saveCredentialsToKeychain({ username, password, domain }, debug, osInfo);
    signale.success('Successfully updated credentials in keychain.');
  });

program
  .command('clear-auth')
  .description('Clear all credentials from the keychain')
  .action(() => {
    const osInfo = getOs();
    if (osInfo.isWindows) {
      signale.error('Keychain storage is not supported on Windows.');
      process.exit(1);
    }
    const debug = program.opts().debug || false;
    clearCredentialsFromKeychain(debug, osInfo);
    signale.success('Successfully cleared credentials from keychain.');
  });

if (require.main === module) {
  program.parse(process.argv);
}
