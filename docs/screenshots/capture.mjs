#!/usr/bin/env node
/**
 * Capture product screenshots of the GUI renderer using Puppeteer.
 * Outputs to docs/public/screenshots/.
 *
 * Usage:  node docs/screenshots/capture.mjs
 */

import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/screenshots');
mkdirSync(outDir, { recursive: true });

const htmlPath = resolve(__dirname, '../../gui/src/renderer/index.html');
const rawHtml = readFileSync(htmlPath, 'utf8');

// Inject a mock window.api so the renderer doesn't crash without Electron.
const mockScript = `
<script>
  window.api = {
    getConfig: () => Promise.resolve({
      baseDir:    '~/Desktop/RDSS Folders',
      remotePath: 'smb://rstore.qut.edu.au/projects',
      dmpBaseUrl: 'https://dmp.qut.edu.au',
      debug:      false,
    }),
    getVersion:            ()    => Promise.resolve('1.3.9'),
    saveConfig:           (cfg) => Promise.resolve(),
    pickFolder:           ()    => Promise.resolve(null),
    mapFolders:           ()    => new Promise(() => {}),
    removeMappings:       ()    => new Promise(() => {}),
    cancelOperation:      ()    => Promise.resolve(),
    clearAuth:            ()    => Promise.resolve(),
    openLogFile:          ()    => Promise.resolve(),
    openBaseDir:          ()    => Promise.resolve(),
    hasShortcuts:         ()    => Promise.resolve(false),
    onLog:                (cb)  => {},
    onProgress:           (cb)  => { window._progressCb = cb; },
    onEvent:              (cb)  => {},
    onCredentialsRequired:(cb)  => {},
    submitCredentials:    (c)   => Promise.resolve(),
    removeAllListeners:   ()    => {},
  };
</script>
`;

// Insert mock before the closing </head>
const html = rawHtml.replace('</head>', mockScript + '</head>');

const VIEWPORT = { width: 560, height: 660 };

async function capture(page, name) {
  await page.screenshot({ path: resolve(outDir, name), type: 'png' });
  console.log(`  ✓ ${name}`);
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // ── 1. Main window ──────────────────────────────────────────────────────
    const page1 = await browser.newPage();
    await page1.setViewport(VIEWPORT);
    await page1.setContent(html, { waitUntil: 'networkidle0' });
    await page1.waitForSelector('#statusText');
    await capture(page1, 'gui-main.png');

    // ── 2. Progress state ────────────────────────────────────────────────────
    const page2 = await browser.newPage();
    await page2.setViewport(VIEWPORT);
    await page2.setContent(html, { waitUntil: 'networkidle0' });
    await page2.waitForSelector('#statusText');

    // Simulate progress at 4/10
    await page2.evaluate(() => {
      const progressSection = document.getElementById('progressSection');
      const progressFill    = document.getElementById('progressFill');
      const progressCount   = document.getElementById('progressCount');
      const progressLabel   = document.getElementById('progressLabel');
      const progressFolder  = document.getElementById('progressFolder');
      const dot             = document.getElementById('statusDot');
      const statusText      = document.getElementById('statusText');
      const btnMap          = document.getElementById('btnMap');
      const btnRemove       = document.getElementById('btnRemove');

      progressSection.classList.remove('hidden');
      progressFill.style.width = '40%';
      progressCount.textContent = '4 / 10';
      progressLabel.textContent = 'Mapping folders…';
      progressFolder.textContent = 'Climate Change Research Dataset 2024';
      dot.style.background = '#f57c00';
      statusText.textContent = 'Mapping folders…';
      btnMap.disabled = true;
      btnRemove.disabled = true;
    });

    await capture(page2, 'gui-progress.png');

    // ── 3. Settings panel ────────────────────────────────────────────────────
    const page3 = await browser.newPage();
    await page3.setViewport(VIEWPORT);
    await page3.setContent(html, { waitUntil: 'networkidle0' });
    await page3.waitForSelector('#btnSettings');
    await page3.click('#btnSettings');
    // Wait for settings panel to be visible
    await page3.waitForFunction(
      () => !document.getElementById('panelSettings').classList.contains('hidden')
    );
    await capture(page3, 'gui-settings.png');

  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots saved to docs/public/screenshots/`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
