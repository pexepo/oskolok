import {create} from 'zustand';
import {apiClient,ApiError} from '../api/apiClient.js';
import {queueManager} from '../audio/QueueManager.js';
import {queueHooks,usePlayerStore} from '../stores/usePlayerStore.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import {queueWindow} from '../telegram/playbackQueue.js';
import type {Track} from '../types/index.js';
import {describeDevice} from './device.js';
import {APP_BASE} from '../routing.js';

/**
 * Jam (Spotify Jam, 2026): friends share one queue. Everyone adds songs and controls playback; each listens
 * on their own device, in step. The server keeps the queue and the clock (connectHub); this module mirrors
 * it into the local player and turns local actions — play, pause, seek, next, «В очередь» — into jam actions.
 */
export interface JamPerson {userId: string; publicId: string; name: string; avatarUrl: string}
export interface JamMember extends JamPerson {owner: boolean; online: boolean}
export interface JamEntry {key: string; track: Track; addedBy: string}
export interface JamView {id: string; ownerId: string; /** The listener this copy is for. */ you: string; members: JamMember[]; queue: JamEntry[]; index: number; isPlaying: boolean; position: number; at: number; now: number; rev: number}
export interface JamSummary {id: string; owner: JamPerson; members: number; track: Track | null; isPlaying: boolean}
export interface JamInvite {id: string; from: JamPerson; track: Track | null}

/** `pendingJoin`: a jam link was opened — joining waits for a tap (browsers start sound only after one). */
interface JamState {jam: JamView | null; offset: number; invites: JamInvite[]; panelOpen: boolean; pendingJoin: string | null}
export const useJamStore = create<JamState>(() => ({jam: null, offset: 0, invites: [], panelOpen: false, pendingJoin: null}));
export const openJamPanel = () => useJamStore.setState({panelOpen: true});

const device = describeDevice();
/** Drift a listener tolerates before their player is moved to the shared second. */
const DRIFT = 2.5, TRACK_LIMIT = 11000;
let applyingUntil = 0;
const ours = () => Date.now() < applyingUntil;
const mark = (ms = 1500) => { applyingUntil = Math.max(applyingUntil, Date.now() + ms); };

/** Where the shared playback is now, by the server's clock. */
export function jamPosition(jam: Pick<JamView, 'position' | 'isPlaying' | 'at'>, offset: number, now = Date.now()) {
  return Math.max(0, jam.position + (jam.isPlaying ? (now + offset - jam.at) / 1000 : 0));
}
export const jamTrack = (jam: JamView | null) => jam ? jam.queue[jam.index]?.track || null : null;
export const memberName = (jam: JamView | null, userId: string) => jam?.members.find(m => m.userId === userId)?.name || tr('слушатель', 'listener');

/** A track as the jam stores it: the client plays from it, so it stays whole unless it is unusually big. */
function slim(track: Track): Track {
  if (JSON.stringify(track).length <= TRACK_LIMIT) return track;
  const {id, source, sourceId, title, artist, artworkUrl, duration, access, release, explicit, audioSource} = track;
  return {id, source, sourceId, title, artist: {...artist}, artworkUrl, duration, access, release, explicit, audioSource} as Track;
}

const request = <T,>(path: string, body?: unknown) => apiClient.request<T>(`/connect/jam${path}`, body === undefined ? {} : {method: 'POST', body: JSON.stringify(body)});

function forget(message?: string) {
  useJamStore.setState({jam: null});
  if (message) useToastStore.getState().addToast(message, 'info', 4000);
}
function failed(e: unknown) {
  if (e instanceof ApiError && (e.status === 403 || e.status === 404) && /JAM_NOT_MEMBER|JAM_NOT_FOUND/.test(e.code)) { forget(tr('Jam закончился.', 'The Jam has ended.')); return; }
  useToastStore.getState().addToast(e instanceof Error ? e.message : tr('Не получилось. Попробуйте ещё раз.', 'That failed. Try again.'), 'warning');
}

/* ---------- server → player ---------- */
let applyChain: Promise<void> = Promise.resolve();
function receive(view: JamView | null | undefined) {
  if (!view) return;
  const prev = useJamStore.getState().jam;
  if (prev && prev.id === view.id && view.rev < prev.rev) return;
  useJamStore.setState({jam: view, offset: view.now - Date.now()});
  applyChain = applyChain.then(() => applyView(view)).catch(() => {});
}

/** Waits until the player has loaded this track (its duration is known). */
function whenLoaded(id: string, run: () => void) {
  const s = usePlayerStore.getState();
  if (s.currentTrack?.id === id && s.duration > 0) { run(); return; }
  const stop = usePlayerStore.subscribe(st => { if (st.currentTrack?.id === id && st.duration > 0) { stop(); clearTimeout(timer); run(); } });
  const timer = setTimeout(stop, 30000);
}

