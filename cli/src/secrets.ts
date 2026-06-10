import { execSync, execFileSync } from 'child_process';
import signale from 'signale';
import { OsInfo } from './os';

export interface Credentials {
  username?: string;
  password?: string;
  adDomain?: string;
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
      const domainHint = domainMatch ? domainMatch[1] : undefined;
      const { username, adDomain } = splitDomainFromUsername(accountMatch[1], domainHint);
      return { username, password, adDomain };
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
      const domainHint = domainMatch ? domainMatch[1].trim() : undefined;
      const { username, adDomain } = splitDomainFromUsername(accountMatch[1].trim(), domainHint);
      return { username, password, adDomain };
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read from Linux secret-tool:', (e as Error).message);
  }
  return {};
};

const CREDENTIAL_RESOURCE = 'rdss-folder-mapper';
const TOKEN_RESOURCE = 'rdss-folder-mapper-token';
const TOKEN_ACCOUNT = 'oauth_token';

const splitDomainFromUsername = (
  username: string,
  adDomain?: string,
): { username: string; adDomain?: string } => {
  if (!adDomain && username.includes('\\')) {
    const [domainPart, ...rest] = username.split('\\');
    return { username: rest.join('\\'), adDomain: domainPart };
  }
  return { username, adDomain };
};

export const getWindowsCredentials = (debug: boolean): Credentials => {
  try {
    if (debug) signale.debug('Reading credentials from Windows Credential Manager...');
    const ps = [
      `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
      `$v=New-Object Windows.Security.Credentials.PasswordVault`,
      `$c=$v.FindAllByResource('${CREDENTIAL_RESOURCE}')[0]`,
      `$c.RetrievePassword()`,
      `Write-Output $c.UserName`,
      `Write-Output $c.Password`,
    ].join(';');
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = out.split(/\r?\n/);
    const rawUsername = (lines[0] || '').trim();
    const password = lines.slice(1).join('\n').trim();
    if (rawUsername && password) {
      if (debug) signale.debug('Credentials successfully retrieved from Windows Credential Manager.');
      const { username, adDomain } = splitDomainFromUsername(rawUsername);
      return { username, password, adDomain };
    }
  } catch (e) {
    if (debug) signale.debug('Failed to read from Windows Credential Manager:', (e as Error).message);
  }
  return {};
};

export const getCredentialsFromKeychain = (
  debug: boolean,
  osInfo: OsInfo,
): Credentials => {
  if (osInfo.isMac) {
    return getMacCredentials(debug);
  } else if (osInfo.isWindows) {
    return getWindowsCredentials(debug);
  }
  return getLinuxCredentials(debug);
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
    if (creds.adDomain) args.push('-j', creds.adDomain);
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
    if (creds.adDomain) args.push('domain', creds.adDomain);
    execFileSync('secret-tool', args, {
      input: creds.password,
      stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore'],
    });
  } catch (e) {
    if (debug) signale.debug('Failed to save to Linux secret-tool:', (e as Error).message);
  }
};

export const saveWindowsCredentials = (creds: Credentials, debug: boolean): void => {
  try {
    if (debug) signale.debug('Saving credentials to Windows Credential Manager...');
    const userName = creds.adDomain ? `${creds.adDomain}\\${creds.username ?? ''}` : creds.username ?? '';
    // Single-quoted PowerShell literals are injection-safe once embedded single
    // quotes are doubled; no other metacharacters are interpreted.
    const escUser = userName.replace(/'/g, "''");
    const escPass = (creds.password ?? '').replace(/'/g, "''");
    const ps = [
      `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
      `$v=New-Object Windows.Security.Credentials.PasswordVault`,
      `try{$v.FindAllByResource('${CREDENTIAL_RESOURCE}')|%{$v.Remove($_)}}catch{}`,
      `$c=New-Object Windows.Security.Credentials.PasswordCredential('${CREDENTIAL_RESOURCE}','${escUser}','${escPass}')`,
      `$v.Add($c)`,
    ].join(';');
    execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    let msg = (e as Error).message;
    if (creds.password) {
      msg = msg.split(creds.password).join('***');
    }
    if (debug) signale.debug('Failed to save to Windows Credential Manager:', msg);
  }
};

