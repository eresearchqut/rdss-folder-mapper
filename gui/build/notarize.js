// electron-builder afterSign hook: notarize and staple the signed .app.
//
// Runs after the app bundle is code-signed but before the .dmg/.pkg are built,
// so the distributable artifacts embed an already-stapled app. Notarization is
// skipped (without failing the build) when the Apple credentials are absent —
// e.g. local developer builds, forks, or CI runs without the signing secrets —
// which keeps unsigned builds working.
const { execFileSync } = require('child_process');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      'Skipping notarization: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // Imported lazily so the dependency is only required on macOS signing runs.
  const { notarize } = require('@electron/notarize');

  console.log(`Notarizing ${appPath} with notarytool…`);
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  // @electron/notarize submits but does not staple; staple so the ticket is
  // embedded and Gatekeeper validates offline.
  console.log(`Stapling notarization ticket to ${appPath}…`);
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
  console.log('Notarization and stapling complete.');
};
