// Over-the-air updates of the desktop shell (the site itself updates on its own). The server lists the newest build
// of this variant with its SHA-256; the file is downloaded in the background, checked, and installed on «Перезапустить»
// or when the app quits. Windows installer: silent NSIS run. Portable: the exe is swapped. macOS: the .app from the
// DMG replaces the running one (the build is unsigned, so Squirrel.Mac is not an option).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const CHECK_EVERY = 4 * 60 * 60 * 1000;

function variantOf(platform = process.platform, arch = process.arch, env = process.env) {
  if (platform === 'win32') return { platform: 'windows', variant: env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer' };
  if (platform === 'darwin') return { platform: 'macos', variant: arch === 'arm64' ? 'arm64' : 'x64' };
  return null;
}
/** The running .app bundle on macOS, or null when it cannot be replaced (inside a DMG, translocated, read-only). */
function macAppPath(execPath = process.execPath) {
  const app = path.resolve(execPath, '..', '..', '..');
  if (!app.endsWith('.app') || app.startsWith('/Volumes/') || app.includes('/AppTranslocation/')) return null;
  try { fs.accessSync(path.dirname(app), fs.constants.W_OK); return app; } catch { return null; }
}
const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** Bash script that waits for the app to exit, puts the new .app in place and optionally starts it. */
function macInstallScript({ dmg, app, pid, relaunch }) {
  return [
    `while kill -0 ${Number(pid)} 2>/dev/null; do sleep 0.3; done`,
    `MNT=$(mktemp -d /tmp/oskolok-update.XXXXXX)`,
    // hdiutil attach is deprecated on recent macOS; diskutil image attach is the successor.
    `hdiutil attach -nobrowse -noautoopen -readonly -mountpoint "$MNT" ${shellQuote(dmg)} >/dev/null 2>&1 || diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$MNT" ${shellQuote(dmg)} >/dev/null 2>&1 || exit 1`,
    `SRC=$(ls -d "$MNT"/*.app | head -1)`,
    `APP=${shellQuote(app)}`,
    `rm -rf "$APP.new" && ditto "$SRC" "$APP.new" && rm -rf "$APP.old" && mv "$APP" "$APP.old" && mv "$APP.new" "$APP" && rm -rf "$APP.old"`,
    `hdiutil detach "$MNT" -quiet || hdiutil detach "$MNT" -force -quiet`,
    `rmdir "$MNT" 2>/dev/null`,
    `xattr -dr com.apple.quarantine "$APP" 2>/dev/null`,
    relaunch ? `open "$APP"` : 'true',
  ].join('\n');
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

function setupUpdater({ app, origin, notify, appPath = macAppPath }) {
  const target = variantOf();
  let state = { state: 'idle' }, file = '', installing = false;
  const set = next => { state = next; try { notify(state); } catch { /* window gone */ } };
  if (!target) return { state: () => state, check: async () => state, install: () => false };
  const dir = path.join(app.getPath('userData'), 'updates');

  async function check() {
    if (installing || state.state === 'downloading') return state;
    try {
      const q = new URLSearchParams({ platform: target.platform, variant: target.variant, version: app.getVersion() });
      const res = await fetch(`${origin}/api/site/desktop-update?${q}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return state;
      const update = (await res.json()).data;
      if (!update || !/^[a-f0-9]{64}$/.test(update.sha256) || !/^\/downloads\/[A-Za-z0-9._-]+$/.test(update.url)) { if (state.state !== 'ready') set({ state: 'idle' }); return state; }
      if (state.state === 'ready' && state.version === update.version) return state;
      if (target.platform === 'macos' && !appPath()) { set({ state: 'manual', version: update.version, changelog: update.changelog, url: `${origin}/download/desktop` }); return state; }
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${update.version}-${path.basename(update.url)}`);
      if (!(fs.existsSync(dest) && await sha256(dest) === update.sha256)) {
        set({ state: 'downloading', version: update.version, progress: 0 });
        const part = `${dest}.part`;
        const dl = await fetch(`${origin}${update.url}`);
        if (!dl.ok || !dl.body) throw new Error(`HTTP ${dl.status}`);
        const total = Number(dl.headers.get('content-length')) || update.size || 0;
        let got = 0, lastSent = 0;
        const counter = new Transform({ transform(chunk, _e, cb) { got += chunk.length; if (total && Date.now() - lastSent > 500) { lastSent = Date.now(); set({ state: 'downloading', version: update.version, progress: Math.min(.99, got / total) }); } cb(null, chunk); } });
        await pipeline(Readable.fromWeb(dl.body), counter, fs.createWriteStream(part));
        if (await sha256(part) !== update.sha256) { fs.rmSync(part, { force: true }); throw new Error('checksum'); }
        fs.renameSync(part, dest);
      }
      // Older downloads are dropped.
      for (const f of fs.readdirSync(dir)) if (path.join(dir, f) !== dest) fs.rmSync(path.join(dir, f), { force: true, recursive: true });
      file = dest;
      set({ state: 'ready', version: update.version, changelog: update.changelog });
    } catch { if (state.state === 'downloading') set({ state: 'idle' }); }
    return state;
  }

  /** Starts the installer detached; the app quits right after when a relaunch is asked. */
  function install(relaunch) {
    if (state.state !== 'ready' || !file || installing) return false;
    installing = true;
    try {
      if (target.platform === 'windows' && target.variant === 'installer') {
        spawn(file, relaunch ? ['/S', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore' }).unref();
      } else if (target.platform === 'windows') {
        const exe = process.env.PORTABLE_EXECUTABLE_FILE;
        const cmd = `ping -n 3 127.0.0.1 >nul & copy /y "${file}" "${exe}" >nul${relaunch ? ` & start "" "${exe}"` : ''}`;
        spawn('cmd.exe', ['/d', '/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } else {
        const bundle = appPath();
        if (!bundle) { installing = false; return false; }
        spawn('/bin/bash', ['-c', macInstallScript({ dmg: file, app: bundle, pid: process.pid, relaunch })], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch { installing = false; return false; }
    if (relaunch) setImmediate(() => app.quit());
    return true;
  }

  // Like electron-updater's autoInstallOnAppQuit: a downloaded update goes in when the listener closes the app.
  app.on('will-quit', () => { if (!installing && state.state === 'ready') install(false); });
  setTimeout(() => { void check(); }, 20000);
  const timer = setInterval(() => { void check(); }, CHECK_EVERY);
  if (timer.unref) timer.unref();
  return { state: () => state, check, install };
}

module.exports = { setupUpdater, variantOf, macAppPath, macInstallScript };
