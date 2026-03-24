import { getOs, OS } from './os';
import os from 'os';

describe('os.ts', () => {
  let platformSpy: jest.SpyInstance;

  beforeEach(() => {
    platformSpy = jest.spyOn(os, 'platform');
  });

  afterEach(() => {
    platformSpy.mockRestore();
  });

  it('should identify windows correctly', () => {
    platformSpy.mockReturnValue('win32');
    const osInfo = getOs();
    expect(osInfo.isWindows).toBe(true);
    expect(osInfo.isMac).toBe(false);
    expect(osInfo.isLinux).toBe(false);
    expect(osInfo.osType).toBe(OS.WINDOWS);
  });

  it('should identify mac correctly', () => {
    platformSpy.mockReturnValue('darwin');
    const osInfo = getOs();
    expect(osInfo.isWindows).toBe(false);
    expect(osInfo.isMac).toBe(true);
    expect(osInfo.isLinux).toBe(false);
    expect(osInfo.osType).toBe(OS.MAC);
  });

  it('should identify linux correctly', () => {
    platformSpy.mockReturnValue('linux');
    const osInfo = getOs();
    expect(osInfo.isWindows).toBe(false);
    expect(osInfo.isMac).toBe(false);
    expect(osInfo.isLinux).toBe(true);
    expect(osInfo.osType).toBe(OS.LINUX);
  });
});
