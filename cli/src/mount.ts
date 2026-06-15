import fs from 'fs';
import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { startCase } from 'lodash';
import truncate from '@stdlib/string-truncate';
import signale from 'signale';

import { FolderMapping } from './mapper';
import { OS, OsInfo } from './os';
import { Credentials } from './secrets';

// eslint-disable-next-line no-control-regex
const INVALID_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1F]/g;

// Use full paths to Windows system executables to avoid PATH lookup failures
// in packaged Electron apps where PATH is typically stripped down.
const winSys32 = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32`
  : 'C:\\Windows\\System32';
const psExe = `${winSys32}\\WindowsPowerShell\\v1.0\\powershell.exe`;
const netExe = `${winSys32}\\net.exe`;

/**
 * Check whether a Windows network share is reachable using the current Windows
 * session identity (Kerberos / integrated auth). When this returns true the
 * share can be mapped without prompting for SMB credentials.
 */
export const isWindowsShareAccessible = (remotePath: string, debug = false): boolean => {
  try {
    const escaped = remotePath.replace(/'/g, "''");
    const out = execFileSync(
      psExe,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `if(Test-Path -LiteralPath '${escaped}'){'YES'}else{'NO'}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const accessible = out.includes('YES');
    if (debug) {
      signale.debug(
        accessible
          ? `Share ${remotePath} is reachable with current Windows credentials.`
          : `Share ${remotePath} is not reachable with current Windows credentials.`,
      );
    }
    return accessible;
  } catch {
    return false;
  }
};




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
    let existingItems: string[] = [];
    try {
      existingItems = fs.readdirSync(baseDir).filter((item) => !ignoreList.includes(item));
    } catch {
      // EPERM can occur when active mount points prevent the directory from being
      // enumerated (common on macOS with SMB mounts). Proceed without resetting —
      // the mapping step will handle stale mounts individually.
      if (debug) signale.debug(`Could not read ${baseDir} — skipping pre-reset`);
    }
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
    if (debug) signale.debug(`Executing: net use "${remotePath}" "***" /user:"${userWithDomain}"`);
    execFileSync(netExe, ['use', remotePath, password, `/user:${userWithDomain}`], {
      stdio: debug ? 'pipe' : 'ignore',
    });
  }
  // Escape single quotes for PowerShell string literals to prevent script injection.
  const escapePS = (s: string) => s.replace(/'/g, "''");
  const psCmd = `$s=(New-Object -COM WScript.Shell).CreateShortcut('${escapePS(localPath + '.lnk')}');$s.TargetPath='${escapePS(remotePath)}';$s.Save()`;
  if (debug) signale.debug(`Executing PowerShell to create shortcut: ${psCmd}`);
  execFileSync(psExe, ['-NoProfile', '-NonInteractive', '-command', psCmd], {
    stdio: debug ? 'pipe' : 'ignore',
  });
}

/**
 * Build the `smb://` URL used by `mount_smbfs`, injecting URL-encoded
 * credentials when supplied. Returns both the real URL and a redacted version
 * safe for logging.
 */
export const buildMacSmbUrl = (
  remotePath: string,
  credentials?: Credentials,
): { url: string; logUrl: string } => {
  const { username, password, domain } = credentials || {};
  let url = remotePath;
  let logUrl = remotePath;
  if (username && password && remotePath.startsWith('smb://')) {
    const domainPrefix = domain ? `${encodeURIComponent(domain)};` : '';
    url = remotePath.replace(
      'smb://',
      `smb://${domainPrefix}${encodeURIComponent(username)}:${encodeURIComponent(password)}@`,
    );
    logUrl = remotePath.replace(
      'smb://',
      `smb://${domainPrefix}${encodeURIComponent(username)}:***@`,
    );
  }
  return { url, logUrl };
};

export const mountMac = (options: MountOptions) => {
  const { remotePath, localPath, mountPath, credentials, debug = false } = options;
  const { url: macRemote, logUrl: macRemoteLog } = buildMacSmbUrl(remotePath, credentials);
  if (debug) signale.debug(`Executing: mount_smbfs "${macRemoteLog}" "${mountPath}"`);
  execFileSync('mount_smbfs', [macRemote, mountPath], {
    stdio: debug ? 'pipe' : 'ignore',
  });
  if (!fs.existsSync(localPath)) {
    fs.symlinkSync(mountPath, localPath);
  }
};

export const mountLinux = (options: MountOptions) => {
  const { remotePath, localPath, mountPath, credentials, debug = false } = options;
  const { url: linuxRemote, opts: mountOpts, logOpts: mountOptsLog } = buildLinuxCifsMount(
    remotePath,
    credentials,
  );
  if (debug)
    signale.debug(
      `Executing: sudo mount -t cifs -o ${mountOptsLog} "${linuxRemote}" "${mountPath}"`,
    );
  execFileSync('sudo', ['mount', '-t', 'cifs', '-o', mountOpts, linuxRemote, mountPath], {
    stdio: debug ? 'pipe' : 'ignore',
  });
  if (!fs.existsSync(localPath)) {
    fs.symlinkSync(mountPath, localPath);
  }
};

