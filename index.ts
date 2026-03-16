#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Command } from 'commander';

const isWindows = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';

const BASE_PATH_WIN = '\\\\rstore.qut.edu.au\\Projects';
const BASE_PATH_NIX = 'smb://rstore.qut.edu.au/projects';

// The local parent directory for mappings
const RDSS_DIR = path.join(os.homedir(), 'RDSS');

interface DriveMapping {
  RPID: string;
  title?: string;
  nickname?: string;
}

async function refresh(): Promise<void> {
  console.log('Refreshing drive mappings...');
  try {
    let folders: DriveMapping[] = [];
    try {
      const fileData = fs.readFileSync('folders.json', 'utf8');
      const parsedData = JSON.parse(fileData);
      folders = parsedData.folders || [];
    } catch {
      console.log(`Failed to read from folders.json, using mock data for demonstration.`);
      folders = [
        { RPID: 'PRJ123', title: 'Project Alpha Data', nickname: 'Alpha' },
        { RPID: 'PRJ456', title: 'Project Beta Data' },
      ];
    }

    if (!fs.existsSync(RDSS_DIR)) {
      fs.mkdirSync(RDSS_DIR, { recursive: true });
    }

    for (const drive of folders) {
      const remote = isWindows
        ? `${BASE_PATH_WIN}\\${drive.RPID}`
        : `${BASE_PATH_NIX}/${drive.RPID}`;

      const folderName = drive.nickname || drive.RPID;
      const localPath = path.join(RDSS_DIR, folderName);

      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
      }

      console.log(`Mapping ${remote} to ${localPath}`);

      try {
        if (isWindows) {
          execSync(`mklink /D "${localPath}" "${remote}"`, { stdio: 'ignore' });
        } else if (isMac) {
          execSync(`mount_smbfs "${remote}" "${localPath}"`, { stdio: 'ignore' });
        } else {
          execSync(`sudo mount -t cifs -o guest "${remote}" "${localPath}"`, { stdio: 'ignore' });
        }
      } catch {
        console.error(`Warning: Failed to map ${remote} to ${localPath}`);
      }
    }
    console.log('Refresh complete.');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error during refresh:', msg);
  }
}

function reset(): void {
  console.log('Resetting drive mappings...');
  if (fs.existsSync(RDSS_DIR)) {
    const folders = fs.readdirSync(RDSS_DIR);
    for (const folder of folders) {
      const localPath = path.join(RDSS_DIR, folder);
      console.log(`Removing mapping for ${localPath}`);
      try {
        if (isWindows) {
          execSync(`rmdir "${localPath}"`, { stdio: 'ignore' });
        } else if (isMac) {
          execSync(`umount "${localPath}"`, { stdio: 'ignore' });
          fs.rmdirSync(localPath);
        } else {
          execSync(`sudo umount "${localPath}"`, { stdio: 'ignore' });
          fs.rmdirSync(localPath);
        }
      } catch {
        console.error(`Warning: Failed to remove mapping at ${localPath}`);
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
  .action((options) => {
    if (options.reset) {
      reset();
    } else {
      refresh();
    }
  });

program.parse(process.argv);
