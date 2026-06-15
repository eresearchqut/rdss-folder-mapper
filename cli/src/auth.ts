import signale from 'signale';
import { createHash, randomBytes } from 'crypto';

export type AuthEvent =
  | { type: 'auth:browser-opened'; url: string }
  | { type: 'auth:complete' };

export interface LoginOptions {
  clientId: string;
  authDomain: string;
  callbackUrls: string[];
  debug: boolean;
  force?: boolean;
  onEvent?: (event: AuthEvent) => void;
}

const REDACTED = '[REDACTED]';

// In-memory OAuth token cache. The token lives only for the lifetime of the
// process (the CLI re-authenticates each run; the GUI worker thread persists for
// its session). It is never written to disk or the OS keychain.
let cachedToken: string | undefined;

const isTokenValid = (token: string): boolean => {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return false;
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    return !payload.exp || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
};

/**
 * Return the cached OAuth token if one is held in memory and has not expired.
 * Expired or missing tokens yield undefined (and clear the cache).
 */
export const getCachedToken = (): string | undefined => {
  if (cachedToken && isTokenValid(cachedToken)) {
    return cachedToken;
  }
  cachedToken = undefined;
  return undefined;
};

export const setCachedToken = (token: string | undefined): void => {
  cachedToken = token;
};

export const redactHeaders = (headers: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = key.toLowerCase() === 'authorization' ? `Bearer ${REDACTED}` : value;
  }
  return result;
};

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
    let reqHeaders: Record<string, string> = {};
    if (init?.headers) {
      reqHeaders =
        init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : (init.headers as Record<string, string>);
    }
    signale.debug(`[fetch request] ${method} ${url} Headers: ${JSON.stringify(redactHeaders(reqHeaders))}`);
    const response = await originalFetch(...args);
    const resHeaders = JSON.stringify(Object.fromEntries(response.headers.entries()));
    signale.debug(
      `[fetch response] ${method} ${url} - Status: ${response.status} ${response.statusText} Headers: ${resHeaders}`,
    );
    return response;
  };
};

export const performLogin = async (options: LoginOptions): Promise<string | undefined> => {
  const { clientId, authDomain, callbackUrls, debug, force, onEvent } = options;
  const authUrl = `https://${authDomain}/oauth2/authorize`;
  const tokenUrl = `https://${authDomain}/oauth2/token`;

  setupFetchMiddleware(debug);

  if (!force) {
    const existingToken = getCachedToken();
    if (existingToken) {
      if (debug) signale.debug('Valid token found in memory.');
      return existingToken;
    }
  }

  if (!authDomain || !clientId) {
    signale.error(
      'Missing required OAuth parameters. Please ensure DMP config has a domain and client id.',
    );
    process.exit(1);
  }

  const http = require('http');

  const { URL } = require('url');
  const { default: openPkg } = await import('open').catch(() => {
    signale.error('Could not load the open module.');
    process.exit(1);
  });

  if (!callbackUrls || callbackUrls.length === 0) {
    signale.error('No callbackUrls provided in config.');
    process.exit(1);
  }

  const redirectUriObj = new URL(callbackUrls[Math.floor(Math.random() * callbackUrls.length)]);

  const hostname = redirectUriObj.hostname;
  const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    signale.error(`Security: Callback URL hostname "${hostname}" is not a loopback address. Only localhost callback URLs are supported.`);
    process.exitCode = 1;
    return undefined;
  }

  const redirectUri = redirectUriObj.toString();
  const serverPort = redirectUriObj.port ? parseInt(redirectUriObj.port, 10) : 80;
  const expectedPath = redirectUriObj.pathname || '/';

  // Generate PKCE code_verifier and code_challenge (RFC 7636 §4.1–4.2)
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const scope = 'phone email profile openid aws.cognito.signin.user.admin';
  const fullAuthUrl = `${authUrl}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&code_challenge_method=S256&code_challenge=${encodeURIComponent(codeChallenge)}`;

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
                    code_verifier: codeVerifier,
                  }).toString(),
                });

                if (!response.ok) {
                  throw new Error(
                    `HTTP error! status: ${response.status} ${await response.text()}`,
                  );
                }

                const tokenData = (await response.json()) as { id_token?: string };
                if (tokenData.id_token) {
                  setCachedToken(tokenData.id_token);
                  signale.success('Successfully logged in.');
                  onEvent?.({ type: 'auth:complete' });
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

    server.listen(serverPort, '127.0.0.1', async () => {
      signale.info(`Listening on ${redirectUri}`);
      signale.info(`Opening browser to ${fullAuthUrl}`);
      try {
        // open v8 uses process.env.SYSTEMROOT with no fallback; ensure it's set on Windows
        if (process.platform === 'win32' && !process.env.SYSTEMROOT) {
          process.env.SYSTEMROOT = process.env.SystemRoot ?? 'C:\\Windows';
        }
        await openPkg(fullAuthUrl);
        onEvent?.({ type: 'auth:browser-opened', url: fullAuthUrl });
      } catch {
        signale.error('Failed to open browser, please navigate to the URL manually:', fullAuthUrl);
      }
    });
  });
};
