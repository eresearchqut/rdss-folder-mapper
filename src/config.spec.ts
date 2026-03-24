import { fetchDmpConfig, loadFoldersConfig } from './config';

describe('config', () => {
  it('should be defined', () => {
    expect(fetchDmpConfig).toBeDefined();
    expect(loadFoldersConfig).toBeDefined();
  });
});
