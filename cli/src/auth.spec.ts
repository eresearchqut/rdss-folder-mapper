import type { MockInstance } from 'vitest';
import signale from 'signale';
import http from 'http';
import os from 'os';
import { execSync, execFileSync } from 'child_process';
import { performLogin, redactHeaders, setupFetchMiddleware } from './auth';
import { getOs } from './os';

vi.mock('os');
vi.mock('child_process');
vi.mock('open', () => ({ default: vi.fn() }), { virtual: true });

describe('auth performLogin', () => {
  let originalArgv: string[];
  let originalExit: NodeJS.Process['exit'];
  let stderrSpy: MockInstance;

  beforeAll(() => {
    originalArgv = process.argv;
    originalExit = process.exit;
    process.argv = ['node', 'index.ts', 'unknown-command'];
    process.exit = vi.fn() as never;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterAll(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    stderrSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('should return valid token from keychain on non-Windows', async () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const validPayload = Buffer.from(JSON.stringify({ exp: futureExp })).toString('base64');
    const validToken = `header.${validPayload}.signature`;

    vi.mocked(execSync).mockReturnValue(validToken as any);

    const token = await performLogin({
      authDomain: 'auth',
      clientId: 'client',
      callbackUrls: ['http://localhost:3001/'],
      debug: true,
    }, getOs());

    expect(token).toBe(validToken);
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('security find-generic-password'),
      expect.any(Object),
    );
  });

  it('persists the token via the Windows Credential Manager after login', async () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    // No existing token in the vault — PasswordVault read returns nothing.
    vi.mocked(execFileSync).mockReturnValue(undefined as never);

    const errorSpy = vi.spyOn(signale, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'windows_token' }),
    } as any);

    const loginPromise = performLogin({
      authDomain: 'auth',
      clientId: 'client',
      callbackUrls: ['http://127.0.0.1:3002/'],
      debug: true,
    }, getOs());

    await new Promise((resolve) => setTimeout(resolve, 500));

    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:3002/?code=mock_code', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(token).toBe('windows_token');
    // The macOS `security` command is never used on Windows.
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining('security find-generic-password'),
      expect.any(Object),
    );
    // The token is saved through PowerShell PasswordVault.
    const savedToVault = vi
      .mocked(execFileSync)
      .mock.calls.some(
        (c) =>
          c[0] === 'powershell' &&
          (c[1] as string[]).join(' ').includes('windows_token'),
      );
    expect(savedToVault).toBe(true);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should fetch new token if keychain token is expired', async () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const expiredPayload = Buffer.from(JSON.stringify({ exp: pastExp })).toString('base64');
    const expiredToken = `header.${expiredPayload}.signature`;

    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('find-generic-password') && cmd.includes('-w')) {
        return expiredToken as any;
      }
      return Buffer.from('') as any;
    });

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'new_valid_token' }),
    } as any);

    const loginPromise = performLogin({
      authDomain: 'auth',
      clientId: 'client',
      callbackUrls: ['http://127.0.0.1:3003/'],
      debug: true,
    }, getOs());

    await new Promise((resolve) => setTimeout(resolve, 500));

    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:3003/?code=mock_code', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(token).toBe('new_valid_token');
  });

  it('should fetch new token if no token exists in keychain', async () => {
    vi.mocked(os.platform).mockReturnValue('darwin');

    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('find-generic-password')) {
        throw new Error('Not found');
      }
      return Buffer.from('') as any;
    });

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'new_valid_token_2' }),
    } as any);

    const loginPromise = performLogin({
      authDomain: 'auth',
      clientId: 'client',
      callbackUrls: ['http://127.0.0.1:3004/'],
      debug: true,
    }, getOs());

    await new Promise((resolve) => setTimeout(resolve, 500));

    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:3004/?code=mock_code', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(token).toBe('new_valid_token_2');
  });
});

// ─── C3 Regression: OAuth callback server binds to 127.0.0.1 ────────────────

