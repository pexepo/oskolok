import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useLibraryStore} from '../stores/useLibraryStore.js';

/** The shipped desktop client (electron/distributed-preload.cjs): mini-player above other windows and Discord status. */
interface DesktopBridge {
  info?: () => Promise<{discord: boolean; shortcut: string} | null>;
  nowPlaying?: (state: Record<string, unknown>) => void;
  setPrefs?: (prefs: {miniOnMinimize?: boolean; discord?: boolean}) => void;
  toggleMini?: () => void;
  onCommand?: (callback: (action: string) => void) => () => void;
}
const bridge = (): DesktopBridge | undefined => typeof window !== 'undefined' ? (window as unknown as {oskolokDesktop?: DesktopBridge}).oskolokDesktop : undefined;
export const desktopExtrasAvailable = () => typeof bridge()?.nowPlaying === 'function';
export const toggleMiniPlayer = () => bridge()?.toggleMini?.();
export const desktopInfo = () => bridge()?.info?.() ?? Promise.resolve(null);

const PREFS = 'oskolok-desktop-prefs';
export interface DesktopPrefs { miniOnMinimize: boolean; discord: boolean }
export function getDesktopPrefs(): DesktopPrefs {
  try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); return {miniOnMinimize: p.miniOnMinimize === true, discord: p.discord !== false}; } catch { return {miniOnMinimize: false, discord: true}; }
}
export function setDesktopPrefs(patch: Partial<DesktopPrefs>) {
  const next = {...getDesktopPrefs(), ...patch};
  try { localStorage.setItem(PREFS, JSON.stringify(next)); } catch { /* private mode */ }
  bridge()?.setPrefs?.(next);
}

let started = false;
export function initDesktopBridge() {
  const b = bridge();
  if (started || !b?.nowPlaying) return;
  started = true;
  b.setPrefs?.(getDesktopPrefs());
  const absolute = (url?: string) => { try { return url ? new URL(url, location.href).href : ''; } catch { return ''; } };
  const send = () => {
    const s = usePlayerStore.getState(), t = s.currentTrack;
    b.nowPlaying!(t ? {id: t.id, title: t.title, artist: t.artist.name, artworkUrl: absolute(t.artworkUrl), duration: s.duration || t.duration || 0, position: s.currentTime || 0, playing: s.isPlaying, liked: useLibraryStore.getState().isLiked(t)} : {});
  };
  let last = {id: '', playing: false, time: 0, at: 0};
  usePlayerStore.subscribe(s => {
    const id = s.currentTrack?.id || '', now = Date.now();
    const expected = last.time + (last.playing ? (now - last.at) / 1000 : 0);
    if (id !== last.id || s.isPlaying !== last.playing || Math.abs((s.currentTime || 0) - expected) > 3) { last = {id, playing: s.isPlaying, time: s.currentTime || 0, at: now}; send(); }
  });
  useLibraryStore.subscribe(() => send());
  b.onCommand?.(action => {
    const p = usePlayerStore.getState();
    if (action === 'toggle') void p.togglePlay();
    else if (action === 'next') void p.next();
    else if (action === 'previous') void p.previous();
    else if (action === 'like' && p.currentTrack) void useLibraryStore.getState().toggleLike(p.currentTrack);
  });
  send();
}
