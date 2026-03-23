#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, execFileSync } from 'child_process';
import { Command } from 'commander';
import { startCase } from 'lodash';
import truncate from '@stdlib/string-truncate';
import readlineSync from 'readline-sync';
import signale from 'signale';

export const isWindows = () => {
  return os.platform() === 'win32';
};
export const isMac = () => {
  return os.platform() === 'darwin';
};

export const isMounted = (localPath: string, mountPath: string): boolean => {
  try {
    if (isWindows()) {
      const stat = fs.lstatSync(localPath);
      return stat.isSymbolicLink();
    } else {
      const mountOutput = execSync('mount', { encoding: 'utf8' });
      const lines = mountOutput.split('\n');
      return lines.some(
        (line) => line.includes(` on ${mountPath} `) || line.includes(` on ${mountPath} (`),
      );
    }
  } catch {
    return false;
  }
};

export const isExistingFolder = (localPath: string): boolean => {
  try {
    const stat = fs.lstatSync(localPath);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch {
    return false;
  }
};

const REMOTE_PATH_WIN = process.env.REMOTE_PATH_WIN || '\\\\rstore.qut.edu.au\\Projects';
const REMOTE_PATH_NIX = process.env.REMOTE_PATH_NIX || 'smb://rstore.qut.edu.au/projects';

// eslint-disable-next-line no-control-regex
const INVALID_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1F]/g;

// The local parent directory for mappings
const BASE_DIR = path.join(os.homedir(), 'RDSS');

interface DriveMapping {
  id: string;
  title?: string;
  nickname?: string;
  role?: string;
  organisation?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const transformPlansToFolders = (plans: any[]): { folders: DriveMapping[] } => {
  const folders = plans
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((plan: any) => !!plan.dataStorageId)
    .filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plan: any) =>
        plan.projectMeta?.isLead === true ||
        plan.projectMeta?.isSupervisor === true ||
        plan.projectMeta?.editable === true,
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((plan: any) => {
      const folder: DriveMapping = {
        id: plan.encodedId,
        title: plan.project?.title,
      };

      if (plan.projectMeta) {
        if (plan.projectMeta.isLead) {
          folder.role = 'LEAD';
        } else if (plan.projectMeta.isSupervisor) {
          folder.role = 'SUPERVISOR';
        } else if (plan.projectMeta.isCollaborator) {
          folder.role = 'COLLABORATOR';
        }
      }

      if (plan.project?.organisation) {
        const orgs = [];
        if (plan.project.organisation.faculty?.name) {
          orgs.push(plan.project.organisation.faculty.name);
        }
        if (plan.project.organisation.school?.name) {
          orgs.push(plan.project.organisation.school.name);
        }
        if (orgs.length > 0) {
          folder.organisation = orgs;
        }
      }

      return folder;
    });

  return { folders };
};

