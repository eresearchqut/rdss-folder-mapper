import { parentPort } from 'worker_threads';
import { refresh, reset, getOs, clearCredentialsFromKeychain } from 'rdss-folder-mapper';
import type { RefreshEvent } from 'rdss-folder-mapper';

const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

const send = (msg: object) => parentPort?.postMessage(msg);

// Intercept stdout/stderr so CLI log output reaches the renderer.
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);

const capture =
  (original: typeof process.stdout.write) =>
  (buffer: Uint8Array | string, ...args: unknown[]): boolean => {
    const line = stripAnsi(buffer.toString()).trimEnd();
    if (line) send({ type: 'log', line });
    return (original as (...a: unknown[]) => boolean)(buffer, ...args);
  };

process.stdout.write = capture(origOut) as typeof process.stdout.write;
process.stderr.write = capture(origErr) as typeof process.stderr.write;

interface WorkerConfig {
  debug: boolean;
  baseDir: string;
  remotePath?: string;
  apiUrl?: string;
  clientId?: string;
  authDomain?: string;
  callbackUrls?: string[];
  adDomain?: string;
}

parentPort?.on('message', async ({ type, config }: { type: string; config: WorkerConfig }) => {
  const prevExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    if (type === 'refresh') {
      await refresh({
        debug: config.debug,
        baseDir: config.baseDir,
        remotePath: config.remotePath,
        apiUrl: config.apiUrl,
        clientId: config.clientId,
        authDomain: config.authDomain,
        callbackUrls: config.callbackUrls,
        adDomain: config.adDomain,
        refresh: true,
        onProgress: (current: number, total: number, folderName: string) => {
          send({ type: 'progress', current, total, folderName });
        },
        onEvent: (event: RefreshEvent) => {
          send({ type: 'event', event });
        },
      });
    } else if (type === 'reset') {
      reset(config.debug, config.baseDir, getOs());
    } else if (type === 'clear-auth') {
      clearCredentialsFromKeychain(config.debug, getOs());
    }
    send({ type: 'done', success: process.exitCode === 0 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'log', line: `✗ ${msg}` });
    send({ type: 'done', success: false });
  } finally {
    process.exitCode = prevExitCode;
  }
});
