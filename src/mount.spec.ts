import fs from 'fs';
import os from 'os';
import * as child_process from 'child_process';
import {
  isMounted,
  isExistingFolder,
  getFolderName,
  getIgnoredItems,
  sanitizeErrorMessage,
  setupBaseDirectory,
  processFolderMapping,
  removeMapping,
} from './mount';
import signale from 'signale';
import { getOs } from './os';

jest.mock('child_process');

describe('mount.ts unit tests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isMounted', () => {
    it('should return true if lstatSync indicates a symbolic link on Windows', () => {
      jest.spyOn(os, 'platform').mockReturnValue('win32');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
      expect(isMounted('C:\\local', '\\\\remote', getOs())).toBe(true);
    });

    it('should return false if lstatSync indicates not a symbolic link on Windows', () => {
      jest.spyOn(os, 'platform').mockReturnValue('win32');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => false } as fs.Stats);
      expect(isMounted('C:\\local', '\\\\remote', getOs())).toBe(false);
    });

    it('should parse mount output on non-Windows', () => {
      jest.spyOn(os, 'platform').mockReturnValue('darwin');
      (child_process.execSync as jest.Mock).mockReturnValue('/dev/disk1s1 on /System/Volumes/Data (apfs, local, journaled)');
      expect(isMounted('/local', '/System/Volumes/Data', getOs())).toBe(true);
      expect(isMounted('/local', '/NonExistent', getOs())).toBe(false);
    });
  });

  describe('isExistingFolder', () => {
    it('should return true if path is directory and not symlink', () => {
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      } as fs.Stats);
      expect(isExistingFolder('/test')).toBe(true);
    });

    it('should return false if path is symlink', () => {
      jest.spyOn(fs, 'lstatSync').mockReturnValue({
        isSymbolicLink: () => true,
        isDirectory: () => true,
      } as fs.Stats);
      expect(isExistingFolder('/test')).toBe(false);
    });
  });

  describe('getFolderName', () => {
    it('should return nickname if provided', () => {
      expect(getFolderName({ id: '1', nickname: 'MyDrive', title: 'SomeTitle' } as any, 40)).toBe('MyDrive [1]');
    });

    it('should format title if nickname is omitted', () => {
      expect(getFolderName({ id: '2', title: 'my cool project' } as any, 40)).toBe('My Cool Project [2]');
    });

    it('should fallback to id if title and nickname are omitted', () => {
      expect(getFolderName({ id: '3' } as any, 40)).toBe('3 [3]');
    });
  });

  describe('getIgnoredItems', () => {
    it('should contain default ignores', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const ignores = getIgnoredItems();
      expect(ignores).toContain('.DS_Store');
      expect(ignores).toContain('desktop.ini');
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('should obscure password in string', () => {
      const error = new Error('Failed to connect with password MySecret123');
      expect(sanitizeErrorMessage(error, 'MySecret123')).toBe('Failed to connect with password ***');
    });
  });
  describe('setupBaseDirectory', () => {
    it('should create desktop shortcut on Windows if not exists', () => {
      jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\testuser');
      jest.spyOn(fs, 'existsSync').mockImplementation((pathStr) => {
        if (typeof pathStr === 'string' && pathStr.endsWith('RDSS.lnk')) return false;
        return true;
      });
      jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
      
      setupBaseDirectory('C:\\Users\\testuser\\RDSS', false, { ...getOs(), isWindows: true });
      expect(child_process.execSync).toHaveBeenCalledWith(
        expect.stringContaining('CreateShortcut'),
        expect.anything()
      );
    });
  });
  describe('processFolderMapping', () => {
    it('should remove mount and warn if folder is inaccessible after mounting', () => {
      jest.spyOn(os, 'platform').mockReturnValue('win32');
      const osInfo = { ...getOs(), isWindows: true, isMac: false, isLinux: false };
      
      jest.spyOn(fs, 'existsSync').mockImplementation((pathStr) => false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation();
      const mockAccessSync = jest.spyOn(fs, 'accessSync').mockImplementation(() => {
        throw new Error('EACCES');
      });
      const rmSyncSpy = jest.spyOn(fs, 'rmSync').mockImplementation();
      const warnSpy = jest.spyOn(signale, 'warn').mockImplementation();

      processFolderMapping({
        folderMapping: { id: '123', title: 'Test Project' } as any,
        baseDir: 'C:\\Users\\testuser\\RDSS',
        mountsDir: 'C:\\Users\\testuser\\RDSS\\.mounts',
        remotePath: '\\\\remote\\path',
        truncateLength: 40,
        osInfo,
        debug: false,
      });

      expect(mockAccessSync).toHaveBeenCalledWith(expect.stringContaining('Test Project'), fs.constants.R_OK);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Folder mapped but not accessible'));
      expect(rmSyncSpy).toHaveBeenCalled();
    });
  });
});
