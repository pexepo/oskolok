import {queueManager} from './QueueManager.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {scopedStorageKey} from '../telegram/runtime.js';
import {queueWindow} from '../telegram/playbackQueue.js';
import {readSession,type SavedSession} from './retention.js';
export {readSession};

/**
 * The last session survives a restart (Spotify does this): after a reload or a new launch the player shows the
 * same track, paused at the same second, with the same queue. Stored per listener in localStorage.
 */
const KEY = 'last-session', LIMIT = 100;

let restoredAt: number | null = null, cuedId = '';
/** When the restored session was saved, while its track is still only cued (not played since). */
export function cuedSessionSavedAt(): number | null {
  const s = usePlayerStore.getState();
  return restoredAt !== null && s.currentTrack?.id === cuedId && !s.isPlaying && s.queueState.currentIndex === queueManager.getState().currentIndex ? restoredAt : null;
}


function save() {
  const s = usePlayerStore.getState(), q = queueManager.getState();
  if (!s.currentTrack || !q.playbackQueue[q.currentIndex]) return;
  const w = queueWindow(q.playbackQueue, q.currentIndex, LIMIT);
  // A track near its end restarts from zero next time instead of playing its last second.
  const near = s.duration > 0 && s.currentTime > s.duration - 5;
  const session: SavedSession = {v: 1, at: Date.now(), index: w.index, position: near ? 0 : Math.round((s.currentTime || 0) * 10) / 10, queue: w.tracks};
  try { localStorage.setItem(scopedStorageKey(KEY), JSON.stringify(session)); } catch { /* storage full or private mode */ }
}

let started = false;
export function initSessionRestore() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const saved = readSession((() => { try { return localStorage.getItem(scopedStorageKey(KEY)); } catch { return null; } })());
  if (saved && usePlayerStore.getState().restoreSession(saved.queue, saved.index, saved.position)) { restoredAt = saved.at; cuedId = saved.queue[saved.index].id; }
  let last = {id: '', playing: false, index: -1};
  usePlayerStore.subscribe(s => {
    const id = s.currentTrack?.id || '', index = s.queueState.currentIndex;
    if (id !== last.id || s.isPlaying !== last.playing || index !== last.index) { last = {id, playing: s.isPlaying, index}; if (id) save(); }
  });
  setInterval(() => { if (usePlayerStore.getState().isPlaying) save(); }, 10000);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
}
