import * as secrets from './secrets';

describe('secrets', () => {
  it('should have defined methods', () => {
    expect(secrets.getCredentialsFromKeychain).toBeDefined();
    expect(secrets.saveCredentialsToKeychain).toBeDefined();
    expect(secrets.clearCredentialsFromKeychain).toBeDefined();
    expect(secrets.getTokenFromKeychain).toBeDefined();
    expect(secrets.saveTokenToKeychain).toBeDefined();
  });
});