const getMacCredentials = (debug: boolean) => {
  try {
    if (debug) signale.debug('Attempting to read credentials from macOS keychain...');
    // Note: `security` writes the password to stderr, and attributes to stdout. We catch both by not redirecting stderr to ignore.
    const stdout = execSync('security find-generic-password -s "rdss-folder-mapper"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const stderr = execSync('security find-generic-password -s "rdss-folder-mapper" -w', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const accountMatch = stdout.match(/"acct"<blob>="([^"]+)"/);
    const domainMatch =
      stdout.match(/"gena"<blob>="([^"]+)"/) || stdout.match(/"icmt"<blob>="([^"]+)"/);
    const password = stderr.trim();
    if (accountMatch && password) {
      if (debug) signale.debug('Credentials successfully retrieved from macOS keychain.');
      let username = accountMatch[1];
      let domain = domainMatch ? domainMatch[1] : undefined;
      if (!domain && username.includes('\\')) {
        const parts = username.split('\\');
        domain = parts[0];
        username = parts[1];
      }
      return { username, password, domain };
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read from macOS keychain:', (e as Error).message);
  }
  return {};
};

const getLinuxCredentials = (debug: boolean) => {
  try {
    if (debug) signale.debug('Attempting to read credentials from Linux secret-tool...');
    const searchOutput = execSync('secret-tool search --all service rdss-folder-mapper', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const accountMatch = searchOutput.match(/username = (.+)/);
    const domainMatch = searchOutput.match(/domain = (.+)/);
    const password = execSync('secret-tool lookup service rdss-folder-mapper', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (accountMatch && password) {
      if (debug) signale.debug('Credentials successfully retrieved from Linux secret-tool.');
      let username = accountMatch[1].trim();
      let domain = domainMatch ? domainMatch[1].trim() : undefined;
      if (!domain && username.includes('\\')) {
        const parts = username.split('\\');
        domain = parts[0];
        username = parts[1];
      }
      return { username, password, domain };
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read from Linux secret-tool:', (e as Error).message);
  }
  return {};
};

const getCredentialsFromKeychain = (
  debug: boolean,
): {
  username?: string;
  password?: string;
  domain?: string;
} => {
  if (isMac()) {
    return getMacCredentials(debug);
  } else if (!isWindows()) {
    return getLinuxCredentials(debug);
  }
  return {};
};

const saveMacCredentials = (
  creds: { username?: string; password?: string; domain?: string },
  debug: boolean,
): void => {
  try {
    if (debug) signale.debug('Saving credentials to macOS keychain...');
    const args = ['add-generic-password', '-s', 'rdss-folder-mapper', '-U'];
    if (creds.username) {
      args.push('-a', creds.username);
    }
    if (creds.password) {
      args.push('-w', creds.password);
    }
    if (creds.domain) {
      args.push('-j', creds.domain);
    }
    execFileSync('security', args, { stdio: debug ? 'pipe' : 'ignore' });
  } catch (e) {
    let msg = (e as Error).message;
    if (creds.password) {
      msg = msg.split(creds.password).join('***');
      msg = msg.split(encodeURIComponent(creds.password)).join('***');
    }
    if (debug) signale.debug('Failed to save to macOS keychain:', msg);
  }
};

const saveLinuxCredentials = (
  creds: { username?: string; password?: string; domain?: string },
  debug: boolean,
): void => {
  try {
    if (debug) signale.debug('Saving credentials to Linux secret-tool...');
    const args = ['store', '--label=RDSS Folder Mapper', 'service', 'rdss-folder-mapper'];
    if (creds.username) {
      args.push('username', creds.username);
    }
    if (creds.domain) {
      args.push('domain', creds.domain);
    }
    execFileSync('secret-tool', args, {
      input: creds.password,
      stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore'],
    });
  } catch (e) {
    if (debug) signale.debug('Failed to save to Linux secret-tool:', (e as Error).message);
  }
};

const saveCredentialsToKeychain = (
  creds: { username?: string; password?: string; domain?: string },
  debug: boolean,
): void => {
  if (isMac()) {
    saveMacCredentials(creds, debug);
  } else if (!isWindows()) {
    saveLinuxCredentials(creds, debug);
  } else {
    if (debug) signale.debug('Keychain storage is not supported on Windows.');
  }
};

const getTokenFromKeychain = (debug: boolean): string | undefined => {
  try {
    if (isMac()) {
      const stdout = execSync('security find-generic-password -s "rdss-folder-mapper-token" -w', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return stdout.trim();
    } else if (!isWindows()) {
      const password = execSync('secret-tool lookup service rdss-folder-mapper-token', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return password.trim();
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read token from keychain:', (e as Error).message);
  }
  return undefined;
};

const saveTokenToKeychain = (token: string, debug: boolean): void => {
  try {
    if (isMac()) {
      execSync(
        'security add-generic-password -s "rdss-folder-mapper-token" -a "oauth_token" -w "' +
          token +
          '" -U',
        {
          stdio: debug ? 'pipe' : 'ignore',
        },
      );
    } else if (!isWindows()) {
      execSync(
        'secret-tool store --label="RDSS Folder Mapper Token" service rdss-folder-mapper-token',
        {
          input: token,
          stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore'],
        },
      );
    }
  } catch (e) {
    if (debug) signale.debug('Failed to save token to keychain:', (e as Error).message);
  }
};

const clearMacCredentials = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing credentials from macOS keychain...');
    execSync('security delete-generic-password -s "rdss-folder-mapper"', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear macOS keychain:', (e as Error).message);
  }
};

const clearLinuxCredentials = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing credentials from Linux secret-tool...');
    execSync('secret-tool clear service rdss-folder-mapper', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear Linux secret-tool:', (e as Error).message);
  }
};

const clearCredentialsFromKeychain = (debug: boolean): void => {
  if (isMac()) {
    clearMacCredentials(debug);
  } else if (!isWindows()) {
    clearLinuxCredentials(debug);
  } else {
    if (debug) signale.debug('Keychain storage is not supported on Windows.');
  }
};

export interface DmpConfig {
  dmpApiUrl?: string;
  authUrl?: string;
  tokenUrl?: string;
  clientId?: string;
}

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

interface ConfigData {
  folders: DriveMapping[];
  remotePath?: string;
}

const resolveCredentials = (
  options: RefreshOptions,
): {
  username?: string;
  password?: string;
  domain: string;
} => {
  let { username, password, domain } = options;
  if (!username || !password || !domain) {
    const keychainCreds = getCredentialsFromKeychain(options.debug || false);
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

const loadFoldersConfig = async (foldersFile: string, debug: boolean): Promise<ConfigData> => {
  try {
    let fileData: string;
    if (foldersFile.startsWith('http://') || foldersFile.startsWith('https://')) {
      if (debug) signale.debug(`Fetching folders config from ${foldersFile}...`);
      const token = getTokenFromKeychain(debug);
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(foldersFile, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      fileData = await response.text();
    } else {
      fileData = fs.readFileSync(foldersFile, 'utf8');
    }
    const parsedData = JSON.parse(fileData);
    return {
      folders: parsedData.folders || [],
      remotePath: parsedData.remotePath,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read or parse ${foldersFile}. Please ensure the file exists/is reachable and is valid JSON. Details: ${msg}`,
    );
  }
};

const getIgnoredItems = (): string[] => {
  const ignores = ['.mounts', '.DS_Store', 'desktop.ini', 'Thumbs.db', '.mountignore'];
  const ignorePath = '.mountignore';
  if (fs.existsSync(ignorePath)) {
    try {
      const content = fs.readFileSync(ignorePath, 'utf8');
      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          ignores.push(trimmed);
        }
      });
    } catch {
      // ignore
    }
  }
  return ignores;
};

const setupBaseDirectory = (baseDir: string, debug: boolean): string => {
  const mountsDir = path.join(baseDir, '.mounts');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  } else {
    const ignoreList = getIgnoredItems();
    const existingItems = fs.readdirSync(baseDir).filter((item) => !ignoreList.includes(item));
    if (existingItems.length > 0) {
      reset(debug, baseDir);
    }
  }
  if (!isWindows() && !fs.existsSync(mountsDir)) {
    fs.mkdirSync(mountsDir, { recursive: true });
  }
  return mountsDir;
};

const getFolderName = (drive: DriveMapping, truncateLength: number): string => {
  let folderName = drive.nickname ? drive.nickname.replace(INVALID_CHARS_REGEX, '') : undefined;
  if (!folderName) {
    if (drive.title) {
      const cleanTitle = drive.title.replace(INVALID_CHARS_REGEX, '');
      folderName = truncate(startCase(cleanTitle), truncateLength).trim();
    } else {
      folderName = drive.id;
    }
  }
  return `${folderName} [${drive.id}]`;
};

const sanitizeErrorMessage = (error: unknown, password?: string): string => {
  let msg = error instanceof Error ? error.message : String(error);
  if (password) {
    msg = msg.split(password).join('***');
    msg = msg.split(encodeURIComponent(password)).join('***');
  }
  return msg;
};

const sanitizeStderr = (error: unknown, password?: string): string | undefined => {
  if (
    error &&
    typeof error === 'object' &&
    'stderr' in error &&
    (error as { stderr?: unknown }).stderr
  ) {
    let stderrMsg = String((error as { stderr: unknown }).stderr);
    if (password) {
      stderrMsg = stderrMsg.split(password).join('***');
      stderrMsg = stderrMsg.split(encodeURIComponent(password)).join('***');
    }
    return stderrMsg;
  }
  return undefined;
};

const handleMountError = (
  error: unknown,
  remote: string,
  localPath: string,
  mountPath: string,
  password?: string,
  debug: boolean = false,
) => {
  process.exitCode = 1;
  const msg = sanitizeErrorMessage(error, password);
  signale.error(`Error: Failed to map ${remote} to ${localPath}`);
  signale.error(`Reason: ${msg}`);

  const stderrMsg = sanitizeStderr(error, password);
  if (stderrMsg) {
    signale.error(`Command Output: ${stderrMsg}`);
  }

  if (debug) {
    signale.error(`Debug Error: ${msg}`);
  }

  try {
    if (!isWindows() && fs.existsSync(localPath) && fs.lstatSync(localPath).isSymbolicLink()) {
      fs.unlinkSync(localPath);
    }
    if (fs.existsSync(mountPath) && fs.readdirSync(mountPath).length === 0) {
      fs.rmdirSync(mountPath);
      if (debug) {
        signale.debug(`Cleaned up empty folder ${mountPath}`);
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
};

interface MountOptions {
  remote: string;
  localPath: string;
  mountPath: string;
  username?: string;
  password?: string;
  domain?: string;
  debug?: boolean;
}

const mountWindows = (options: MountOptions) => {
  const { remote, localPath, username, password, domain, debug = false } = options;
  const existingIsFolder = isExistingFolder(localPath);
  if (existingIsFolder) {
    try {
      fs.rmdirSync(localPath);
    } catch {
      /* empty */
    }
  }
  if (username && password) {
    const userWithDomain = domain ? `${domain}\\${username}` : username;
    const cmd = `net use "${remote}" "${password}" /user:"${userWithDomain}"`;
    if (debug) signale.debug(`Executing: net use "${remote}" "***" /user:"${userWithDomain}"`);
    execSync(cmd, { stdio: debug ? 'pipe' : 'ignore' });
  }
  const mklinkCmd = `mklink /D "${localPath}" "${remote}"`;
  if (debug) signale.debug(`Executing: ${mklinkCmd}`);
  execSync(mklinkCmd, { stdio: debug ? 'pipe' : 'ignore' });
};

const mountMac = (options: MountOptions) => {
  const { remote, localPath, mountPath, username, password, domain, debug = false } = options;
  let macRemote = remote;
  let macRemoteLog = remote;
  if (username && password && macRemote.startsWith('smb://')) {
    const domainPrefix = domain ? `${encodeURIComponent(domain)};` : '';
    macRemote = macRemote.replace(
      'smb://',
      `smb://${domainPrefix}${encodeURIComponent(username)}:${encodeURIComponent(password)}@`,
    );
    macRemoteLog = macRemoteLog.replace(
      'smb://',
      `smb://${domainPrefix}${encodeURIComponent(username)}:***@`,
    );
  }
  if (debug) signale.debug(`Executing: mount_smbfs "${macRemoteLog}" "${mountPath}"`);
  execSync(`mount_smbfs "${macRemote}" "${mountPath}"`, {
    stdio: debug ? 'pipe' : 'ignore',
  });
  if (!fs.existsSync(localPath)) {
    fs.symlinkSync(mountPath, localPath);
  }
};

const mountLinux = (options: MountOptions) => {
  const { remote, localPath, mountPath, username, password, domain, debug = false } = options;
  let linuxRemote = remote;
  if (linuxRemote.startsWith('smb://')) {
    linuxRemote = linuxRemote.replace('smb://', '//');
  }
  const mountOpts =
    username && password ? `username=${username},password=${password},domain=${domain}` : 'guest';
  const mountOptsLog =
    username && password ? `username=${username},password=***,domain=${domain}` : 'guest';
  if (debug)
    signale.debug(
      `Executing: sudo mount -t cifs -o ${mountOptsLog} "${linuxRemote}" "${mountPath}"`,
    );
  execSync(`sudo mount -t cifs -o ${mountOpts} "${linuxRemote}" "${mountPath}"`, {
    stdio: debug ? 'pipe' : 'ignore',
  });
  if (!fs.existsSync(localPath)) {
    fs.symlinkSync(mountPath, localPath);
  }
};

interface ProcessDriveMappingOptions {
  drive: DriveMapping;
  baseDir: string;
  mountsDir: string;
  finalRemotePath: string | undefined;
  truncateLength: number;
  username?: string;
  password?: string;
  domain?: string;
  debug?: boolean;
}

const processDriveMapping = ({
  drive,
  baseDir,
  mountsDir,
  finalRemotePath,
  truncateLength,
  username,
  password,
  domain,
  debug = false,
}: ProcessDriveMappingOptions) => {
  const remote = finalRemotePath
    ? `${finalRemotePath}${isWindows() ? '\\' : '/'}${drive.id}`
    : isWindows()
      ? `${REMOTE_PATH_WIN}\\${drive.id}`
      : `${REMOTE_PATH_NIX}/${drive.id}`;

  const folderName = getFolderName(drive, truncateLength);
  const localPath = path.join(baseDir, folderName);
  const mountPath = isWindows() ? localPath : path.join(mountsDir, drive.id);

  if (isMounted(localPath, mountPath)) {
    if (debug) {
      signale.debug(`Mount already exists at ${mountPath}, skipping.`);
    }
    if (!isWindows() && !fs.existsSync(localPath)) {
      fs.symlinkSync(mountPath, localPath);
    }
    return;
  }

  if (!isWindows() && !fs.existsSync(mountPath)) {
    fs.mkdirSync(mountPath, { recursive: true });
  }

  signale.info(`Mapping ${remote} to ${localPath}`);

  try {
    if (isWindows()) {
      mountWindows({ remote, localPath, mountPath, username, password, domain, debug });
    } else if (isMac()) {
      mountMac({ remote, localPath, mountPath, username, password, domain, debug });
    } else {
      mountLinux({ remote, localPath, mountPath, username, password, domain, debug });
    }
    if (debug) {
      signale.debug(`Successfully mounted ${remote} to ${localPath}`);
    }
  } catch (error: unknown) {
    handleMountError(error, remote, localPath, mountPath, password, debug);
  }
};

let fetchMiddlewareSetup = false;
const setupFetchMiddleware = (debug: boolean) => {
  if (!debug || fetchMiddlewareSetup) return;
  fetchMiddlewareSetup = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof originalFetch>) => {
    const [input, init] = args;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    const method = init?.method || 'GET';
    let reqHeaders = '{}';
    if (init?.headers) {
      reqHeaders =
        init.headers instanceof Headers
          ? JSON.stringify(Object.fromEntries(init.headers.entries()))
          : JSON.stringify(init.headers);
    }
    signale.debug(`[fetch request] ${method} ${url} Headers: ${reqHeaders}`);
    const response = await originalFetch(...args);
    const resHeaders = JSON.stringify(Object.fromEntries(response.headers.entries()));
    signale.debug(
      `[fetch response] ${method} ${url} - Status: ${response.status} ${response.statusText} Headers: ${resHeaders}`,
    );
    return response;
  };
};

const fetchDmpConfig = async (dmpBaseUrl: string, debug?: boolean): Promise<DmpConfig> => {
  try {
    if (debug) signale.debug(`Fetching config from ${dmpBaseUrl}/config.json...`);
    const response = await fetch(`${dmpBaseUrl}/config.json`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    const result: DmpConfig = {};
    if (data.apiUrl) result.dmpApiUrl = data.apiUrl;
    const authDomain = data.amplify?.Auth?.Cognito?.loginWith?.oauth?.domain;
    if (authDomain) {
      result.authUrl = `https://${authDomain}/oauth2/authorize`;
      result.tokenUrl = `https://${authDomain}/oauth2/token`;
    }
    const clientId = data.amplify?.Auth?.Cognito?.userPoolClientId;
    if (clientId) result.clientId = clientId;
    if (debug) signale.debug('Extracted dmp config overrides:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (debug) signale.error(`Failed to fetch DMP config from ${dmpBaseUrl}:`, msg);
    return {};
  }
};

export const refresh = async (options: RefreshOptions = {}): Promise<void> => {
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
    const { username, password, domain } = resolveCredentials(options);

    if (options.force && fs.existsSync(foldersFile)) {
      if (debug) signale.debug(`Force option provided, removing existing ${foldersFile}`);
      fs.rmSync(foldersFile, { force: true });
    }

    if (doRefresh || !fs.existsSync(foldersFile)) {
      signale.info(`${foldersFile} not found or refresh requested. Fetching plans from DMP...`);
      const port = options.port || 3000;
      const force = options.force || false;

      const token = await performLogin({ dmpConfig: dmpConfig || {}, port, debug, force });
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

    const configData = await loadFoldersConfig(foldersFile, debug);
    const mountsDir = setupBaseDirectory(baseDir, debug);

    const finalRemotePath = remotePath || configData.remotePath;

    for (const drive of configData.folders) {
      processDriveMapping({
        drive,
        baseDir,
        mountsDir,
        finalRemotePath,
        truncateLength,
        username,
        password,
        domain,
        debug,
      });
    }
    signale.success('Refresh complete.');
  } catch (error: unknown) {
    process.exitCode = 1;
    const msg = sanitizeErrorMessage(error, options.password);
    signale.error('Error during refresh:', msg);
  }
};

const handleUnmountError = (error: unknown, pathName: string, debug: boolean) => {
  process.exitCode = 1;
  const msg = error instanceof Error ? error.message : String(error);
  signale.error(`Error: Failed to unmount or remove ${pathName}`);
  signale.error(`Reason: ${msg}`);
  const stderrMsg = sanitizeStderr(error);
  if (stderrMsg) {
    signale.error(`Command Output: ${stderrMsg}`);
  }
  if (debug) {
    signale.error(`Debug Error: ${msg}`);
  }
};

const resetMountsDir = (mountsDir: string, debug: boolean) => {
  if (fs.existsSync(mountsDir) && !isWindows()) {
    const mounts = fs.readdirSync(mountsDir);
    for (const mountFolder of mounts) {
      const mountPath = path.join(mountsDir, mountFolder);
      signale.info(`Unmounting ${mountPath}`);
      try {
        if (isMac()) {
          execSync(`umount "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
        } else {
          execSync(`sudo umount "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
        }
        fs.rmdirSync(mountPath);
      } catch (error: unknown) {
        handleUnmountError(error, mountPath, debug);
      }
    }
    try {
      fs.rmdirSync(mountsDir);
    } catch {
      // Ignore
    }
  }
};

const resetBaseDirMappings = (baseDir: string, debug: boolean, ignoreList: string[]) => {
  const folders = fs.readdirSync(baseDir);
  for (const folder of folders) {
    if (ignoreList.includes(folder)) continue;
    const localPath = path.join(baseDir, folder);
    signale.info(`Removing mapping for ${localPath}`);
    try {
      if (isWindows()) {
        fs.rmSync(localPath, { recursive: true, force: true });
      } else {
        const stat = fs.lstatSync(localPath);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(localPath);
        } else {
          if (isMac()) {
            execSync(`umount "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          } else {
            execSync(`sudo umount "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          }
          fs.rmdirSync(localPath);
        }
      }
    } catch (error: unknown) {
      handleUnmountError(error, localPath, debug);
    }
  }
};

export const reset = (debug: boolean = false, baseDir: string = BASE_DIR): void => {
  signale.info('Resetting folder mappings...');
  if (fs.existsSync(baseDir)) {
    const mountsDir = path.join(baseDir, '.mounts');
    const ignoreList = getIgnoredItems();
    resetMountsDir(mountsDir, debug);
    resetBaseDirMappings(baseDir, debug, ignoreList);
  }
  signale.success('Reset complete.');
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
    reset(opts.debug, opts.baseDir);
  });

program
  .command('auth')
  .description('Set credentials in the keychain')
  .action(() => {
    if (isWindows()) {
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

    saveCredentialsToKeychain({ username, password, domain }, debug);
    signale.success('Successfully updated credentials in keychain.');
  });

program
  .command('clear-auth')
  .description('Clear all credentials from the keychain')
  .action(() => {
    if (isWindows()) {
      signale.error('Keychain storage is not supported on Windows.');
      process.exit(1);
    }
    const debug = program.opts().debug || false;
    clearCredentialsFromKeychain(debug);
    signale.success('Successfully cleared credentials from keychain.');
  });

export interface LoginOptions {
  dmpConfig: DmpConfig;
  port: number;
  debug: boolean;
  force?: boolean;
}

export const performLogin = async (options: LoginOptions): Promise<string | undefined> => {
  const { dmpConfig, port, debug, force } = options;
  const { authUrl, tokenUrl, clientId } = dmpConfig;

  setupFetchMiddleware(debug);

  if (!isWindows() && !force) {
    const existingToken = getTokenFromKeychain(debug);
    if (existingToken) {
      try {
        const payloadBase64 = existingToken.split('.')[1];
        if (payloadBase64) {
          const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
          const payload = JSON.parse(payloadJson);
          if (!payload.exp || payload.exp * 1000 > Date.now()) {
            if (debug) signale.debug('Valid token found in keychain.');
            return existingToken;
          }
        }
      } catch {
        if (debug) signale.debug('Failed to parse existing token from keychain.');
      }
    }
  }

  if (!authUrl || !tokenUrl || !clientId) {
    signale.error(
      'Missing required OAuth parameters. Please provide --auth-url, --token-url, and --client-id, or set AUTH_URL, TOKEN_URL, CLIENT_ID environment variables.',
    );
    process.exit(1);
  }

  const http = require('http');
  const { URL } = require('url');
  let openPkg;
  try {
    openPkg = require('open');
  } catch {
    signale.error('Could not load the open module.');
    process.exit(1);
  }

  const redirectUri = `http://localhost:${port}`;
  const scope = 'phone email profile openid aws.cognito.signin.user.admin';
  const fullAuthUrl = `${authUrl}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;

  return new Promise((resolve) => {
    const server = http.createServer(
      async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
        try {
          const parsedUrl = new URL(req.url, `http://localhost:${port}`);
          if (parsedUrl.pathname === '/') {
            const code = parsedUrl.searchParams.get('code');
            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(
                '<html><body><h2>Authentication successful!</h2><p>You can close this window and return to your terminal.</p></body></html>',
              );

              if (debug) signale.debug('Authorization code received, exchanging for token...');

              try {
                const response = await fetch(tokenUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    client_id: clientId,
                    redirect_uri: redirectUri,
                  }).toString(),
                });

                if (!response.ok) {
                  throw new Error(
                    `HTTP error! status: ${response.status} ${await response.text()}`,
                  );
                }

                const tokenData = (await response.json()) as { id_token?: string };
                if (tokenData.id_token) {
                  if (!isWindows()) {
                    saveTokenToKeychain(tokenData.id_token, debug);
                  }
                  signale.success('Successfully logged in and saved token.');
                  server.close(() => resolve(tokenData.id_token));
                  return;
                } else {
                  signale.error('No id_token found in response.');
                }
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                signale.error('Failed to exchange code for token:', msg);
              }
            } else {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing authorization code.');
              signale.error('No authorization code found in callback.');
            }

            server.close(() => process.exit(0));
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
          }
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
      },
    );

    server.listen(port, async () => {
      signale.info(`Listening on ${redirectUri}`);
      signale.info(`Opening browser to ${fullAuthUrl}`);
      try {
        await openPkg(fullAuthUrl);
      } catch {
        signale.error('Failed to open browser, please navigate to the URL manually:', fullAuthUrl);
      }
    });
  });
};

if (require.main === module) {
  program.parse(process.argv);
}
