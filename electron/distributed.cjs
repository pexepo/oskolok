const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const appConfig = require('./app-url.json');
const { url } = appConfig;
const origin = new URL(url).origin;

function external(target) {
  try { if (['https:', 'http:', 'tg:'].includes(new URL(target).protocol)) void shell.openExternal(target); } catch {}
}

// The shipped app opens straight into the player, never the landing page.
const playerUrl = `${origin}/app`;
function createWindow(target = playerUrl) {
  const win = new BrowserWindow({
    width: 1380, height: 860, minWidth: 900, minHeight: 640,
    title: 'Oskolok', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0a0f1d',
    autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'distributed-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      event.preventDefault();
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
    }
  });
  win.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== origin) { event.preventDefault(); external(destination); }
  });
  win.webContents.setWindowOpenHandler(({ url: destination }) => {
    try {
      if (new URL(destination).origin === origin) createWindow(destination);
      else external(destination);
    } catch {}
    return { action: 'deny' };
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(target).catch(() => {
    void win.loadFile(path.join(__dirname, 'offline.html'));
    win.show();
  });
  return win;
}

ipcMain.handle('retry-connection', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && event.sender.getURL().startsWith('file:')) void win.loadURL(playerUrl).catch(() => win.loadFile(path.join(__dirname, 'offline.html')));
});
let mainWindow = null, extras = null;
function createMainWindow() {
  mainWindow = createWindow();
  if (extras && mainWindow && typeof mainWindow.on === 'function') extras.attach(mainWindow);
  return mainWindow;
}
app.whenReady().then(() => {
  // Mini-player above other windows, its global shortcut and Discord status (optional: the app works without them).
  try {
    const mod = require('./desktop-extras.cjs');
    if (typeof mod.setup === 'function') extras = mod.setup({ electron: require('electron'), getMain: () => mainWindow, dir: __dirname, origin, discordClientId: appConfig.discordClientId || '' });
  } catch { extras = null; }
  createMainWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createMainWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
