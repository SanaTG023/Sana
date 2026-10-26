const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sanaosDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('sanaos:get-version'),
  getPublisherStatus: () => ipcRenderer.invoke('sanaos:publisher-status'),
  savePublisherToken: token => ipcRenderer.invoke('sanaos:save-publisher-token', token),
  clearPublisherToken: () => ipcRenderer.invoke('sanaos:clear-publisher-token'),
  publishSiteData: data => ipcRenderer.invoke('sanaos:publish-site-data', data),
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
