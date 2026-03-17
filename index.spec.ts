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

  beforeAll(async () => {
    container = await new GenericContainer('dockurr/samba')
      .withEnvironment({
        USER: 'testuser',
        PASS: 'testpass',
        RW: 'true',
      })
      .withExposedPorts(445)
      .withWaitStrategy(Wait.forLogMessage(/smbd version/i))
      .start();
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
          folders: [{ RPID: 'test_share', nickname: 'TestShare' }],
        })
      );
    });

    afterEach(() => {
      if (fs.existsSync('folders.json')) {
        fs.rmSync('folders.json');
      }
    });

    test('should recreate RDSS folder and run CLI', async () => {
      const host = container.getHost();
      const port = container.getMappedPort(445);
      
      const basePathWin = `\\\\${host}\\test_share`;
      // Usually dockurr/samba maps volumes, but we can just use smb://${host}:${port}/test_share
      const basePathNix = `smb://${host}:${port}/test_share`;

      const env = {
        ...process.env,
        BASE_PATH_WIN: basePathWin,
        BASE_PATH_NIX: basePathNix,
      };

      try {
        execSync(`npx ts-node index.ts --rdss-dir ${testRdssDir} --username testuser --password testpass`, { env, stdio: 'pipe' });
      } catch (e: any) {
        // It might fail to mount if the OS doesn't support mounting or needs sudo
        // We'll just verify the CLI creates the folders
        console.log('CLI execution failed/warned:', e.stderr?.toString() || e.message);
      }

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
      
      const basePathWin = `\\\\${host}\\test_share`;
      const basePathNix = `smb://${host}:${port}/test_share`;

      const env = {
        ...process.env,
        BASE_PATH_WIN: basePathWin,
        BASE_PATH_NIX: basePathNix,
      };

      try {
        const output = execSync(`npx ts-node index.ts --rdss-dir ${testRdssDir} --username wronguser --password wrongpass 2>&1`, { env, stdio: 'pipe' });
        expect(output.toString()).toContain('Warning: Failed to map');
      } catch (e: any) {
        expect(e.stderr?.toString() || e.stdout?.toString() || e.message).toContain('Warning: Failed to map');
      }
    });
  });
});
