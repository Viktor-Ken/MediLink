import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('setupApi', {
  generateSecret: () => ipcRenderer.invoke('generate-secret'),
  saveConfig: (fields) => ipcRenderer.invoke('save-config', fields),
  onPrefill: (callback) => ipcRenderer.on('prefill', (_event, data) => callback(data)),
});
