import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import { BASE_DIR } from './index';

describe('index.ts constants', () => {
  describe('BASE_DIR', () => {
    it('should mount inside the Desktop directory', () => {
      expect(BASE_DIR).toContain(path.join(os.homedir(), 'Desktop'));
    });

    it('should use "RDSS Folders" as the default folder name', () => {
      expect(BASE_DIR).toBe(path.join(os.homedir(), 'Desktop', 'RDSS Folders'));
    });

    it('should not point to the home directory root', () => {
      expect(BASE_DIR).not.toBe(path.join(os.homedir(), 'RDSS'));
      expect(BASE_DIR).not.toBe(os.homedir());
    });
  });
});
