# Your Data & Privacy

RDSS Folder Mapper is designed to be transparent about what information it accesses, when it asks for credentials, and how everything is stored. Nothing is transmitted to third parties or collected for analytics.

## When you may be asked to sign in

### 1. Institutional login (browser-based)

When you first click **Connect Research Folders**, your default web browser opens to your institution's login page. This is a standard OAuth sign-in — the same mechanism used by university portals, Microsoft 365, and other institutional services.

::: tip The app never sees your institutional password
Your credentials are entered directly into your institution's login page inside the browser. The app only receives a short-lived access token after you have successfully signed in — it never has access to your username or password.
:::

After signing in, the browser may display a message like *"You can now close this tab"* — the app has received the token it needs and the browser window is no longer required.

### 2. Network storage credentials (if prompted)

In some network configurations, mounting a research storage folder requires separate credentials — typically your institutional username and password for the file server (e.g. Active Directory credentials).

If these are required, the app will display a **credentials dialog** before mounting. The dialog pre-fills your system username to save you time.

![Credentials dialog — enter your network storage username and password]()

::: info When this prompt appears
This prompt only appears when the storage server requires explicit credentials that your current session does not already provide. Many environments handle this automatically and this dialog will never appear.
:::

### 3. Re-authentication after sign out or token expiry

If you click **Sign Out** or your session token expires, the next time you click **Connect Research Folders** your browser will open to the institutional login page again.

---

## What is stored and where

All credentials are stored exclusively in your **operating system's secure credential store**. Nothing is written to a plain text file on disk.

| What | Where | Purpose |
|------|-------|---------|
| Session token (OAuth) | OS keychain / credential manager | Authorises calls to the research folder API |
| Network storage credentials | OS keychain / credential manager | Mounts the file server without re-prompting every session |
| App settings | User data folder (`config.json`) | Remembers your chosen base folder and debug preference |

**OS keychain / credential manager** refers to:
- **macOS** — Keychain Access (the same store used by Safari, Mail, and system apps)
- **Windows** — Windows Credential Manager
- **Linux** — GNOME Keyring or KDE Wallet (via `libsecret`)

Credentials stored in the OS keychain are:
- Encrypted at rest by the operating system
- Accessible only to your user account
- Never written to disk in plain text by this app

---

## What is NOT collected

- ❌ No usage analytics or telemetry
- ❌ No crash reporting sent off-device
- ❌ No passwords or tokens logged to the Activity log
- ❌ No data shared with third parties

---

## Removing stored credentials

To remove everything this app has stored:

1. Click **Sign Out** in the main window — this clears your session token from the keychain.
2. If you were ever prompted for network storage credentials, these are also cleared when you sign out.

To verify or manually remove entries, open your OS credential store:
- **macOS**: Open **Keychain Access** and search for `rdss-folder-mapper`
- **Windows**: Open **Credential Manager** → **Windows Credentials** and look for entries starting with `rdss-folder-mapper`
- **Linux**: Open your keyring manager and look for entries labelled **RDSS Folder Mapper**

---

## Deployment configuration

Your IT administrator may have deployed a configuration file (`config.json`) to your device as part of the app installation. This file contains connection details for your institution's research storage infrastructure (server addresses, authentication endpoints). It does not contain any personal information and is readable by any user on the device — it is not a secret.

If folder mapping is not working, contact your IT helpdesk, as the configuration may need to be updated for your environment.
