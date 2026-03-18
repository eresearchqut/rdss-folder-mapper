#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, execFileSync } from 'child_process';
import { Command } from 'commander';
import { startCase } from 'lodash';
import truncate from '@stdlib/string-truncate';
import readlineSync from 'readline-sync';

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
}

const getMacCredentials = (debug: boolean) => {
  try {
    if (debug) console.log('Attempting to read credentials from macOS keychain...');
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
      if (debug) console.log('Credentials successfully retrieved from macOS keychain.');
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
    if (debug) console.log('Failed to read from macOS keychain:', (e as Error).message);
  }
  return {};
};

const getLinuxCredentials = (debug: boolean) => {
  try {
    if (debug) console.log('Attempting to read credentials from Linux secret-tool...');
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
      if (debug) console.log('Credentials successfully retrieved from Linux secret-tool.');
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
    if (debug) console.log('Failed to read from Linux secret-tool:', (e as Error).message);
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
    if (debug) console.log('Saving credentials to macOS keychain...');
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
    if (debug) console.log('Failed to save to macOS keychain:', msg);
  }
};

const saveLinuxCredentials = (
  creds: { username?: string; password?: string; domain?: string },
  debug: boolean,
): void => {
  try {
    if (debug) console.log('Saving credentials to Linux secret-tool...');
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
    if (debug) console.log('Failed to save to Linux secret-tool:', (e as Error).message);
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
    if (debug) console.log('Keychain storage is not supported on Windows.');
  }
};

const clearMacCredentials = (debug: boolean): void => {
  try {
    if (debug) console.log('Clearing credentials from macOS keychain...');
    execSync('security delete-generic-password -s "rdss-folder-mapper"', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) console.log('Failed to clear macOS keychain:', (e as Error).message);
  }
};

const clearLinuxCredentials = (debug: boolean): void => {
  try {
    if (debug) console.log('Clearing credentials from Linux secret-tool...');
    execSync('secret-tool clear service rdss-folder-mapper', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) console.log('Failed to clear Linux secret-tool:', (e as Error).message);
  }
};

const clearCredentialsFromKeychain = (debug: boolean): void => {
  if (isMac()) {
    clearMacCredentials(debug);
  } else if (!isWindows()) {
    clearLinuxCredentials(debug);
  } else {
    if (debug) console.log('Keychain storage is not supported on Windows.');
  }
};

interface RefreshOptions {
  debug?: boolean;
  baseDir?: string;
  username?: string;
  password?: string;
  foldersFile?: string;
  cliRemotePath?: string;
  truncateLength?: number;
  domain?: string;
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
      console.log(`No username provided, defaulting to executing user: ${username}`);
  }
  return { username, password, domain };
};

const loadFoldersConfig = (foldersFile: string): ConfigData => {
  try {
    const fileData = fs.readFileSync(foldersFile, 'utf8');
    const parsedData = JSON.parse(fileData);
    return {
      folders: parsedData.folders || [],
      remotePath: parsedData.remotePath,
    };
  } catch {
    throw new Error(
      `Failed to read or parse ${foldersFile}. Please ensure the file exists and is valid JSON.`,
    );
  }
};

const setupBaseDirectory = (baseDir: string, debug: boolean): string => {
  const mountsDir = path.join(baseDir, '.mounts');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  } else {
    const existingItems = fs.readdirSync(baseDir).filter((item) => item !== '.mounts');
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
  console.error(`Error: Failed to map ${remote} to ${localPath}`);
  console.error(`Reason: ${msg}`);

  const stderrMsg = sanitizeStderr(error, password);
  if (stderrMsg) {
    console.error(`Command Output: ${stderrMsg}`);
  }

  if (debug) {
    console.error(`Debug Error: ${msg}`);
  }

  try {
    if (!isWindows() && fs.existsSync(localPath) && fs.lstatSync(localPath).isSymbolicLink()) {
      fs.unlinkSync(localPath);
    }
    if (fs.existsSync(mountPath) && fs.readdirSync(mountPath).length === 0) {
      fs.rmdirSync(mountPath);
      if (debug) {
        console.log(`Debug: Cleaned up empty folder ${mountPath}`);
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
    if (debug) console.log(`Executing: net use "${remote}" "***" /user:"${userWithDomain}"`);
    execSync(cmd, { stdio: debug ? 'pipe' : 'ignore' });
  }
  const mklinkCmd = `mklink /D "${localPath}" "${remote}"`;
  if (debug) console.log(`Executing: ${mklinkCmd}`);
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
  if (debug) console.log(`Executing: mount_smbfs "${macRemoteLog}" "${mountPath}"`);
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
    console.log(`Executing: sudo mount -t cifs -o ${mountOptsLog} "${linuxRemote}" "${mountPath}"`);
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
      console.log(`Debug: Mount already exists at ${mountPath}, skipping.`);
    }
    if (!isWindows() && !fs.existsSync(localPath)) {
      fs.symlinkSync(mountPath, localPath);
    }
    return;
  }

  if (!isWindows() && !fs.existsSync(mountPath)) {
    fs.mkdirSync(mountPath, { recursive: true });
  }

  console.log(`Mapping ${remote} to ${localPath}`);

  try {
    if (isWindows()) {
      mountWindows({ remote, localPath, mountPath, username, password, domain, debug });
    } else if (isMac()) {
      mountMac({ remote, localPath, mountPath, username, password, domain, debug });
    } else {
      mountLinux({ remote, localPath, mountPath, username, password, domain, debug });
    }
    if (debug) {
      console.log(`Debug: Successfully mounted ${remote} to ${localPath}`);
    }
  } catch (error: unknown) {
    handleMountError(error, remote, localPath, mountPath, password, debug);
  }
};

