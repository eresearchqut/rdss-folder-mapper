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
  mountMac,
  mountLinux,
  buildMacSmbUrl,
  buildLinuxCifsMount,
  findExistingSmbMount,
  mountNixShare,
  aliasSubfolder,
  resetMountsDir,
  isWindowsShareAccessible,
} from './mount';
import signale from 'signale';
import { getOs } from './os';
import { beforeEach, afterEach, describe, expect, it, test, vi, type Mock } from 'vitest';

vi.mock('fs');
vi.mock('os');
vi.mock('child_process');

describe('mount.ts unit tests', () => {
  beforeEach(() => {
    // Restore constants since vi.mock auto-mock replaces them
    vi.mocked(fs as any).constants = require('fs').constants;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isMounted', () => {
    it('should return true if lstatSync indicates a symbolic link on Windows', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
      expect(isMounted('C:\\local', '\\\\remote', getOs())).toBe(true);
    });

    it('should return false if lstatSync indicates not a symbolic link on Windows', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false } as fs.Stats);
      expect(isMounted('C:\\local', '\\\\remote', getOs())).toBe(false);
    });

    it('should parse mount output on non-Windows', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      (child_process.execSync as Mock).mockReturnValue('/dev/disk1s1 on /System/Volumes/Data (apfs, local, journaled)');
      expect(isMounted('/local', '/System/Volumes/Data', getOs())).toBe(true);
      expect(isMounted('/local', '/NonExistent', getOs())).toBe(false);
    });
  });

  describe('isWindowsShareAccessible', () => {
    it('returns true when Test-Path reports the share is reachable', () => {
      (child_process.execFileSync as Mock).mockReturnValue('YES\n');
      expect(isWindowsShareAccessible('\\\\server\\share')).toBe(true);
      const call = (child_process.execFileSync as Mock).mock.calls[0];
      expect(String(call[1].join(' '))).toContain('Test-Path');
    });

    it('returns false when Test-Path reports the share is not reachable', () => {
      (child_process.execFileSync as Mock).mockReturnValue('NO\n');
      expect(isWindowsShareAccessible('\\\\server\\share')).toBe(false);
    });

    it('returns false when the PowerShell invocation throws', () => {
      (child_process.execFileSync as Mock).mockImplementation(() => {
        throw new Error('access denied');
      });
      expect(isWindowsShareAccessible('\\\\server\\share')).toBe(false);
    });

    it('escapes single quotes in the remote path', () => {
      (child_process.execFileSync as Mock).mockReturnValue('YES\n');
      isWindowsShareAccessible("\\\\server\\o'brien");
      const script = (child_process.execFileSync as Mock).mock.calls[0][1].join(' ');
      expect(script).toContain("o''brien");
    });
  });

  describe('isExistingFolder', () => {
    it('should return true if path is directory and not symlink', () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      } as fs.Stats);
      expect(isExistingFolder('/test')).toBe(true);
    });

    it('should return false if path is symlink', () => {
      vi.mocked(fs.lstatSync).mockReturnValue({
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
      vi.mocked(fs.existsSync).mockReturnValue(false);
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
    it('should create mountsDir on non-Windows if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);

      setupBaseDirectory('/home/testuser/Desktop/RDSS Folders', false, { ...getOs(), isWindows: false, isMac: true, isLinux: false });
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.mounts'),
        expect.objectContaining({ recursive: true }),
      );
      expect(child_process.execSync).not.toHaveBeenCalledWith(
        expect.stringContaining('CreateShortcut'),
        expect.anything(),
      );
    });

    it('should not throw when readdirSync throws EPERM (active mounts blocking enumeration)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        const err = Object.assign(new Error('EPERM'), { code: 'EPERM' });
        throw err;
      });
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);

      expect(() =>
        setupBaseDirectory('/home/testuser/Desktop/RDSS Folders', false, { ...getOs(), isWindows: false, isMac: true, isLinux: false })
      ).not.toThrow();
    });
  });

  describe('processFolderMapping', () => {
    it('should remove mount and warn if folder is inaccessible after mounting', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      const osInfo = { ...getOs(), isWindows: false, isMac: true, isLinux: false };

      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);
      vi.mocked(fs.accessSync).mockImplementation(() => {
        throw new Error('EACCES');
      });
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined as any);
      const warnSpy = vi.spyOn(signale, 'warn').mockImplementation(() => {});

      processFolderMapping({
        folderMapping: { id: '123', title: 'Test Project' } as any,
        baseDir: 'C:\\Users\\testuser\\RDSS',
        mountsDir: 'C:\\Users\\testuser\\RDSS\\.mounts',
        remotePath: '\\\\remote\\path',
        truncateLength: 40,
        osInfo,
        debug: false,
      });

      expect(fs.accessSync).toHaveBeenCalledWith(expect.stringContaining('Test Project'), fs.constants.R_OK);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Folder mapped but not accessible'));
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('mountMac – C2 shell injection regression', () => {
    it('calls execFileSync with an argument array instead of a shell string', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      mountMac({
      remotePath: 'smb://storage.example.com/projects',
      localPath: '/home/user/Desktop/RDSS Folders/My Project [abc]',
      mountPath: '/home/user/Desktop/RDSS Folders/.mounts/abc',
      baseDir: '/home/user/Desktop/RDSS Folders',
      os: 'darwin' as any,
      debug: false,
      });

      expect(child_process.execFileSync).toHaveBeenCalledWith(
      'mount_smbfs',
      expect.arrayContaining(['smb://storage.example.com/projects', '/home/user/Desktop/RDSS Folders/.mounts/abc']),
      expect.any(Object),
      );
      expect(child_process.execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('mount_smbfs'),
      expect.anything(),
      );
    });

    it('a mountPath with shell metacharacters is passed as a literal argument (no injection)', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);
      const maliciousId = '"; rm -rf /; echo "';
      const mountPath = `/mounts/${maliciousId}`;

      mountMac({
      remotePath: 'smb://host/share',
      localPath: '/base/link',
      mountPath,
      baseDir: '/base',
      os: 'darwin' as any,
      debug: false,
      });

      const call = vi.mocked(child_process.execFileSync).mock.calls[0];
      const args = call[1] as string[];
      expect(args).toContain(mountPath);
    });
  });

  describe('mountMac – special characters in password', () => {
    // Extracts the [domain;]user:password segment from the smb:// URL that
    // mountMac passes to mount_smbfs. user and password are percent-encoded,
    // so they contain no raw ';', ':' or '@' to confuse this parser.
    const parseSmbUrl = (url: string) => {
      const match = url.match(/^smb:\/\/(?:([^;]*);)?([^:]*):([^@]*)@(.*)$/);
      if (!match) throw new Error(`Unexpected smb URL: ${url}`);
      return { domain: match[1], user: match[2], password: match[3], hostAndShare: match[4] };
    };

    const callMountMac = (password: string, username = 'testuser', adDomain?: string) => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      mountMac({
        remotePath: 'smb://storage.example.com/projects',
        localPath: '/home/user/Desktop/RDSS Folders/My Project [abc]',
        mountPath: '/home/user/Desktop/RDSS Folders/.mounts/abc',
        baseDir: '/home/user/Desktop/RDSS Folders',
        os: 'darwin' as any,
        debug: false,
        credentials: { username, password, adDomain },
      });

      const args = vi.mocked(child_process.execFileSync).mock.calls[0][1] as string[];
      return parseSmbUrl(args[0]);
    };

    // Characters that would corrupt the smb:// authority if left unencoded.
    // '%' is excluded because it is the percent-encoding escape character and is
    // expected to appear in the encoded output; its round-trip is covered above.
    const urlBreaking = ['@', ':', '/', '?', '#', '&', ';', ' '];

    test.each([
      ['shell/url metacharacters', '!@#$%^&*()-'],
      ['symbols and quotes', `=+[]{}|\\:";'<>,.?/`],
      ['contains an @ like an email', 'p@ssw0rd@QUT'],
      ['contains a colon and slash', 'a:b/c:d'],
      ['contains an ampersand and hash', 'foo&bar#baz'],
      ['contains a percent sign', '50%off%20'],
      ['contains spaces', 'correct horse battery staple'],
      ['contains a semicolon', 'pa;ss;word'],
      ['is only exclamation marks', '!!!!!'],
      ['mixes exclamation marks with other characters', 'p@ss!w0rd!#$'],
    ])('round-trips a password that %s', (_label, password) => {
      const { password: encoded } = callMountMac(password);
      // The decoded password placed in the URL must equal the original, or SMB
      // authentication will be attempted with the wrong secret.
      expect(decodeURIComponent(encoded)).toBe(password);
    });

    it('leaves exclamation marks literal but still round-trips them', () => {
      // encodeURIComponent does not escape '!', which is a valid sub-delimiter in
      // a URL userinfo component, so it is passed through verbatim to mount_smbfs.
      const password = 'Tr0ub4dor!&3';
      const { password: encoded } = callMountMac(password);
      expect(encoded).toContain('!');
      expect(decodeURIComponent(encoded)).toBe(password);
    });

    it('percent-encodes URL-breaking characters in the password', () => {
      const password = urlBreaking.join('');
      const { password: encoded } = callMountMac(password);
      for (const ch of urlBreaking) {
        expect(encoded).not.toContain(ch);
      }
      expect(decodeURIComponent(encoded)).toBe(password);
    });

    it('round-trips username, password and domain together (mirrors a UPN login)', () => {
      const { domain, user, password } = callMountMac('S3cr3t!@#$', 'totagian@qut.edu.au', 'qutad');
      expect(decodeURIComponent(user)).toBe('totagian@qut.edu.au');
      expect(decodeURIComponent(password)).toBe('S3cr3t!@#$');
      expect(decodeURIComponent(domain)).toBe('qutad');
      // The '@' in the username must be encoded so it is not mistaken for the
      // userinfo/host separator.
      expect(user).not.toContain('@');
    });

    it('does not leak the password in the debug log', () => {
      const debugSpy = vi.spyOn(signale, 'debug').mockImplementation(() => {});
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      const password = 'My!Secret@123';
      mountMac({
        remotePath: 'smb://storage.example.com/projects',
        localPath: '/base/My Project [abc]',
        mountPath: '/base/.mounts/abc',
        baseDir: '/base',
        os: 'darwin' as any,
        debug: true,
        credentials: { username: 'testuser', password },
      });

      const logged = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain(password);
      expect(logged).not.toContain(encodeURIComponent(password));
      expect(logged).toContain('***');

      debugSpy.mockRestore();
    });
  });

  describe('mountLinux – C2 shell injection regression', () => {
    it('calls execFileSync with an argument array (no shell) for sudo mount', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      mountLinux({
      remotePath: 'smb://storage.example.com/projects',
      localPath: '/home/user/Desktop/RDSS/My Project [abc]',
      mountPath: '/home/user/Desktop/RDSS/.mounts/abc',
      baseDir: '/home/user/Desktop/RDSS',
      os: 'linux' as any,
      debug: false,
      credentials: { username: 'user', password: 's3cr3t', adDomain: 'qutad' },
      });

      expect(child_process.execFileSync).toHaveBeenCalledWith(
      'sudo',
      expect.arrayContaining(['mount', '-t', 'cifs', '-o']),
      expect.any(Object),
      );
      expect(child_process.execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('mount -t cifs'),
      expect.anything(),
      );
    });
  });

  describe('resetMountsDir – C2 umount regression', () => {
    it('calls execFileSync for umount on macOS, not execSync', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['abc'] as any);
      vi.mocked(fs.rmdirSync).mockReturnValue(undefined as any);

      resetMountsDir('/mounts', false, { ...getOs(), isMac: true, isWindows: false, isLinux: false });

      expect(child_process.execFileSync).toHaveBeenCalledWith(
      'umount',
      expect.arrayContaining([expect.stringContaining('abc')]),
      expect.any(Object),
      );
      expect(child_process.execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('umount'),
      expect.anything(),
      );
    });
  });

  const macOs = () => ({ ...getOs(), isMac: true, isWindows: false, isLinux: false });
  const linuxOs = () => ({ ...getOs(), isMac: false, isWindows: false, isLinux: true });

  describe('buildMacSmbUrl', () => {
    it('returns the path unchanged when no credentials are supplied', () => {
      const { url, logUrl } = buildMacSmbUrl('smb://host/projects');
      expect(url).toBe('smb://host/projects');
      expect(logUrl).toBe('smb://host/projects');
    });

    it('injects URL-encoded credentials and redacts the log URL', () => {
      const { url, logUrl } = buildMacSmbUrl('smb://host/projects', {
        username: 'user@qut.edu.au',
        password: 'p@ss:word',
        adDomain: 'qutad',
      });
      expect(url).toBe('smb://qutad;user%40qut.edu.au:p%40ss%3Aword@host/projects');
      expect(logUrl).toBe('smb://qutad;user%40qut.edu.au:***@host/projects');
      expect(logUrl).not.toContain('p@ss');
    });
  });

  describe('buildLinuxCifsMount', () => {
    it('converts smb:// to // and uses guest options without credentials', () => {
      const { url, opts, logOpts } = buildLinuxCifsMount('smb://host/projects');
      expect(url).toBe('//host/projects');
      expect(opts).toBe('guest');
      expect(logOpts).toBe('guest');
    });

    it('builds credentialed options and redacts the password in logOpts', () => {
      const { url, opts, logOpts } = buildLinuxCifsMount('smb://host/projects', {
        username: 'user',
        password: 's3cr3t',
        adDomain: 'qutad',
      });
      expect(url).toBe('//host/projects');
      expect(opts).toBe('username=user,password=s3cr3t,domain=qutad');
      expect(logOpts).toBe('username=user,password=***,domain=qutad');
    });
  });

  describe('findExistingSmbMount', () => {
    it('matches a macOS smbfs mount ignoring the user@ prefix', () => {
      vi.mocked(child_process.execSync).mockReturnValue(
        '//qutad;user@rstore.qut.edu.au/projects on /Volumes/projects (smbfs, nodev, nosuid)\n' as any,
      );
      expect(findExistingSmbMount('rstore.qut.edu.au', 'projects')).toBe('/Volumes/projects');
    });

    it('matches a Linux cifs mount using the " type " separator', () => {
      vi.mocked(child_process.execSync).mockReturnValue(
        '//rstore.qut.edu.au/projects on /home/u/RDSS/.mounts/projects type cifs (rw,relatime)\n' as any,
      );
      expect(findExistingSmbMount('rstore.qut.edu.au', 'projects')).toBe(
        '/home/u/RDSS/.mounts/projects',
      );
    });

    it('returns undefined when no matching mount exists', () => {
      vi.mocked(child_process.execSync).mockReturnValue(
        '/dev/disk1s1 on / (apfs, local)\n' as any,
      );
      expect(findExistingSmbMount('rstore.qut.edu.au', 'projects')).toBeUndefined();
    });
  });

  describe('mountNixShare', () => {
    it('macOS: tries a credential-free mount first and does not retry on success', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(child_process.execFileSync).mockReturnValue(undefined as any);

      mountNixShare({
        remotePath: 'smb://host/projects',
        mountPath: '/base/.mounts/projects',
        credentials: { username: 'user', password: 'pw' },
        osInfo: macOs(),
      });

      const calls = vi.mocked(child_process.execFileSync).mock.calls;
      expect(calls).toHaveLength(1);
      // First (and only) attempt must NOT contain embedded credentials.
      expect(calls[0][1]).toEqual(['smb://host/projects', '/base/.mounts/projects']);
    });

    it('macOS: falls back to credentialed mount when the credential-free attempt fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(child_process.execFileSync)
        .mockImplementationOnce(() => {
          throw new Error('NT_STATUS_LOGON_FAILURE');
        })
        .mockReturnValueOnce(undefined as any);

      mountNixShare({
        remotePath: 'smb://host/projects',
        mountPath: '/base/.mounts/projects',
        credentials: { username: 'user', password: 'pw' },
        osInfo: macOs(),
      });

      const calls = vi.mocked(child_process.execFileSync).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).toEqual(['smb://host/projects', '/base/.mounts/projects']);
      expect((calls[1][1] as string[])[0]).toBe('smb://user:pw@host/projects');
    });

    it('Linux: mounts via sudo mount -t cifs with an argument array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(child_process.execFileSync).mockReturnValue(undefined as any);

      mountNixShare({
        remotePath: 'smb://host/projects',
        mountPath: '/base/.mounts/projects',
        credentials: { username: 'user', password: 'pw', adDomain: 'qutad' },
        osInfo: linuxOs(),
      });

      expect(child_process.execFileSync).toHaveBeenCalledWith(
        'sudo',
        ['mount', '-t', 'cifs', '-o', 'username=user,password=pw,domain=qutad', '//host/projects', '/base/.mounts/projects'],
        expect.any(Object),
      );
    });
  });

  describe('aliasSubfolder', () => {
    it('symlinks an accessible subfolder into baseDir', () => {
      vi.mocked(fs.accessSync).mockReturnValue(undefined as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const symlink = vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      const result = aliasSubfolder({
        folderMapping: { id: 'abc123', nickname: 'My Project' } as any,
        baseDir: '/base',
        baseMountPath: '/base/.mounts/projects',
        truncateLength: 40,
      });

      expect(result).toBe(true);
      expect(symlink).toHaveBeenCalledWith(
        '/base/.mounts/projects/abc123',
        '/base/My Project [abc123]',
      );
    });

    it('skips (returns false) when the subfolder is not accessible', () => {
      vi.mocked(fs.accessSync).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const symlink = vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      const result = aliasSubfolder({
        folderMapping: { id: 'abc123' } as any,
        baseDir: '/base',
        baseMountPath: '/base/.mounts/projects',
        truncateLength: 40,
      });

      expect(result).toBe(false);
      expect(symlink).not.toHaveBeenCalled();
    });

    it('does not clobber a real (non-symlink) directory already at the alias path', () => {
      vi.mocked(fs.accessSync).mockReturnValue(undefined as any);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false } as fs.Stats);
      const symlink = vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      const result = aliasSubfolder({
        folderMapping: { id: 'abc123', nickname: 'My Project' } as any,
        baseDir: '/base',
        baseMountPath: '/base/.mounts/projects',
        truncateLength: 40,
      });

      expect(result).toBe(false);
      expect(symlink).not.toHaveBeenCalled();
    });

    it('replaces a stale symlink already at the alias path', () => {
      vi.mocked(fs.accessSync).mockReturnValue(undefined as any);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as fs.Stats);
      const unlink = vi.mocked(fs.unlinkSync).mockReturnValue(undefined as any);
      const symlink = vi.mocked(fs.symlinkSync).mockReturnValue(undefined as any);

      const result = aliasSubfolder({
        folderMapping: { id: 'abc123', nickname: 'My Project' } as any,
        baseDir: '/base',
        baseMountPath: '/base/.mounts/projects',
        truncateLength: 40,
      });

      expect(result).toBe(true);
      expect(unlink).toHaveBeenCalledWith('/base/My Project [abc123]');
      expect(symlink).toHaveBeenCalled();
    });
  });
});
