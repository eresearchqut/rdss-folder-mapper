#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Command } from 'commander';

const isWindows = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';

const BASE_PATH_WIN = process.env.BASE_PATH_WIN || '\\\\rstore.qut.edu.au\\Projects';
const BASE_PATH_NIX = process.env.BASE_PATH_NIX || 'smb://rstore.qut.edu.au/projects';

// The local parent directory for mappings
const RDSS_DIR = path.join(os.homedir(), 'RDSS');

interface DriveMapping {
  RPID: string;
  title?: string;
  nickname?: string;
}

async function refresh(debug: boolean = false, rdssDir: string = RDSS_DIR, username?: string, password?: string): Promise<void> {
  console.log('Refreshing drive mappings...');
  try {
    let folders: DriveMapping[] = [];
    try {
      const fileData = fs.readFileSync('folders.json', 'utf8');
      const parsedData = JSON.parse(fileData);
      folders = parsedData.folders || [];
    } catch {
      throw new Error('Failed to read or parse folders.json. Please ensure the file exists and is valid JSON.');
    }

    const MOUNTS_DIR = path.join(rdssDir, '.mounts');

    if (!fs.existsSync(rdssDir)) {
      fs.mkdirSync(rdssDir, { recursive: true });
    } else {
      const existingItems = fs.readdirSync(rdssDir).filter(item => item !== '.mounts');
      if (existingItems.length > 0) {
        reset(debug, rdssDir);
      }
    }

    if (!isWindows && !fs.existsSync(MOUNTS_DIR)) {
      fs.mkdirSync(MOUNTS_DIR, { recursive: true });
    }

    for (const drive of folders) {
      const remote = isWindows
        ? `${BASE_PATH_WIN}\\${drive.RPID}`
        : `${BASE_PATH_NIX}/${drive.RPID}`;

      const folderName = drive.nickname || drive.RPID;
      const localPath = path.join(rdssDir, folderName);
      const mountPath = isWindows ? localPath : path.join(MOUNTS_DIR, drive.RPID);

      let isMounted = false;
      try {
        if (isWindows) {
          const stat = fs.lstatSync(localPath);
          isMounted = stat.isSymbolicLink();
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

      if (!fs.existsSync(mountPath)) {
        fs.mkdirSync(mountPath, { recursive: true });
      }

      console.log(`Mapping ${remote} to ${localPath}`);

      try {
        if (isWindows) {
          if (username && password) {
            execSync(`net use "${remote}" "${password}" /user:"${username}"`, { stdio: debug ? 'pipe' : 'ignore' });
          }
          execSync(`mklink /D "${localPath}" "${remote}"`, { stdio: debug ? 'pipe' : 'ignore' });
        } else if (isMac) {
          let macRemote = remote;
          if (username && password && macRemote.startsWith('smb://')) {
            macRemote = macRemote.replace('smb://', `smb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@`);
          }
          execSync(`mount_smbfs "${macRemote}" "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          if (!fs.existsSync(localPath)) {
            fs.symlinkSync(mountPath, localPath);
          }
        } else {
          const mountOpts = (username && password) ? `username=${username},password=${password}` : `guest`;
          execSync(`sudo mount -t cifs -o ${mountOpts} "${remote}" "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
          if (!fs.existsSync(localPath)) {
            fs.symlinkSync(mountPath, localPath);
          }
        }
      } catch (error: unknown) {
        console.error(`Warning: Failed to map ${remote} to ${localPath}`);
        if (debug) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`Debug Error: ${msg}`);
          if (error && typeof error === 'object' && 'stderr' in error && (error as { stderr?: unknown }).stderr) {
            console.error(String((error as { stderr: unknown }).stderr));
          }
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
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error during refresh:', msg);
  }
}

function reset(debug: boolean = false, rdssDir: string = RDSS_DIR): void {
  console.log('Resetting drive mappings...');
  if (fs.existsSync(rdssDir)) {
    const MOUNTS_DIR = path.join(rdssDir, '.mounts');

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
          console.error(`Warning: Failed to unmount ${mountPath}`);
          if (debug) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`Debug Error: ${msg}`);
            if (error && typeof error === 'object' && 'stderr' in error && (error as { stderr?: unknown }).stderr) {
              console.error(String((error as { stderr: unknown }).stderr));
            }
          }
        }
      }
      try {
        fs.rmdirSync(MOUNTS_DIR);
      } catch {
        // Ignore
      }
    }

    const folders = fs.readdirSync(rdssDir);
    for (const folder of folders) {
      if (folder === '.mounts') continue;
      const localPath = path.join(rdssDir, folder);
      console.log(`Removing mapping for ${localPath}`);
      try {
        if (isWindows) {
          execSync(`rmdir "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
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
        console.error(`Warning: Failed to remove mapping at ${localPath}`);
        if (debug) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`Debug Error: ${msg}`);
          if (error && typeof error === 'object' && 'stderr' in error && (error as { stderr?: unknown }).stderr) {
            console.error(String((error as { stderr: unknown }).stderr));
          }
        }
      }
    }
  }
  console.log('Reset complete.');
}

const program = new Command();

program
  .name('rdss-rpid-mapper')
  .description(
    'A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network drives effortlessly.',
  )
  .option('--reset', 'Remove all currently mapped folders')
  .option('--debug', 'Enable debug logging')
  .option('--rdss-dir <path>', 'Custom RDSS folder location')
  .option('--username <username>', 'Username for mapping')
  .option('--password <password>', 'Password for mapping')
  .action((options) => {
    if (options.reset) {
      reset(options.debug, options.rdssDir);
    } else {
      refresh(options.debug, options.rdssDir, options.username, options.password);
    }
  });

program.parse(process.argv);
