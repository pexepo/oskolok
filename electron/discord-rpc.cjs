// Discord Rich Presence over Discord's local IPC socket — no dependency. «Слушает Осколок: трек — артист».
const net = require('node:net');
const path = require('node:path');

function pipePaths(platform = process.platform, env = process.env) {
  const ids = Array.from({ length: 10 }, (_, i) => i);
  if (platform === 'win32') return ids.map(i => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  // Regular, Flatpak and Snap Discord on Linux; macOS uses $TMPDIR.
  const dirs = [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord')];
  return dirs.flatMap(dir => ids.map(i => path.join(dir, `discord-ipc-${i}`)));
}

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0); header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}
function decode(buffer) {
  const frames = []; let offset = 0;
  while (buffer.length - offset >= 8) {
    const op = buffer.readInt32LE(offset), len = buffer.readInt32LE(offset + 4);
    if (buffer.length - offset - 8 < len) break;
    try { frames.push({ op, data: JSON.parse(buffer.slice(offset + 8, offset + 8 + len).toString('utf8')) }); } catch { /* skip */ }
    offset += 8 + len;
  }
  return { frames, rest: buffer.slice(offset) };
}

/** Builds the «Listening» activity for a track; null clears the status. */
function activityFor(state, appOrigin, now = Date.now()) {
  if (!state || !state.title || !state.playing) return null;
  const start = now - Math.max(0, state.position || 0) * 1000;
  const cut = (s, n) => String(s || '').slice(0, n).padEnd(2, ' ');
  const activity = {
    type: 2,
    details: cut(state.title, 128),
    state: cut(state.artist, 128),
    timestamps: state.duration > 0 ? { start: Math.round(start), end: Math.round(start + state.duration * 1000) } : { start: Math.round(start) },
    assets: { large_image: /^https:\/\//.test(state.artworkUrl || '') && state.artworkUrl.length < 256 ? state.artworkUrl : 'oskolok', large_text: 'Осколок' },
    instance: false,
  };
  if (appOrigin && state.id) activity.buttons = [{ label: 'Слушать в Осколке', url: `${appOrigin}/app/track/${encodeURIComponent(state.id)}`.slice(0, 512) }];
  return activity;
}

class DiscordPresence {
  constructor(clientId, appOrigin) { this.clientId = clientId; this.appOrigin = appOrigin; this.socket = null; this.ready = false; this.wanted = undefined; this.retryAt = 0; this.buffer = Buffer.alloc(0); this.enabled = true; this.connecting = false; }
  async connect() {
    if (this.socket || this.connecting || !this.clientId || Date.now() < this.retryAt) return;
    this.connecting = true;
    try {
      for (const p of pipePaths()) {
        const socket = await new Promise(resolve => {
          const s = net.createConnection(p, () => resolve(s));
          s.once('error', () => { s.destroy(); resolve(null); });
        });
        if (!socket) continue;
        this.socket = socket;
        socket.on('data', chunk => this.onData(chunk));
        socket.on('close', () => { this.socket = null; this.ready = false; this.retryAt = Date.now() + 15000; });
        socket.on('error', () => {});
        socket.write(encode(0, { v: 1, client_id: this.clientId }));
        return;
      }
      this.retryAt = Date.now() + 30000; // Discord is not running
    } finally { this.connecting = false; }
  }
  onData(chunk) {
    const { frames, rest } = decode(Buffer.concat([this.buffer, chunk]));
    this.buffer = rest;
    for (const f of frames) {
      if (f.op === 1 && f.data && f.data.evt === 'READY') { this.ready = true; this.flush(); }
      else if (f.op === 2) { if (this.socket) this.socket.destroy(); } // closed by Discord (e.g. wrong client id)
      else if (f.op === 3 && this.socket) this.socket.write(encode(4, f.data)); // ping → pong
    }
  }
  flush() {
    if (!this.ready || !this.socket || this.wanted === undefined) return;
    this.socket.write(encode(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.wanted }, nonce: `${Date.now()}-${Math.random()}` }));
  }
  update(state) {
    if (!this.enabled || !this.clientId) return;
    this.wanted = activityFor(state, this.appOrigin);
    if (this.ready) this.flush(); else void this.connect();
  }
  setEnabled(on) {
    this.enabled = !!on;
    if (!on && this.ready) { this.wanted = null; this.flush(); }
  }
  close() { try { if (this.ready) { this.wanted = null; this.flush(); } if (this.socket) this.socket.end(); } catch { /* closing anyway */ } }
}

module.exports = { DiscordPresence, activityFor, encode, decode, pipePaths };
