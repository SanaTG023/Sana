const { app, BrowserWindow, shell, ipcMain, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');

const appRoot = path.resolve(__dirname, '..');
const startPage = pathToFileURL(path.join(appRoot, 'kernelos.html')).href;
const publisherTokenPath = path.join(app.getPath('userData'), 'github-token.enc');
let mainWindow;

async function readPublisherToken() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows ไม่พร้อมเข้ารหัส token อย่างปลอดภัย');
  }
  const encrypted = await fs.readFile(publisherTokenPath, 'utf8');
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SanaOS',
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `GitHub ตอบกลับ ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

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
ipcMain.handle('sanaos:publisher-status', async () => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, secureStorage: false, configured: false };
  try {
    await fs.access(publisherTokenPath);
    return { ok: true, secureStorage: true, configured: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, secureStorage: true, configured: false };
    throw error;
  }
});
ipcMain.handle('sanaos:save-publisher-token', async (_event, value) => {
  if (process.platform !== 'win32' || !safeStorage.isEncryptionAvailable()) {
    return { ok: false, message: 'ไม่สามารถเข้ารหัส token ด้วย Windows Credential Protection ได้' };
  }
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token || token.length > 512) return { ok: false, message: 'กรุณากรอก GitHub token ที่ถูกต้อง' };

  try {
    const repo = await githubRequest('https://api.github.com/repos/SanaTG023/Sana', token);
    await githubRequest(`https://api.github.com/repos/SanaTG023/Sana/contents/data.js?ref=${encodeURIComponent(repo.default_branch)}`, token);
    await fs.mkdir(path.dirname(publisherTokenPath), { recursive: true });
    const encrypted = safeStorage.encryptString(token).toString('base64');
    await fs.writeFile(publisherTokenPath, encrypted, 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.status === 401 || error.status === 403
      ? 'Token ใช้ไม่ได้หรือไม่มีสิทธิ์เข้าถึง repository SanaTG023/Sana'
      : error.message };
  }
});
ipcMain.handle('sanaos:clear-publisher-token', async () => {
  try {
    await fs.unlink(publisherTokenPath);
    return { ok: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true };
    return { ok: false, message: error.message };
  }
});
ipcMain.handle('sanaos:publish-site-data', async (_event, source) => {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source, 'utf8') > 90 * 1024 * 1024) {
    return { ok: false, message: 'ข้อมูลเว็บไซต์ไม่ถูกต้องหรือมีขนาดเกินกำหนด' };
  }

  try {
    const token = await readPublisherToken();
    const repoUrl = 'https://api.github.com/repos/SanaTG023/Sana';
    const repo = await githubRequest(repoUrl, token);
    const branch = repo.default_branch;
    const fileUrl = `${repoUrl}/contents/data.js?ref=${encodeURIComponent(branch)}`;
    const existing = await githubRequest(fileUrl, token);
    const content = Buffer.from(source, 'utf8');
    const blobSha = crypto.createHash('sha1')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex');
    if (existing.sha === blobSha) return { ok: true, unchanged: true };

    const result = await githubRequest(`${repoUrl}/contents/data.js`, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update website content from SanaOS admin',
        content: content.toString('base64'),
        sha: existing.sha,
        branch
      })
    });
    return { ok: true, commit: result.commit.sha, branch };
  } catch (error) {
    return { ok: false, message: error.status === 404
      ? 'ไม่พบ data.js หรือไม่มีสิทธิ์อ่านไฟล์ใน repository'
      : error.status === 409 || error.status === 422
        ? 'GitHub ปฏิเสธการอัปเดต อาจเกิดจาก branch protection, สิทธิ์ token หรือข้อมูลเปลี่ยนพร้อมกัน'
        : error.status === 401 || error.status === 403
          ? 'Token หมดอายุหรือไม่มีสิทธิ์ Contents: Read and write'
          : error.message };
  }
});
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