/** Moves the local player to the shared second and play state. */
function syncClock() {
  const {jam, offset} = useJamStore.getState(), target = jamTrack(jam), p = usePlayerStore.getState();
  if (!jam || !target || p.currentTrack?.id !== target.id) return;
  const expected = jamPosition(jam, offset), duration = p.duration || target.duration || 0;
  if (!p.isBuffering && Math.abs((p.currentTime || 0) - expected) > DRIFT && (!duration || expected < duration - 1)) { mark(); p.seek(expected); }
  if (jam.isPlaying && !p.isPlaying && !p.isBuffering) { mark(); p.resume(); }
  if (!jam.isPlaying && p.isPlaying) { mark(); p.pause(); }
}

async function applyView(view: JamView) {
  const current = useJamStore.getState().jam;
  if (!current || current.id !== view.id || current.rev !== view.rev) return;
  const tracks = view.queue.map(e => e.track), target = tracks[view.index], p = usePlayerStore.getState();
  if (!target) { if (p.isPlaying) { mark(); p.pause(); } return; }
  // The shared order is the order: local shuffle would play a different song than the friends hear.
  if (queueManager.getState().shuffle) { mark(); p.toggleShuffle(); }
  if (p.currentTrack?.id === target.id) {
    const q = queueManager.getState();
    if (q.currentIndex !== view.index || q.playbackQueue.length !== tracks.length || q.playbackQueue.some((t, i) => t.id !== tracks[i].id)) {
      queueManager.setQueue(tracks, view.index);
      usePlayerStore.setState({queueState: queueManager.getState()});
    }
    syncClock();
    return;
  }
  mark(6000);
  await p.playCollection(tracks, view.index, undefined, 'no-continuation');
  whenLoaded(target.id, () => { mark(); syncClock(); });
}

/* ---------- player → server ---------- */
async function control(c: {action: 'play' | 'pause' | 'seek' | 'jump' | 'ended'; position?: number; index?: number; fromIndex?: number}) {
  const jam = useJamStore.getState().jam; if (!jam) return;
  try { receive(await request<JamView>(`/${jam.id}/control`, c)); } catch (e) { failed(e); }
}

function onLocalTrack(jam: JamView, track: Track) {
  const ids = jam.queue.map(e => e.track.id);
  if (ids[jam.index] === track.id) return;
  let i = ids.indexOf(track.id, Math.max(0, jam.index - 1));
  if (i < 0) i = ids.indexOf(track.id);
  if (i >= 0) { void control({action: 'jump', index: i, fromIndex: jam.index}); return; }
  // Something outside the jam was started here: it plays for everyone, right now.
  void request<JamView>(`/${jam.id}/add`, {track: slim(track), mode: 'now'}).then(receive, failed);
}

let playTimer: ReturnType<typeof setTimeout> | undefined;
function onLocalPlayState(playing: boolean, trackId: string, timeBefore: number) {
  clearTimeout(playTimer);
  playTimer = setTimeout(() => {
    const s = usePlayerStore.getState(), jam = useJamStore.getState().jam;
    if (!jam || ours() || s.isPlaying !== playing || s.currentTrack?.id !== trackId) return;
    const duration = s.duration || s.currentTrack?.duration || 0;
    // The song ran out: the last one ends the queue for everyone; otherwise the next track speaks for itself.
    if (!playing && duration && timeBefore >= duration - 2) {
      if (jam.index === jam.queue.length - 1 && jamTrack(jam)?.id === trackId) void control({action: 'ended', fromIndex: jam.index});
      return;
    }
    void control({action: playing ? 'play' : 'pause', position: s.currentTime || 0});
  }, 350);
}

/* ---------- actions ---------- */
export async function startJam() {
  const q = queueManager.getState(), p = usePlayerStore.getState();
  const w = q.playbackQueue[q.currentIndex] ? queueWindow(q.playbackQueue, q.currentIndex, 200) : {tracks: [] as Track[], index: 0};
  try {
    const view = await request<JamView>('', {deviceId: device.id, queue: w.tracks.map(slim), index: w.index, position: p.currentTime || 0, isPlaying: p.isPlaying});
    // The jam owns the queue now: a running wave would keep refilling only this device's copy.
    usePlayerStore.getState().stopWave();
    receive(view);
    useToastStore.getState().addToast(tr('Jam начался — позовите друзей', 'Jam started — invite your friends'), 'success', 3000);
  } catch (e) { failed(e); }
}

export async function joinJam(id: string) {
  try {
    const view = await request<JamView>(`/${encodeURIComponent(id)}/join`, {deviceId: device.id});
    usePlayerStore.getState().stopWave();
    useJamStore.setState(s => ({invites: s.invites.filter(i => i.id !== id), pendingJoin: null}));
    receive(view);
    const owner = view.members.find(m => m.owner);
    useToastStore.getState().addToast(owner ? tr(`Вы в Jam · ${owner.name}`, `You joined the Jam · ${owner.name}`) : tr('Вы в Jam', 'You joined the Jam'), 'success', 3000);
    return true;
  } catch (e) {
    useJamStore.setState(s => ({invites: s.invites.filter(i => i.id !== id), pendingJoin: null}));
    useToastStore.getState().addToast(e instanceof Error ? e.message : tr('Не удалось подключиться.', 'Could not join.'), 'warning');
    return false;
  }
}

