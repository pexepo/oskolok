import {create} from 'zustand';
import {apiClient} from '../api/apiClient.js';
import {apiBase,scopedStorageKey} from '../telegram/runtime.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import type {Track} from '../types/index.js';

/**
 * Offline listening (Spotify / Яндекс «Скачать»): the audio of chosen tracks is kept in Cache Storage on this
 * device and played from there — with or without a network. Cache Storage works in the browser, Telegram,
 * Electron and the iOS/Android shells alike, so no service worker is needed for playback.
 */
const CACHE = 'osk-offline-audio-v1'; // not «oskolok-…»: the shell service worker deletes those on update
const INDEX = 'offline-index', LIMIT = 3000;
export interface OfflineEntry { track: Track; size: number; savedAt: number }
type Status = 'queued' | 'downloading' | 'error';
interface OfflineState { entries: Record<string, OfflineEntry>; pending: Record<string, Status>; progress: Record<string, number> }
export const useOfflineStore = create<OfflineState>(() => ({entries: {}, pending: {}, progress: {}}));

const audioKey = (id: string) => `/offline/audio/${encodeURIComponent(id)}`;
const artKey = (id: string) => `/offline/art/${encodeURIComponent(id)}`;
const supported = () => typeof caches !== 'undefined' && typeof window !== 'undefined';

let loadedFor = '';
function indexKey() { return scopedStorageKey(INDEX); }
/** Reads the list of downloaded tracks for the signed-in listener (once per listener). */
export function loadOfflineIndex() {
  const key = indexKey();
  if (loadedFor === key) return;
  loadedFor = key;
  let entries: Record<string, OfflineEntry> = {};
  try { const list = JSON.parse(localStorage.getItem(key) || '[]') as OfflineEntry[]; for (const e of list) if (e?.track?.id) entries[e.track.id] = e; } catch { entries = {}; }
  useOfflineStore.setState({entries});
}
function saveIndex() {
  const list = Object.values(useOfflineStore.getState().entries).sort((a, b) => b.savedAt - a.savedAt).slice(0, LIMIT);
  try { localStorage.setItem(indexKey(), JSON.stringify(list)); } catch { /* storage full: the cache still holds the audio */ }
}
export const isDownloaded = (id: string) => { loadOfflineIndex(); return !!useOfflineStore.getState().entries[id]; };

const objectUrls = new Map<string, string>();
/** A playable blob URL for a downloaded track, or null. */
export async function offlineAudioUrl(id: string): Promise<string | null> {
  if (!supported() || !isDownloaded(id)) return null;
  const known = objectUrls.get(id); if (known) return known;
  try {
    const hit = await (await caches.open(CACHE)).match(audioKey(id));
    if (!hit) { forget(id); return null; }
    const url = URL.createObjectURL(await hit.blob());
    // Keep a few recent URLs alive (back/forward in the queue); older ones are released.
    objectUrls.set(id, url);
    if (objectUrls.size > 6) { const [oldId, oldUrl] = objectUrls.entries().next().value as [string, string]; objectUrls.delete(oldId); URL.revokeObjectURL(oldUrl); }
    return url;
  } catch { return null; }
}
export async function offlineArtworkUrl(id: string): Promise<string | null> {
  if (!supported()) return null;
  try { const hit = await (await caches.open(CACHE)).match(artKey(id)); return hit ? URL.createObjectURL(await hit.blob()) : null; } catch { return null; }
}

function forget(id: string) {
  const {entries} = useOfflineStore.getState();
  if (!entries[id]) return;
  const next = {...entries}; delete next[id];
  useOfflineStore.setState({entries: next}); saveIndex();
}

/** Fetches the full audio; the server may still be resolving a source (202/503) — wait like the player does. */
async function fetchAudio(track: Track, onProgress: (p: number) => void): Promise<Blob> {
  const url = apiClient.getStreamUrl(track.id);
  const delays = [0, 3000, 5000, 6000, 6000, 8000];
  for (const delay of delays) {
    if (delay) await new Promise(r => setTimeout(r, delay));
    const response = await fetch(url, {credentials: 'include'});
    if (response.status === 202 || response.status === 503) { await response.body?.cancel(); continue; }
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('Content-Length')) || 0, type = response.headers.get('Content-Type') || 'audio/mp4';
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) { const {value, done} = await reader.read(); if (done) break; chunks.push(value); received += value.length; if (total) onProgress(Math.min(.99, received / total)); }
    if (received < 32 * 1024) throw new Error('too small');
    return new Blob(chunks as BlobPart[], {type});
  }
  throw new Error('timeout');
}

