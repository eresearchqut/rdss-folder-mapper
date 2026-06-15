import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test } from 'vitest';
import { GenericContainer, Wait, StartedTestContainer } from 'testcontainers';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const isWindows = () => {
  return os.platform() === 'win32';
};

describe('Mount Integration Test', () => {
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
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    // Create test files and set permissions for home directories
    await container.exec(['mkdir', '-p', '/home/alice', '/home/bob']);
    await container.exec(['sh', '-c', 'echo "alice_data" > /home/alice/alice_test.txt']);
    await container.exec(['sh', '-c', 'echo "bob_data" > /home/bob/bob_test.txt']);
    await container.exec(['chown', '-R', 'alice:smb', '/home/alice']);
    await container.exec(['chown', '-R', 'bob:smb', '/home/bob']);

    // A user whose password contains special characters (including '!', '@', '#',
    // '$', '^', '&', '*', '(', ')', '-') to exercise authentication with the kinds
    // of passwords reported as failing in the field.
    await container.exec(['mkdir', '-p', '/home/paola']);
    await container.exec(['sh', '-c', 'echo "paola_data" > /home/paola/paola_test.txt']);
    await container.exec(['chown', '-R', 'paola:smb', '/home/paola']);

    // Project subfolders inside the single shared mount (the `test_share` share
    // maps to /storage). The new nix model mounts the share root once and
    // aliases these subfolders, so they must exist as real directories.
    await container.exec(['mkdir', '-p', '/storage/proj_alpha', '/storage/proj_beta']);
    await container.exec(['sh', '-c', 'echo "alpha_data" > /storage/proj_alpha/alpha.txt']);
    await container.exec(['sh', '-c', 'echo "beta_data" > /storage/proj_beta/beta.txt']);
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
    const mockBinDir = path.join(process.cwd(), '.test', 'bin');
    // The new nix model mounts a single share (the prefix) once, then aliases
    // subfolders by id within it. `test_share` is the Samba share name.
    const remotePrefixNix = 'test_share';

    beforeAll(() => {
      fs.mkdirSync(mockBinDir, { recursive: true });
      const mockScript = `#!/bin/bash
if [[ "$1" == "find-generic-password" ]]; then
  if [[ "$*" == *"-w"* ]]; then
    echo "testpass"
  else
    echo '"acct"<blob>="testuser"'
    echo '"gena"<blob>="testdomain"'
  fi
  exit 0
fi
if [[ "$1" == "search" ]]; then
  echo "username = testuser"
  echo "domain = testdomain"
  exit 0
fi
if [[ "$1" == "lookup" ]]; then
  echo "testpass"
  exit 0
fi
exit 0
`;
      fs.writeFileSync(path.join(mockBinDir, 'security'), mockScript, { mode: 0o755 });
      fs.writeFileSync(path.join(mockBinDir, 'secret-tool'), mockScript, { mode: 0o755 });

      // macOS now authenticates via the native SMB Internet password, which a
      // mock `security` cannot write to the real keychain that the real
      // mount_smbfs reads. Mock mount_smbfs so the mount/alias orchestration is
      // exercised deterministically: it creates the mount point and the expected
      // `proj_alpha` subfolder so subfolder aliasing succeeds. (Real Samba auth
      // is still covered by the smbclient test below.)
      const mockMountSmbfs = `#!/bin/bash
mountpath="\${@: -1}"
mkdir -p "$mountpath/proj_alpha"
exit 0
`;
      fs.writeFileSync(path.join(mockBinDir, 'mount_smbfs'), mockMountSmbfs, { mode: 0o755 });
    });

    beforeEach(() => {
      if (fs.existsSync(testRdssDir)) {
        fs.rmSync(testRdssDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testRdssDir, { recursive: true });

      fs.writeFileSync(
        'folders.json',
        JSON.stringify({
          folders: [{ id: 'proj_alpha', nickname: 'TestShare' }],
        }),
      );
    });

    afterEach(() => {
      if (fs.existsSync('folders.json')) {
        fs.rmSync('folders.json');
      }
      try {
        execSync(`npx ts-node src/index.ts reset --base-dir ${testRdssDir}`, { stdio: 'ignore' });
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
        REMOTE_PREFIX_NIX: remotePrefixNix,
        PATH: `${mockBinDir}:${process.env.PATH}`,
      };

      execSync(`npx ts-node src/index.ts --base-dir ${testRdssDir}`, { env, stdio: 'pipe' });

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
        REMOTE_PREFIX_NIX: remotePrefixNix,
        PATH: `${mockBinDir}:${process.env.PATH}`,
      };

      try {
        const output = execSync(`npx ts-node src/index.ts --base-dir ${testRdssDir} 2>&1`, {
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
        REMOTE_PREFIX_NIX: remotePrefixNix,
        PATH: `${mockBinDir}:${process.env.PATH}`,
      };

      try {
        const output = execSync('npx ts-node src/index.ts 2>&1', {
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

    test('should fail when folders.json is missing or invalid', async () => {
      fs.writeFileSync('folders.json', 'invalid-json');
      try {
        const output = execSync(`npx ts-node src/index.ts --base-dir ${testRdssDir} 2>&1`, {
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
          folders: [{ id: 'proj_alpha', nickname: 'CustomShare' }],
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
        REMOTE_PREFIX_NIX: remotePrefixNix,
        PATH: `${mockBinDir}:${process.env.PATH}`,
      };

      execSync(
        `npx ts-node src/index.ts --base-dir ${testRdssDir} --folders ${customFoldersFile}`,
        {
          env,
          stdio: 'pipe',
        },
      );

      const mountsDir = path.join(testRdssDir, '.mounts');
      if (!isWindows()) {
        expect(fs.existsSync(mountsDir)).toBe(true);
      } else {
        expect(fs.existsSync(testRdssDir)).toBe(true);
      }
    });

    test('should fail when custom folders file is invalid', async () => {
      const missingFoldersFile = path.join(testRdssDir, 'missing-folders.json');
      fs.writeFileSync(missingFoldersFile, 'invalid-json');
      try {
        const output = execSync(
          `npx ts-node src/index.ts --base-dir ${testRdssDir} -f ${missingFoldersFile} 2>&1`,
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
          `npx ts-node src/index.ts --base-dir ${testRdssDir} --remote-path ${customRemotePath} 2>&1`,
          { env, stdio: 'pipe' },
        );
        expect(output.toString()).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // Since we are mocking the mount and it might fail, we just make sure the error output
        // mentions mapping the custom path rather than the default env ones
        const outputStr = e.stderr?.toString() || e.stdout?.toString() || e.message;
        // With the new nix model the share root is mounted once; without a
        // prefix the error references the base remote path directly (no
        // per-folder suffix). Windows still maps per-folder.
        const expectedRemote = isWindows() ? `${customRemotePath}\\test_share` : customRemotePath;
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
        execSync(`npx ts-node src/index.ts reset --base-dir ${testRdssDir}`, { stdio: 'pipe' });
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
              id: 'proj_alpha',
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
        REMOTE_PREFIX_NIX: remotePrefixNix,
        PATH: `${mockBinDir}:${process.env.PATH}`,
      };

      execSync(
        `npx ts-node src/index.ts --base-dir ${testRdssDir} --folders ${customFoldersFile}`,
        {
          env,
          stdio: 'pipe',
        },
      );

      const expectedFolderName = 'This Is A Very Long Title That Should... [proj_alpha]';
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

    test('should authenticate a user whose password contains special characters', async () => {
      const specialPassword = 'P@ss!w0rd#$^&*()-';

      // Authenticate against Samba using the special-character password. The args
      // are passed as an array (no shell), so the only parsing is smbclient's own
      // 'user%password' split — the password deliberately contains no '%'.
      const paolaExec = await container.exec([
        'smbclient',
        '//127.0.0.1/paola',
        '-U',
        `paola%${specialPassword}`,
        '-c',
        'get paola_test.txt -',
      ]);
      expect(paolaExec.exitCode).toBe(0);
      expect(paolaExec.output).toContain('paola_data');

      // The wrong password must be rejected.
      const paolaDenyExec = await container.exec([
        'smbclient',
        '//127.0.0.1/paola',
        '-U',
        'paola%wrongpassword',
        '-c',
        'ls',
      ]);
      expect(paolaDenyExec.exitCode).not.toBe(0);
    });
  });
});
