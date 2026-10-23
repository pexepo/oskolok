import {create} from 'zustand';
import {apiClient} from '../api/apiClient.js';
import {apiBase,telegramAuthHeaders,useTelegramStore} from '../telegram/runtime.js';
import {queueManager} from '../audio/QueueManager.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import {queueWindow} from '../telegram/playbackQueue.js';
import type {Track} from '../types/index.js';
import {describeDevice,deviceLabel,parseSseChunk,type ConnectDevice,type DeviceKind} from './device.js';
import {handleJamEvent} from './jam.js';
export {deviceLabel};

/**
 * Осколок Connect: every open player of the listener (phone, computer, Telegram, browser tab) is a device.
 * Devices see what plays where, pass the queue between each other and work as remotes, like Spotify Connect.
 */
export type {ConnectDevice,DeviceKind};
interface ConnectState { selfId: string; devices: ConnectDevice[]; connected: boolean }
export const useConnectStore = create<ConnectState>(() => ({selfId: '', devices: [], connected: false}));

const TAKEOVER_LIMIT = 200;
let started = false, controller: AbortController | null = null, retry = 0, retryTimer: ReturnType<typeof setTimeout> | undefined;
const device = describeDevice();

export const otherDevices = (s: ConnectState) => s.devices.filter(d => d.id !== s.selfId);
/** Position of a remote device now, from its last report. */
export const livePosition = (d: ConnectDevice) => {
  const st = d.state; if (!st) return 0;
  const p = st.position + (st.isPlaying ? (Date.now() - d.receivedAt) / 1000 : 0);
  return Math.min(st.duration || p, p);
};

function onDevices(list: Omit<ConnectDevice, 'receivedAt'>[]) {
  const before = new Map(useConnectStore.getState().devices.map(d => [d.id, d]));
  // A device keeps its local timestamp until it reports a new state: progress bars stay smooth between reports.
  const devices = list.map(d => { const old = before.get(d.id); return {...d, receivedAt: old && old.state?.at === d.state?.at ? old.receivedAt : Date.now()}; });
  useConnectStore.setState({devices});
}

async function post(path: string, body: Record<string, unknown>) {
  return apiClient.request(`/connect/${path}`, {method: 'POST', body: JSON.stringify(body)});
}

function snapshotState() {
  const s = usePlayerStore.getState(), t = s.currentTrack;
  return {
    track: t ? {id: t.id, title: t.title.slice(0, 300), artist: t.artist.name.slice(0, 300), artworkUrl: t.artworkUrl && t.artworkUrl.length < 1000 ? t.artworkUrl : undefined, duration: Math.max(0, Math.min(86400, t.duration || s.duration || 0))} : null,
    isPlaying: s.isPlaying, position: Math.max(0, Math.min(86400, s.currentTime || 0)), duration: Math.max(0, Math.min(86400, s.duration || t?.duration || 0)), volume: Math.max(0, Math.min(1, s.isMuted ? 0 : s.volume)),
  };
}
let publishTimer: ReturnType<typeof setTimeout> | undefined, lastPublishAt = 0;
function publishSoon(delay = 250) {
  if (!useConnectStore.getState().connected) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => { lastPublishAt = Date.now(); void post('state', {id: device.id, state: snapshotState()}).catch(() => {}); }, delay);
}

function queueSnapshot(): {queue: Track[]; index: number} | null {
  const q = queueManager.getState();
  if (!q.playbackQueue[q.currentIndex]) return null;
  const w = queueWindow(q.playbackQueue, q.currentIndex, TAKEOVER_LIMIT);
  return {queue: w.tracks, index: w.index};
}

/** Plays a queue that came from another device, from the same second. */
async function takeOver(payload: {from: string; queue: Track[]; index: number; position: number; isPlaying: boolean}) {
  const target = payload.queue[payload.index];
  if (!target) return;
  const sender = useConnectStore.getState().devices.find(d => d.id === payload.from), from = sender && deviceLabel(sender, device.id, tr('другая вкладка', 'another tab'));
  await usePlayerStore.getState().playCollection(payload.queue, payload.index, undefined, 'connect');
  if (payload.position >= 2) {
    const stop = usePlayerStore.subscribe(s => {
      if (s.currentTrack?.id === target.id && s.duration > 0) { stop(); clearTimeout(timer); if (payload.position < s.duration - 2) usePlayerStore.getState().seek(payload.position); }
    });
    const timer = setTimeout(stop, 30000);
  }
  if (from) useToastStore.getState().addToast(tr(`Продолжаем здесь — с «${from}»`, `Continuing here from “${from}”`), 'info', 3000);
}

