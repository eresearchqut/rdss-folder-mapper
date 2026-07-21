// eslint-disable-next-line @typescript-eslint/no-require-imports
const { build } = require('esbuild');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
const path = require('path');

// Directly alias the workspace package to its compiled entry point,
// bypassing npm symlink resolution which is unreliable in CI environments.
const alias = {
  'rdss-folder-mapper': path.resolve(__dirname, '../cli/dist/index.js'),
};
// Bake the Umami analytics website id and default host into the bundle at build
// time. Production builds set UMAMI_WEBSITE_ID (from a GitHub Actions secret) and
// UMAMI_HOST; local/dev builds fall back to the shared testing id. There is no
// hardcoded host default: if UMAMI_HOST is unset and no deployment config.json
// provides `umamiHost`, the host resolves to '' and tracking is disabled. The
// renderer POSTs events straight to the Umami collect API, so no remote script is
// bundled or loaded.
const umamiWebsiteId =
  process.env.UMAMI_WEBSITE_ID || 'a1b2ad15-0a5c-444e-a2c1-5bccda473838';
const umamiHost = process.env.UMAMI_HOST || '';

const shared = {
  bundle: true,
  platform: 'node',
  external: ['electron'],
  alias,
  define: {
    'process.env.UMAMI_WEBSITE_ID': JSON.stringify(umamiWebsiteId),
    'process.env.UMAMI_HOST': JSON.stringify(umamiHost),
  },
};

Promise.all([
  build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.js', ...shared }),
  build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js', ...shared }),
  build({ entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js', ...shared }),
])
  .then(() => {
    // Bundle the runtime window icon next to the compiled output so it resolves
    // both in development and inside the packaged asar.
    fs.mkdirSync('dist', { recursive: true });
    fs.copyFileSync('build/icon.png', 'dist/icon.png');
  })
  .catch(() => process.exit(1));
