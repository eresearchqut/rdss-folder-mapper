import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { startCase } from 'lodash';
import truncate from '@stdlib/string-truncate';
import signale from 'signale';

import { FolderMapping } from './mapper';
import { OS, OsInfo } from './os';
import { Credentials } from './secrets';


// eslint-disable-next-line no-control-regex
const INVALID_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1F]/g;



export const isMounted = (localPath: string, mountPath: string, osInfo: OsInfo): boolean => {
  try {
    if (osInfo.isWindows) {
      if (fs.existsSync(localPath)) {
        const stat = fs.lstatSync(localPath);
        return stat.isSymbolicLink();
      }
      if (fs.existsSync(`${localPath}.lnk`)) {
        return true;
      }
      return false;
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

export const getIgnoredItems = (): string[] => {
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

export const setupBaseDirectory = (baseDir: string, debug: boolean, osInfo: OsInfo): string => {
  const mountsDir = path.join(baseDir, '.mounts');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  } else {
    const ignoreList = getIgnoredItems();
    const existingItems = fs.readdirSync(baseDir).filter((item) => !ignoreList.includes(item));
    if (existingItems.length > 0) {
      reset(debug, baseDir, osInfo);
    }
  }
  if (!osInfo.isWindows && !fs.existsSync(mountsDir)) {
    fs.mkdirSync(mountsDir, { recursive: true });
  }
  return mountsDir;
};

export const getFolderName = (drive: FolderMapping, truncateLength: number): string => {
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

export const sanitizeErrorMessage = (error: unknown, password?: string): string => {
  let msg = error instanceof Error ? error.message : String(error);
  if (password) {
    msg = msg.split(password).join('***');
    msg = msg.split(encodeURIComponent(password)).join('***');
  }
  return msg;
};

export const sanitizeStderr = (error: unknown, password?: string): string | undefined => {
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

export const handleMountError = (
  error: unknown,
  remote: string,
  localPath: string,
  mountPath: string,
  password: string | undefined,
  debug: boolean,
  osInfo: OsInfo,
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
    if (!osInfo.isWindows && fs.existsSync(localPath) && fs.lstatSync(localPath).isSymbolicLink()) {
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



export interface MountOptions {
  remotePath: string;
  baseDir: string;
  os: OS;
  localPath: string;
  mountPath: string;
  credentials?: Credentials;
  debug?: boolean;
}

export const mountWindows = (options: MountOptions) => {
  const { remotePath, localPath, credentials, debug = false } = options;
  const { username, password, domain } = credentials || {};
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
    const cmd = `net use "${remotePath}" "${password}" /user:"${userWithDomain}"`;
    if (debug) signale.debug(`Executing: net use "${remotePath}" "***" /user:"${userWithDomain}"`);
    execSync(cmd, { stdio: debug ? 'pipe' : 'ignore' });
  }
  try {
    const mklinkCmd = `mklink /D "${localPath}" "${remotePath}"`;
    if (debug) signale.debug(`Executing: ${mklinkCmd}`);
    execSync(mklinkCmd, { stdio: debug ? 'pipe' : 'ignore' });
  } catch (error) {
    if (debug) signale.debug(`mklink failed (likely insufficient permissions), falling back to Windows shortcut (.lnk)`);
    const psCmd = `$s=(New-Object -COM WScript.Shell).CreateShortcut('${localPath}.lnk');$s.TargetPath='${remotePath}';$s.Save()`;
    execSync(`powershell -command "${psCmd}"`, { stdio: debug ? 'pipe' : 'ignore' });
  }
}

export const mountMac = (options: MountOptions) => {
  const { remotePath, localPath, mountPath, credentials, debug = false } = options;
  const { username, password, domain } = credentials || {};
  let macRemote = remotePath;
  let macRemoteLog = remotePath;
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

export const mountLinux = (options: MountOptions) => {
  const { remotePath, localPath, mountPath, credentials, debug = false } = options;
  const { username, password, domain } = credentials || {};
  let linuxRemote = remotePath;
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

export interface FolderMappingOptions extends Omit<MountOptions, 'os' | 'localPath' | 'mountPath'> {
  osInfo: OsInfo;
  folderMapping: FolderMapping;
  mountsDir: string;
  truncateLength: number;
}

export const processFolderMapping = ({
  folderMapping,
  baseDir,
  mountsDir,
  remotePath,
  truncateLength,
  credentials,
  debug = false,
  osInfo,
}: FolderMappingOptions) => {
  const remote = remotePath;

  const folderName = getFolderName(folderMapping, truncateLength);
  const localPath = path.join(baseDir, folderName);
  const mountPath = osInfo.isWindows ? localPath : path.join(mountsDir, folderMapping.id);
  const osType = osInfo.osType;

  const mountOptions: MountOptions = {
    remotePath: remote,
    baseDir,
    os: osType,
    localPath,
    mountPath,
    credentials,
    debug,
  };

  if (isMounted(localPath, mountPath, osInfo)) {
    if (debug) {
      signale.debug(`Mount already exists at ${mountPath}, skipping.`);
    }
    if (!osInfo.isWindows && !fs.existsSync(localPath)) {
      fs.symlinkSync(mountPath, localPath);
    }
    return;
  }

  if (!osInfo.isWindows && !fs.existsSync(mountPath)) {
    fs.mkdirSync(mountPath, { recursive: true });
  }

  signale.info(`Mapping ${remote} to ${localPath}`);

  try {
    if (osInfo.isWindows) {
      mountWindows(mountOptions);
    } else if (osInfo.isMac) {
      mountMac(mountOptions);
    } else {
      mountLinux(mountOptions);
    }
    if (debug) {
      signale.debug(`Successfully mounted ${remote} to ${localPath}`);
    }
  } catch (error: unknown) {
    handleMountError(error, remote, localPath, mountPath, credentials?.password, debug, osInfo);
  }
};

export const handleUnmountError = (error: unknown, pathName: string, debug: boolean) => {
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

export const resetMountsDir = (mountsDir: string, debug: boolean, osInfo: OsInfo) => {
  if (fs.existsSync(mountsDir) && !osInfo.isWindows) {
    const mounts = fs.readdirSync(mountsDir);
    for (const mountFolder of mounts) {
      const mountPath = path.join(mountsDir, mountFolder);
      signale.info(`Unmounting ${mountPath}`);
      try {
        if (osInfo.isMac) {
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

export const resetBaseDirMappings = (baseDir: string, debug: boolean, ignoreList: string[], osInfo: OsInfo) => {
  const folders = fs.readdirSync(baseDir);
  for (const folder of folders) {
    if (ignoreList.includes(folder)) continue;
    const localPath = path.join(baseDir, folder);
    signale.info(`Removing mapping for ${localPath}`);
    try {
      if (osInfo.isWindows) {
        fs.rmSync(localPath, { recursive: true, force: true });
        fs.rmSync(`${localPath}.lnk`, { force: true });
      } else {
        const stat = fs.lstatSync(localPath);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(localPath);
        } else {
          if (osInfo.isMac) {
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

export const reset = (debug: boolean = false, baseDir: string, osInfo: OsInfo): void => {
  signale.info('Resetting folder mappings...');
  if (fs.existsSync(baseDir)) {
    const mountsDir = path.join(baseDir, '.mounts');
    const ignoreList = getIgnoredItems();
    resetMountsDir(mountsDir, debug, osInfo);
    resetBaseDirMappings(baseDir, debug, ignoreList, osInfo);
  }
  signale.success('Reset complete.');
};
