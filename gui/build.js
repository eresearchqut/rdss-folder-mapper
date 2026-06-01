// eslint-disable-next-line @typescript-eslint/no-require-imports
const { build } = require('esbuild');
const path = require('path');

// Directly alias the workspace package to its compiled entry point,
// bypassing npm symlink resolution which is unreliable in CI environments.
const alias = {
  'rdss-folder-mapper': path.resolve(__dirname, '../cli/dist/index.js'),
};
const shared = {
  bundle: true,
  platform: 'node',
  external: ['electron'],
  alias,
};

Promise.all([
  build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.js', ...shared }),
  build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js', ...shared }),
  build({ entryPoints: ['src/worker.ts'], outfile: 'dist/worker.js', ...shared }),
]).catch(() => process.exit(1));
