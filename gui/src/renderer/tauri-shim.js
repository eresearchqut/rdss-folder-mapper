// Recreates the Electron `window.api` contextBridge surface on top of Tauri's
// core invoke/event APIs (exposed via app.withGlobalTauri). This lets the
// existing renderer (index.html) run unchanged under Tauri.
(() => {
  const tauri = window.__TAURI__;
  if (!tauri) {
    console.error('Tauri global API not available — is withGlobalTauri enabled?');
    return;
  }
  const { invoke } = tauri.core;
  const { listen } = tauri.event;

  window.api = {
    getConfig: () => invoke('get_config'),
    saveConfig: (config) => invoke('save_config', { config }),
    pickFolder: () => invoke('pick_folder'),
    getVersion: () => invoke('get_version'),
    hasShortcuts: () => invoke('has_shortcuts'),
    openLogFile: () => invoke('open_log_file'),
    openBaseDir: () => invoke('open_base_dir'),
    openHelp: () => invoke('open_help'),
    cancelOperation: () => invoke('cancel_operation'),
    mapFolders: () => invoke('map_folders'),
    removeMappings: () => invoke('remove_mappings'),
    clearAuth: () => invoke('clear_auth'),
    submitCredentials: (credentials) => invoke('submit_credentials', { credentials }),

    onCredentialsRequired: (cb) => listen('credentials-required', (e) => cb(e.payload)),
    onProgress: (cb) => listen('progress', (e) => cb(e.payload)),
    onLog: (cb) => listen('log', (e) => cb(e.payload)),
    onEvent: (cb) => listen('event', (e) => cb(e.payload)),

    removeAllListeners: () => {},
  };
})();
