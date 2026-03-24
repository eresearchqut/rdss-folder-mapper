import fs from 'fs';
import os from 'os';
import * as child_process from 'child_process';
import {
  isMounted,
  isExistingFolder,
  getFolderName,
  getIgnoredItems,
  sanitizeErrorMessage,
} from './mount';
import { getOs } from './os';

jest.mock('child_process');

describe('mount.ts unit tests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isMounted', () => {
    it('should return true if lstatSync indicates a symbolic link on Windows', () => {
      jest.spyOn(os, 'platform').mockReturnValue('win32');
      jest.spyOn(fs, 'lstatSync').mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
      expect(isMounted('C:\\local', '\\\\remote', getOs())).toBe(true);
    });

    it('should return false if lstatSync indicates not a symbolic link on Windows', () => {
      jest.spyOn(os, 'platform').mockReturnValue('win32');
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
});
