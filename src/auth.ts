import signale from 'signale';
import { getTokenFromKeychain, saveTokenToKeychain } from './secrets';
import { OsInfo } from './os';
import { DmpConfig } from './config';

export interface LoginOptions {
  dmpConfig: DmpConfig;
  debug: boolean;
  force?: boolean;
}

let fetchMiddlewareSetup = false;
export const setupFetchMiddleware = (debug: boolean) => {
  if (!debug || fetchMiddlewareSetup) return;
  fetchMiddlewareSetup = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof originalFetch>) => {
    const [input, init] = args;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url;
    const method = init?.method || 'GET';
    let reqHeaders = '{}';
    if (init?.headers) {
      reqHeaders =
        init.headers instanceof Headers
          ? JSON.stringify(Object.fromEntries(init.headers.entries()))
          : JSON.stringify(init.headers);
    }
    signale.debug(`[fetch request] ${method} ${url} Headers: ${reqHeaders}`);
    const response = await originalFetch(...args);
    const resHeaders = JSON.stringify(Object.fromEntries(response.headers.entries()));
    signale.debug(
      `[fetch response] ${method} ${url} - Status: ${response.status} ${response.statusText} Headers: ${resHeaders}`,
    );
    return response;
  };
};

export const performLogin = async (options: LoginOptions, osInfo: OsInfo): Promise<string | undefined> => {
  const { dmpConfig, debug, force } = options;
  const { clientId, domain } = dmpConfig;
  const authUrl = `https://${domain}/oauth2/authorize`;
  const tokenUrl = `https://${domain}/oauth2/token`;

  setupFetchMiddleware(debug);

  if (!osInfo.isWindows && !force) {
    const existingToken = getTokenFromKeychain(debug, osInfo);
    if (existingToken) {
      try {
        const payloadBase64 = existingToken.split('.')[1];
        if (payloadBase64) {
          const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
          const payload = JSON.parse(payloadJson);
          if (!payload.exp || payload.exp * 1000 > Date.now()) {
            if (debug) signale.debug('Valid token found in keychain.');
            return existingToken;
          }
        }
      } catch {
        if (debug) signale.debug('Failed to parse existing token from keychain.');
      }
    }
  }

  if (!domain || !clientId) {
    signale.error(
      'Missing required OAuth parameters. Please ensure DMP config has a domain and client id.',
    );
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

  if (!dmpConfig.callbackUrls || dmpConfig.callbackUrls.length === 0) {
    signale.error('No callbackUrls provided in DMP config.');
    process.exit(1);
  }

  const redirectUriObj = new URL(dmpConfig.callbackUrls[Math.floor(Math.random() * dmpConfig.callbackUrls.length)]);

  const redirectUri = redirectUriObj.toString();
  const serverPort = redirectUriObj.port ? parseInt(redirectUriObj.port, 10) : 80;
  const expectedPath = redirectUriObj.pathname || '/';

  const scope = 'phone email profile openid aws.cognito.signin.user.admin';
  const fullAuthUrl = `${authUrl}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;

  return new Promise((resolve) => {
    const server = http.createServer(
      async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
        try {
          const parsedUrl = new URL(req.url, `http://localhost:${serverPort}`);
          if (parsedUrl.pathname === expectedPath) {
            const code = parsedUrl.searchParams.get('code');
            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; color: #333; }
    .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    h2 { color: #4CAF50; margin-top: 0; }
    .timer { font-size: 24px; font-weight: bold; color: #555; margin: 0 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>DMP Authentication Successful!</h2>
    <p>You can now return to your terminal.</p>
    <p>This window will close automatically in <span id="time" class="timer">5</span> seconds.</p>
  </div>
  <script>
    let timeLeft = 5;
    const timerEl = document.getElementById('time');
    const interval = setInterval(() => {
      timeLeft--;
      timerEl.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(interval);
        window.close();
      }
    }, 1000);
  </script>
</body>
</html>`);

              if (debug) signale.debug('Authorization code received, exchanging for token...');

              try {
                const response = await fetch(tokenUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    client_id: clientId,
                    redirect_uri: redirectUri,
                  }).toString(),
                });

                if (!response.ok) {
                  throw new Error(
                    `HTTP error! status: ${response.status} ${await response.text()}`,
                  );
                }

                const tokenData = (await response.json()) as { id_token?: string };
                if (tokenData.id_token) {
                  if (!osInfo.isWindows) {
                    saveTokenToKeychain(tokenData.id_token, debug, osInfo);
                  }
                  signale.success('Successfully logged in and saved token.');
                  server.close(() => resolve(tokenData.id_token));
                  return;
                } else {
                  signale.error('No id_token found in response.');
                }
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                signale.error('Failed to exchange code for token:', msg);
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
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
      },
    );

    server.listen(serverPort, async () => {
      signale.info(`Listening on ${redirectUri}`);
      signale.info(`Opening browser to ${fullAuthUrl}`);
      try {
        await openPkg(fullAuthUrl);
      } catch {
        signale.error('Failed to open browser, please navigate to the URL manually:', fullAuthUrl);
      }
    });
  });
};
