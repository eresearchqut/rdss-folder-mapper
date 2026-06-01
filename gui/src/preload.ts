import { contextBridge, ipcRenderer } from 'electron';

interface Config {
  debug: boolean;
  baseDir: string;
  dmpBaseUrl: string;
  remotePath: string;
}

contextBridge.exposeInMainWorld('api', {
  getConfig: (): Promise<Config> => ipcRenderer.invoke('get-config'),

  saveConfig: (config: Config): Promise<void> => ipcRenderer.invoke('save-config', config),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),

  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  hasShortcuts: (): Promise<boolean> => ipcRenderer.invoke('has-shortcuts'),

  openLogFile: (): Promise<void> => ipcRenderer.invoke('open-log-file'),

  cancelOperation: (): Promise<void> => ipcRenderer.invoke('cancel-operation'),

  mapFolders: (): Promise<{ success: boolean }> => ipcRenderer.invoke('map-folders'),

  removeMappings: (): Promise<{ success: boolean }> => ipcRenderer.invoke('remove-mappings'),

  onProgress: (callback: (data: { current: number; total: number; folderName: string }) => void) => {
    ipcRenderer.on('progress', (_event, data) => callback(data));
  },

  onLog: (callback: (line: string) => void) => {
    ipcRenderer.on('log', (_event, line: string) => callback(line));
  },

  onEvent: (callback: (event: { type: string; [key: string]: unknown }) => void) => {
    ipcRenderer.on('event', (_event, data) => callback(data));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('log');
    ipcRenderer.removeAllListeners('progress');
    ipcRenderer.removeAllListeners('event');
  },
});
