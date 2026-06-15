import { describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { BASE_DIR, fetchWithTimeout, formatRemoteBase, trimSlashes } from './index';
import { getOs } from './os';

const macOs = () => ({ ...getOs(), isMac: true, isWindows: false, isLinux: false });
const winOs = () => ({ ...getOs(), isMac: false, isWindows: true, isLinux: false });

describe('index.ts constants', () => {
  describe('BASE_DIR', () => {
    it('should mount inside the Desktop directory', () => {
      expect(BASE_DIR).toContain(path.join(os.homedir(), 'Desktop'));
    });

    it('should use "RDSS Folders" as the default folder name', () => {
      expect(BASE_DIR).toBe(path.join(os.homedir(), 'Desktop', 'RDSS Folders'));
    });

    it('should not point to the home directory root', () => {
      expect(BASE_DIR).not.toBe(path.join(os.homedir(), 'RDSS'));
      expect(BASE_DIR).not.toBe(os.homedir());
    });
  });
});

describe('formatRemoteBase', () => {
  it('prefixes a bare host with smb:// on nix', () => {
    expect(formatRemoteBase('rstore.qut.edu.au', macOs())).toBe('smb://rstore.qut.edu.au');
  });

  it('prefixes a bare host with \\\\ on Windows', () => {
    expect(formatRemoteBase('rstore.qut.edu.au', winOs())).toBe('\\\\rstore.qut.edu.au');
  });

  it('is idempotent for an existing smb:// URL on nix', () => {
    expect(formatRemoteBase('smb://host:445', macOs())).toBe('smb://host:445');
  });

  it('is idempotent for an existing UNC path on Windows', () => {
    expect(formatRemoteBase('\\\\host', winOs())).toBe('\\\\host');
  });

  it('converts an smb:// URL to a UNC path on Windows', () => {
    expect(formatRemoteBase('smb://host/sub', winOs())).toBe('\\\\host\\sub');
  });

  it('converts a UNC path to an smb:// URL on nix', () => {
    expect(formatRemoteBase('\\\\host\\sub', macOs())).toBe('smb://host/sub');
  });
});

describe('trimSlashes', () => {
  it('trims leading and trailing slashes and backslashes', () => {
    expect(trimSlashes('/Projects/')).toBe('Projects');
    expect(trimSlashes('\\\\share\\\\')).toBe('share');
  });

  it('preserves internal separators and unaffected strings', () => {
    expect(trimSlashes('Projects')).toBe('Projects');
    expect(trimSlashes('a/b')).toBe('a/b');
  });

  it('returns an empty string when the input is only separators', () => {
    expect(trimSlashes('///')).toBe('');
    expect(trimSlashes('')).toBe('');
  });
});

describe('fetchWithTimeout', () => {
  it('resolves with the response when fetch completes in time', async () => {
    const res = { ok: true } as Response;
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(fetchWithTimeout('https://example.test/api', {}, 1000)).resolves.toBe(res);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects with a timeout error when the request exceeds the timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(fetchWithTimeout('https://example.test/slow', {}, 10)).rejects.toThrow(
        /timed out after/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
