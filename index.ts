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
const BASE_DIR = path.join(os.homedir(), 'RDSS');

interface DriveMapping {
  RPID: string;
  title?: string;
  nickname?: string;
}

function isPathMounted(checkPath: string): boolean {
  try {
    if (isWindows) {
      const stat = fs.lstatSync(checkPath);
      return stat.isSymbolicLink();
    } else {
      const mountOutput = execSync('mount', { encoding: 'utf8' });
      const lines = mountOutput.split('\n');
      return lines.some(line => line.includes(` on ${checkPath} `) || line.includes(` on ${checkPath} (`));
    }
  } catch {
    return false;
  }
}

async function refresh(debug: boolean = false, baseDir: string = BASE_DIR, username?: string, password?: string, foldersFile: string = 'folders.json', cliBasePath?: string): Promise<void> {
  console.log('Refreshing drive mappings...');
  try {
    let folders: DriveMapping[] = [];
    let configBasePath: string | undefined;
    try {
      const fileData = fs.readFileSync(foldersFile, 'utf8');
      const parsedData = JSON.parse(fileData);
      folders = parsedData.folders || [];
      configBasePath = parsedData.basePath;
    } catch {
      throw new Error(`Failed to read or parse ${foldersFile}. Please ensure the file exists and is valid JSON.`);
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

    const finalBasePath = cliBasePath || configBasePath;

    for (const drive of folders) {
      const remote = finalBasePath
        ? `${finalBasePath}${isWindows ? '\\' : '/'}${drive.RPID}`
        : isWindows
        ? `${BASE_PATH_WIN}\\${drive.RPID}`
        : `${BASE_PATH_NIX}/${drive.RPID}`;

      const folderName = drive.nickname || drive.RPID;
      const localPath = path.join(baseDir, folderName);
      const mountPath = isWindows ? localPath : path.join(MOUNTS_DIR, drive.RPID);

      let isMounted = isPathMounted(isWindows ? localPath : mountPath);

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
          if (isPathMounted(mountPath)) {
            if (isMac) {
              execSync(`umount "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
            } else {
              execSync(`sudo umount "${mountPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
            }
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
      
      try {
        const stat = fs.lstatSync(localPath);
        if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
      } catch {
        continue;
      }

      console.log(`Removing mapping for ${localPath}`);
      try {
        if (isWindows) {
          execSync(`rmdir "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
        } else {
          const stat = fs.lstatSync(localPath);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(localPath);
          } else {
            if (isPathMounted(localPath)) {
              if (isMac) {
                execSync(`umount "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
              } else {
                execSync(`sudo umount "${localPath}"`, { stdio: debug ? 'pipe' : 'ignore' });
              }
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
  .name('rdss-rpid-mapper')
  .description(
    'A cross-platform command-line interface (CLI) tool that allows you to create local folder mappings to shared network drives effortlessly.',
  )
  .option('--reset', 'Remove all currently mapped folders')
  .option('--debug', 'Enable debug logging')
  .option('--base-dir <path>', 'Custom base folder location (default: ~/RDSS)')
  .option('--username <username>', 'Username for mapping')
  .option('--password <password>', 'Password for mapping')
  .option('--folders-file <path>', 'Custom folders JSON file location (default: folders.json)')
  .option('--base-path <path>', 'Custom remote base path')
  .action((options) => {
    if (options.reset) {
      reset(options.debug, options.baseDir);
    } else {
      refresh(options.debug, options.baseDir, options.username, options.password, options.foldersFile, options.basePath);
    }
  });

program.parse(process.argv);