describe('auth – C3: callback server binds to 127.0.0.1', () => {
  let originalExit: NodeJS.Process['exit'];
  let stderrSpy: MockInstance;

  beforeAll(() => {
    originalExit = process.exit;
    process.exit = vi.fn() as never;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterAll(() => {
    process.exit = originalExit;
    stderrSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-loopback callback URLs and returns undefined', async () => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });

    const errorSpy = vi.spyOn(signale, 'error').mockImplementation(() => {});
    const originalExitCode = process.exitCode;

    const result = await performLogin({
      authDomain: 'auth.example.com',
      clientId: 'client',
      callbackUrls: ['http://evil.attacker.com:9999/callback'],
      debug: false,
    }, getOs());

    expect(result).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('loopback'));

    process.exitCode = originalExitCode;
    errorSpy.mockRestore();
  });

  it('accepts 127.0.0.1 callback URLs', async () => {
    vi.mocked(os.platform).mockReturnValue('win32');

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'tok' }),
    } as any);

    const loginPromise = performLogin({
      authDomain: 'auth.example.com',
      clientId: 'client',
      callbackUrls: ['http://127.0.0.1:3010/'],
      debug: false,
    }, getOs());

    await new Promise((r) => setTimeout(r, 300));
    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:3010/?code=abc', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(token).toBe('tok');
    expect(process.exitCode).not.toBe(1);
  });
});

// ─── C4 Regression: PKCE code_challenge in auth URL ─────────────────────────

describe('auth – C4: PKCE in authorization code flow', () => {
  let originalExit: NodeJS.Process['exit'];
  let stderrSpy: MockInstance;

  beforeAll(() => {
    originalExit = process.exit;
    process.exit = vi.fn() as never;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterAll(() => {
    process.exit = originalExit;
    stderrSpy.mockRestore();
  });

  beforeEach(() => vi.clearAllMocks());

  it('includes code_challenge_method=S256 and code_challenge in the authorization URL', async () => {
    vi.mocked(os.platform).mockReturnValue('win32');

    const openMock = await import('open').then((m) => m.default as unknown as ReturnType<typeof vi.fn>);
    openMock.mockResolvedValue(undefined);

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'pkce-token' }),
    } as any);

    const loginPromise = performLogin({
      authDomain: 'auth.example.com',
      clientId: 'client',
      callbackUrls: ['http://127.0.0.1:3011/'],
      debug: false,
    }, getOs());

    await new Promise((r) => setTimeout(r, 300));
    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:3011/?code=authcode', () => resolve()).on('error', reject);
    });

    await loginPromise;

    // The first fetch call is the token exchange — check it carries code_verifier
    const tokenExchangeCall = fetchSpy.mock.calls.find(([url]) =>
      typeof url === 'string' && url.includes('/oauth2/token'),
    );
    expect(tokenExchangeCall).toBeDefined();
    const body = tokenExchangeCall![1]?.body as string;
    expect(body).toContain('code_verifier=');
    expect(body).toContain('code=authcode');
  });
});

// ─── C6 Regression: Authorization header redacted in debug logs ──────────────

describe('redactHeaders – C6: Authorization header redaction', () => {
  it('replaces Bearer token value with [REDACTED]', () => {
    const result = redactHeaders({ Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig' });
    expect(result['Authorization']).toBe('Bearer [REDACTED]');
  });

  it('is case-insensitive (lowercase authorization key)', () => {
    const result = redactHeaders({ authorization: 'Bearer some-token' });
    expect(result['authorization']).toBe('Bearer [REDACTED]');
  });

  it('leaves non-Authorization headers unchanged', () => {
    const result = redactHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(result['Content-Type']).toBe('application/json');
    expect(result['Accept']).toBe('application/json');
  });

  it('does not modify the original headers object', () => {
    const headers = { Authorization: 'Bearer real-token' };
    redactHeaders(headers);
    expect(headers['Authorization']).toBe('Bearer real-token');
  });
});