export const refresh = async (options: RefreshOptions = {}): Promise<void> => {
  const {
    debug = false,
    baseDir = BASE_DIR,
    foldersFile = 'folders.json',
    cliRemotePath,
    truncateLength = 40,
  } = options;

  console.log('Refreshing drive mappings...');
  try {
    const { username, password, domain } = resolveCredentials(options);
    const configData = loadFoldersConfig(foldersFile);
    const mountsDir = setupBaseDirectory(baseDir, debug);

    const finalRemotePath = cliRemotePath || configData.remotePath;

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
    console.log('Refresh complete.');
  } catch (error: unknown) {
    process.exitCode = 1;
    const msg = sanitizeErrorMessage(error, options.password);
    console.error('Error during refresh:', msg);
  }
};

const handleUnmountError = (error: unknown, pathName: string, debug: boolean) => {
  process.exitCode = 1;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`Error: Failed to unmount or remove ${pathName}`);
  console.error(`Reason: ${msg}`);
  const stderrMsg = sanitizeStderr(error);
  if (stderrMsg) {
    console.error(`Command Output: ${stderrMsg}`);
  }
  if (debug) {
    console.error(`Debug Error: ${msg}`);
  }
};

const resetMountsDir = (mountsDir: string, debug: boolean) => {
  if (fs.existsSync(mountsDir) && !isWindows()) {
    const mounts = fs.readdirSync(mountsDir);
    for (const mountFolder of mounts) {
      const mountPath = path.join(mountsDir, mountFolder);
      console.log(`Unmounting ${mountPath}`);
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

const resetBaseDirMappings = (baseDir: string, debug: boolean) => {
  const folders = fs.readdirSync(baseDir);
  for (const folder of folders) {
    if (folder === '.mounts') continue;
    const localPath = path.join(baseDir, folder);
    console.log(`Removing mapping for ${localPath}`);
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
  console.log('Resetting folder mappings...');
  if (fs.existsSync(baseDir)) {
    const mountsDir = path.join(baseDir, '.mounts');
    resetMountsDir(mountsDir, debug);
    resetBaseDirMappings(baseDir, debug);
  }
  console.log('Reset complete.');
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
  .option(
    '-t, --truncate <number>',
    'Truncate length for folder names',
    (val) => parseInt(val, 10),
    40,
  )
  .option('-d, --domain <domain>', 'Domain for remote mapping')
  .action((options) => {
    refresh({
      debug: options.debug,
      baseDir: options.baseDir,
      username: process.env.RDSS_USERNAME,
      password: process.env.RDSS_PASSWORD,
      foldersFile: options.folders,
      cliRemotePath: options.remotePath,
      truncateLength: options.truncate,
      domain: options.domain,
    }).catch(console.error);
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
      console.error('Keychain storage is not supported on Windows.');
      process.exit(1);
    }

    const debug = program.opts().debug || false;

    const usernameInput = readlineSync.question(
      'Enter username (leave blank to use current user): ',
    );
    const username = usernameInput.trim() || os.userInfo().username;

    const password = readlineSync.question('Enter password: ', {
      hideEchoBack: true,
    });

    const domainInput = readlineSync.question('Enter domain (optional): ');
    const domain = domainInput.trim() || undefined;

    saveCredentialsToKeychain({ username, password, domain }, debug);
    console.log('Successfully updated credentials in keychain.');
  });

program
  .command('clear-auth')
  .description('Clear all credentials from the keychain')
  .action(() => {
    if (isWindows()) {
      console.error('Keychain storage is not supported on Windows.');
      process.exit(1);
    }
    const debug = program.opts().debug || false;
    clearCredentialsFromKeychain(debug);
    console.log('Successfully cleared credentials from keychain.');
  });

program.parse(process.argv);
