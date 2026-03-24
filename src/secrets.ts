import { execSync, execFileSync } from 'child_process';
import signale from 'signale';
import { OsInfo } from './os';

export interface Credentials {
  username?: string;
  password?: string;
  domain?: string;
}

export const getMacCredentials = (debug: boolean): Credentials => {
  try {
    if (debug) signale.debug('Attempting to read credentials from macOS keychain...');
    const stdout = execSync('security find-generic-password -s "rdss-folder-mapper"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const stderr = execSync('security find-generic-password -s "rdss-folder-mapper" -w', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const accountMatch = stdout.match(/"acct"<blob>="([^"]+)"/);
    const domainMatch =
      stdout.match(/"gena"<blob>="([^"]+)"/) || stdout.match(/"icmt"<blob>="([^"]+)"/);
    const password = stderr.trim();
    if (accountMatch && password) {
      if (debug) signale.debug('Credentials successfully retrieved from macOS keychain.');
      let username = accountMatch[1];
      let domain = domainMatch ? domainMatch[1] : undefined;
      if (!domain && username.includes('\\')) {
        const parts = username.split('\\');
        domain = parts[0];
        username = parts[1];
      }
      return { username, password, domain };
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read from macOS keychain:', (e as Error).message);
  }
  return {};
};

export const getLinuxCredentials = (debug: boolean): Credentials => {
  try {
    if (debug) signale.debug('Attempting to read credentials from Linux secret-tool...');
    const searchOutput = execSync('secret-tool search --all service rdss-folder-mapper', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const accountMatch = searchOutput.match(/username = (.+)/);
    const domainMatch = searchOutput.match(/domain = (.+)/);
    const password = execSync('secret-tool lookup service rdss-folder-mapper', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (accountMatch && password) {
      if (debug) signale.debug('Credentials successfully retrieved from Linux secret-tool.');
      let username = accountMatch[1].trim();
      let domain = domainMatch ? domainMatch[1].trim() : undefined;
      if (!domain && username.includes('\\')) {
        const parts = username.split('\\');
        domain = parts[0];
        username = parts[1];
      }
      return { username, password, domain };
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read from Linux secret-tool:', (e as Error).message);
  }
  return {};
};

export const getCredentialsFromKeychain = (
  debug: boolean,
  osInfo: OsInfo,
): Credentials => {
  if (osInfo.isMac) {
    return getMacCredentials(debug);
  } else if (!osInfo.isWindows) {
    return getLinuxCredentials(debug);
  }
  return {};
};

export const saveMacCredentials = (
  creds: Credentials,
  debug: boolean,
): void => {
  try {
    if (debug) signale.debug('Saving credentials to macOS keychain...');
    const args = ['add-generic-password', '-s', 'rdss-folder-mapper', '-U'];
    if (creds.username) args.push('-a', creds.username);
    if (creds.password) args.push('-w', creds.password);
    if (creds.domain) args.push('-j', creds.domain);
    execFileSync('security', args, { stdio: debug ? 'pipe' : 'ignore' });
  } catch (e) {
    let msg = (e as Error).message;
    if (creds.password) {
      msg = msg.split(creds.password).join('***');
      msg = msg.split(encodeURIComponent(creds.password)).join('***');
    }
    if (debug) signale.debug('Failed to save to macOS keychain:', msg);
  }
};

export const saveLinuxCredentials = (
  creds: Credentials,
  debug: boolean,
): void => {
  try {
    if (debug) signale.debug('Saving credentials to Linux secret-tool...');
    const args = ['store', '--label=RDSS Folder Mapper', 'service', 'rdss-folder-mapper'];
    if (creds.username) args.push('username', creds.username);
    if (creds.domain) args.push('domain', creds.domain);
    execFileSync('secret-tool', args, {
      input: creds.password,
      stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore'],
    });
  } catch (e) {
    if (debug) signale.debug('Failed to save to Linux secret-tool:', (e as Error).message);
  }
};

export const saveCredentialsToKeychain = (
  creds: Credentials,
  debug: boolean,
  osInfo: OsInfo,
): void => {
  if (osInfo.isMac) {
    saveMacCredentials(creds, debug);
  } else if (!osInfo.isWindows) {
    saveLinuxCredentials(creds, debug);
  } else {
    if (debug) signale.debug('Keychain storage is not supported on Windows.');
  }
};

export const getTokenFromKeychain = (debug: boolean, osInfo: OsInfo): string | undefined => {
  try {
    if (osInfo.isMac) {
      const stdout = execSync('security find-generic-password -s "rdss-folder-mapper-token" -w', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return stdout.trim();
    } else if (!osInfo.isWindows) {
      const password = execSync('secret-tool lookup service rdss-folder-mapper-token', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return password.trim();
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read token from keychain:', (e as Error).message);
  }
  return undefined;
};

export const saveTokenToKeychain = (token: string, debug: boolean, osInfo: OsInfo): void => {
  try {
    if (osInfo.isMac) {
      execSync(
        'security add-generic-password -s "rdss-folder-mapper-token" -a "oauth_token" -w "' +
          token +
          '" -U',
        { stdio: debug ? 'pipe' : 'ignore' },
      );
    } else if (!osInfo.isWindows) {
      execSync(
        'secret-tool store --label="RDSS Folder Mapper Token" service rdss-folder-mapper-token',
        {
          input: token,
          stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore'],
        },
      );
    }
  } catch (e) {
    if (debug) signale.debug('Failed to save token to keychain:', (e as Error).message);
  }
};

export const clearMacCredentials = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing credentials from macOS keychain...');
    execSync('security delete-generic-password -s "rdss-folder-mapper"', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear macOS keychain:', (e as Error).message);
  }
};

export const clearLinuxCredentials = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing credentials from Linux secret-tool...');
    execSync('secret-tool clear service rdss-folder-mapper', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear Linux secret-tool:', (e as Error).message);
  }
};

export const clearCredentialsFromKeychain = (debug: boolean, osInfo: OsInfo): void => {
  if (osInfo.isMac) {
    clearMacCredentials(debug);
  } else if (!osInfo.isWindows) {
    clearLinuxCredentials(debug);
  } else {
    if (debug) signale.debug('Keychain storage is not supported on Windows.');
  }
};
