// Copies the prebuilt CLI SEA binary into src-tauri/binaries with the
// platform target-triple suffix that Tauri's externalBin resolver expects.
//
// The CLI is built per-arch (cli/dist/rdss-folder-mapper-{linux,macos,win}
// for x64 and -{linux,macos,win}-arm64 for arm64). We pick the binary that
// matches the host architecture, falling back to the x64 build if a native
// arm64 binary has not been built locally.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ext = process.platform === 'win32' ? '.exe' : '';
const triple = execSync('rustc --print host-tuple').toString().trim();
if (!triple) {
  console.error('Failed to determine host target triple');
  process.exit(1);
}

const isArm64 = /^(aarch64|arm64)/.test(triple);

const base = {
  win32: 'rdss-folder-mapper-win',
  darwin: 'rdss-folder-mapper-macos',
  linux: 'rdss-folder-mapper-linux',
}[process.platform];

if (!base) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

const cliDist = path.resolve(__dirname, '../cli/dist');

// Prefer the native arm64 binary, fall back to the x64 build.
const candidates = isArm64 ? [`${base}-arm64${ext}`, `${base}${ext}`] : [`${base}${ext}`];
const sourceName = candidates.find((name) => fs.existsSync(path.join(cliDist, name)));

if (!sourceName) {
  console.error(
    `CLI binary not found in ${cliDist} (looked for: ${candidates.join(', ')}). ` +
      'Build it first: npm run build --workspace=cli',
  );
  process.exit(1);
}

if (isArm64 && sourceName === `${base}${ext}`) {
  console.warn('Native arm64 CLI binary not found; using the x64 build (runs via emulation).');
}

const source = path.join(cliDist, sourceName);
const binDir = path.resolve(__dirname, 'src-tauri/binaries');
fs.mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, `rdss-folder-mapper-${triple}${ext}`);
fs.copyFileSync(source, dest);
if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);

console.log(`Sidecar ready: ${path.relative(process.cwd(), dest)}`);
