// Desktop extras of the shipped client: a floating mini-player above other windows (liner-style overlay),
// a global shortcut for it and Discord «Listening» status. The web app reports what plays; actions go back.
const path = require('node:path');
const fs = require('node:fs');
const { DiscordPresence } = require('./discord-rpc.cjs');
const { setupUpdater } = require('./updater.cjs');

const ACTIONS = new Set(['toggle', 'next', 'previous', 'like']);
const SHORTCUT = 'CommandOrControl+Alt+M';

function sanitize(s) {
  if (!s || typeof s !== 'object') return null;
  const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const num = v => Number.isFinite(Number(v)) ? Math.max(0, Math.min(86400, Number(v))) : 0;
  return { id: str(s.id, 200), title: str(s.title, 300), artist: str(s.artist, 300), artworkUrl: /^https:\/\//.test(s.artworkUrl || '') ? str(s.artworkUrl, 1000) : '', duration: num(s.duration), position: num(s.position), playing: !!s.playing, liked: !!s.liked };
}

function setup({ electron, getMain, dir, origin, discordClientId }) {
  const { app, BrowserWindow, ipcMain, globalShortcut, screen } = electron;
  let mini = null, last = null, shortcutOn = false;
  const prefs = { miniOnMinimize: false, discord: true };
  const discord = new DiscordPresence(discordClientId || '', origin);
  const boundsFile = () => path.join(app.getPath('userData'), 'mini-window.json');
  const fromMain = event => { const m = getMain(); return !!m && !m.isDestroyed() && event.sender === m.webContents; };

  function savedBounds(w, h) {
    try {
      const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
      const fits = screen.getAllDisplays().some(d => { const a = d.workArea; return b.x >= a.x - 20 && b.y >= a.y - 20 && b.x + w <= a.x + a.width + 20 && b.y + h <= a.y + a.height + 20; });
      return fits ? b : null;
    } catch { return null; }
  }
  function openMini() {
    if (mini && !mini.isDestroyed()) { mini.showInactive(); return; }
    const w = 360, h = 104, area = screen.getPrimaryDisplay().workArea, saved = savedBounds(w, h);
    mini = new BrowserWindow({
      width: w, height: h, x: saved ? saved.x : area.x + area.width - w - 24, y: saved ? saved.y : area.y + area.height - h - 24,
      frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, transparent: true, backgroundColor: '#00000000', hasShadow: true,
      title: 'Осколок — мини-плеер',
      webPreferences: { preload: path.join(dir, 'mini-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
    });
    const win = mini;
    win.setAlwaysOnTop(true, 'floating');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* not on every platform */ }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('ready-to-show', () => { win.showInactive(); if (last) win.webContents.send('mini-state', last); });
    win.on('moved', () => { try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds())); } catch { /* not important */ } });
    win.on('closed', () => { if (mini === win) mini = null; });
    void win.loadFile(path.join(dir, 'mini.html'));
  }
  const closeMini = () => { if (mini && !mini.isDestroyed()) mini.close(); };
  const toggleMini = () => { if (mini && !mini.isDestroyed() && mini.isVisible()) closeMini(); else openMini(); };

  ipcMain.handle('desktop-info', event => fromMain(event) ? { discord: !!discordClientId, shortcut: shortcutOn ? SHORTCUT : '' } : null);
  ipcMain.on('desktop-now-playing', (event, state) => {
    if (!fromMain(event)) return;
    last = sanitize(state);
    if (mini && !mini.isDestroyed()) mini.webContents.send('mini-state', last);
    if (prefs.discord) discord.update(last);
  });
  ipcMain.on('desktop-prefs', (event, p) => {
    if (!fromMain(event) || !p || typeof p !== 'object') return;
    if (typeof p.miniOnMinimize === 'boolean') prefs.miniOnMinimize = p.miniOnMinimize;
    if (typeof p.discord === 'boolean') { prefs.discord = p.discord; discord.setEnabled(p.discord); if (p.discord && last) discord.update(last); }
  });
  ipcMain.on('desktop-toggle-mini', event => { if (fromMain(event)) toggleMini(); });
  ipcMain.on('mini-action', (event, action) => {
    if (!mini || mini.isDestroyed() || event.sender !== mini.webContents) return;
    const main = getMain();
    if (action === 'open') { if (main && !main.isDestroyed()) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); } return; }
    if (action === 'close') { closeMini(); return; }
    if (ACTIONS.has(action) && main && !main.isDestroyed()) main.webContents.send('desktop-command', action);
  });

  try { shortcutOn = globalShortcut.register(SHORTCUT, toggleMini); } catch { shortcutOn = false; }

  // Over-the-air updates of this shell: downloaded in the background, installed on «Перезапустить» or on quit.
  const updater = setupUpdater({ app, origin, notify: state => { const m = getMain(); if (m && !m.isDestroyed()) m.webContents.send('desktop-update', state); } });
  ipcMain.handle('desktop-update-state', event => fromMain(event) ? updater.state() : null);
  ipcMain.handle('desktop-update-check', event => fromMain(event) ? updater.check() : null);
  ipcMain.on('desktop-update-install', event => { if (fromMain(event)) updater.install(true); });
  app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch { /* quitting */ } discord.close(); });

  /** Hooks the main window: optional mini-player while it is minimised. */
  function attach(main) {
    main.on('minimize', () => { if (prefs.miniOnMinimize && last && last.title) openMini(); });
    main.on('restore', () => { if (prefs.miniOnMinimize) closeMini(); });
    main.on('closed', closeMini);
  }
  return { attach, toggleMini };
}

module.exports = { setup, sanitize, SHORTCUT };
