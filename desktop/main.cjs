const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const appRoot = path.resolve(__dirname, '..');
const startPage = pathToFileURL(path.join(appRoot, 'kernelos.html')).href;
let mainWindow;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function sendUpdateStatus(event, details = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sanaos:update-status', { event, ...details });
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
autoUpdater.on('update-not-available', info => sendUpdateStatus('current', { version: info.version }));
autoUpdater.on('download-progress', progress => sendUpdateStatus('progress', { percent: Math.round(progress.percent) }));
autoUpdater.on('update-downloaded', info => sendUpdateStatus('downloaded', { version: info.version }));
autoUpdater.on('error', error => sendUpdateStatus('error', { message: error.message }));

ipcMain.handle('sanaos:get-version', () => app.getVersion());
ipcMain.handle('sanaos:check-update', async () => {
  if (!app.isPackaged || process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: Boolean(result), version: result?.updateInfo?.version };
  } catch (error) {
    return { ok: false, reason: 'error', message: error.message };
  }
});
ipcMain.handle('sanaos:download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});
ipcMain.handle('sanaos:install-update', () => {
  if (!app.isPackaged || process.platform !== 'win32') return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#1d132b',
    autoHideMenuBar: true,
    title: 'SanaOS',
    icon: path.join(appRoot, 'images', 'sanaos-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file:')) {
      try {
        const target = new URL(url);
        const targetPath = path.resolve(fileURLToPath(target));
        if (targetPath.startsWith(appRoot + path.sep)) return { action: 'allow' };
      } catch {
        // Invalid local URLs are blocked below.
      }
      return { action: 'deny' };
    }

    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.loadURL(startPage);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.sanaos.desktop');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
