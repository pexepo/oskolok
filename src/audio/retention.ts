import type {Track} from '../types/index.js';

/** Pure helpers of the sleep timer, session restore and autoplay (no DOM, no stores) — shared with tests. */

/** Sleep-timer fade factor: 1 until the last `fade` seconds, then down to 0. */
export function fadeGainAt(remainingSeconds: number, fade = 12) {
  if (remainingSeconds >= fade) return 1;
  return Math.max(0, remainingSeconds / fade);
}
export function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), sec = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export interface SavedSession { v: 1; at: number; index: number; position: number; queue: Track[] }
const SESSION_MAX_AGE = 14 * 86400000;
export function readSession(raw: string | null, now = Date.now()): SavedSession | null {
  try {
    const s = raw ? JSON.parse(raw) as SavedSession : null;
    if (!s || s.v !== 1 || !Array.isArray(s.queue) || !s.queue[s.index]?.id || now - s.at > SESSION_MAX_AGE) return null;
    return s;
  } catch { return null; }
}

export interface AutoplaySeed { releaseId: string; title?: string; artists: string[]; trackIds: string[] }
/** Autoplay seed from what was just listened to: the three artists that dominate the last tracks, recent ones weigh more. */
export function queueSeedOf(tracks: Track[]): AutoplaySeed | null {
  if (!tracks.length) return null;
  const recent = tracks.slice(-25), weight = new Map<string, number>();
  recent.forEach((t, i) => { const name = t?.artist?.name?.split(',')[0].trim(); if (name) weight.set(name, (weight.get(name) || 0) + 1 + i / recent.length); });
  const artists = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  if (!artists.length) return null;
  return { releaseId: 'autoplay', artists, trackIds: tracks.slice(-200).filter(Boolean).map(t => t.id) };
}
