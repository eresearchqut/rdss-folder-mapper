import { execSync, execFileSync } from 'child_process';
import signale from 'signale';
import { OsInfo } from './os';

export interface Credentials {
  username?: string;
  password?: string;
  adDomain?: string;
}

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

// ─── Linux: secret-tool (full SMB credentials) ───────────────────────────────
// Linux has no native SMB keychain the OS can re-use at mount time, so the app
// continues to store username/password/domain via the Secret Service.

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

export const saveLinuxCredentials = (creds: Credentials, debug: boolean): void => {
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

// ─── macOS: native SMB Internet password ─────────────────────────────────────
// On macOS we don't keep an app-owned credential. Instead we store the SMB
// password as a native Internet password so the OS (NetFS / mount_smbfs) can
// re-authenticate without prompting, and we recover the username from that
// keychain item's account attribute.

/**
 * Save an SMB Internet password to the macOS login keychain so that the OS
 * (NetFS / Finder / mount_smbfs) can re-authenticate to the server natively
 * without prompting on subsequent connections. Best-effort: failures are logged
 * in debug mode but never thrown.
 */
export const saveMacInternetPassword = (
  server: string,
  account: string,
  password: string,
  debug: boolean,
): void => {
  try {
    if (debug) signale.debug(`Saving SMB Internet password for ${server} to macOS keychain...`);
    // -r "smb " is the four-character SMB protocol code (trailing space pads to 4).
    const args = [
      'add-internet-password',
      '-a',
      account,
      '-s',
      server,
      '-r',
      'smb ',
      '-D',
      'Network Password',
      '-w',
      password,
      '-U',
    ];
    execFileSync('security', args, { stdio: debug ? 'pipe' : 'ignore' });
  } catch (e) {
    let msg = (e as Error).message;
    msg = msg.split(password).join('***');
    if (debug) signale.debug('Failed to save Internet password to macOS keychain:', msg);
  }
};

/**
 * Recover the account (username) stored on the SMB Internet password for the
 * given server. Reads only the item's attributes (no -w), so it does not trigger
 * a keychain authorisation prompt. Returns undefined if no item exists.
 */
export const getMacInternetPasswordAccount = (
  server: string,
  debug: boolean,
): string | undefined => {
  try {
    if (debug) signale.debug(`Reading SMB Internet password account for ${server}...`);
    const out = execFileSync(
      'security',
      ['find-internet-password', '-s', server, '-r', 'smb '],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = out.match(/"acct"<blob>="([^"]+)"/);
    return match ? match[1] : undefined;
  } catch (e) {
    if (debug) signale.debug('No SMB Internet password account found:', (e as Error).message);
    return undefined;
  }
};

/**
 * Remove the SMB Internet password for the given server from the macOS keychain.
 * Best-effort: failures are logged in debug mode but never thrown.
 */
export const clearMacInternetPassword = (server: string, debug: boolean): void => {
  try {
    if (debug) signale.debug(`Clearing SMB Internet password for ${server} from macOS keychain...`);
    execFileSync('security', ['delete-internet-password', '-s', server, '-r', 'smb '], {
      stdio: debug ? 'pipe' : 'ignore',
    });
  } catch (e) {
    if (debug) signale.debug('Failed to clear Internet password from macOS keychain:', (e as Error).message);
  }
};

// ─── Cross-platform dispatchers ──────────────────────────────────────────────
// Only Linux stores app-owned credentials. macOS relies on the native Internet
// password (handled directly in the mount flow) and Windows relies on the
// logged-in session identity, so both return empty / no-op here.

export const getCredentialsFromKeychain = (debug: boolean, osInfo: OsInfo): Credentials => {
  if (osInfo.isLinux) {
    return getLinuxCredentials(debug);
  }
  return {};
};

export const saveCredentialsToKeychain = (
  creds: Credentials,
  debug: boolean,
  osInfo: OsInfo,
): void => {
  if (osInfo.isLinux) {
    saveLinuxCredentials(creds, debug);
    return;
  }
  if (debug) {
    signale.debug('Credential storage is OS-native on this platform; skipping app keychain save.');
  }
};

export const clearCredentialsFromKeychain = (
  debug: boolean,
  osInfo: OsInfo,
  server?: string,
): void => {
  if (osInfo.isLinux) {
    clearLinuxCredentials(debug);
    return;
  }
  if (osInfo.isMac && server) {
    clearMacInternetPassword(server, debug);
    return;
  }
  if (debug) {
    signale.debug('No app-owned credentials to clear on this platform.');
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
