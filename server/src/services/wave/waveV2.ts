/* Резонанс v2 batch builder.
   Settings: language (RU/EN/JA or none) → subgenre and mood of that language (or «без ограничения»)
   → mode: default, «что-то нишевое» or «из коллекции». Hard filters (language, subgenre, mood,
   collection membership, playability, recent repeats) are applied before ranking; they are never
   relaxed silently. When nothing qualifies the answer says why, so the client can explain it. */
import type { Track } from '../../types/index.js';
import { recommendationService, type WaveSignal } from '../RecommendationService.js';
import { trackIdentity } from '../trackRanking.js';
import { logger } from '../../utils/logger.js';
import { moodOf, subgenreOf, waveSubgenres, type SubgenreDef, type WaveLang, type WaveRequestV2 } from './taxonomy.js';
import { animeSongs, animeThemeType, artistTopTracks, deezerArtist, relatedArtists, resolveAnimeSong, themedPlaylistTracks, type DzArtist } from './sources.js';
import { artistKey, loadTaste, type Taste } from './profile.js';
import { matchesLanguage } from './language.js';
import { buildPersonalWave } from './personalWave.js';

export interface WaveV2Options extends WaveRequestV2 {
  userId: string;
  limit: number;
  batch: number;
  excludeTrackIds: string[];
  skipped: WaveSignal[];
  liked: WaveSignal[];
  recentArtists: string[];
  /** Wave tracks played to the end this session. */
  finished?: WaveSignal[];
}
export type WaveEmptyReason = 'empty-collection' | 'no-match' | 'unavailable';
export interface WaveV2Result {
  tracks: Track[];
  status: 'ok' | 'empty';
  reason?: WaveEmptyReason;
  /** A finite pool (the collection) ran out and older tracks come round again. */
  repeating?: boolean;
  /** Mood could not be checked for this combination (no themed playlists found). */
  moodUnverified?: boolean;
  version: string;
}

type Candidate = { track: Track; origin: 'anchor' | 'related' | 'mood' | 'personal' | 'anime'; fromSource: boolean };
const LANG_WORD: Record<WaveLang, string> = { ru: 'русский', en: 'english', ja: 'japanese' };
const rotate = <T,>(items: T[], by: number) => items.length ? [...items.slice(by % items.length), ...items.slice(0, by % items.length)] : items;
const settle = async <T,>(work: Promise<T>, fallback: T, ms = 8000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  finally { clearTimeout(timer); }
};
const primaryKey = (t: Track) => artistKey(t.artist.name);

/** Artists of a scene: its anchors plus Deezer's related acts of a few of them (cached a day). */
export async function sceneArtists(sub: SubgenreDef): Promise<Set<string>> {
  const names = [...sub.popular, ...sub.niche];
  const keys = new Set(names.map(artistKey));
  const seeds = (await Promise.all(names.slice(0, 6).map(n => settle(deezerArtist(n), null)))).filter((a): a is DzArtist => !!a);
  (await Promise.all(seeds.map(a => settle(relatedArtists(a), [] as DzArtist[])))).flat().forEach(a => keys.add(artistKey(a.name)));
  return keys;
}

/** Mood membership: artists appearing in themed Deezer playlists for this language/scene and mood. */
export async function moodArtists(lang: WaveLang, sub: SubgenreDef | undefined, queries: string[]): Promise<{ tracks: Track[]; artists: Set<string> }> {
  // The scene's own mood playlists, then language-wide ones; every synonym of the mood widens the artist set.
  const phrases = queries.flatMap(q => [...(sub ? [`${sub.query} ${q}`] : []), `${LANG_WORD[lang]} ${q}`]);
  const lists = await Promise.all(phrases.map(phrase => settle(themedPlaylistTracks(phrase, 2), [] as Track[], 9000)));
  const tracks = lists.flat();
  return { tracks, artists: new Set(tracks.map(primaryKey)) };
}

