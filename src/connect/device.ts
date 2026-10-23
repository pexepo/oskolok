/** Pure helpers of Осколок Connect (no store, no network) — shared by the client and tests. */
export type DeviceKind = 'desktop' | 'phone' | 'tablet' | 'telegram' | 'web';
export interface ConnectDeviceState { track: {id: string; title: string; artist: string; artworkUrl?: string; duration: number} | null; isPlaying: boolean; position: number; duration: number; volume: number; at: number }
export interface ConnectDevice { id: string; name: string; kind: DeviceKind; state: ConnectDeviceState | null; connectedAt: number; receivedAt: number }

const randomId = (n: number) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(n)) : Uint8Array.from({length: n}, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
};
function stored(storage: Storage | undefined, key: string, n: number) {
  try { const v = storage?.getItem(key); if (v && /^[a-z0-9]{4,20}$/.test(v)) return v; const id = randomId(n); storage?.setItem(key, id); return id; }
  catch { return randomId(n); }
}

export interface DeviceEnv { userAgent: string; telegram: boolean; electron: boolean; platform?: string; maxTouchPoints?: number }
export function deviceName(env: DeviceEnv): {name: string; kind: DeviceKind} {
  const ua = env.userAgent;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints || 0) > 1);
  const os = ipad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : '';
  const mobile = /iPhone|Android.+Mobile/.test(ua);
  if (env.telegram) return {name: `Telegram${os ? ` · ${os}` : ''}`, kind: 'telegram'};
  if (/\bOskolokIOS\//.test(ua)) return {name: `Осколок · ${ipad ? 'iPad' : 'iPhone'}`, kind: ipad ? 'tablet' : 'phone'};
  if (/\bOskolokAndroid\//.test(ua)) return {name: 'Осколок · Android', kind: /Mobile/.test(ua) ? 'phone' : 'tablet'};
  if (env.electron) return {name: `Осколок · ${os || 'компьютер'}`, kind: 'desktop'};
  const browser = /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Браузер';
  return {name: os ? `${browser} · ${os}` : browser, kind: ipad ? 'tablet' : mobile ? 'phone' : 'web'};
}

/** One id per browser profile plus one per tab: two tabs are two players, a reload stays the same device. */
export function describeDevice(): {id: string; name: string; kind: DeviceKind} {
  const w = typeof window !== 'undefined' ? window as unknown as {Telegram?: {WebApp?: {initData?: string}}; electronAPI?: unknown; localStorage?: Storage; sessionStorage?: Storage} : undefined;
  const base = stored(w?.localStorage, 'oskolok-device', 10), tab = stored(w?.sessionStorage, 'oskolok-tab', 4);
  const env: DeviceEnv = {userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '', telegram: !!w?.Telegram?.WebApp?.initData, electron: !!w?.electronAPI || /Electron\//.test(typeof navigator !== 'undefined' ? navigator.userAgent : ''), maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0};
  return {id: `${base}-${tab}`, ...deviceName(env)};
}

/** Splits a server-sent-events buffer into complete events; the incomplete tail is returned for the next chunk. */
export function parseSseChunk(buffer: string): {events: Array<{event: string; data: string}>; rest: string} {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() || '';
  const events: Array<{event: string; data: string}> = [];
  for (const part of parts) {
    let event = 'message'; const data: string[] = [];
    for (const line of part.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':'), field = i < 0 ? line : line.slice(0, i), value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value; else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({event, data: data.join('\n')});
  }
  return {events, rest};
}

/** Another tab of this same browser carries the same name: say so instead of showing two identical rows. */
export function deviceLabel(d: {id: string; name: string}, selfId: string, anotherTab = 'другая вкладка') {
  const base = (id: string) => id.split('-')[0];
  return d.id !== selfId && selfId && base(d.id) === base(selfId) ? `${d.name} · ${anotherTab}` : d.name;
}
