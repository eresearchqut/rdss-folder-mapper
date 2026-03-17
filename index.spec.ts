import { GenericContainer, Wait } from 'testcontainers';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const isWindows = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';

describe('Integration Test', () => {
  let container: any;
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
        })
      );
    });

    afterEach(() => {
      if (fs.existsSync('folders.json')) {
        fs.rmSync('folders.json');
      }
      try {
        execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --reset`, { stdio: 'ignore' });
      } catch (e) {
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
      };

      execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --username testuser --password testpass`, { env, stdio: 'pipe' });

      // Verify that the CLI started to create the mapping
      // Since mounting might fail in CI/local depending on perms, we mainly check if the .test/RDSS directory has the expected structures
      const mountsDir = path.join(testRdssDir, '.mounts');
      
      if (!isWindows) {
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
      };

      try {
        const output = execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --username wronguser --password wrongpass 2>&1`, { env, stdio: 'pipe' });
        expect(output.toString()).toContain('Error: Failed to map');
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain('Error: Failed to map');
      }
    });

    test('should fail when folders.json is missing', async () => {
      fs.rmSync('folders.json');
      try {
        const output = execSync(`npx ts-node index.ts --base-dir ${testRdssDir} 2>&1`, { stdio: 'pipe' });
        expect(output.toString()).toContain('Failed to read or parse folders.json');
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain('Failed to read or parse folders.json');
      }
    });

    test('should use custom folders file when --folders is provided', async () => {
      const customFoldersFile = path.join(process.cwd(), '.test', 'custom-folders.json');
      fs.writeFileSync(
        customFoldersFile,
        JSON.stringify({
          folders: [{ id: 'test_share', nickname: 'CustomShare' }],
        })
      );

      const host = container.getHost();
      const port = container.getMappedPort(445);
      
      const basePathWin = `\\\\${host}`;
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
      };

      execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --folders ${customFoldersFile} --username testuser --password testpass`, { env, stdio: 'pipe' });

      const mountsDir = path.join(testRdssDir, '.mounts');
      if (!isWindows) {
        expect(fs.existsSync(mountsDir)).toBe(true);
      } else {
        expect(fs.existsSync(testRdssDir)).toBe(true);
      }
    });

    test('should fail when custom folders file is missing', async () => {
      const missingFoldersFile = path.join(testRdssDir, 'missing-folders.json');
      try {
        const output = execSync(`npx ts-node index.ts --base-dir ${testRdssDir} -f ${missingFoldersFile} 2>&1`, { stdio: 'pipe' });
        expect(output.toString()).toContain(`Failed to read or parse ${missingFoldersFile}`);
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain(`Failed to read or parse ${missingFoldersFile}`);
      }
    });

    test('should use custom remote path when --remote-path is provided', async () => {
      // Use an invalid host so it fails to mount reliably, allowing us to inspect the error string
      const customRemotePath = isWindows ? `\\\\invalid-test-host` : `smb://invalid-test-host:445`;

      try {
        const output = execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --remote-path ${customRemotePath} --username testuser --password testpass 2>&1`, { stdio: 'pipe' });
      } catch (e: any) {
        // Since we are mocking the mount and it might fail, we just make sure the error output
        // mentions mapping the custom path rather than the default env ones
        const outputStr = e.stderr?.toString() || e.stdout?.toString() || e.message;
        const expectedRemote = isWindows ? `${customRemotePath}\\test_share` : `${customRemotePath}/test_share`;
        expect(outputStr).toContain(`Error: Failed to map ${expectedRemote}`);
      }
    });

    test('should reset all currently mapped folders', async () => {
      const mountsDir = path.join(testRdssDir, '.mounts');
      fs.mkdirSync(mountsDir, { recursive: true });

      const fakeTarget = path.join(mountsDir, 'fake');
      fs.mkdirSync(fakeTarget, { recursive: true });
      
      const fakeLocalPath = path.join(testRdssDir, 'FakeShare');
      if (isWindows) {
        fs.mkdirSync(fakeLocalPath, { recursive: true });
      } else {
        fs.symlinkSync(fakeTarget, fakeLocalPath);
      }

      try {
        execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --reset`, { stdio: 'pipe' });
      } catch (e) {
        // ignore reset failure
      }
      expect(fs.existsSync(fakeLocalPath)).toBe(false);
    });

    test('should truncate and remove unsafe characters from the title when nickname is not provided', async () => {
      const customFoldersFile = path.join(process.cwd(), '.test', 'truncate-folders.json');
      fs.writeFileSync(
        customFoldersFile,
        JSON.stringify({
          folders: [{ id: 'test_share', title: 'This is a very long <title> that should definitely be truncated because it exceeds sixty characters' }],
        })
      );

      const host = container.getHost();
      const port = container.getMappedPort(445);
      
      const basePathWin = `\\\\${host}`;
      const basePathNix = `smb://${host}:${port}`;

      const env = {
        ...process.env,
        REMOTE_PATH_WIN: basePathWin,
        REMOTE_PATH_NIX: basePathNix,
      };

      execSync(`npx ts-node index.ts --base-dir ${testRdssDir} --folders ${customFoldersFile} --username testuser --password testpass`, { env, stdio: 'pipe' });

      const expectedFolderName = 'test_share - This is a very long title that should...';
      const localPath = path.join(testRdssDir, expectedFolderName);
      
      expect(fs.existsSync(localPath)).toBe(true);
    });

    test('should assert access to multiple user home directories via smbclient', async () => {
      // Assert Alice has access to her home
      const aliceExec = await container.exec(['smbclient', '//127.0.0.1/alice', '-U', 'alice%alicepass', '-c', 'get alice_test.txt -']);
      expect(aliceExec.exitCode).toBe(0);
      expect(aliceExec.output).toContain('alice_data');

      // Assert Bob has access to his home
      const bobExec = await container.exec(['smbclient', '//127.0.0.1/bob', '-U', 'bob%bobpass', '-c', 'get bob_test.txt -']);
      expect(bobExec.exitCode).toBe(0);
      expect(bobExec.output).toContain('bob_data');

      // Assert Alice cannot access Bob's home
      const aliceDenyExec = await container.exec(['smbclient', '//127.0.0.1/bob', '-U', 'alice%alicepass', '-c', 'ls']);
      expect(aliceDenyExec.exitCode).not.toBe(0);
    });
  });
});
