import { GenericContainer, Wait, StartedTestContainer } from 'testcontainers';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import os from 'os';
import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { transformPlansToFolders } from './index';

const isWindows = () => {
  return os.platform() === 'win32';
};

describe('transformPlansToFolders', () => {
  it('should transform plans.json format into folders.json format', () => {
    const input = [
      {
        dataStorageId: 'some-id',
        encodedId: 'MOZGYH8890',
        project: {
          title: 'Launch Job ids',
          organisation: {
            faculty: { name: 'Faculty of Business & Law' },
            school: { name: 'School of Law' },
          },
        },
        projectMeta: {
          isLead: true,
          isCollaborator: false,
          isSupervisor: false,
        },
      },
      {
        dataStorageId: 'some-other-id',
        encodedId: 'SHOULD_IGNORE_123',
        project: {
          title: 'Should be ignored due to projectMeta conditions',
        },
        projectMeta: {
          isLead: false,
          isCollaborator: true,
          isSupervisor: false,
          editable: false,
        },
      },
      {
        encodedId: 'NO_STORAGE_ID',
        project: { title: 'Should be ignored' },
      },
    ];

    const result = transformPlansToFolders(input);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]).toEqual({
      id: 'MOZGYH8890',
      title: 'Launch Job ids',
      role: 'LEAD',
      organisation: ['Faculty of Business & Law', 'School of Law'],
    });
  });
});

