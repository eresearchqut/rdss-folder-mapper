import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { loadFoldersConfig } from './config';

// ─── loadFoldersConfig ────────────────────────────────────────────────────────

describe('loadFoldersConfig', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('returns a FolderMapping array from a URL-fetched folders.json object', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({ folders: [{ id: 'abc', title: 'Project A' }] }),
        ),
    });

    const folders = await loadFoldersConfig('https://example.com/folders.json', false);
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe('abc');
  });

  it('handles a flat array folders.json', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify([{ id: 'flat', title: 'Flat Project' }])),
    });

    const folders = await loadFoldersConfig('https://example.com/folders.json', false);
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe('flat');
  });
});