export async function buildWaveV2(options: WaveV2Options): Promise<WaveV2Result> {
  const limit = Math.max(1, Math.min(40, options.limit || 20));
  const taste = await loadTaste(options.userId);
  // Everything but anime themes and «из коллекции» is built around the listener's own taste (v3).
  const animeScene = options.language !== 'all' && !!subgenreOf(options.language as WaveLang, options.subgenre)?.anime;
  if (options.mode !== 'collection' && !animeScene) return buildPersonalWave(options, taste);
  if (options.language === 'all') return legacyAllLanguages(options, taste, limit);
  const lang = options.language as WaveLang;
  const sub = subgenreOf(lang, options.subgenre), mood = moodOf(lang, options.mood);
  const excluded = new Set(options.excludeTrackIds.slice(-300));
  const skippedIds = new Set(options.skipped.map(s => s.id));
  const recentArtists = new Set(options.recentArtists.slice(-8).map(artistKey));
  const sessionSkips = new Map<string, number>();
  options.skipped.slice(-40).forEach(s => sessionSkips.set(artistKey(s.artist), (sessionSkips.get(artistKey(s.artist)) || 0) + 1));
  const sessionLiked = new Set(options.liked.map(s => artistKey(s.artist)));

  const moodSet = mood ? await moodArtists(lang, sub, mood.queries) : null;
  const moodUnverified = !!mood && !!moodSet && moodSet.artists.size === 0;
  const scene = sub && !sub.anime ? await sceneArtists(sub) : null;
  const inScene = (t: Track) => !scene || scene.has(primaryKey(t));
  const inMood = (t: Track) => !moodSet || moodUnverified || moodSet.artists.has(primaryKey(t));

  /* ---------- «из коллекции»: only the listener's own tracks ---------- */
  if (options.mode === 'collection') {
    const pool = dedupe([...taste.likes, ...taste.library]);
    if (!pool.length) return { tracks: [], status: 'empty', reason: 'empty-collection', version: taste.version };
    let matching = pool.filter(t => matchesLanguage(t, lang, 'collection') && inScene(t) && inMood(t));
    if (sub?.anime) {
      const sample = matching.slice(0, 120);
      const verified = await Promise.all(sample.map(t => settle(animeThemeType(t), null, 9000)));
      matching = sample.filter((_, i) => verified[i] === sub.anime);
    }
    if (!matching.length) return { tracks: [], status: 'empty', reason: 'no-match', moodUnverified, version: taste.version };
    return collectionBatch(matching, options, taste, limit, moodUnverified);
  }

  /* ---------- catalogue candidates ---------- */
  const niche = options.mode === 'niche';
  const candidates: Candidate[] = [];
  const add = (tracks: Track[], origin: Candidate['origin'], fromSource = true) => tracks.forEach(track => candidates.push({ track, origin, fromSource }));
  const tasks: Promise<void>[] = [];
  /** «Нишевое»: artists known to be small (niche anchors and related acts under the follower bar). */
  const nicheKeys = new Set<string>();
  const subs = sub ? [sub] : rotate(waveSubgenres(lang).filter(s => !s.anime), options.batch).slice(0, 3);
  if (sub?.anime) {
    tasks.push((async () => {
      const songs = rotate(await settle(animeSongs(sub.anime!, options.batch, niche), []), options.batch * 7).slice(0, mood ? 70 : 40);
      const resolved = await Promise.all(songs.map(song => settle(resolveAnimeSong(song), null, 9000)));
      add(resolved.filter((t): t is Track => !!t), 'anime');
    })());
  } else {
    for (const s of subs) {
      const anchors = rotate(niche ? s.niche : [...s.popular, ...s.niche.slice(0, 3)], options.batch * 2).slice(0, sub ? 5 : 3);
      tasks.push((async () => {
        const artists = (await Promise.all(anchors.map(n => settle(deezerArtist(n), null)))).filter((a): a is DzArtist => !!a);
        const tops = await Promise.all(artists.map(a => settle(artistTopTracks(a, 15), [] as Track[])));
        tops.forEach(list => add(rotate(list, options.batch * 3).slice(0, niche ? 6 : 4), 'anchor'));
        // Neighbours: «нишевое» keeps the smaller acts among them.
        const related = (await Promise.all(artists.slice(0, 3).map(a => settle(relatedArtists(a), [] as DzArtist[])))).flat();
        const small = related.filter(r => r.fans < 150_000);
        if (niche) { artists.forEach(a => nicheKeys.add(artistKey(a.name))); small.forEach(a => nicheKeys.add(artistKey(a.name))); }
        const picked = rotate(niche ? small : related, options.batch).slice(0, niche ? 5 : 3);
        const relTops = await Promise.all(picked.map(a => settle(artistTopTracks(a, 10), [] as Track[])));
        relTops.forEach(list => add(rotate(list, options.batch).slice(0, 3), 'related'));
      })());
    }
  }
  // Mood playlists are candidates only outside anime: an anime song must come from AnimeThemes.
  if (moodSet?.tracks.length && !sub?.anime) add(moodSet.tracks, 'mood');
  // The listener's own artists of this language and scene.
  const favourites = new Set([...taste.artists.entries()].filter(([, w]) => w > 1).map(([key]) => key));
  const ownInLanguage = dedupe([...taste.likes, ...taste.library, ...taste.history]).filter(t => matchesLanguage(t, lang, 'collection') && inScene(t));
  const ownArtists = rotate([...new Set(ownInLanguage.map(t => t.artist.name.split(',')[0].trim()))].filter(n => favourites.has(artistKey(n))), options.batch).slice(0, niche ? 1 : 3);
  if (!sub?.anime) tasks.push((async () => {
    const artists = (await Promise.all(ownArtists.map(n => settle(deezerArtist(n), null)))).filter((a): a is DzArtist => !!a);
    const tops = await Promise.all(artists.map(a => settle(artistTopTracks(a, 12), [] as Track[])));
    tops.forEach(list => add(rotate(list, options.batch * 2).slice(0, 4), 'personal'));
  })());
  await Promise.all(tasks.map(task => settle(task, undefined, 12000)));

  /* ---------- mood by neighbourhood ----------
     Small acts rarely sit in big mood playlists: an artist also passes when one of its Deezer related acts does. */
  if (moodSet && !moodUnverified) {
    const outside = [...new Map(candidates.filter(c => c.origin !== 'mood' && !moodSet.artists.has(primaryKey(c.track))).map(c => [primaryKey(c.track), c.track.artist.name.split(',')[0].trim()])).values()].slice(0, 24);
    const verdicts = await Promise.all(outside.map(async name => {
      const artist = await settle(deezerArtist(name), null);
      const related = artist ? await settle(relatedArtists(artist), [] as DzArtist[]) : [];
      return related.some(r => moodSet.artists.has(artistKey(r.name))) ? artistKey(name) : '';
    }));
    verdicts.filter(Boolean).forEach(key => moodSet.artists.add(key));
  }

  /* ---------- hard filters ---------- */
  const seen = new Set<string>();
  let eligible = candidates.filter(c => {
    const t = c.track, id = trackIdentity(t);
    if (seen.has(t.id) || seen.has(id)) return false;
    seen.add(t.id); seen.add(id);
    if (excluded.has(t.id) || skippedIds.has(t.id) || taste.recent.includes(t.id)) return false;
    if (t.access !== 'playable' || t.duration < 45) return false;
    if ((sessionSkips.get(primaryKey(t)) || 0) >= 2) return false;
    if (!matchesLanguage(t, lang, c.fromSource ? 'source' : 'none')) return false;
    if (!sub?.anime && c.origin === 'mood' && scene && !inScene(t)) return false;
    // A famous name found through a mood playlist is not «нишевое», however obscure that one recording is.
    // The same holds for a niche act's feature on a star's single: the lead artist decides.
    if (niche && c.origin !== 'personal' && c.origin !== 'anime' && !nicheKeys.has(primaryKey(t))) return false;
    return sub?.anime ? true : inMood(t);
  });
  if (sub?.anime && moodSet && !moodUnverified) eligible = eligible.filter(c => moodSet.artists.has(primaryKey(c.track)));
  if (!eligible.length) {
    const reason: WaveEmptyReason = candidates.length ? 'no-match' : 'unavailable';
    logger.info({ lang, subgenre: sub?.id, mood: mood?.id, mode: options.mode, candidates: candidates.length, reason }, 'Wave v2 batch empty');
    return { tracks: [], status: 'empty', reason, moodUnverified, version: taste.version };
  }

  /* ---------- ranking ---------- */
  const scored = eligible.map(c => {
    const t = c.track, key = primaryKey(t), affinity = taste.artists.get(key) || 0, pop = t.popularity ?? 50;
    let score = Math.random() * 6;
    if (niche) {
      score += (100 - pop) * 0.35;                      // less played tracks first
      score -= Math.max(0, affinity) * 2;               // and away from what the listener already knows
      if (c.origin === 'related') score += 8;
    } else {
      score += Math.min(12, Math.max(-6, affinity) * 1.5) + (taste.tracks.get(t.id) || 0);
      score += Math.min(20, pop * 0.15);
      if (c.origin === 'personal') score += 6;
    }
    if (sessionLiked.has(key)) score += 10;
    if (recentArtists.has(key)) score -= 12;
    score -= 6 * (sessionSkips.get(key) || 0);
    if (moodSet && !moodUnverified && moodSet.artists.has(key)) score += 5;
    return { t, score };
  }).sort((a, b) => b.score - a.score).map(x => x.t);
  return { tracks: spread(scored, niche ? 1 : 2).slice(0, limit), status: 'ok', moodUnverified, version: taste.version };
}