export async function leaveJam() {
  const jam = useJamStore.getState().jam; if (!jam) return;
  forget();
  await request(`/${jam.id}/leave`, {}).catch(() => {});
}

export async function addToJam(track: Track, mode: 'end' | 'next' | 'now' = 'end') {
  const jam = useJamStore.getState().jam; if (!jam) return;
  try {
    receive(await request<JamView>(`/${jam.id}/add`, {track: slim(track), mode}));
    if (mode !== 'now') useToastStore.getState().addToast(mode === 'next' ? tr('В общей очереди — следующим', 'Next in the shared queue') : tr('Добавлено в общую очередь', 'Added to the shared queue'), 'info');
  } catch (e) { failed(e); }
}

export async function removeFromJam(key: string) {
  const jam = useJamStore.getState().jam; if (!jam) return;
  try { receive(await request<JamView>(`/${jam.id}/remove`, {key})); } catch (e) { failed(e); }
}

export function playJamEntry(index: number) {
  const jam = useJamStore.getState().jam; if (!jam || index === jam.index) return;
  void control({action: 'jump', index, fromIndex: jam.index});
}

export async function inviteToJam(publicId: string) {
  const jam = useJamStore.getState().jam; if (!jam) return false;
  try { await request(`/${jam.id}/invite`, {user: publicId}); return true; } catch (e) { failed(e); return false; }
}

/** «Слушать вместе» from a friend's profile: starts a jam with what plays now (if none yet) and invites them. */
export async function listenTogether(publicId: string, name: string) {
  if (!useJamStore.getState().jam) await startJam();
  if (!useJamStore.getState().jam) return;
  if (await inviteToJam(publicId)) useToastStore.getState().addToast(tr(`${name} получит приглашение в Jam`, `${name} is invited to the Jam`), 'success', 3000);
  openJamPanel();
}

export const jamLink = (id: string, origin = typeof location !== 'undefined' ? location.origin : 'https://oskolok.lol') => `${origin}${APP_BASE}/jam/${encodeURIComponent(id)}`;

export const fetchJamOverview = () => request<{jam: JamView | null; friends: JamSummary[]}>('');

/** Events of the jam on this device's Connect stream. */
export function handleJamEvent(event: string, data: unknown) {
  if (event === 'jam') receive(data as JamView);
  else if (event === 'jam-end') {
    const {id, reason} = data as {id: string; reason: string};
    if (useJamStore.getState().jam?.id !== id) return;
    forget(reason === 'owner-left' ? tr('Jam закончился: владелец вышел', 'The Jam ended: the host left')
      : reason === 'moved' ? tr('Jam продолжается на другом вашем устройстве', 'The Jam continues on your other device')
      : reason === 'ended' ? tr('Jam закончился', 'The Jam has ended') : undefined);
  } else if (event === 'jam-invite') {
    const invite = data as JamInvite;
    if (useJamStore.getState().jam?.id === invite.id) return;
    useJamStore.setState(s => ({invites: [invite, ...s.invites.filter(i => i.id !== invite.id)].slice(0, 3)}));
  }
}

let started = false;
/** Once per page: mirrors the jam into the player and the player's actions into the jam. */
export function initJam() {
  if (started || typeof window === 'undefined') return;
  started = true;
  queueHooks.add = (track, mode) => { if (!useJamStore.getState().jam) return false; void addToJam(track, mode); return true; };
  queueHooks.shared = () => !!useJamStore.getState().jam;
  let last = {id: '', playing: false, time: 0, at: 0};
  usePlayerStore.subscribe(s => {
    const id = s.currentTrack?.id || '', now = Date.now(), prev = last;
    last = {id, playing: s.isPlaying, time: s.currentTime || 0, at: now};
    const jam = useJamStore.getState().jam;
    if (!jam || ours() || !id) return;
    if (id !== prev.id) { clearTimeout(playTimer); onLocalTrack(jam, s.currentTrack!); return; }
    if (s.isPlaying !== prev.playing && !s.isBuffering) { onLocalPlayState(s.isPlaying, id, prev.time); return; }
    // A jump of the clock that playback alone cannot explain is a seek: everyone follows.
    const expected = prev.time + (prev.playing ? (now - prev.at) / 1000 : 0);
    const duration = s.duration || s.currentTrack?.duration || 0, rewoundAtEnd = !!duration && prev.time >= duration - 2;
    if (Math.abs((s.currentTime || 0) - expected) > 3.5 && !rewoundAtEnd) void control({action: 'seek', position: s.currentTime || 0});
  });
  // Players drift apart (buffering, a sleeping tab): every few seconds the shared second wins.
  setInterval(() => { const jam = useJamStore.getState().jam; if (jam?.isPlaying && !ours()) syncClock(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && useJamStore.getState().jam && !ours()) syncClock(); });
}
