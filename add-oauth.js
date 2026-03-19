const fs = require('fs');
let code = fs.readFileSync('index.ts', 'utf8');

// 1. Add token storage/retrieval functions
const tokenFunctions = `
const getTokenFromKeychain = (debug: boolean): string | undefined => {
  try {
    if (isMac()) {
      const stdout = execSync('security find-generic-password -s "rdss-folder-mapper-token" -w', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return stdout.trim();
    } else if (!isWindows()) {
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

const saveTokenToKeychain = (token: string, debug: boolean): void => {
  try {
    if (isMac()) {
      execSync('security add-generic-password -s "rdss-folder-mapper-token" -a "oauth_token" -w "' + token + '" -U', {
        stdio: debug ? 'pipe' : 'ignore'
      });
    } else if (!isWindows()) {
      execSync('secret-tool store --label="RDSS Folder Mapper Token" service rdss-folder-mapper-token', {
        input: token,
        stdio: ['pipe', debug ? 'pipe' : 'ignore', debug ? 'pipe' : 'ignore']
      });
    }
  } catch (e) {
    if (debug) signale.debug('Failed to save token to keychain:', (e as Error).message);
  }
};
`;

code = code.replace(
  'const clearMacCredentials = (debug: boolean): void => {',
  tokenFunctions + '\nconst clearMacCredentials = (debug: boolean): void => {',
);

// 2. Make loadFoldersConfig async and support fetching
const oldLoadFoldersConfig = `const loadFoldersConfig = (foldersFile: string): ConfigData => {
  try {
    const fileData = fs.readFileSync(foldersFile, 'utf8');
    const parsedData = JSON.parse(fileData);
    return {
      folders: parsedData.folders || [],
      remotePath: parsedData.remotePath,
    };
  } catch {
    throw new Error(
      \`Failed to read or parse \${foldersFile}. Please ensure the file exists and is valid JSON.\`,
    );
  }
};`;

const newLoadFoldersConfig = `const loadFoldersConfig = async (foldersFile: string, debug: boolean): Promise<ConfigData> => {
  try {
    let fileData: string;
    if (foldersFile.startsWith('http://') || foldersFile.startsWith('https://')) {
      if (debug) signale.debug(\`Fetching folders config from \${foldersFile}...\`);
      const token = getTokenFromKeychain(debug);
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = \`Bearer \${token}\`;
      }
      const response = await fetch(foldersFile, { headers });
      if (!response.ok) {
        throw new Error(\`HTTP error! status: \${response.status}\`);
      }
      fileData = await response.text();
    } else {
      fileData = fs.readFileSync(foldersFile, 'utf8');
    }
    const parsedData = JSON.parse(fileData);
    return {
      folders: parsedData.folders || [],
      remotePath: parsedData.remotePath,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      \`Failed to read or parse \${foldersFile}. Please ensure the file exists/is reachable and is valid JSON. Details: \${msg}\`,
    );
  }
};`;

code = code.replace(oldLoadFoldersConfig, newLoadFoldersConfig);

// 3. Update refresh function to await loadFoldersConfig
code = code.replace(
  'const configData = loadFoldersConfig(foldersFile);',
  'const configData = await loadFoldersConfig(foldersFile, debug);',
);

// 4. Add login command
const loginCommand = `
program
  .command('login')
  .description('Perform OAuth login to retrieve a token for fetching remote folders.json')
  .option('--auth-url <url>', 'The OAuth authorization URL')
  .option('--token-url <url>', 'The OAuth token exchange URL')
  .option('--client-id <id>', 'The OAuth client ID')
  .option('-p, --port <port>', 'Local port to listen for the callback (default: 3000)', '3000')
  .action(async (options) => {
    if (isWindows()) {
      signale.error('Keychain storage for token is currently only supported on macOS and Linux.');
      process.exit(1);
    }
    const debug = program.opts().debug || false;
    const authUrl = options.authUrl || process.env.RDSS_AUTH_URL;
    const tokenUrl = options.tokenUrl || process.env.RDSS_TOKEN_URL;
    const clientId = options.clientId || process.env.RDSS_CLIENT_ID;
    const port = parseInt(options.port, 10);

    if (!authUrl || !tokenUrl || !clientId) {
      signale.error('Missing required OAuth parameters. Please provide --auth-url, --token-url, and --client-id, or set RDSS_AUTH_URL, RDSS_TOKEN_URL, RDSS_CLIENT_ID environment variables.');
      process.exit(1);
    }

    const http = require('http');
    const { URL } = require('url');
    let openPkg;
    try {
      openPkg = require('open');
    } catch {
      signale.error('Could not load the open module.');
      process.exit(1);
    }

    const redirectUri = \`http://localhost:\${port}/callback\`;
    const fullAuthUrl = \`\${authUrl}?client_id=\${encodeURIComponent(clientId)}&redirect_uri=\${encodeURIComponent(redirectUri)}&response_type=code\`;

    const server = http.createServer(async (req: any, res: any) => {
      try {
        const parsedUrl = new URL(req.url, \`http://localhost:\${port}\`);
        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.searchParams.get('code');
          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>Authentication successful!</h2><p>You can close this window and return to your terminal.</p></body></html>');
            
            if (debug) signale.debug('Authorization code received, exchanging for token...');
            
            try {
              const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  grant_type: 'authorization_code',
                  code,
                  client_id: clientId,
                  redirect_uri: redirectUri
                }).toString()
              });
              
              if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status} \${await response.text()}\`);
              }
              
              const tokenData = await response.json();
              if (tokenData.access_token) {
                saveTokenToKeychain(tokenData.access_token, debug);
                signale.success('Successfully logged in and saved token.');
              } else {
                signale.error('No access_token found in response.');
              }
            } catch (err: any) {
              signale.error('Failed to exchange code for token:', err.message);
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing authorization code.');
            signale.error('No authorization code found in callback.');
          }
          
          server.close(() => process.exit(0));
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });

    server.listen(port, async () => {
      signale.info(\`Listening on \${redirectUri}\`);
      signale.info(\`Opening browser to \${fullAuthUrl}\`);
      try {
        await openPkg(fullAuthUrl);
      } catch (e: any) {
        signale.error('Failed to open browser, please navigate to the URL manually:', fullAuthUrl);
      }
    });
  });
`;

code = code.replace(
  'program.parse(process.argv);',
  loginCommand + '\nprogram.parse(process.argv);',
);

fs.writeFileSync('index.ts', code);
