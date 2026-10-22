const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sanaosDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('sanaos:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('sanaos:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('sanaos:download-update'),
  installUpdate: () => ipcRenderer.invoke('sanaos:install-update'),
  onUpdateStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sanaos:update-status', listener);
    return () => ipcRenderer.removeListener('sanaos:update-status', listener);
  }
}));
