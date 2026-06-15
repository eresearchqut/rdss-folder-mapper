import * as childProcess from 'child_process';
import * as secrets from './secrets';
import { getOs } from './os';
import os from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process');
vi.mock('os');

const macOs = () => {
  vi.mocked(os.platform).mockReturnValue('darwin');
  return { ...getOs(), isMac: true, isWindows: false, isLinux: false };
};
const linuxOs = () => {
  vi.mocked(os.platform).mockReturnValue('linux');
  return { ...getOs(), isMac: false, isWindows: false, isLinux: true };
};
const winOs = () => {
  vi.mocked(os.platform).mockReturnValue('win32');
  return { ...getOs(), isMac: false, isWindows: true, isLinux: false };
};

describe('secrets', () => {
  it('should have defined methods', () => {
    expect(secrets.getCredentialsFromKeychain).toBeDefined();
    expect(secrets.saveCredentialsToKeychain).toBeDefined();
    expect(secrets.clearCredentialsFromKeychain).toBeDefined();
    expect(secrets.saveMacInternetPassword).toBeDefined();
    expect(secrets.getMacInternetPasswordAccount).toBeDefined();
    expect(secrets.clearMacInternetPassword).toBeDefined();
  });
});

describe('getCredentialsFromKeychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads Linux credentials via secret-tool', () => {
    const osInfo = linuxOs();
    vi.mocked(childProcess.execSync)
      .mockReturnValueOnce('username = alice\ndomain = QUT\n')
      .mockReturnValueOnce('secretpw\n');

    const creds = secrets.getCredentialsFromKeychain(false, osInfo);

    expect(creds).toEqual({ username: 'alice', password: 'secretpw', domain: 'QUT' });
  });

  it('returns empty credentials on macOS (native Internet password is used instead)', () => {
    const osInfo = macOs();
    expect(secrets.getCredentialsFromKeychain(false, osInfo)).toEqual({});
    expect(childProcess.execSync).not.toHaveBeenCalled();
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  it('returns empty credentials on Windows (session identity is used instead)', () => {
    const osInfo = winOs();
    expect(secrets.getCredentialsFromKeychain(false, osInfo)).toEqual({});
    expect(childProcess.execSync).not.toHaveBeenCalled();
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });
});

describe('saveCredentialsToKeychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores Linux credentials via secret-tool', () => {
    const osInfo = linuxOs();
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.saveCredentialsToKeychain(
      { username: 'alice', password: 'pw', domain: 'QUT' },
      false,
      osInfo,
    );

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'secret-tool',
      expect.arrayContaining(['store', 'service', 'rdss-folder-mapper', 'username', 'alice']),
      expect.objectContaining({ input: 'pw' }),
    );
  });

  it('does not store anything on macOS or Windows', () => {
    secrets.saveCredentialsToKeychain({ username: 'alice', password: 'pw' }, false, macOs());
    secrets.saveCredentialsToKeychain({ username: 'alice', password: 'pw' }, false, winOs());
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });
});

describe('clearCredentialsFromKeychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));
  });

  it('clears the Linux secret-tool entry', () => {
    const osInfo = linuxOs();

    secrets.clearCredentialsFromKeychain(false, osInfo);

    const calls = vi.mocked(childProcess.execSync).mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('secret-tool clear service rdss-folder-mapper'))).toBe(true);
  });

  it('clears the macOS SMB Internet password when a server is provided', () => {
    const osInfo = macOs();

    secrets.clearCredentialsFromKeychain(false, osInfo, 'rstore.qut.edu.au');

    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    expect(call[0]).toBe('security');
    const args = call[1] as string[];
    expect(args).toContain('delete-internet-password');
    expect(args[args.indexOf('-s') + 1]).toBe('rstore.qut.edu.au');
  });

  it('is a no-op on macOS when no server is provided', () => {
    secrets.clearCredentialsFromKeychain(false, macOs());
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  it('is a no-op on Windows', () => {
    secrets.clearCredentialsFromKeychain(false, winOs());
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });
});

describe('saveMacInternetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves an SMB internet-password entry with the smb protocol code', () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.saveMacInternetPassword('rstore.qut.edu.au', 'user@qut.edu.au', 's3cr3t', false);

    const calls = vi.mocked(childProcess.execFileSync).mock.calls;
    // A stale item is deleted first so the new access ACL applies cleanly.
    const deleteCall = calls.find((c) => (c[1] as string[]).includes('delete-internet-password'));
    expect(deleteCall).toBeDefined();
    const addCall = calls.find((c) => (c[1] as string[]).includes('add-internet-password'));
    expect(addCall).toBeDefined();
    expect(addCall![0]).toBe('security');
    const args = addCall![1] as string[];
    expect(args).toContain('-r');
    expect(args).toContain('smb ');
    expect(args[args.indexOf('-s') + 1]).toBe('rstore.qut.edu.au');
    expect(args[args.indexOf('-a') + 1]).toBe('user@qut.edu.au');
    expect(args[args.indexOf('-w') + 1]).toBe('s3cr3t');
    expect(args).toContain('-U');
    expect(args).toContain('-A');
  });

  it('never throws when the security command fails', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('keychain locked');
    });

    expect(() =>
      secrets.saveMacInternetPassword('rstore.qut.edu.au', 'user', 'pw', false),
    ).not.toThrow();
  });
});

describe('getMacInternetPasswordAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses the account from the Internet password attributes without requesting the password', () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue(
      'keychain: "/Users/me/Library/Keychains/login.keychain-db"\n' +
        '    "acct"<blob>="alice@qut.edu.au"\n' +
        '    "srvr"<blob>="rstore.qut.edu.au"\n',
    );

    const account = secrets.getMacInternetPasswordAccount('rstore.qut.edu.au', false);

    expect(account).toBe('alice@qut.edu.au');
    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    expect(call[0]).toBe('security');
    const args = call[1] as string[];
    expect(args).toContain('find-internet-password');
    expect(args).not.toContain('-w');
    expect(args[args.indexOf('-s') + 1]).toBe('rstore.qut.edu.au');
  });

  it('returns undefined when no Internet password exists', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('The specified item could not be found in the keychain.');
    });

    expect(secrets.getMacInternetPasswordAccount('rstore.qut.edu.au', false)).toBeUndefined();
  });
});

describe('clearMacInternetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the SMB Internet password for the server', () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.clearMacInternetPassword('rstore.qut.edu.au', false);

    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    expect(call[0]).toBe('security');
    const args = call[1] as string[];
    expect(args).toContain('delete-internet-password');
    expect(args).toContain('smb ');
    expect(args[args.indexOf('-s') + 1]).toBe('rstore.qut.edu.au');
  });

  it('never throws when the security command fails', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('keychain locked');
    });

    expect(() => secrets.clearMacInternetPassword('rstore.qut.edu.au', false)).not.toThrow();
  });
});
