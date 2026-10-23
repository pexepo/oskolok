/* «Волна на двоих» (Яндекс, июль 2026; Spotify Blend): one Резонанс built from two friends' tastes.
   Both libraries feed the seeds on equal terms — each side is capped to the same depth and their likes,
   playlists and history are interleaved, so the recency weighting of the personal wave treats them alike
   and a listener with three thousand likes does not drown a friend with thirty. Artists both of them
   love lead. The finished batch alternates «yours» and «theirs», with common ground in between. */
import type { Track } from '../../types/index.js';
import { loadTaste, artistKey, type Taste } from './profile.js';
import { buildPersonalWave, seedWeights, type PersonalWaveOptions } from './personalWave.js';
import type { WaveV2Result } from './waveV2.js';

export type BlendOwner = 'a' | 'b' | 'both';
type VersionedTaste = Taste & { version: string };

const DEPTH = { likes: 120, library: 150, history: 120 };
const NO_SESSION = { liked: [], finished: [], skips: new Map<string, number>() };

function interleave<T>(a: T[], b: T[], key: (item: T) => string): T[] {
  const out: T[] = [], seen = new Set<string>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) for (const item of [a[i], b[i]]) {
    if (item === undefined) continue;
    const k = key(item);
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out;
}

/** Scales positive weights to the same total, so both listeners count equally. */
function normalised(weights: Map<string, number>, total = 100): Map<string, number> {
  const sum = [...weights.values()].reduce((s, w) => s + Math.max(0, w), 0);
  const k = sum > 0 ? total / sum : 0;
  return new Map([...weights.entries()].map(([key, w]) => [key, w > 0 ? w * k : w]));
}

function mergeWeights(a: Map<string, number>, b: Map<string, number>, sharedBoost: number): Map<string, number> {
  const na = normalised(a), nb = normalised(b), out = new Map<string, number>();
  for (const key of new Set([...na.keys(), ...nb.keys()])) {
    const wa = na.get(key) || 0, wb = nb.get(key) || 0;
    out.set(key, wa > 0 && wb > 0 ? (wa + wb) * sharedBoost : wa + wb);
  }
  return out;
}

/** Two tastes as one, both on equal terms. Pure, for tests. */
export function blendTastes(a: VersionedTaste, b: VersionedTaste): VersionedTaste {
  const id = (t: Track) => t.id;
  return {
    artists: mergeWeights(a.artists, b.artists, 1.5),
    tracks: mergeWeights(a.tracks, b.tracks, 1.5),
    likes: interleave(a.likes.slice(0, DEPTH.likes), b.likes.slice(0, DEPTH.likes), id),
    library: interleave(a.library.slice(0, DEPTH.library), b.library.slice(0, DEPTH.library), id),
    history: interleave(a.history.slice(0, DEPTH.history), b.history.slice(0, DEPTH.history), id),
    recent: [...new Set([...a.recent, ...b.recent])],
    version: `blend:${a.version}`,
  };
}

/** Whose taste a track comes from: its own place in a library, else its artist, else the seed it was found through. */
export function blendOwnership(a: Taste, b: Taste) {
  const wa = seedWeights(a, NO_SESSION), wb = seedWeights(b, NO_SESSION);
  const tracksA = new Set([...a.likes, ...a.library].map(t => t.id)), tracksB = new Set([...b.likes, ...b.library].map(t => t.id));
  const byArtist = (key: string): BlendOwner | undefined => {
    const inA = (wa.get(key)?.w || 0) >= 2, inB = (wb.get(key)?.w || 0) >= 2;
    return inA && inB ? 'both' : inA ? 'a' : inB ? 'b' : undefined;
  };
  return (track: Track, via?: string): BlendOwner | undefined => {
    const inA = tracksA.has(track.id), inB = tracksB.has(track.id);
    if (inA || inB) return inA && inB ? 'both' : inA ? 'a' : 'b';
    return byArtist(artistKey(track.artist.name)) || (via ? byArtist(artistKey(via)) : undefined);
  };
}

/** «Yours», «theirs», «yours», «theirs» — shared picks open the stream and come back every third place. Pure, for tests. */
export function interleaveByOwner<T>(items: T[], ownerOf: (item: T) => BlendOwner | undefined): T[] {
  const a: T[] = [], b: T[] = [], shared: T[] = [];
  items.forEach(item => { const o = ownerOf(item); (o === 'a' ? a : o === 'b' ? b : shared).push(item); });
  const out: T[] = [];
  let turn: 'a' | 'b' = a.length >= b.length ? 'a' : 'b';
  while (a.length || b.length || shared.length) {
    if (shared.length && out.length % 3 === 0) { out.push(shared.shift()!); continue; }
    const own = turn === 'a' ? a : b, other = turn === 'a' ? b : a;
    out.push((own.shift() ?? other.shift() ?? shared.shift())!);
    turn = turn === 'a' ? 'b' : 'a';
  }
  return out;
}

export interface BlendPartner { userId: string; name: string }

export async function buildBlendWave(options: PersonalWaveOptions, partner: BlendPartner): Promise<WaveV2Result> {
  const [mine, theirs] = await Promise.all([loadTaste(options.userId), loadTaste(partner.userId)]);
  const ownerOf = blendOwnership(mine, theirs), owners = new Map<string, BlendOwner>();
  const label = (o: BlendOwner | undefined) => o === 'both' ? 'Нравится вам обоим' : o === 'a' ? 'Из вашего вкуса' : o === 'b' ? `Из вкуса: ${partner.name}` : '';
  // «Из коллекции» means one listener's own shelf; on two it is the shared stream.
  const result = await buildPersonalWave({
    ...options, mode: options.mode === 'niche' ? 'niche' : null,
    describe: (track, via, reason, origin) => {
      const o = ownerOf(track, via);
      if (o) owners.set(track.id, o);
      // A favourite coming back belongs to whoever liked it, not always to «you».
      if (origin === 'replay') return o === 'b' ? `Любимое у ${partner.name}` : o === 'both' ? 'Любимое у вас обоих' : 'Из ваших любимых';
      return o ? `${label(o)} · ${reason}` : reason;
    },
  }, blendTastes(mine, theirs));
  return { ...result, tracks: interleaveByOwner(result.tracks, t => owners.get(t.id)) };
}
