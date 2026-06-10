import * as childProcess from 'child_process';
import * as secrets from './secrets';
import { getOs } from './os';
import os from 'os';

vi.mock('child_process');
vi.mock('os');

describe('secrets', () => {
  it('should have defined methods', () => {
    expect(secrets.getCredentialsFromKeychain).toBeDefined();
    expect(secrets.saveCredentialsToKeychain).toBeDefined();
    expect(secrets.clearCredentialsFromKeychain).toBeDefined();
    expect(secrets.getTokenFromKeychain).toBeDefined();
    expect(secrets.saveTokenToKeychain).toBeDefined();
  });
});

describe('clearCredentialsFromKeychain – clears both credentials and OAuth token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
  });

  it('deletes both rdss-folder-mapper and rdss-folder-mapper-token entries on macOS', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    const osInfo = { ...getOs(), isMac: true, isWindows: false, isLinux: false };

    secrets.clearCredentialsFromKeychain(false, osInfo);

    const calls = vi.mocked(childProcess.execSync).mock.calls.map(c => c[0] as string);
    expect(calls.some(c => c.includes('rdss-folder-mapper"') && !c.includes('token'))).toBe(true);
    expect(calls.some(c => c.includes('rdss-folder-mapper-token'))).toBe(true);
  });

  it('deletes both entries on Linux', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    const osInfo = { ...getOs(), isMac: false, isWindows: false, isLinux: true };

    secrets.clearCredentialsFromKeychain(false, osInfo);

    const calls = vi.mocked(childProcess.execSync).mock.calls.map(c => c[0] as string);
    expect(calls.some(c => c.includes('rdss-folder-mapper') && !c.includes('token'))).toBe(true);
    expect(calls.some(c => c.includes('rdss-folder-mapper-token'))).toBe(true);
  });

  it('clears the PasswordVault entry on Windows', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    const osInfo = { ...getOs(), isMac: false, isWindows: true, isLinux: false };
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.clearCredentialsFromKeychain(false, osInfo);

    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    expect(call[0]).toBe('powershell');
    const script = (call[1] as string[]).join(' ');
    expect(script).toContain('PasswordVault');
    expect(script).toContain("FindAllByResource('rdss-folder-mapper')");
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });
});

describe('saveTokenToKeychain – C1 shell injection regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses execFileSync (not execSync) with an argument array on macOS', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    const osInfo = { ...getOs(), isMac: true, isWindows: false, isLinux: false };

    secrets.saveTokenToKeychain('my-token', false, osInfo);

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'security',
      expect.arrayContaining(['add-generic-password', '-w', 'my-token']),
      expect.any(Object),
    );
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });

  it('passes a token containing shell metacharacters as a literal argument (no injection)', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    const osInfo = { ...getOs(), isMac: true, isWindows: false, isLinux: false };
    const maliciousToken = 'tok"; rm -rf /;echo "pwned';

    secrets.saveTokenToKeychain(maliciousToken, false, osInfo);

    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    const args = call[1] as string[];
    expect(args).toContain(maliciousToken);
    // The token must appear as a discrete element, not baked into a shell string.
    expect(args.some((a) => a.includes('rm -rf') && a !== maliciousToken)).toBe(false);
  });

  it('uses execFileSync with stdin on Linux (token never in shell args)', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    const osInfo = { ...getOs(), isMac: false, isWindows: false, isLinux: true };

    secrets.saveTokenToKeychain('linux-token', false, osInfo);

    expect(childProcess.execFileSync).toHaveBeenCalledWith(
      'secret-tool',
      expect.arrayContaining(['store', 'service', 'rdss-folder-mapper-token']),
      expect.objectContaining({ input: 'linux-token' }),
    );
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });

  it('saves the token to the PasswordVault on Windows', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    const osInfo = { ...getOs(), isMac: false, isWindows: true, isLinux: false };
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.saveTokenToKeychain('windows-token', false, osInfo);

    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    expect(call[0]).toBe('powershell');
    const script = (call[1] as string[]).join(' ');
    expect(script).toContain('PasswordCredential');
    expect(script).toContain("'rdss-folder-mapper-token'");
    expect(script).toContain('windows-token');
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });
});

describe('Windows credential storage – PasswordVault', () => {
  const winOs = () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    return { ...getOs(), isMac: false, isWindows: true, isLinux: false };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves credentials to the PasswordVault with the domain encoded into the username', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.saveCredentialsToKeychain(
      { username: 'alice', password: 'pw', adDomain: 'QUT' },
      false,
      osInfo,
    );

    const call = vi.mocked(childProcess.execFileSync).mock.calls[0];
    expect(call[0]).toBe('powershell');
    const script = (call[1] as string[]).join(' ');
    expect(script).toContain('PasswordCredential');
    expect(script).toContain("'rdss-folder-mapper'");
    expect(script).toContain('QUT\\alice');
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });

  it('escapes single quotes in the password to prevent PowerShell injection', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.saveCredentialsToKeychain(
      { username: 'alice', password: "p');$x='owned" },
      false,
      osInfo,
    );

    const script = (vi.mocked(childProcess.execFileSync).mock.calls[0][1] as string[]).join(' ');
    expect(script).toContain("p'');$x=''owned");
  });

  it('reads and parses credentials (domain\\user) from the PasswordVault', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockReturnValue('QUT\\alice\nsecretpw\n' as unknown as Buffer);

    const creds = secrets.getCredentialsFromKeychain(false, osInfo);

    expect(creds).toEqual({ username: 'alice', password: 'secretpw', adDomain: 'QUT' });
  });

  it('returns empty credentials when the PasswordVault has no entry', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('Element not found');
    });

    expect(secrets.getCredentialsFromKeychain(false, osInfo)).toEqual({});
  });

  it('reads the OAuth token from the PasswordVault', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockReturnValue('jwt-token-value\n' as unknown as Buffer);

    expect(secrets.getTokenFromKeychain(false, osInfo)).toBe('jwt-token-value');
    const script = (vi.mocked(childProcess.execFileSync).mock.calls[0][1] as string[]).join(' ');
    expect(script).toContain("'rdss-folder-mapper-token'");
    expect(script).toContain("'oauth_token'");
  });

  it('returns undefined for the token when the PasswordVault has no entry', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('Element not found');
    });

    expect(secrets.getTokenFromKeychain(false, osInfo)).toBeUndefined();
  });

  it('clears both the credentials and the OAuth token on Windows', () => {
    const osInfo = winOs();
    vi.mocked(childProcess.execFileSync).mockReturnValue(Buffer.from(''));

    secrets.clearCredentialsFromKeychain(false, osInfo);

    const scripts = vi
      .mocked(childProcess.execFileSync)
      .mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(scripts.some((s) => s.includes("FindAllByResource('rdss-folder-mapper')"))).toBe(true);
    expect(scripts.some((s) => s.includes("FindAllByResource('rdss-folder-mapper-token')"))).toBe(true);
  });
});