/**
 * Build the host path and CIFS `-o` option string for a Linux `mount -t cifs`
 * call. Returns the option string plus a redacted version for logging.
 */
export const buildLinuxCifsMount = (
  remotePath: string,
  credentials?: Credentials,
): { url: string; opts: string; logOpts: string } => {
  const { username, password, domain } = credentials || {};
  const url = remotePath.startsWith('smb://') ? remotePath.replace('smb://', '//') : remotePath;
  const opts =
    username && password ? `username=${username},password=${password},domain=${domain}` : 'guest';
  const logOpts =
    username && password ? `username=${username},password=***,domain=${domain}` : 'guest';
  return { url, opts, logOpts };
};


/**
 * Search the system mount table for an existing SMB/CIFS mount of the given
 * server + share, ignoring any `user@`/`domain;user@` prefix in the source.
 * Returns the local mount point if found (e.g. a prior run or a Finder mount
 * under /Volumes), so the caller can alias into it without re-authenticating.
 */
export const findExistingSmbMount = (
  server: string,
  share: string,
  debug = false,
): string | undefined => {
  try {
    const out = execSync('mount', { encoding: 'utf8' });
    const target = `${server.toLowerCase()}/${share.toLowerCase()}`;
    for (const line of out.split('\n')) {
      const onIdx = line.indexOf(' on ');
      if (onIdx === -1) continue;
      const source = line.slice(0, onIdx);
      const rest = line.slice(onIdx + 4);
      const parenIdx = rest.indexOf(' (');
      const typeIdx = rest.indexOf(' type ');
      const candidates = [parenIdx, typeIdx].filter((idx) => idx !== -1);
      const cutIdx = candidates.length ? Math.min(...candidates) : -1;
      const mountPoint = cutIdx === -1 ? rest : rest.slice(0, cutIdx);
      const normalizedSource = source
        .toLowerCase()
        .replace(/^\/\/[^/]*@/, '//')
        .replace(/^\/\//, '');
      if (normalizedSource === target || normalizedSource.startsWith(`${target}/`)) {
        if (debug) signale.debug(`Reusing existing mount of ${target} at ${mountPoint}`);
        return mountPoint;
      }
    }
  } catch (e) {
    if (debug) signale.debug('Could not inspect existing mounts:', (e as Error).message);
  }
  return undefined;
};

export interface NixShareMountOptions {
  remotePath: string;
  mountPath: string;
  credentials?: Credentials;
  /**
   * macOS only: username to embed in the credential-free probe URL so the OS can
   * match and reuse the saved SMB Internet password from the keychain without
   * prompting. When omitted the probe is fully anonymous.
   */
  probeUsername?: string;
  debug?: boolean;
  osInfo: OsInfo;
}

/**
 * Mount an SMB/CIFS share root once. On macOS it first attempts a
 * credential-free mount so an existing authenticated server session or a saved
 * keychain Internet password is reused without prompting, falling back to an
 * embedded-credential URL only if that fails.
 */
export const mountNixShare = (options: NixShareMountOptions): void => {
  const { remotePath, mountPath, credentials, probeUsername, debug = false, osInfo } = options;
  if (!fs.existsSync(mountPath)) {
    fs.mkdirSync(mountPath, { recursive: true });
  }

  if (osInfo.isMac) {
    // Run mount_smbfs detached from the controlling terminal so it can never
    // block on an interactive /dev/tty password prompt (stdio alone does not
    // cover /dev/tty). A timeout is a further safety net for the credential-free
    // probe: if no reusable session/keychain entry exists we fail fast and fall
    // back to an explicit, non-interactive credentialed mount.
    const baseOpts = { stdio: debug ? 'pipe' : 'ignore', detached: true } as const;
    // Embed the username (no password) in the probe URL so the OS can resolve the
    // saved SMB Internet password for that account from the keychain.
    const probeRemote = probeUsername
      ? remotePath.replace(/^smb:\/\//, `smb://${encodeURIComponent(probeUsername)}@`)
      : remotePath;
    const { url: plainUrl } = buildMacSmbUrl(probeRemote);
    try {
      if (debug)
        signale.debug(`Executing: mount_smbfs "${plainUrl}" "${mountPath}" (reuse session/keychain)`);
      execFileSync('mount_smbfs', [plainUrl, mountPath], { ...baseOpts, timeout: 15000 });
      return;
    } catch (e) {
      if (debug)
        signale.debug(
          `Credential-free mount failed, retrying with credentials: ${(e as Error).message}`,
        );
    }
    const { url, logUrl } = buildMacSmbUrl(remotePath, credentials);
    if (debug) signale.debug(`Executing: mount_smbfs "${logUrl}" "${mountPath}"`);
    execFileSync('mount_smbfs', [url, mountPath], baseOpts);
    return;
  }

  const { url: linuxRemote, opts, logOpts } = buildLinuxCifsMount(remotePath, credentials);
  if (debug)
    signale.debug(`Executing: sudo mount -t cifs -o ${logOpts} "${linuxRemote}" "${mountPath}"`);
  execFileSync('sudo', ['mount', '-t', 'cifs', '-o', opts, linuxRemote, mountPath], {
    stdio: debug ? 'pipe' : 'ignore',
  });
};

export interface SubfolderAliasOptions {
  folderMapping: FolderMapping;
  baseDir: string;
  baseMountPath: string;
  truncateLength: number;
  debug?: boolean;
}

/**
 * Create a symlink alias in baseDir pointing at a subfolder of the single
 * mounted share. Skips (without error) when the subfolder is not accessible, and
 * never clobbers a real (non-symlink) file/directory already at the alias path.
 */
export const aliasSubfolder = (options: SubfolderAliasOptions): boolean => {
  const { folderMapping, baseDir, baseMountPath, truncateLength, debug = false } = options;
  const folderName = getFolderName(folderMapping, truncateLength);
  const localPath = path.join(baseDir, folderName);
  const subfolderPath = path.join(baseMountPath, folderMapping.id);

  signale.info(`Mapping ${subfolderPath} to ${localPath}`);

  try {
    fs.accessSync(subfolderPath, fs.constants.R_OK);
  } catch {
    signale.warn(`Subfolder not accessible: ${subfolderPath}. Skipping.`);
    return false;
  }

  try {
    if (fs.existsSync(localPath)) {
      const stat = fs.lstatSync(localPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(localPath);
      } else {
        signale.warn(`Skipping alias for ${localPath}: a non-symlink already exists.`);
        return false;
      }
    }
    fs.symlinkSync(subfolderPath, localPath);
    if (debug) signale.debug(`Aliased ${subfolderPath} -> ${localPath}`);
    return true;
  } catch (error: unknown) {
    process.exitCode = 1;
    signale.error(`Error: Failed to alias ${subfolderPath} to ${localPath}`);
    signale.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
    return false;
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

    if (!osInfo.isWindows) {
      try {
        fs.accessSync(localPath, fs.constants.R_OK);
      } catch {
        signale.warn(`Folder mapped but not accessible: ${localPath}. Removing mapping.`);
        removeMapping(localPath, debug, osInfo);
        return;
      }
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
    let mounts: string[];
    try {
      mounts = fs.readdirSync(mountsDir);
    } catch {
      // EPERM can occur when stuck mount points prevent the directory from being
      // enumerated. Fall back to parsing `mount` output to find what is mounted
      // under mountsDir, so we can still attempt to unmount each one.
      if (osInfo.isMac) {
        try {
          const mountOutput = execSync('mount', { encoding: 'utf8' });
          mounts = mountOutput
            .split('\n')
            .filter(line => line.includes(mountsDir))
            .map(line => {
              const match = line.match(/ on (.+?) \(/);
              return match ? path.basename(match[1]) : null;
            })
            .filter((m): m is string => m !== null);
        } catch {
          mounts = [];
        }
      } else {
        mounts = [];
      }
    }
    for (const mountFolder of mounts) {
      const mountPath = path.join(mountsDir, mountFolder);
      signale.info(`Unmounting ${mountPath}`);
      try {
        if (osInfo.isMac) {
          execFileSync('umount', [mountPath], { stdio: debug ? 'pipe' : 'ignore' });
        } else {
          execFileSync('sudo', ['umount', mountPath], { stdio: debug ? 'pipe' : 'ignore' });
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

export const removeMapping = (localPath: string, debug: boolean, osInfo: OsInfo) => {
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
          execFileSync('umount', [localPath], { stdio: debug ? 'pipe' : 'ignore' });
        } else {
          execFileSync('sudo', ['umount', localPath], { stdio: debug ? 'pipe' : 'ignore' });
        }
        fs.rmdirSync(localPath);
      }
    }
  } catch (error: unknown) {
    handleUnmountError(error, localPath, debug);
  }
};

export const resetBaseDirMappings = (baseDir: string, debug: boolean, ignoreList: string[], osInfo: OsInfo) => {
  let folders: string[];
  try {
    folders = fs.readdirSync(baseDir);
  } catch {
    // EPERM can occur when active mount points prevent the directory from being
    // enumerated. Fall back to parsing `mount` output to find what is mounted
    // directly under baseDir.
    if (osInfo.isMac) {
      try {
        const mountOutput = execSync('mount', { encoding: 'utf8' });
        folders = mountOutput
          .split('\n')
          .filter(line => {
            const match = line.match(/ on (.+?) \(/);
            if (!match) return false;
            const mountPoint = match[1];
            return path.dirname(mountPoint) === baseDir;
          })
          .map(line => {
            const match = line.match(/ on (.+?) \(/);
            return match ? path.basename(match[1]) : null;
          })
          .filter((f): f is string => f !== null);
      } catch {
        folders = [];
      }
    } else {
      folders = [];
    }
  }
  for (const folder of folders) {
    if (ignoreList.includes(folder)) continue;
    const localPath = path.join(baseDir, folder);
    signale.info(`Removing mapping for ${localPath}`);
    removeMapping(localPath, debug, osInfo);
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