/** No language chosen: the existing personal wave, with the two modes mapped onto its characters. */
async function legacyAllLanguages(options: WaveV2Options, taste: Taste & { version: string }, limit: number): Promise<WaveV2Result> {
  if (options.mode === 'collection') {
    const pool = dedupe([...taste.likes, ...taste.library]);
    if (!pool.length) return { tracks: [], status: 'empty', reason: 'empty-collection', version: taste.version };
    return collectionBatch(pool, options, taste, limit, false);
  }
  const tracks = await recommendationService.getRecommendations({
    userId: options.userId, limit, character: options.mode === 'niche' ? 'discovery' : 'familiar', language: 'all',
    excludeTrackIds: options.excludeTrackIds, skipped: options.skipped, liked: options.liked, recentArtists: options.recentArtists, batch: options.batch,
  });
  return tracks.length ? { tracks, status: 'ok', version: taste.version } : { tracks: [], status: 'empty', reason: 'unavailable', version: taste.version };
}

/** A finite pool: everything not played lately first; once exhausted, the oldest plays come round again. */
export function collectionBatch(pool: Track[], options: Pick<WaveV2Options, 'excludeTrackIds' | 'skipped' | 'recentArtists'>, taste: Pick<Taste, 'tracks' | 'artists'> & { version: string }, limit: number, moodUnverified: boolean): WaveV2Result {
  const excluded = new Set(options.excludeTrackIds), skipped = new Set(options.skipped.map(s => s.id));
  const recentArtists = new Set(options.recentArtists.slice(-8).map(artistKey));
  let fresh = pool.filter(t => !excluded.has(t.id) && !skipped.has(t.id)), repeating = false;
  if (fresh.length < Math.min(limit, pool.length) / 2) {
    // Only the most recent ~60 % of the pool stays out, so the oldest plays return in turn instead of one pair alternating.
    const window = new Set(options.excludeTrackIds.slice(-Math.max(1, Math.floor(pool.length * 0.6))));
    fresh = pool.filter(t => !window.has(t.id));
    if (!fresh.length) fresh = pool;
    repeating = true;
  }
  const ranked = fresh.map(t => ({ t, s: (taste.tracks.get(t.id) || 0) + 0.3 * (taste.artists.get(primaryKey(t)) || 0) - (recentArtists.has(primaryKey(t)) ? 3 : 0) + Math.random() * 3 }))
    .sort((a, b) => b.s - a.s).map(x => x.t);
  return { tracks: spread(ranked, 2).slice(0, limit), status: 'ok', repeating, moodUnverified, version: taste.version };
}

