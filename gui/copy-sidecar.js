// Copies the prebuilt CLI SEA binary into src-tauri/binaries with the
// platform target-triple suffix that Tauri's externalBin resolver expects.
//
// The CLI is built (cli/dist/rdss-folder-mapper-{linux,macos,win.exe}) for x64
// only; on Apple Silicon the macOS x64 binary runs under Rosetta, so we still
// publish it under the aarch64 triple for local development.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ext = process.platform === 'win32' ? '.exe' : '';
const triple = execSync('rustc --print host-tuple').toString().trim();
if (!triple) {
  console.error('Failed to determine host target triple');
  process.exit(1);
}

const cliDist = path.resolve(__dirname, '../cli/dist');
const sourceName = {
  win32: 'rdss-folder-mapper-win.exe',
  darwin: 'rdss-folder-mapper-macos',
  linux: 'rdss-folder-mapper-linux',
}[process.platform];

if (!sourceName) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

const source = path.join(cliDist, sourceName);
if (!fs.existsSync(source)) {
  console.error(`CLI binary not found at ${source}. Build it first: npm run build --workspace=cli`);
  process.exit(1);
}

const binDir = path.resolve(__dirname, 'src-tauri/binaries');
fs.mkdirSync(binDir, { recursive: true });
const dest = path.join(binDir, `rdss-folder-mapper-${triple}${ext}`);
fs.copyFileSync(source, dest);
if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);

console.log(`Sidecar ready: ${path.relative(process.cwd(), dest)}`);
