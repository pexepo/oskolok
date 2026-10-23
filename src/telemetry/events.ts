import { apiClient } from '../api/apiClient.js';
import { scopedStorageKey } from '../telegram/runtime.js';
import { useConsentStore, onPersonalizationChange } from './consent.js';
import type { Track } from '../types/index.js';

/* Listening events: buffered, sent in batches (≤50, every 30 s, at 20 events, or when the page hides),
   retried with backoff, de-duplicated on the server by event id. Collected only with personalisation
   consent; a revoked consent empties the buffer. Unsent events expire after 3 days and the buffer holds
   at most 300, so an unreachable server never makes it grow without bound. No search text, no device data. */
export const EVENT_SCHEMA_VERSION = 1;
export type EventType = 'impression' | 'select' | 'play_request' | 'play_start' | 'listen' | 'queue_add' | 'queue_remove' | 'queue_move'
  | 'like' | 'unlike' | 'playlist_add' | 'playlist_remove' | 'open_release' | 'open_artist' | 'speed_change';
export interface ListeningEvent { id: string; v: number; type: EventType; trackId: string; artist: string; sessionId: string; context: string; at: string; data: Record<string, unknown> }

const KEY = 'telemetry_queue_v1', MAX_QUEUE = 300, TTL = 3 * 86_400_000, BATCH = 50;
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16).padStart(12, '0')}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`.replace(/^(.{8})(.{4})/, '$1-$2'));
const contextPattern = /^[a-z-]{0,24}(:[\w:.-]{0,120})?$/;

let queue: ListeningEvent[] | null = null;
let timer: ReturnType<typeof setTimeout> | undefined, sending = false, failures = 0;

function load(): ListeningEvent[] {
  if (queue) return queue;
  try { queue = JSON.parse(localStorage.getItem(scopedStorageKey(KEY)) || '[]') as ListeningEvent[]; } catch { queue = []; }
  const cutoff = Date.now() - TTL;
  queue = queue.filter(e => e && e.id && Date.parse(e.at) > cutoff).slice(-MAX_QUEUE);
  return queue;
}
function persist() { try { localStorage.setItem(scopedStorageKey(KEY), JSON.stringify(load())); } catch { /* Quota: the in-memory buffer still sends. */ } }
export function clearEventQueue() { queue = []; persist(); clearTimeout(timer); timer = undefined; }
export const pendingEvents = () => load().length;

export function trackEvent(type: EventType, track: Pick<Track, 'id' | 'artist'> | null | undefined, sessionId: string, context = '', data: Record<string, unknown> = {}) {
  if (!track?.id || !useConsentStore.getState().personalization) return;
  const list = load();
  list.push({ id: uuid(), v: EVENT_SCHEMA_VERSION, type, trackId: track.id.slice(0, 200), artist: (track.artist?.name || '').slice(0, 200), sessionId: sessionId.slice(0, 64), context: contextPattern.test(context) ? context : '', at: new Date().toISOString(), data });
  if (list.length > MAX_QUEUE) list.splice(0, list.length - MAX_QUEUE);
  persist();
  schedule(list.length >= 20 ? 0 : 30_000);
}

function schedule(delay: number) {
  if (timer && delay > 0) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
}

export async function flush(keepalive = false): Promise<void> {
  if (sending || !useConsentStore.getState().personalization) return;
  const list = load();
  if (!list.length) return;
  sending = true;
  const batch = list.slice(0, BATCH);
  try {
    await apiClient.request('/events', { method: 'POST', body: JSON.stringify({ events: batch }), keepalive });
    const sent = new Set(batch.map(e => e.id));
    queue = load().filter(e => !sent.has(e.id)); persist();
    failures = 0;
    if (queue.length) schedule(1000);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 403) { clearEventQueue(); void useConsentStore.getState().load(); }
    else if (status === 400) { const bad = new Set(batch.map(e => e.id)); queue = load().filter(e => !bad.has(e.id)); persist(); }
    else { failures++; schedule(Math.min(600_000, 30_000 * 2 ** Math.min(5, failures))); }
  } finally { sending = false; }
}

if (typeof window !== 'undefined') {
  onPersonalizationChange(on => { if (!on) clearEventQueue(); else schedule(5_000); });
  window.addEventListener('pagehide', () => { void flush(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(true); });
  window.addEventListener('online', () => schedule(2_000));
}
export const newSessionId = uuid;
