import { fetchDmpConfig, loadFoldersConfig } from './config';

describe('config', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should be defined', () => {
    expect(fetchDmpConfig).toBeDefined();
    expect(loadFoldersConfig).toBeDefined();
  });

  it('should fetch and parse cli.json correctly', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          port: 3000,
          clientId: '59r7e3s0h3dhkagj34551c0tbr',
          apiUrl: 'https://api-qut.dev.data-management-checklist.info',
          domain: 'auth.dev.data-management-checklist.info',
          callbackUrls: ['http://localhost:3000/callback'],
          scopes: ['phone', 'email', 'profile', 'openid', 'aws.cognito.signin.user.admin'],
        }),
    });

    const config = await fetchDmpConfig('http://localhost:3000');
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/cli.json');
    expect(config).toEqual({
      port: 3000,
      clientId: '59r7e3s0h3dhkagj34551c0tbr',
      apiUrl: 'https://api-qut.dev.data-management-checklist.info',
      domain: 'auth.dev.data-management-checklist.info',
      callbackUrls: ['http://localhost:3000/callback'],
      scopes: ['phone', 'email', 'profile', 'openid', 'aws.cognito.signin.user.admin'],
    });
  });
});