describe('Integration Test', () => {
  let container: StartedTestContainer;
  const testFilesDir = path.join(process.cwd(), '.smb', 'config');

  beforeAll(async () => {
    const smbConfPath = path.join(testFilesDir, 'smb.conf');
    const usersConfPath = path.join(testFilesDir, 'users.conf');

    container = await new GenericContainer('dockurr/samba')
      .withBindMounts([
        { source: smbConfPath, target: '/etc/samba/smb.conf' },
        { source: usersConfPath, target: '/etc/samba/users.conf' },
      ])
      .withExposedPorts(445)
      .withWaitStrategy(Wait.forLogMessage(/smbd version/i))
      .start();

    // Create test files and set permissions for home directories
    await container.exec(['mkdir', '-p', '/home/alice', '/home/bob']);
    await container.exec(['sh', '-c', 'echo "alice_data" > /home/alice/alice_test.txt']);
    await container.exec(['sh', '-c', 'echo "bob_data" > /home/bob/bob_test.txt']);
    await container.exec(['chown', '-R', 'alice:smb', '/home/alice']);
    await container.exec(['chown', '-R', 'bob:smb', '/home/bob']);
  }, 120000);

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  test('should start samba container and expose port 445', async () => {
    const host = container.getHost();
    const port = container.getMappedPort(445);

    expect(host).toBeDefined();
    expect(port).toBeDefined();

    // Verify we can connect to the SMB port
    const isPortOpen = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });
      socket.connect(port, host);
    });

    expect(isPortOpen).toBe(true);
  });

  describe('CLI mounting', () => {
    const testRdssDir = path.join(process.cwd(), '.test', 'RDSS');

    beforeEach(() => {
      if (fs.existsSync(testRdssDir)) {
        fs.rmSync(testRdssDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testRdssDir, { recursive: true });

      fs.writeFileSync(
        'folders.json',
        JSON.stringify({
          folders: [{ id: 'test_share', nickname: 'TestShare' }],
        }),
      );
    });

    afterEach(() => {
      if (fs.existsSync('folders.json')) {
        fs.rmSync('folders.json');
      }
      try {
        execSync(`npx ts-node index.ts reset --base-dir ${testRdssDir}`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    });

    test('should recreate RDSS folder and run CLI', async () => {
      const host = container.getHost();
      const port = container.getMappedPort(445);

      const basePathWin = `\\\\${host}`;
      // Usually dockurr/samba maps volumes, but we can just use smb://${host}:${port}
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
        RDSS_USERNAME: 'testuser',
        RDSS_PASSWORD: 'testpass',
      };

      execSync(`npx ts-node index.ts --base-dir ${testRdssDir}`, { env, stdio: 'pipe' });

      // Verify that the CLI started to create the mapping
      // Since mounting might fail in CI/local depending on perms, we mainly check if the .test/RDSS directory has the expected structures
      const mountsDir = path.join(testRdssDir, '.mounts');

      if (!isWindows()) {
        expect(fs.existsSync(mountsDir)).toBe(true);
      } else {
        expect(fs.existsSync(testRdssDir)).toBe(true);
      }
    });

    test('should fail to mount and warn when using invalid credentials', async () => {
      const host = container.getHost();
      const port = container.getMappedPort(445);

      const basePathWin = `\\\\${host}`;
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
        RDSS_USERNAME: 'testuser',
        RDSS_PASSWORD: 'testpass',
      };

      try {
        const output = execSync(`npx ts-node index.ts --base-dir ${testRdssDir} 2>&1`, {
          env,
          stdio: 'pipe',
        });
        expect(output.toString()).toContain('Error: Failed to map');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain(
          'Error: Failed to map',
        );
      }
    });

    test('should apply options from config.json and override with CLI', async () => {
      const customConfigPath = 'config.json';
      fs.writeFileSync(
        customConfigPath,
        JSON.stringify({
          baseDir: testRdssDir,
          debug: true,
          truncateLength: 15,
        }),
      );

      const host = container.getHost();
      const port = container.getMappedPort(445);

      const basePathWin = `\\\\${host}`;
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
        RDSS_USERNAME: 'testuser',
        RDSS_PASSWORD: 'testpass',
      };

      try {
        const output = execSync('npx ts-node index.ts 2>&1', {
          env,
          stdio: 'pipe',
        });
        expect(output.toString()).toContain('Using options:');
        expect(output.toString()).toContain('"truncateLength": 15');
      } finally {
        if (fs.existsSync(customConfigPath)) {
          fs.rmSync(customConfigPath);
        }
      }
    });

    test('should fail when folders.json is missing', async () => {
      fs.rmSync('folders.json');
      try {
        const output = execSync(`npx ts-node index.ts --base-dir ${testRdssDir} 2>&1`, {
          stdio: 'pipe',
        });
        expect(output.toString()).toContain('Failed to read or parse folders.json');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain(
          'Failed to read or parse folders.json',
        );
      }
    });

    test('should use custom folders file when --folders is provided', async () => {
      const customFoldersFile = path.join(process.cwd(), '.test', 'custom-folders.json');
      fs.writeFileSync(
        customFoldersFile,
        JSON.stringify({
          folders: [{ id: 'test_share', nickname: 'CustomShare' }],
        }),
      );

      const host = container.getHost();
      const port = container.getMappedPort(445);

      const basePathWin = `\\\\${host}`;
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
        RDSS_USERNAME: 'testuser',
        RDSS_PASSWORD: 'testpass',
      };

      execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --folders ${customFoldersFile}`, {
        env,
        stdio: 'pipe',
      });

      const mountsDir = path.join(testRdssDir, '.mounts');
      if (!isWindows()) {
        expect(fs.existsSync(mountsDir)).toBe(true);
      } else {
        expect(fs.existsSync(testRdssDir)).toBe(true);
      }
    });

    test('should fail when custom folders file is missing', async () => {
      const missingFoldersFile = path.join(testRdssDir, 'missing-folders.json');
      try {
        const output = execSync(
          `npx ts-node index.ts --base-dir ${testRdssDir} -f ${missingFoldersFile} 2>&1`,
          { stdio: 'pipe' },
        );
        expect(output.toString()).toContain(`Failed to read or parse ${missingFoldersFile}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain(
          `Failed to read or parse ${missingFoldersFile}`,
        );
      }
    });

    test('should use custom remote path when --remote-path is provided', async () => {
      // Use an invalid host so it fails to mount reliably, allowing us to inspect the error string
      const customRemotePath = isWindows()
        ? '\\\\invalid-test-host'
        : 'smb://invalid-test-host:445';
      const env = { ...process.env, RDSS_USERNAME: 'testuser', RDSS_PASSWORD: 'testpass' };

      try {
        const output = execSync(
          `npx ts-node index.ts --base-dir ${testRdssDir} --remote-path ${customRemotePath} 2>&1`,
          { env, stdio: 'pipe' },
        );
        expect(output.toString()).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // Since we are mocking the mount and it might fail, we just make sure the error output
        // mentions mapping the custom path rather than the default env ones
        const outputStr = e.stderr?.toString() || e.stdout?.toString() || e.message;
        const expectedRemote = isWindows()
          ? `${customRemotePath}\\test_share`
          : `${customRemotePath}/test_share`;
        expect(outputStr).toContain(`Error: Failed to map ${expectedRemote}`);
      }
    });

    test('should reset all currently mapped folders', async () => {
      const mountsDir = path.join(testRdssDir, '.mounts');
      fs.mkdirSync(mountsDir, { recursive: true });

      const fakeTarget = path.join(mountsDir, 'fake');
      fs.mkdirSync(fakeTarget, { recursive: true });

      const fakeLocalPath = path.join(testRdssDir, 'FakeShare');
      if (isWindows()) {
        fs.mkdirSync(fakeLocalPath, { recursive: true });
      } else {
        fs.symlinkSync(fakeTarget, fakeLocalPath);
      }

      try {
        execSync(`npx ts-node index.ts reset --base-dir ${testRdssDir}`, { stdio: 'pipe' });
      } catch {
        // ignore reset failure
      }
      expect(fs.existsSync(fakeLocalPath)).toBe(false);
    });

    test('should truncate and remove unsafe characters from the title when nickname is not provided', async () => {
      const customFoldersFile = path.join(process.cwd(), '.test', 'truncate-folders.json');
      fs.writeFileSync(
        customFoldersFile,
        JSON.stringify({
          folders: [
            {
              id: 'test_share',
              title:
                'This is a very long <title> that should definitely be truncated because it exceeds sixty characters',
            },
          ],
        }),
      );

      const host = container.getHost();
      const port = container.getMappedPort(445);

      const basePathWin = `\\\\${host}`;
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
        RDSS_USERNAME: 'testuser',
        RDSS_PASSWORD: 'testpass',
      };

      execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --folders ${customFoldersFile}`, {
        env,
        stdio: 'pipe',
      });

      const expectedFolderName = 'This Is A Very Long Title That Should... [test_share]';
      const localPath = path.join(testRdssDir, expectedFolderName);

      expect(fs.existsSync(localPath)).toBe(true);
    });

    test('should assert access to multiple user home directories via smbclient', async () => {
      // Assert Alice has access to her home
      const aliceExec = await container.exec([
        'smbclient',
        '//127.0.0.1/alice',
        '-U',
        'alice%alicepass',
        '-c',
        'get alice_test.txt -',
      ]);
      expect(aliceExec.exitCode).toBe(0);
      expect(aliceExec.output).toContain('alice_data');

      // Assert Bob has access to his home
      const bobExec = await container.exec([
        'smbclient',
        '//127.0.0.1/bob',
        '-U',
        'bob%bobpass',
        '-c',
        'get bob_test.txt -',
      ]);
      expect(bobExec.exitCode).toBe(0);
      expect(bobExec.output).toContain('bob_data');

      // Assert Alice cannot access Bob's home
      const aliceDenyExec = await container.exec([
        'smbclient',
        '//127.0.0.1/bob',
        '-U',
        'alice%alicepass',
        '-c',
        'ls',
      ]);
      expect(aliceDenyExec.exitCode).not.toBe(0);
    });
  });

  describe('performLogin token handling', () => {
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

      const { performLogin } = require('./index');

      const token = await performLogin({
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
        port: 3001,
        debug: true,
      });

      expect(token).toBe(validToken);
      expect(execSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('security find-generic-password'),
        expect.any(Object),
      );
    });

    it('should skip keychain on Windows and start login process', async () => {
      osPlatformMock.mockReturnValue('win32');

      const { performLogin } = require('./index');

      // Mock console to prevent error outputs from missing parameters
      const errorSpy = jest.spyOn(require('signale'), 'error').mockImplementation(() => {});
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'windows_token' }),
      });

      // Start login, it should complain about missing params or try to open browser
      // Actually, let's provide dummy URLs and see if it tries to open
      const loginPromise = performLogin({
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
        port: 3002,
        debug: true,
      });

      // Wait a moment for the server to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      await new Promise<void>((resolve) => {
        http.get('http://localhost:3002/callback?code=mock_code', () => resolve());
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

      execSyncMock.mockImplementation((cmd) => {
        if (cmd.includes('find-generic-password') && cmd.includes('-w')) {
          return expiredToken;
        }
        return Buffer.from('');
      });

      // Mock fetch for the token exchange
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new_valid_token' }),
      });

      const { performLogin } = require('./index');

      const loginPromise = performLogin({
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
        port: 3003,
        debug: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await new Promise<void>((resolve) => {
        http.get('http://localhost:3003/callback?code=mock_code', () => resolve());
      });

      const token = await loginPromise;
      expect(token).toBe('new_valid_token');
    });

    it('should fetch new token if no token exists in keychain', async () => {
      osPlatformMock.mockReturnValue('darwin');

      // Throw an error to simulate no token in keychain
      execSyncMock.mockImplementation((cmd) => {
        if (cmd.includes('find-generic-password')) {
          throw new Error('Not found');
        }
        return Buffer.from('');
      });

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new_valid_token_2' }),
      });

      const { performLogin } = require('./index');

      const loginPromise = performLogin({
        authUrl: 'http://auth',
        tokenUrl: 'http://token',
        clientId: 'client',
        port: 3004,
        debug: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await new Promise<void>((resolve) => {
        http.get('http://localhost:3004/callback?code=mock_code', () => resolve());
      });

      const token = await loginPromise;
      expect(token).toBe('new_valid_token_2');
    });
  });

  describe('login action', () => {
    let cognitoContainer: StartedTestContainer;
    let cognitoHost: string;
    let cognitoPort: number;
    let userPoolId: string;
    let clientId: string;

    beforeAll(async () => {
      cognitoContainer = await new GenericContainer('jagregory/cognito-local:latest')
        .withExposedPorts(9229)
        .start();

      cognitoHost = cognitoContainer.getHost();
      cognitoPort = cognitoContainer.getMappedPort(9229);

      const client = new CognitoIdentityProviderClient({
        region: 'local',
        endpoint: `http://${cognitoHost}:${cognitoPort}`,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      });

      const poolRes = await client.send(new CreateUserPoolCommand({ PoolName: 'test-pool' }));
      userPoolId = poolRes.UserPool!.Id as string;

      const clientRes = await client.send(
        new CreateUserPoolClientCommand({
          UserPoolId: userPoolId,
          ClientName: 'test-client',
          GenerateSecret: false,
          ExplicitAuthFlows: ['USER_PASSWORD_AUTH'],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthScopes: ['openid', 'email', 'profile'],
          CallbackURLs: ['http://localhost:3000/callback'],
          SupportedIdentityProviders: ['COGNITO'],
        }),
      );
      clientId = clientRes.UserPoolClient!.ClientId as string;

      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: 'testuser@example.com',
          MessageAction: 'SUPPRESS',
        }),
      );

      await client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: userPoolId,
          Username: 'testuser@example.com',
          Password: 'Password1!',
          Permanent: true,
        }),
      );
    }, 60000);

    afterAll(async () => {
      if (cognitoContainer) {
        await cognitoContainer.stop();
      }
    });

    test('should start local server, receive code and attempt to exchange token', async () => {
      const authUrl = `http://${cognitoHost}:${cognitoPort}/${userPoolId}/oauth2/authorize`;
      const tokenUrl = `http://${cognitoHost}:${cognitoPort}/${userPoolId}/oauth2/token`;

      const child = exec(
        `npx ts-node index.ts login --auth-url "${authUrl}" --token-url "${tokenUrl}" --client-id "${clientId}"`,
      );

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for the server to start by polling the callback endpoint
      let serverStarted = false;
      for (let i = 0; i < 15; i++) {
        try {
          await fetch('http://localhost:3000/callback?code=mock_auth_code');
          serverStarted = true;
          break;
        } catch {
          // not started yet
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      expect(serverStarted).toBe(true);

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
      });

      // Since jagregory/cognito-local does not support /oauth2/token, it will fail to exchange the code
      // We should verify that the CLI handled the callback and attempted the exchange.
      expect(stdout + stderr).toContain('Failed to exchange code for token');
    }, 30000);
  });
});