export const saveCredentialsToKeychain = (
  creds: Credentials,
  debug: boolean,
  osInfo: OsInfo,
): void => {
  if (osInfo.isMac) {
    saveMacCredentials(creds, debug);
  } else if (osInfo.isWindows) {
    saveWindowsCredentials(creds, debug);
  } else {
    saveLinuxCredentials(creds, debug);
  }
};

export const getWindowsToken = (debug: boolean): string | undefined => {
  try {
    if (debug) signale.debug('Reading OAuth token from Windows Credential Manager...');
    const ps = [
      `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
      `$v=New-Object Windows.Security.Credentials.PasswordVault`,
      `$c=$v.Retrieve('${TOKEN_RESOURCE}','${TOKEN_ACCOUNT}')`,
      `$c.RetrievePassword()`,
      `Write-Output $c.Password`,
    ].join(';');
    const token = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return token || undefined;
  } catch (e) {
    if (debug) signale.debug('Failed to read token from Windows Credential Manager:', (e as Error).message);
    return undefined;
  }
};

export const saveWindowsToken = (token: string, debug: boolean): void => {
  try {
    if (debug) signale.debug('Saving OAuth token to Windows Credential Manager...');
    // Single-quoted PowerShell literals are injection-safe once embedded single
    // quotes are doubled; no other metacharacters are interpreted.
    const escToken = token.replace(/'/g, "''");
    const ps = [
      `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
      `$v=New-Object Windows.Security.Credentials.PasswordVault`,
      `try{$v.FindAllByResource('${TOKEN_RESOURCE}')|%{$v.Remove($_)}}catch{}`,
      `$c=New-Object Windows.Security.Credentials.PasswordCredential('${TOKEN_RESOURCE}','${TOKEN_ACCOUNT}','${escToken}')`,
      `$v.Add($c)`,
    ].join(';');
    execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    let msg = (e as Error).message;
    if (token) {
      msg = msg.split(token).join('***');
    }
    if (debug) signale.debug('Failed to save token to Windows Credential Manager:', msg);
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
    } else if (osInfo.isWindows) {
      return getWindowsToken(debug);
    } else {
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
      // Use execFileSync with an argument array — never interpolate the token into a shell string.
      execFileSync(
        'security',
        ['add-generic-password', '-s', 'rdss-folder-mapper-token', '-a', 'oauth_token', '-w', token, '-U'],
        { stdio: debug ? 'pipe' : 'ignore' },
      );
    } else if (osInfo.isWindows) {
      saveWindowsToken(token, debug);
    } else {
      // Token is passed via stdin, not as a shell argument, to avoid any injection.
      execFileSync(
        'secret-tool',
        ['store', '--label=RDSS Folder Mapper Token', 'service', 'rdss-folder-mapper-token'],
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

export const clearMacToken = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing OAuth token from macOS keychain...');
    execSync('security delete-generic-password -s "rdss-folder-mapper-token"', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear macOS token:', (e as Error).message);
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

export const clearLinuxToken = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing OAuth token from Linux secret-tool...');
    execSync('secret-tool clear service rdss-folder-mapper-token', {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear Linux token:', (e as Error).message);
  }
};

export const clearWindowsCredentials = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing credentials from Windows Credential Manager...');
    const ps = [
      `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
      `$v=New-Object Windows.Security.Credentials.PasswordVault`,
      `try{$v.FindAllByResource('${CREDENTIAL_RESOURCE}')|%{$v.Remove($_)}}catch{}`,
    ].join(';');
    execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear Windows Credential Manager:', (e as Error).message);
  }
};

export const clearWindowsToken = (debug: boolean): void => {
  try {
    if (debug) signale.debug('Clearing OAuth token from Windows Credential Manager...');
    const ps = [
      `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
      `$v=New-Object Windows.Security.Credentials.PasswordVault`,
      `try{$v.FindAllByResource('${TOKEN_RESOURCE}')|%{$v.Remove($_)}}catch{}`,
    ].join(';');
    execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear Windows token:', (e as Error).message);
  }
};

export const clearCredentialsFromKeychain = (debug: boolean, osInfo: OsInfo): void => {
  if (osInfo.isMac) {
    clearMacCredentials(debug);
    clearMacToken(debug);
  } else if (osInfo.isWindows) {
    clearWindowsCredentials(debug);
    clearWindowsToken(debug);
  } else {
    clearLinuxCredentials(debug);
    clearLinuxToken(debug);
  }
};

// ─── Deployment config keychain ───────────────────────────────────────────────

const DEPLOYMENT_SERVICE = 'rdss-folder-mapper-config';
const DEPLOYMENT_ACCOUNT = 'deployment';

/**
 * Read the IT-provisioned deployment config JSON string from the OS keychain.
 * Returns undefined when no entry exists or the platform is unsupported.
 */
export const getDeploymentConfigJson = (debug: boolean, osInfo: OsInfo): string | undefined => {
  try {
    if (osInfo.isMac) {
      if (debug) signale.debug('Reading deployment config from macOS keychain…');
      const json = execSync(
        `security find-generic-password -s "${DEPLOYMENT_SERVICE}" -a "${DEPLOYMENT_ACCOUNT}" -w`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      return json || undefined;
    } else if (osInfo.isWindows) {
      if (debug) signale.debug('Reading deployment config from Windows Credential Manager…');
      const ps = [
        `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
        `$v=New-Object Windows.Security.Credentials.PasswordVault`,
        `$c=$v.Retrieve('${DEPLOYMENT_SERVICE}','${DEPLOYMENT_ACCOUNT}')`,
        `$c.RetrievePassword()`,
        `Write-Output $c.Password`,
      ].join(';');
      const json = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return json || undefined;
    } else {
      if (debug) signale.debug('Reading deployment config from Linux secret-tool…');
      const json = execFileSync(
        'secret-tool',
        ['lookup', 'service', DEPLOYMENT_SERVICE, 'account', DEPLOYMENT_ACCOUNT],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      return json || undefined;
    }
  } catch (e) {
    if (debug) signale.debug('Deployment config not found in keychain:', (e as Error).message);
    return undefined;
  }
};

/**
 * Store the deployment config JSON string in the OS keychain.
 * Called by the provisioning script; not called by the app itself.
 */
export const saveDeploymentConfigJson = (json: string, debug: boolean, osInfo: OsInfo): void => {
  try {
    if (osInfo.isMac) {
      if (debug) signale.debug('Saving deployment config to macOS keychain…');
      execFileSync(
        'security',
        [
          'add-generic-password',
          '-s', DEPLOYMENT_SERVICE,
          '-a', DEPLOYMENT_ACCOUNT,
          '-w', json,
          '-U', // update if exists
        ],
        { stdio: debug ? 'pipe' : 'ignore' },
      );
    } else if (osInfo.isWindows) {
      if (debug) signale.debug('Saving deployment config to Windows Credential Manager…');
      const escaped = json.replace(/'/g, "''");
      const ps = [
        `[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]|Out-Null`,
        `$v=New-Object Windows.Security.Credentials.PasswordVault`,
        `try{$old=$v.Retrieve('${DEPLOYMENT_SERVICE}','${DEPLOYMENT_ACCOUNT}');$v.Remove($old)}catch{}`,
        `$c=New-Object Windows.Security.Credentials.PasswordCredential('${DEPLOYMENT_SERVICE}','${DEPLOYMENT_ACCOUNT}','${escaped}')`,
        `$v.Add($c)`,
      ].join(';');
      execFileSync('powershell', ['-NoProfile', '-Command', ps], {
        stdio: debug ? 'pipe' : 'ignore',
      });
    } else {
      if (debug) signale.debug('Saving deployment config to Linux secret-tool…');
      execFileSync(
        'secret-tool',
        ['store', '--label=RDSS Folder Mapper Config', 'service', DEPLOYMENT_SERVICE, 'account', DEPLOYMENT_ACCOUNT],
        { input: json, stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore'] },
      );
    }
  } catch (e) {
    if (debug) signale.debug('Failed to save deployment config to keychain:', (e as Error).message);
    throw e;
  }
};