export function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter(t => { const k = trackIdentity(t); if (seen.has(t.id) || seen.has(k)) return false; seen.add(t.id); seen.add(k); return true; });
}

/** At most `cap` tracks per artist in a batch, and no two in a row where it can be avoided. */
export function spread(tracks: Track[], cap: number): Track[] {
  const counts = new Map<string, number>(), capped = tracks.filter(t => { const k = primaryKey(t); const n = (counts.get(k) || 0) + 1; counts.set(k, n); return n <= cap; });
  const out: Track[] = [], rest = [...capped];
  while (rest.length) {
    const last = out.length ? primaryKey(out[out.length - 1]) : '';
    const i = rest.findIndex(t => primaryKey(t) !== last);
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

/** Release continuation: the release's artists, their neighbours and the listener's taste — never the release itself. */
export async function releaseContinuation(userId: string, seed: { artists: string[]; trackIds: string[] }, batch: number, excludeTrackIds: string[], limit = 20): Promise<Track[]> {
  const taste = await loadTaste(userId);
  const excluded = new Set([...seed.trackIds, ...excludeTrackIds]);
  const names = [...new Set(seed.artists.map(n => n.split(',')[0].trim()).filter(Boolean))].slice(0, 3);
  const artists = (await Promise.all(names.map(n => settle(deezerArtist(n), null)))).filter((a): a is DzArtist => !!a);
  const related = rotate((await Promise.all(artists.map(a => settle(relatedArtists(a), [] as DzArtist[])))).flat(), batch).slice(0, 8);
  const lists = await Promise.all([...artists, ...related].map(a => settle(artistTopTracks(a, 12), [] as Track[])));
  const seedKeys = new Set(artists.map(a => artistKey(a.name)));
  const scored = dedupe(lists.flatMap((list, i) => rotate(list, batch * 2).slice(0, i < artists.length ? 3 : 4)))
    .filter(t => !excluded.has(t.id) && t.access === 'playable' && t.duration >= 45)
    .map(t => ({ t, s: Math.random() * 5 + Math.min(10, Math.max(-5, taste.artists.get(primaryKey(t)) || 0)) + (seedKeys.has(primaryKey(t)) ? 4 : 0) + (t.popularity ?? 40) * 0.08 }))
    .sort((a, b) => b.s - a.s).map(x => x.t);
  return spread(scored, 2).slice(0, limit);
}