let queue: Track[] = [], running = false, persistAsked = false;
function clearPending(id: string) {
  useOfflineStore.setState(s => { const pending = {...s.pending}, progress = {...s.progress}; delete pending[id]; delete progress[id]; return {pending, progress}; });
}
async function work() {
  if (running) return;
  running = true;
  let failed = 0;
  try {
    while (queue.length) {
      const track = queue.shift()!;
      if (isDownloaded(track.id)) { clearPending(track.id); continue; }
      useOfflineStore.setState(s => ({pending: {...s.pending, [track.id]: 'downloading'}, progress: {...s.progress, [track.id]: 0}}));
      try {
        const blob = await fetchAudio(track, p => useOfflineStore.setState(s => ({progress: {...s.progress, [track.id]: p}})));
        const cache = await caches.open(CACHE);
        await cache.put(audioKey(track.id), new Response(blob, {headers: {'Content-Type': blob.type, 'Content-Length': String(blob.size)}}));
        if (track.artworkUrl) {
          try {
            const art = await fetch(`${apiBase}/artwork?url=${encodeURIComponent(track.artworkUrl)}`, {credentials: 'include'});
            if (art.ok) await cache.put(artKey(track.id), new Response(await art.blob(), {headers: {'Content-Type': art.headers.get('Content-Type') || 'image/jpeg'}}));
          } catch { /* the cover is optional */ }
        }
        useOfflineStore.setState(s => ({entries: {...s.entries, [track.id]: {track, size: blob.size, savedAt: Date.now()}}}));
        saveIndex(); clearPending(track.id);
      } catch (e) {
        if ((e as Error)?.name === 'QuotaExceededError') {
          useToastStore.getState().addToast(tr('На устройстве закончилось место для скачанной музыки.', 'The device ran out of space for downloaded music.'), 'warning', 6000);
          for (const t of [track, ...queue]) clearPending(t.id);
          queue = []; break;
        }
        useOfflineStore.setState(s => ({pending: {...s.pending, [track.id]: 'error'}}));
        failed++;
      }
    }
  } finally {
    running = false;
    if (failed) useToastStore.getState().addToast(tr(`Не удалось скачать треков: ${failed}. Источник сейчас недоступен — попробуйте позже.`, `Could not download ${failed} tracks. The source is unavailable right now — try later.`), 'warning', 6000);
  }
}

/** Queues tracks for download (blocked ones and duplicates are skipped). */
export function downloadTracks(tracks: Track[]) {
  if (!supported()) { useToastStore.getState().addToast(tr('Это устройство не умеет хранить музыку офлайн.', 'This device cannot keep music offline.'), 'warning'); return; }
  loadOfflineIndex();
  if (!persistAsked) { persistAsked = true; void navigator.storage?.persist?.().catch(() => false); }
  const {entries, pending} = useOfflineStore.getState();
  const fresh = tracks.filter(t => t.access !== 'blocked' && !entries[t.id] && pending[t.id] !== 'queued' && pending[t.id] !== 'downloading' && !queue.some(q => q.id === t.id));
  if (!fresh.length) return;
  queue.push(...fresh);
  useToastStore.getState().addToast(tr(`Скачиваем на устройство: ${fresh.length}. Найдёте в «Коллекция» → «Скачанное».`, `Downloading to this device: ${fresh.length}. Find them in Collection → Downloads.`), 'info', 4000);
  useOfflineStore.setState(s => ({pending: {...s.pending, ...Object.fromEntries(fresh.map(t => [t.id, 'queued' as Status]))}}));
  void work();
}
export async function removeDownloads(ids: string[]) {
  queue = queue.filter(t => !ids.includes(t.id));
  for (const id of ids) clearPending(id);
  if (supported()) { try { const cache = await caches.open(CACHE); await Promise.all(ids.flatMap(id => [cache.delete(audioKey(id)), cache.delete(artKey(id))])); } catch { /* nothing to delete */ } }
  for (const id of ids) { const u = objectUrls.get(id); if (u) { URL.revokeObjectURL(u); objectUrls.delete(id); } }
  const entries = {...useOfflineStore.getState().entries};
  for (const id of ids) delete entries[id];
  useOfflineStore.setState({entries}); saveIndex();
}
export const totalOfflineBytes = (s: OfflineState) => Object.values(s.entries).reduce((n, e) => n + e.size, 0);
export function formatBytes(n: number) { return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ` : `${Math.max(1, Math.round(n / 1024 ** 2))} МБ`; }