function onCommand(c: {from: string; action: string; value?: number; reason?: string}) {
  const p = usePlayerStore.getState();
  const sender = useConnectStore.getState().devices.find(d => d.id === c.from), fromName = sender ? deviceLabel(sender, device.id, tr('другая вкладка', 'another tab')) : tr('другом устройстве', 'another device');
  switch (c.action) {
    case 'pause':
      if (p.isPlaying) { p.pause(); if (c.reason === 'other-device') useToastStore.getState().addToast(tr(`Пауза: музыка играет на «${fromName}»`, `Paused: music is playing on “${fromName}”`), 'info', 3500); }
      break;
    case 'play': if (!p.isPlaying) p.resume(); break;
    case 'toggle': void p.togglePlay(); break;
    case 'next': void p.next(); break;
    case 'previous': void p.previous(); break;
    case 'seek': if (typeof c.value === 'number') p.seek(c.value); break;
    case 'volume': if (typeof c.value === 'number') { if (p.isMuted) p.toggleMute(); p.setVolume(Math.max(0, Math.min(1, c.value))); } break;
    case 'handoff': {
      // Another device asked to continue there: send it the queue and the second, then fall silent here.
      const snap = queueSnapshot(); if (!snap) break;
      const position = usePlayerStore.getState().currentTime || 0;
      void post('takeover', {from: device.id, to: c.from, queue: snap.queue, index: snap.index, position, isPlaying: true}).then(() => usePlayerStore.getState().pause()).catch(() => {});
      break;
    }
  }
  publishSoon(400);
}

function handle(event: string, data: unknown) {
  if (event === 'hello') { const d = data as {self: string; devices: ConnectDevice[]}; useConnectStore.setState({selfId: d.self, connected: true}); onDevices(d.devices); publishSoon(0); }
  else if (event === 'devices') onDevices(data as ConnectDevice[]);
  else if (event === 'command') onCommand(data as {from: string; action: string; value?: number; reason?: string});
  else if (event === 'takeover') void takeOver(data as {from: string; queue: Track[]; index: number; position: number; isPlaying: boolean});
  else if (event.startsWith('jam')) handleJamEvent(event, data);
}

async function openStream() {
  clearTimeout(retryTimer);
  controller?.abort();
  if (!useTelegramStore.getState().user) return;
  const own = new AbortController(); controller = own;
  const params = new URLSearchParams({id: device.id, name: device.name, kind: device.kind});
  try {
    const response = await fetch(`${apiBase}/connect/stream?${params}`, {credentials: 'include', headers: {Accept: 'text/event-stream', ...telegramAuthHeaders()}, signal: own.signal, cache: 'no-store'});
    if (response.status === 401 || response.status === 403) { useConnectStore.setState({connected: false, devices: []}); return; }
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    retry = 0;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) { try { handle(e.event, JSON.parse(e.data)); } catch { /* malformed event */ } }
    }
  } catch { if (own.signal.aborted) return; }
  if (controller !== own) return;
  useConnectStore.setState({connected: false});
  // Reconnect with backoff: 2 s, 4 s … up to 30 s.
  retry = Math.min(retry + 1, 5);
  retryTimer = setTimeout(() => { void openStream(); }, Math.min(30000, 1000 * 2 ** retry));
}

/** Starts once per page: connects while signed in, publishes this device's playback and obeys remote commands. */
export function initConnect() {
  if (started || typeof window === 'undefined') return;
  started = true;
  useConnectStore.setState({selfId: device.id});
  let last = {id: '', playing: false, volume: -1, time: 0, at: 0};
  usePlayerStore.subscribe(s => {
    const id = s.currentTrack?.id || '', volume = s.isMuted ? 0 : s.volume, now = Date.now();
    // A jump of the clock that playback alone cannot explain is a seek: the other devices update their bars.
    const expected = last.time + (last.playing ? (now - last.at) / 1000 : 0);
    const seeked = id === last.id && Math.abs((s.currentTime || 0) - expected) > 4;
    if (id !== last.id || s.isPlaying !== last.playing || Math.abs(volume - last.volume) > .02 || seeked) publishSoon(seeked ? 150 : 250);
    last = {id, playing: s.isPlaying, volume, time: s.currentTime || 0, at: now};
  });
  setInterval(() => { if (usePlayerStore.getState().isPlaying && Date.now() - lastPublishAt > 14000) publishSoon(0); }, 15000);
  useTelegramStore.subscribe((s, prev) => { if (!!s.user !== !!prev.user) { if (s.user) void openStream(); else { controller?.abort(); useConnectStore.setState({connected: false, devices: []}); } } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !useConnectStore.getState().connected) { retry = 0; void openStream(); } });
  window.addEventListener('online', () => { if (!useConnectStore.getState().connected) { retry = 0; void openStream(); } });
  void openStream();
}

/** «Слушать здесь»: the playing device sends its queue and position to this one. */
export async function listenHere(targetId: string) {
  try { await post('command', {from: device.id, target: targetId, action: 'handoff'}); }
  catch (e) { useToastStore.getState().addToast(e instanceof Error ? e.message : tr('Устройство не ответило.', 'The device did not respond.'), 'warning'); }
}
/** «Играть там»: this device's queue continues on another one, and this one pauses. */
export async function playOn(targetId: string) {
  const snap = queueSnapshot(); if (!snap) return;
  try {
    await post('takeover', {from: device.id, to: targetId, queue: snap.queue, index: snap.index, position: usePlayerStore.getState().currentTime || 0, isPlaying: true});
    usePlayerStore.getState().pause();
  } catch (e) { useToastStore.getState().addToast(e instanceof Error ? e.message : tr('Устройство не ответило.', 'The device did not respond.'), 'warning'); }
}
export async function remote(targetId: string, action: 'toggle' | 'next' | 'previous' | 'seek' | 'volume' | 'play' | 'pause', value?: number) {
  try { await post('command', {from: device.id, target: targetId, action, value}); }
  catch (e) { useToastStore.getState().addToast(e instanceof Error ? e.message : tr('Устройство не ответило.', 'The device did not respond.'), 'warning'); }
}
export const thisDevice = device;
