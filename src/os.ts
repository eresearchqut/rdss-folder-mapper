import os from 'os';

export enum OS {
  WINDOWS = 'WINDOWS',
  MAC = 'MAC',
  LINUX = 'LINUX',
}

export interface OsInfo {
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  osType: OS;
}

export const getOs = (): OsInfo => {
  const isWindows = os.platform() === 'win32';
  const isMac = os.platform() === 'darwin';
  const isLinux = !isWindows && !isMac;

  return {
    isWindows,
    isMac,
    isLinux,
    osType: isWindows ? OS.WINDOWS : isMac ? OS.MAC : OS.LINUX,
  };
};
