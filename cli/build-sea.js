const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const admZip = require('adm-zip');
const tar = require('tar');

const NODE_VERSION = process.version;
const DIST_DIR = path.join(__dirname, 'dist');
const TMP_DIR = path.join(__dirname, 'tmp');

const TARGETS = [
  { os: 'linux', arch: 'x64', ext: '', name: 'linux' },
  { os: 'darwin', arch: 'x64', ext: '', name: 'macos' },
  { os: 'win32', arch: 'x64', ext: '.exe', name: 'win' },
];

async function downloadFile(url, dest) {
  if (fs.existsSync(dest)) return;
  console.log(`Downloading ${url}...`);
  execSync(`curl -L -o "${dest}" "${url}"`, { stdio: 'inherit' });
}

async function extractNode(target) {
  let nodeOs = target.os;
  if (target.os === 'win32') nodeOs = 'win';
  if (target.os === 'darwin') nodeOs = 'darwin';

  const isZip = target.os === 'win32';
  const archiveExt = isZip ? '.zip' : '.tar.gz';
  const archiveName = `node-${NODE_VERSION}-${nodeOs}-${target.arch}`;
  const archiveUrl = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}${archiveExt}`;

  const archivePath = path.join(TMP_DIR, `${archiveName}${archiveExt}`);
  const extractDir = path.join(TMP_DIR, archiveName);

  await downloadFile(archiveUrl, archivePath);

  if (!fs.existsSync(extractDir)) {
    console.log(`Extracting ${archivePath}...`);
    if (isZip) {
      const zip = new admZip(archivePath);
      zip.extractAllTo(TMP_DIR, true);
    } else {
      await tar.x({
        file: archivePath,
        C: TMP_DIR,
      });
    }
  }

  const nodeBinaryExt = target.os === 'win32' ? '.exe' : '';
  const nodeBinaryPath = path.join(
    extractDir,
    target.os === 'win32' ? '' : 'bin',
    `node${nodeBinaryExt}`,
  );
  return nodeBinaryPath;
}

async function build() {
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  console.log('Bundling with esbuild...');
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: path.join(DIST_DIR, 'index.bundle.js'),
    format: 'cjs',
    minify: true,
  });

  const seaConfig = {
    main: 'dist/index.bundle.js',
    output: 'dist/sea-prep.blob',
    disableExperimentalSEAWarning: true,
  };
  fs.writeFileSync('sea-config.json', JSON.stringify(seaConfig, null, 2));

  console.log('Generating SEA blob...');
  execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

  for (const target of TARGETS) {
    console.log(`\n--- Building for ${target.os} ---`);
    const nodeBinaryPath = await extractNode(target);

    const execName = `rdss-folder-mapper-${target.name}${target.ext}`;
    const outPath = path.join(DIST_DIR, execName);

    console.log(`Copying node executable to ${outPath}...`);
    fs.copyFileSync(nodeBinaryPath, outPath);

    if (target.os !== 'win32') {
      fs.chmodSync(outPath, 0o755);
    }

    if (target.os === 'darwin') {
      try {
        execSync(`codesign --remove-signature "${outPath}"`, { stdio: 'ignore' });
      } catch {
        // ignore
      }
    }

    console.log(`Injecting blob for ${target.os}...`);
    const machoFlag = target.os === 'darwin' ? ' --macho-segment-name NODE_SEA' : '';
    const postjectCmd = `npx postject "${outPath}" NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${machoFlag}`;
    execSync(postjectCmd, { stdio: 'inherit' });

    if (target.os === 'darwin' && process.platform === 'darwin') {
      console.log('Re-signing executable for macOS...');
      try {
        execSync(`codesign --sign - "${outPath}"`, { stdio: 'inherit' });
      } catch {
        console.warn('Failed to codesign on macOS. This may be fine if not on macOS.');
      }
    }

    console.log(`Executable created: ${outPath}`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
