require('dotenv/config');

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Disable web security restrictions for local embedded desktop server
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
app.commandLine.appendSwitch('ignore-certificate-errors');

const backendUrl = `http://127.0.0.1:${process.env.PORT || '5000'}`;
let mainWindow = null;

if (process.platform === 'win32') {
  app.setAppUserModelId('com.oskolok.desktop');
}

function logServerMessage(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try {
    const logFile = path.join(app.getPath('userData'), 'oskolok-server.log');
    fs.appendFileSync(logFile, msg);
  } catch {}
  console.log(...args);
}

ipcMain.handle('set-title-bar-overlay', (event, options) => {
  if (mainWindow && typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay(options);
      return true;
    } catch (err) {
      return false;
    }
  }
  return false;
});

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');
  const preloadPath = path.join(__dirname, 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Oskolok',
    icon: iconPath,
    backgroundColor: '#0a0f1d',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#7188a3',
      height: 34,
    },
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const showWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const loadURLWithRetry = (url, retries = 15, onFail) => {
    if (!mainWindow) return;
    mainWindow.loadURL(url)
      .then(() => {
        showWindow();
      })
      .catch((err) => {
        if (retries > 0) {
          setTimeout(() => loadURLWithRetry(url, retries - 1, onFail), 500);
        } else {
          console.error(`Failed to load ${url} in Electron:`, err);
          if (onFail) onFail();
          else showWindow();
        }
      });
  };

  const loadFallback = () => {
    if (!mainWindow) return;
    const localDistPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(localDistPath)) {
      mainWindow.loadFile(localDistPath)
        .then(showWindow)
        .catch((err) => {
          console.error('Failed to load index.html fallback:', err);
          showWindow();
        });
    } else {
      showWindow();
    }
  };

  const tryLoadServer = () => {
    loadURLWithRetry(backendUrl, 15, loadFallback);
  };

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    loadURLWithRetry(devUrl, 10, tryLoadServer);
  } else if (!app.isPackaged) {
    fetch('http://localhost:3000')
      .then((r) => {
        if (r.ok) {
          loadURLWithRetry('http://localhost:3000', 5, tryLoadServer);
        } else {
          tryLoadServer();
        }
      })
      .catch(() => {
        tryLoadServer();
      });
  } else {
    tryLoadServer();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function ensureBackendServer() {
  try {
    const isUp = await fetch(`${backendUrl}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (isUp) {
      logServerMessage('[Main] Backend server already running at', backendUrl);
      return;
    }

    const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
    const dataDir = isPortable
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Oskolok-Data')
      : path.join(app.getPath('userData'), 'database');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const privateDir = path.join(dataDir, 'private');
    fs.mkdirSync(privateDir, { recursive: true });
    const legacyPrivateDir = path.resolve(process.env.OSKOLOK_PRIVATE_DIR || 'server/data/private');
    const oldKey = path.join(legacyPrivateDir, 'session.key');
    const newKey = path.join(privateDir, 'session.key');
    if (!fs.existsSync(newKey) && fs.existsSync(oldKey)) fs.copyFileSync(oldKey, newKey, fs.constants.COPYFILE_EXCL);
    process.env.OSKOLOK_PRIVATE_DIR = privateDir;

    const targetDb = path.join(dataDir, 'dev.db');
    const templateDbCandidates = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'prisma', 'dev.db'),
      path.join(__dirname, '../prisma/dev.db'),
      path.resolve('prisma/dev.db'),
    ];
    const templateDb = templateDbCandidates.find((p) => fs.existsSync(p));

    if (!fs.existsSync(targetDb) && templateDb) {
      try {
        fs.copyFileSync(templateDb, targetDb);
        logServerMessage('[Main] Copied template db to:', targetDb);
      } catch (copyErr) {
        logServerMessage('[Main] Failed to copy template db:', copyErr);
      }
    }

    process.env.DATABASE_URL = `file:${targetDb.replace(/\\/g, '/')}`;
    process.env.PORT = process.env.PORT || '5000';
    process.env.NODE_ENV = 'production';

    const serverCandidates = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist-server', 'server.js'),
      path.join(__dirname, '../dist-server/server.js'),
      path.resolve('dist-server/server.js'),
    ];
    const serverScript = serverCandidates.find((p) => fs.existsSync(p));

    if (serverScript) {
      logServerMessage('[Main] Loading backend server from:', serverScript);
      await import(pathToFileURL(serverScript).href);
      logServerMessage('[Main] Backend server started successfully at', backendUrl);
    } else {
      logServerMessage('[Main] ERROR: Could not find server.js among candidates:', JSON.stringify(serverCandidates));
    }
  } catch (err) {
    logServerMessage('[Main] ERROR: Failed to start backend server:', err && err.stack ? err.stack : err);
  }
}

async function waitForLocalServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${backendUrl}/api/health`);
      if (res.ok) {
        logServerMessage('[Main] Backend server responded to health check');
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

app.whenReady().then(async () => {
  await ensureBackendServer();
  await waitForLocalServer(20);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
