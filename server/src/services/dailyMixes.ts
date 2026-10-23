import type { Track } from '../types/index.js';
import { prisma } from '../database/client.js';
import { deezerSimilar } from './RecommendationService.js';
import { normalizeMusicText, trackIdentity } from './trackRanking.js';

/**
 * «Миксы дня»: the listener's artists grouped by Deezer's similarity graph, one mix per group.
 * Each mix blends songs the listener already plays from that group with new songs from the
 * group's neighbourhood, so a rap evening and a calm morning don't end up in one queue.
 * Built once per day and stored, so the cards don't reshuffle on every visit.
 */
export interface DailyMix { id: string; title: string; description: string; artists: string[]; artworkUrl?: string; tracks: Track[] }

const MIXES = 4, MIX_SIZE = 30, MAX_SEEDS = 14;
const primaryArtist = (name: string) => name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0]?.trim() || name;
const key = (name: string) => normalizeMusicText(name).replace(/\s+/g, '');

type Weighted = { name: string; weight: number; tracks: Track[] };

/** Artist weights from likes (strong) and plays (recent plays count more). */
export function tasteProfile(likes: Track[], history: Track[]): Weighted[] {
  const byKey = new Map<string, Weighted>();
  const add = (track: Track, weight: number) => {
    const name = primaryArtist(track.artist?.name || '');
    const k = key(name);
    if (!k) return;
    const entry = byKey.get(k) || { name, weight: 0, tracks: [] };
    entry.weight += weight;
    if (!entry.tracks.some(t => trackIdentity(t) === trackIdentity(track))) entry.tracks.push(track);
    byKey.set(k, entry);
  };
  likes.forEach(t => add(t, 3));
  history.forEach((t, i) => add(t, i < 60 ? 1.5 : 1));
  return [...byKey.values()].sort((a, b) => b.weight - a.weight);
}

/** Greedy grouping: an artist joins the first group whose members it neighbours (either direction) or shares two neighbours with. */
export function clusterArtists(artists: Weighted[], related: Map<string, Set<string>>, max = MIXES): Weighted[][] {
  const clusters: Weighted[][] = [];
  for (const artist of artists) {
    const mine = related.get(key(artist.name)) || new Set<string>();
    const home = clusters.find(group => group.some(member => {
      const theirs = related.get(key(member.name)) || new Set<string>();
      if (mine.has(key(member.name)) || theirs.has(key(artist.name))) return true;
      let shared = 0;
      for (const name of mine) if (theirs.has(name) && ++shared >= 2) return true;
      return false;
    }));
    if (home) home.push(artist);
    else if (clusters.length < max) clusters.push([artist]);
  }
  return clusters;
}

/** No two neighbouring songs by the same artist where it can be avoided. */
export function spreadArtists(tracks: Track[]): Track[] {
  const rest = [...tracks], out: Track[] = [];
  while (rest.length) {
    const last = out.length ? key(primaryArtist(out[out.length - 1].artist.name)) : '';
    const index = rest.findIndex(t => key(primaryArtist(t.artist.name)) !== last);
    out.push(rest.splice(index < 0 ? 0 : index, 1)[0]);
  }
  return out;
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function pooled<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await run(items[i]); }
  }));
  return out;
}

const parse = (rows: { trackData: string }[]): Track[] => rows.flatMap(row => {
  try { const t = JSON.parse(row.trackData); return t?.artist?.name && t?.title && t?.id ? [t as Track] : []; } catch { return []; }
});

