describe('auth performLogin', () => {
  let osPlatformMock: jest.SpyInstance;
  let execSyncMock: jest.SpyInstance;
  let fetchMock: jest.SpyInstance;
  let openMock: jest.Mock;
  let originalArgv: string[];
  let originalExit: NodeJS.Process['exit'];
  let stderrSpy: jest.SpyInstance;

  const http = require('http');

  beforeAll(() => {
    originalArgv = process.argv;
    originalExit = process.exit;
    process.argv = ['node', 'index.ts', 'unknown-command'];
    process.exit = jest.fn() as never;
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterAll(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    stderrSpy.mockRestore();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  beforeEach(() => {
    jest.resetModules();

    const os = require('os');
    osPlatformMock = jest.spyOn(os, 'platform');

    execSyncMock = jest.spyOn(require('child_process'), 'execSync');
    fetchMock = jest.spyOn(global, 'fetch');
    openMock = jest.fn();
    jest.mock('open', () => openMock, { virtual: true });
  });

  afterEach(() => {
    osPlatformMock.mockRestore();
    execSyncMock.mockRestore();
    fetchMock.mockRestore();
    jest.clearAllMocks();
  });

  it('should return valid token from keychain on non-Windows', async () => {
    osPlatformMock.mockReturnValue('darwin');
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const validPayload = Buffer.from(JSON.stringify({ exp: futureExp })).toString('base64');
    const validToken = `header.${validPayload}.signature`;

    execSyncMock.mockReturnValue(validToken);

    const { performLogin } = require('./auth');
    const { getOs } = require('./os');

    const token = await performLogin({
      dmpConfig: {
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
      },
      port: 3001,
      debug: true,
    }, getOs());

    expect(token).toBe(validToken);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('security find-generic-password'),
      expect.any(Object),
    );
  });

  it('should skip keychain on Windows and start login process', async () => {
    osPlatformMock.mockReturnValue('win32');

    const { performLogin } = require('./auth');
    const { getOs } = require('./os');

    // Mock console to prevent error outputs from missing parameters

    const errorSpy = jest.spyOn(require('signale'), 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    fetchMock.mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'windows_token' }),
    });

    // Start login, it should complain about missing params or try to open browser
    // Actually, let's provide dummy URLs and see if it tries to open
    const loginPromise = performLogin({
      dmpConfig: {
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
      },
      port: 3002,
      debug: true,
    }, getOs());

    // Wait a moment for the server to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    await new Promise<void>((resolve, reject) => {
      http.get('http://localhost:3002/?code=mock_code', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(execSyncMock).not.toHaveBeenCalledWith(
      expect.stringContaining('security find-generic-password'),
      expect.any(Object),
    );
    expect(token).toBe('windows_token');

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should fetch new token if keychain token is expired', async () => {
    osPlatformMock.mockReturnValue('darwin');
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const expiredPayload = Buffer.from(JSON.stringify({ exp: pastExp })).toString('base64');
    const expiredToken = `header.${expiredPayload}.signature`;

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('find-generic-password') && cmd.includes('-w')) {
        return expiredToken;
      }
      return Buffer.from('');
    });

    // Mock fetch for the token exchange
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'new_valid_token' }),
    });

    const { performLogin } = require('./auth');
    const { getOs } = require('./os');

    const loginPromise = performLogin({
      dmpConfig: {
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
      },
      port: 3003,
      debug: true,
    }, getOs());

    await new Promise((resolve) => setTimeout(resolve, 500));

    await new Promise<void>((resolve, reject) => {
      http.get('http://localhost:3003/?code=mock_code', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(token).toBe('new_valid_token');
  });

  it('should fetch new token if no token exists in keychain', async () => {
    osPlatformMock.mockReturnValue('darwin');

    // Throw an error to simulate no token in keychain
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('find-generic-password')) {
        throw new Error('Not found');
      }
      return Buffer.from('');
    });

    fetchMock.mockResolvedValue({
      ok: true,
      headers: { entries: () => [] },
      json: async () => ({ id_token: 'new_valid_token_2' }),
    });

    const { performLogin } = require('./auth');
    const { getOs } = require('./os');

    const loginPromise = performLogin({
      dmpConfig: {
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
      },
      port: 3004,
      debug: true,
    }, getOs());

    await new Promise((resolve) => setTimeout(resolve, 500));

    await new Promise<void>((resolve, reject) => {
      http.get('http://localhost:3004/?code=mock_code', () => resolve()).on('error', reject);
    });

    const token = await loginPromise;
    expect(token).toBe('new_valid_token_2');
  });
});
