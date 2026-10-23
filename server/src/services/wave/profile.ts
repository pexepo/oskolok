/* The listener's taste as ranking weights: artists and tracks with a signed weight built from the
   library (likes, own playlists, history) and — only with personalisation consent — from listening
   events. Technical failures never count against a track; one skip never bans an artist (capped,
   decaying with time). Weights are versioned parameters (RecommendationModel), so a change can be
   evaluated, activated and rolled back. */
import { prisma } from '../../database/client.js';
import type { Track } from '../../types/index.js';
import { latinFold } from '../trackRanking.js';

export interface RankingParams {
  like: number; playlist: number; history: number; complete: number; repeat: number; queueAdd: number;
  skipEarly: number; unlike: number; playlistRemove: number; halfLifeDays: number; skipFloor: number;
}
/** Built-in v1: library only plus event weights; the event weights stay inert without consent. */
export const DEFAULT_PARAMS: RankingParams = {
  like: 4, playlist: 2, history: 0.6, complete: 1, repeat: 1.5, queueAdd: 0.5,
  skipEarly: -0.6, unlike: -2, playlistRemove: -1, halfLifeDays: 30, skipFloor: -3,
};
export const BASELINE_VERSION = 'v1-builtin';

let activeCache: { at: number; version: string; params: RankingParams } | null = null;
export async function activeRanking(): Promise<{ version: string; params: RankingParams }> {
  if (activeCache && Date.now() - activeCache.at < 5 * 60_000) return activeCache;
  const row = await prisma.recommendationModel.findFirst({ where: { active: true } }).catch(() => null);
  let params = DEFAULT_PARAMS, version = BASELINE_VERSION;
  if (row) { try { params = { ...DEFAULT_PARAMS, ...JSON.parse(row.params) }; version = row.version; } catch { /* Keep the built-in parameters. */ } }
  activeCache = { at: Date.now(), version, params };
  return activeCache;
}
export function resetRankingCache() { activeCache = null; }

export const artistKey = (name: string) => latinFold(name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0] || name);
const parse = (rows: { trackData: string }[]): Track[] => rows.flatMap(row => { try { const t = JSON.parse(row.trackData); return t?.id && t?.artist?.name ? [t as Track] : []; } catch { return []; } });

export interface ListenEventData { listenedMs?: number; uniqueRatio?: number; endReason?: string; repeats?: number; started?: boolean; speed?: number }
export interface TasteEvent { type: string; trackId: string; artist: string; at: Date; data: ListenEventData }

export interface Taste {
  artists: Map<string, number>;
  tracks: Map<string, number>;
  likes: Track[];
  library: Track[];
  history: Track[];
  /** Track ids heard recently (to avoid close repeats). */
  recent: string[];
}

/** Pure scoring of events + library, shared by the live ranking and the offline evaluation. */
export function scoreTaste(input: { likes: Track[]; library: Track[]; history: Track[]; events: TasteEvent[]; now?: number }, p: RankingParams = DEFAULT_PARAMS): Pick<Taste, 'artists' | 'tracks'> {
  const now = input.now ?? Date.now(), artists = new Map<string, number>(), tracks = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, w: number) => { if (key) map.set(key, (map.get(key) || 0) + w); };
  input.likes.forEach(t => { bump(artists, artistKey(t.artist.name), p.like); bump(tracks, t.id, p.like); });
  input.library.forEach(t => { bump(artists, artistKey(t.artist.name), p.playlist); bump(tracks, t.id, p.playlist); });
  input.history.forEach((t, i) => bump(artists, artistKey(t.artist.name), p.history * Math.exp(-i / 60)));
  const skipsByArtist = new Map<string, number>();
  for (const e of input.events) {
    const decay = Math.pow(0.5, Math.max(0, now - e.at.getTime()) / (p.halfLifeDays * 86_400_000)), a = artistKey(e.artist);
    if (e.type === 'listen') {
      const d = e.data, reason = d.endReason || '';
      // Only audio that really played says anything about taste: errors, buffering and never-started plays are neutral.
      if (!d.started || reason === 'error' || reason === 'unavailable') continue;
      if (reason === 'natural' && (d.uniqueRatio ?? 0) >= 0.8) { bump(artists, a, p.complete * decay); bump(tracks, e.trackId, p.complete * decay); }
      if ((d.repeats || 0) > 0) { bump(artists, a, p.repeat * decay); bump(tracks, e.trackId, p.repeat * decay); }
      if (reason === 'manual-skip' && (d.uniqueRatio ?? 1) < 0.3) { skipsByArtist.set(a, (skipsByArtist.get(a) || 0) + p.skipEarly * decay); bump(tracks, e.trackId, p.skipEarly * decay); }
    } else if (e.type === 'unlike') { bump(artists, a, p.unlike * decay); bump(tracks, e.trackId, p.unlike * decay); }
    else if (e.type === 'playlist_remove') bump(tracks, e.trackId, p.playlistRemove * decay);
    else if (e.type === 'queue_add') bump(artists, a, p.queueAdd * decay);
  }
  // Skips lower an artist but never below the floor: a few skips are a mood, not a ban.
  skipsByArtist.forEach((w, a) => bump(artists, a, Math.max(p.skipFloor, w)));
  return { artists, tracks };
}

export async function personalizationAllowed(userId: string): Promise<boolean> {
  const row = await prisma.userConsent.findUnique({ where: { userId } }).catch(() => null);
  return !!row?.personalization;
}

export async function loadTaste(userId: string): Promise<Taste & { version: string }> {
  const [likedRows, playlistRows, historyRows, consent, ranking] = await Promise.all([
    prisma.likedTrack.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, take: 3000 }),
    prisma.playlistTrack.findMany({ where: { playlist: { userId } }, orderBy: { addedAt: 'desc' }, take: 3000 }),
    prisma.historyItem.findMany({ where: { userId }, orderBy: { playedAt: 'desc' }, take: 400 }),
    personalizationAllowed(userId),
    activeRanking(),
  ]);
  const events: TasteEvent[] = consent ? (await prisma.trackEvent.findMany({ where: { userId, type: { in: ['listen', 'unlike', 'playlist_remove', 'queue_add'] } }, orderBy: { at: 'desc' }, take: 3000 }).catch(() => []))
    .map(e => { let data: ListenEventData = {}; try { data = JSON.parse(e.data); } catch { /* Malformed rows count as empty. */ } return { type: e.type, trackId: e.trackId, artist: e.artist, at: e.at, data }; }) : [];
  const likes = parse(likedRows), library = parse(playlistRows), history = parse(historyRows);
  const scored = scoreTaste({ likes, library, history, events }, ranking.params);
  return { ...scored, likes, library, history, recent: history.slice(0, 60).map(t => t.id), version: ranking.version };
}
