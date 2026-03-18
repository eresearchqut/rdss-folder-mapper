#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Command } from 'commander';
import { startCase } from 'lodash';
import truncate from '@stdlib/string-truncate';
import { password as promptPassword, input as promptInput } from '@inquirer/prompts';

const isWindows = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';

const REMOTE_PATH_WIN = process.env.REMOTE_PATH_WIN || '\\\\rstore.qut.edu.au\\Projects';
const REMOTE_PATH_NIX = process.env.REMOTE_PATH_NIX || 'smb://rstore.qut.edu.au/projects';

const INVALID_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1F]/g;

// The local parent directory for mappings
const BASE_DIR = path.join(os.homedir(), 'RDSS');

interface DriveMapping {
  id: string;
  title?: string;
  nickname?: string;
}

function getCredentialsFromKeychain(debug: boolean): { username?: string; password?: string } {
  if (isMac) {
    try {
      if (debug) console.log('Attempting to read credentials from macOS keychain...');
      // Note: `security` writes the password to stderr, and attributes to stdout. We catch both by not redirecting stderr to ignore.
      const stdout = execSync('security find-generic-password -s "rdss-folder-mapper"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const stderr = execSync('security find-generic-password -s "rdss-folder-mapper" -w', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const accountMatch = stdout.match(/"acct"<blob>="([^"]+)"/);
      const password = stderr.trim();
      if (accountMatch && password) {
        if (debug) console.log('Credentials successfully retrieved from macOS keychain.');
        return { username: accountMatch[1], password };
      }
    } catch (e) {
      if (debug) console.log('Failed to read from macOS keychain:', (e as Error).message);
    }
  } else if (!isWindows) {
    try {
      if (debug) console.log('Attempting to read credentials from Linux secret-tool...');
      const searchOutput = execSync('secret-tool search --all service rdss-folder-mapper', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const accountMatch = searchOutput.match(/username = (.+)/);
      const password = execSync('secret-tool lookup service rdss-folder-mapper', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (accountMatch && password) {
        if (debug) console.log('Credentials successfully retrieved from Linux secret-tool.');
        return { username: accountMatch[1].trim(), password };
      }
    } catch (e) {
      if (debug) console.log('Failed to read from Linux secret-tool:', (e as Error).message);
    }
  }
  return {};
}

function saveCredentialsToKeychain(username: string, pass: string, debug: boolean): void {
  if (isMac) {
    try {
      if (debug) console.log('Saving credentials to macOS keychain...');
      execSync(`security add-generic-password -s "rdss-folder-mapper" -a "${username}" -w "${pass}" -U`, { stdio: debug ? 'pipe' : 'ignore' });
    } catch (e) {
      if (debug) console.log('Failed to save to macOS keychain:', (e as Error).message);
    }
  } else if (!isWindows) {
    try {
      if (debug) console.log('Saving credentials to Linux secret-tool...');
      execSync(`printf "%s" "${pass}" | secret-tool store --label="RDSS Folder Mapper" service rdss-folder-mapper username "${username}"`, { stdio: debug ? 'pipe' : 'ignore' });
    } catch (e) {
      if (debug) console.log('Failed to save to Linux secret-tool:', (e as Error).message);
    }
  }
}

async function refresh(debug: boolean = false, baseDir: string = BASE_DIR, username?: string, password?: string, foldersFile: string = 'folders.json', cliRemotePath?: string, truncateLength: number = 40, domain: string = 'qutad'): Promise<void> {
  console.log('Refreshing drive mappings...');
  try {
    let folders: DriveMapping[] = [];
    let configRemotePath: string | undefined;
    try {
      const fileData = fs.readFileSync(foldersFile, 'utf8');
      const parsedData = JSON.parse(fileData);
      folders = parsedData.folders || [];
      configRemotePath = parsedData.remotePath;
    } catch {
      throw new Error(`Failed to read or parse ${foldersFile}. Please ensure the file exists and is valid JSON.`);
    }

    let promptedForPassword = false;
    if (!username || !password) {
      const keychainCreds = getCredentialsFromKeychain(debug);
      username = username || keychainCreds.username;
      password = password || keychainCreds.password;
    }

    if (!username) {
      username = await promptInput({ message: 'Enter username:' });
    }
    if (!password) {
      password = await promptPassword({ message: 'Enter password:', mask: '*' });
      promptedForPassword = true;
    }

    const MOUNTS_DIR = path.join(baseDir, '.mounts');

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    } else {
      const existingItems = fs.readdirSync(baseDir).filter(item => item !== '.mounts');
      if (existingItems.length > 0) {
        reset(debug, baseDir);
      }
    }

    if (!isWindows && !fs.existsSync(MOUNTS_DIR)) {
      fs.mkdirSync(MOUNTS_DIR, { recursive: true });
    }

    const finalRemotePath = cliRemotePath || configRemotePath;

    for (const drive of folders) {
      const remote = finalRemotePath
        ? `${finalRemotePath}${isWindows ? '\\' : '/'}${drive.id}`
        : isWindows
        ? `${REMOTE_PATH_WIN}\\${drive.id}`
        : `${REMOTE_PATH_NIX}/${drive.id}`;

      let folderName = drive.nickname ? drive.nickname.replace(INVALID_CHARS_REGEX, '') : undefined;
      if (!folderName) {
        if (drive.title) {
          const cleanTitle = drive.title.replace(INVALID_CHARS_REGEX, '');
          folderName = truncate(startCase(cleanTitle), truncateLength).trim();
        } else {
          folderName = drive.id;
        }
      }
      folderName = `${folderName} [${drive.id}]`;
      const localPath = path.join(baseDir, folderName);
      const mountPath = isWindows ? localPath : path.join(MOUNTS_DIR, drive.id);

      let isMounted = false;
      let existingIsFolder = false;
      try {
        if (isWindows) {
          const stat = fs.lstatSync(localPath);
          isMounted = stat.isSymbolicLink();
          existingIsFolder = !isMounted && stat.isDirectory();
        } else {
          const mountOutput = execSync('mount', { encoding: 'utf8' });
          const lines = mountOutput.split('\n');
          isMounted = lines.some(line => line.includes(` on ${mountPath} `) || line.includes(` on ${mountPath} (`));
        }
      } catch {
        // Does not exist
      }

      if (isMounted) {
        if (debug) {
          console.log(`Debug: Mount already exists at ${mountPath}, skipping.`);
        }
        if (!isWindows && !fs.existsSync(localPath)) {
          fs.symlinkSync(mountPath, localPath);
        }
        continue;
      }

      if (!isWindows && !fs.existsSync(mountPath)) {
        fs.mkdirSync(mountPath, { recursive: true });
      }

      console.log(`Mapping ${remote} to ${localPath}`);

      try {
        if (isWindows) {
          if (existingIsFolder) {
            try { fs.rmdirSync(localPath); } catch {}
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
        } else if (isMac) {
          let macRemote = remote;
          let macRemoteLog = remote;
          if (username && password && macRemote.startsWith('smb://')) {
            const domainPrefix = domain ? `${encodeURIComponent(domain)};` : '';
            macRemote = macRemote.replace('smb://', `smb://${domainPrefix}${encodeURIComponent(username)}:${encodeURIComponent(password)}@`);
            macRemoteLog = macRemoteLog.replace('smb://', `smb://${domainPrefix}${encodeURIComponent(username)}:***@`);
          }
          if (debug) console.log(`Executing: mount_smbfs "${macRemoteLog}" "${mountPath}"`);
          execSync(`mount_smbfs "${macRemote}" "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          if (!fs.existsSync(localPath)) {
            fs.symlinkSync(mountPath, localPath);
          }
        } else {
          let linuxRemote = remote;
          if (linuxRemote.startsWith('smb://')) {
            linuxRemote = linuxRemote.replace('smb://', '//');
          }
          const mountOpts = (username && password) ? `username=${username},password=${password},domain=${domain}` : `guest`;
          const mountOptsLog = (username && password) ? `username=${username},password=***,domain=${domain}` : `guest`;
          if (debug) console.log(`Executing: sudo mount -t cifs -o ${mountOptsLog} "${linuxRemote}" "${mountPath}"`);
          execSync(`sudo mount -t cifs -o ${mountOpts} "${linuxRemote}" "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          if (!fs.existsSync(localPath)) {
            fs.symlinkSync(mountPath, localPath);
          }
        }
        
        if (promptedForPassword && username && password && (!isWindows)) {
          saveCredentialsToKeychain(username, password, debug);
          promptedForPassword = false; // Only save once
        }
      } catch (error: unknown) {
        process.exitCode = 1;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: Failed to map ${remote} to ${localPath}`);
        console.error(`Reason: ${msg}`);
        if (error && typeof error === 'object' && 'stderr' in error && (error as { stderr?: unknown }).stderr) {
          console.error(`Command Output: ${String((error as { stderr: unknown }).stderr)}`);
        }
        if (debug) {
          console.error(`Debug Error: ${msg}`);
        }
        try {
          if (!isWindows && fs.existsSync(localPath) && fs.lstatSync(localPath).isSymbolicLink()) {
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
      }
    }
    console.log('Refresh complete.');
  } catch (error: unknown) {
    process.exitCode = 1;
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error during refresh:', msg);
  }
}

function reset(debug: boolean = false, baseDir: string = BASE_DIR): void {
  console.log('Resetting drive mappings...');
  if (fs.existsSync(baseDir)) {
    const MOUNTS_DIR = path.join(baseDir, '.mounts');

    if (fs.existsSync(MOUNTS_DIR) && !isWindows) {
      const mounts = fs.readdirSync(MOUNTS_DIR);
      for (const mountFolder of mounts) {
        const mountPath = path.join(MOUNTS_DIR, mountFolder);
        console.log(`Unmounting ${mountPath}`);
        try {
          if (isMac) {
            execSync(`umount "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          } else {
            execSync(`sudo umount "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          }
          fs.rmdirSync(mountPath);
        } catch (error: unknown) {
          process.exitCode = 1;
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`Error: Failed to unmount ${mountPath}`);
          console.error(`Reason: ${msg}`);
          if (error && typeof error === 'object' && 'stderr' in error && (error as { stderr?: unknown }).stderr) {
            console.error(`Command Output: ${String((error as { stderr: unknown }).stderr)}`);
          }
          if (debug) {
            console.error(`Debug Error: ${msg}`);
          }
        }
      }
      try {
        fs.rmdirSync(MOUNTS_DIR);
      } catch {
        // Ignore
      }
    }

    const folders = fs.readdirSync(baseDir);
    for (const folder of folders) {
      if (folder === '.mounts') continue;
      const localPath = path.join(baseDir, folder);
      console.log(`Removing mapping for ${localPath}`);
      try {
        if (isWindows) {
          fs.rmSync(localPath, { recursive: true, force: true });
        } else {
          const stat = fs.lstatSync(localPath);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(localPath);
          } else {
            if (isMac) {
              execSync(`umount "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
            } else {
              execSync(`sudo umount "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
            }
            fs.rmdirSync(localPath);
          }
        }
      } catch (error: unknown) {
        process.exitCode = 1;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: Failed to remove mapping at ${localPath}`);
        console.error(`Reason: ${msg}`);
        if (error && typeof error === 'object' && 'stderr' in error && (error as { stderr?: unknown }).stderr) {
          console.error(`Command Output: ${String((error as { stderr: unknown }).stderr)}`);
        }
        if (debug) {
          console.error(`Debug Error: ${msg}`);
        }
      }
    }
  }
  console.log('Reset complete.');
}

const program = new Command();

program
  .name('rdss-folder-mapper')
  .description(
    'A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network drives effortlessly.',
  )
  .option('--reset', 'Remove all currently mapped folders')
  .option('--debug', 'Enable debug logging')
  .option('-b, --base-dir <path>', 'Custom base folder location (default: ~/RDSS)')
  .option('-u --username <username>', 'Username for remote mapping')
  .option('-p, --password <password>', 'Password for remote mapping')
  .option('-f, --folders <path>', 'Custom folders JSON file location (default: folders.json)')
  .option('-r, --remote-path <path>', 'Custom remote path')
  .option('-t, --truncate <number>', 'Truncate length for folder names', (val) => parseInt(val, 10), 40)
  .option('-d, --domain <domain>', 'Domain for remote mapping', 'qutad')
  .action((options) => {
    if (options.reset) {
      reset(options.debug, options.baseDir);
    } else {
      refresh(options.debug, options.baseDir, options.username, options.password, options.folders, options.remotePath, options.truncate, options.domain).then();
    }
  });

program.parse(process.argv);