export async function buildDailyMixes(userId: string, day = new Date().toISOString().slice(0, 10)): Promise<DailyMix[]> {
  const [likedRows, historyRows] = await Promise.all([
    prisma.likedTrack.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, take: 1500 }),
    prisma.historyItem.findMany({ where: { userId }, orderBy: { playedAt: 'desc' }, take: 500 }),
  ]);
  const likes = parse(likedRows), history = parse(historyRows);
  const profile = tasteProfile(likes, history).filter(a => a.weight >= 2).slice(0, MAX_SEEDS);
  if (!profile.length) return [];
  const graphs = await pooled(profile, 4, a => deezerSimilar(a.name).catch(() => ({ tracks: [] as Track[], related: [] as string[] })));
  const related = new Map(profile.map((a, i) => [key(a.name), new Set(graphs[i].related.map(key))]));
  const radio = new Map(profile.map((a, i) => [key(a.name), graphs[i].tracks]));
  const heard = new Set([...likes, ...history].map(trackIdentity));
  const used = new Set<string>();
  const mixes: DailyMix[] = [];
  for (const [index, group] of clusterArtists(profile, related).entries()) {
    // Familiar: the listener's own songs by this group. New: the group's Deezer radios, round-robin.
    const familiar = seededShuffle(group.flatMap(a => a.tracks), `${day}:${index}:f`).filter(t => !used.has(trackIdentity(t))).slice(0, 12);
    const radios = group.map(a => seededShuffle((radio.get(key(a.name)) || []).filter(t => !heard.has(trackIdentity(t))), `${day}:${index}:${a.name}`));
    const fresh: Track[] = [];
    for (let round = 0; fresh.length < MIX_SIZE - familiar.length && round < 40; round++) {
      let added = false;
      for (const list of radios) {
        const track = list[round];
        if (!track) continue;
        added = true;
        const id = trackIdentity(track);
        if (used.has(id) || fresh.some(t => trackIdentity(t) === id)) continue;
        fresh.push(track);
        if (fresh.length >= MIX_SIZE - familiar.length) break;
      }
      if (!added) break;
    }
    // Two new songs for every familiar one, then spread the artists.
    const blended: Track[] = [];
    for (let f = 0, n = 0; f < familiar.length || n < fresh.length;) {
      if (n < fresh.length) blended.push(fresh[n++]);
      if (n < fresh.length) blended.push(fresh[n++]);
      if (f < familiar.length) blended.push(familiar[f++]);
    }
    const tracks = spreadArtists(blended).slice(0, MIX_SIZE);
    if (tracks.length < 8) continue;
    tracks.forEach(t => used.add(trackIdentity(t)));
    const artists = group.map(a => a.name).slice(0, 4);
    const lead = tracks.find(t => key(primaryArtist(t.artist.name)) === key(group[0].name)) || tracks[0];
    mixes.push({ id: `daily-${day}-${mixes.length + 1}`, title: `Микс дня ${mixes.length + 1}`, description: artists.join(', '), artists, artworkUrl: lead.artworkUrl, tracks });
  }
  return mixes;
}

/** One edition per user per day, kept in the shared enrichment store. */
export async function dailyMixesFor(userId: string): Promise<DailyMix[]> {
  const day = new Date().toISOString().slice(0, 10), id = `daily-mix:v1:${userId}:${day}`;
  const stored = await prisma.artistEnrichment.findUnique({ where: { id } }).catch(() => null);
  if (stored) { try { return JSON.parse(stored.data) as DailyMix[]; } catch { /* Rebuild a damaged entry. */ } }
  const mixes = await buildDailyMixes(userId, day);
  // An empty answer (new listener, Deezer down) is not stored: it is retried on the next visit.
  if (mixes.length) await prisma.artistEnrichment.upsert({ where: { id }, create: { id, data: JSON.stringify(mixes) }, update: { data: JSON.stringify(mixes) } }).catch(() => {});
  return mixes;
}

/** «Радио по треку»: the song's artist and its Deezer neighbourhood, the seed song first. */
export async function trackRadio(seed: Track, limit = 40): Promise<Track[]> {
  const graph = await deezerSimilar(primaryArtist(seed.artist.name)).catch(() => ({ tracks: [] as Track[], related: [] as string[] }));
  const seen = new Set([trackIdentity(seed)]);
  const rest = seededShuffle(graph.tracks, `${seed.id}:${new Date().toISOString().slice(0, 13)}`).filter(t => { const id = trackIdentity(t); if (seen.has(id)) return false; seen.add(id); return true; });
  return [seed, ...spreadArtists(rest)].slice(0, limit);
}
