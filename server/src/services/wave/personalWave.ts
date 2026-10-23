/* Резонанс v3: the listener's own taste first, the settings second — the way Yandex «Моя волна» works.
   What the Yandex client shows (rea, 2026-10): the wave is a session fed by every event — trackStarted,
   trackFinished with seconds played, skip with seconds played, like, dislike — and answers in small
   batches, so it turns after each skip. Its settings are seeds over the personal model, not separate
   catalogues: character (favourite / discover / popular), mood, language, and activity agents.

   Here: seed artists come from likes, playlists and history, weighted toward what the listener plays
   NOW; candidates are their releases the listener has not heard yet, plus artists Deezer relates to
   several seeds at once (the closest thing to «people who like X also like Y» a public catalogue
   offers) and Deezer's artist radio. Language, scene, mood and activity filter and weight that pool;
   generic anchors only stand in when the listener has no taste in that corner yet. New releases lead,
   decade-old hits fall back, already-heard songs give way to unheard ones. */
import type { Track } from '../../types/index.js';
import type { WaveSignal } from '../RecommendationService.js';
import { HIGH_ENERGY, LOW_ENERGY, INSTRUMENTAL_TEXT, REMIX_TEXT, LOW_QUALITY, isJunkUpload } from '../RecommendationService.js';
import { trackIdentity } from '../trackRanking.js';
import { logger } from '../../utils/logger.js';
import { activityOf, moodOf, subgenreOf, waveSubgenres, type ActivityDef, type WaveLang } from './taxonomy.js';
import { artistFreshTracks, artistRadio, artistTopTracks, deezerArtist, relatedArtists, themedPlaylistTracks, type DzArtist } from './sources.js';
import { artistKey, type Taste } from './profile.js';
import { languageOf } from './language.js';
import { recencyScore, trackYear } from './freshness.js';
import { dedupe, moodArtists, sceneArtists, spread, type WaveV2Options, type WaveV2Result } from './waveV2.js';

export interface PersonalWaveOptions extends WaveV2Options {
  /** Wave tracks played to the end this session (Yandex: trackFinished). */
  finished?: WaveSignal[];
  /** Rewrites the reason shown under a track (the shared wave says whose taste it came from). */
  describe?: (track: Track, via: string | undefined, reason: string, origin: string) => string;
}
type Origin = 'familiar' | 'neighbour' | 'radio' | 'replay' | 'activity' | 'anchor';
type Candidate = { track: Track; origin: Origin; via?: string };
type Seed = { key: string; name: string; w: number; artist: DzArtist | null; related: DzArtist[] };

const CYR = /\p{Script=Cyrillic}/u, KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const settle = async <T,>(work: Promise<T>, fallback: T, ms = 8000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  finally { clearTimeout(timer); }
};
const rotate = <T,>(items: T[], by: number) => items.length ? [...items.slice(by % items.length), ...items.slice(0, by % items.length)] : items;
const primary = (t: Pick<Track, 'artist'>) => artistKey(t.artist.name);
const firstName = (name: string) => name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0]?.trim() || name;

/** The language an artist sings in, read from names: Cyrillic or kana in its own or its neighbours' names. */
export function nameLanguage(names: string[]): WaveLang | null {
  if (!names.length) return null;
  const share = (re: RegExp) => names.filter(n => re.test(n)).length / names.length;
  if (share(KANA) >= 0.25) return 'ja';
  if (share(CYR) >= 0.25) return 'ru';
  return null;
}

/** Seed weight of an artist from the library: recent likes and plays count most. Pure, for tests. */
export function seedWeights(taste: Pick<Taste, 'likes' | 'library' | 'history' | 'artists'>, session: { liked: WaveSignal[]; finished: WaveSignal[]; skips: Map<string, number> }) {
  const weights = new Map<string, { name: string; w: number; tracks: Track[] }>();
  const add = (name: string, w: number, track?: Track) => {
    const clean = firstName(name), key = artistKey(clean);
    if (!key) return;
    const entry = weights.get(key) || { name: clean, w: 0, tracks: [] };
    entry.w += w;
    if (track && entry.tracks.length < 12) entry.tracks.push(track);
    weights.set(key, entry);
  };
  // A like from last week says more about today than one from three years ago.
  taste.likes.forEach((t, i) => add(t.artist.name, 2 + 6 * Math.exp(-i / 35), t));
  taste.library.forEach(t => add(t.artist.name, 0.8, t));
  taste.history.forEach((t, i) => add(t.artist.name, 2.2 * Math.exp(-i / 50), t));
  session.liked.forEach(s => add(s.artist, 14));
  session.finished.forEach(s => add(s.artist, 4));
  // Listening events (consented): full plays and repeats lift an artist, early skips sink it.
  weights.forEach((entry, key) => { entry.w += 0.6 * Math.max(-4, Math.min(12, taste.artists.get(key) || 0)); });
  session.skips.forEach((n, key) => { const e = weights.get(key); if (e) e.w -= 6 * n; });
  return weights;
}

export async function buildPersonalWave(options: PersonalWaveOptions, taste: Taste & { version: string }): Promise<WaveV2Result> {
  const limit = Math.max(1, Math.min(40, options.limit || 12));
  const batch = options.batch || 0;
  const lang = options.language;
  const sub = lang !== 'all' ? subgenreOf(lang, options.subgenre) : undefined;
  const mood = lang !== 'all' ? moodOf(lang, options.mood) : undefined;
  const activity: ActivityDef | undefined = activityOf(options.activity);
  const niche = options.mode === 'niche';
  const nowYear = new Date().getFullYear();

  /* ---------- session signals ---------- */
  const excluded = new Set(options.excludeTrackIds.slice(-300));
  const skippedIds = new Set(options.skipped.map(s => s.id));
  const sessionSkips = new Map<string, number>();
  options.skipped.slice(-40).forEach((s, i, all) => sessionSkips.set(artistKey(s.artist), (sessionSkips.get(artistKey(s.artist)) || 0) + (i >= all.length - 12 ? 1.5 : 1)));
  const sessionLiked = new Set(options.liked.map(s => artistKey(s.artist)));
  const sessionFinished = new Set((options.finished || []).map(s => artistKey(s.artist)));
  const recentArtists = new Set(options.recentArtists.slice(-8).map(artistKey));
  const heard = new Set(taste.history.map(t => trackIdentity(t)));
  const heardIds = new Set(taste.history.map(t => t.id));
  const recent = new Set(taste.recent);
  const likedIds = new Set(taste.likes.map(t => t.id)), likedIdentity = new Set(taste.likes.map(trackIdentity));

  /* ---------- seeds: what the listener plays now ---------- */
  const seedWeight = seedWeights(taste, { liked: options.liked, finished: options.finished || [], skips: sessionSkips });
  const ranked = [...seedWeight.entries()].filter(([, e]) => e.w > 1).sort((a, b) => b[1].w - a[1].w);

  // Scene (a subgenre was chosen), mood and activity: artist sets from catalogue anchors and themed playlists.
  const scene = sub && !sub.anime ? await settle(sceneArtists(sub), null, 9000) : null;
  const moodSet = mood && lang !== 'all' ? await settle(moodArtists(lang as WaveLang, sub, mood.queries), null, 9000) : null;
  const moodKnown = !!moodSet && moodSet.artists.size >= 15;
  const activityPhrases = activity ? [...(lang === 'ru' ? activity.queries.ru : lang === 'en' ? activity.queries.en : lang === 'all' ? [activity.queries.ru[0], activity.queries.en[0]] : []), ...activity.queries.any] : [];
  const activityTracks = activity ? (await Promise.all(activityPhrases.map(p => settle(themedPlaylistTracks(p, 2), [] as Track[], 9000)))).flat() : [];
  const activitySet = new Set(activityTracks.map(primary));
  // Strong activities also know what does NOT fit: a workout keeps sleep-playlist artists out and vice versa,
  // so a neoclassical favourite does not lead a gym session.
  const opposite = activity && Math.abs(activity.energy) >= 0.6 ? activityOf(activity.energy > 0 ? 'sleep' : 'workout') : undefined;
  const oppositeTracks = opposite ? (await Promise.all(opposite.queries.any.map(p => settle(themedPlaylistTracks(p, 2), [] as Track[], 9000)))).flat() : [];
  const oppositeSet = new Set(oppositeTracks.map(primary));
  activitySet.forEach(key => oppositeSet.delete(key));

  /* ---------- seed artists with their Deezer neighbourhood ---------- */
  // The four strongest artists always seed; six more rotate per batch among those that still matter (≥ 20 % of the top).
  const topW = ranked[0]?.[1].w || 0;
  const seedList = [...ranked.slice(0, 4), ...rotate(ranked.slice(4, 20).filter(([, e]) => e.w >= topW * 0.2), batch * 3).slice(0, 6)];
  const seedArtists = await Promise.all(seedList.map(([, e]) => settle(deezerArtist(e.name), null)));
  const seedRelated = await Promise.all(seedArtists.map(a => a ? settle(relatedArtists(a), [] as DzArtist[]) : Promise.resolve([] as DzArtist[])));
  const seedLang = new Map<string, WaveLang>();
  seedList.forEach(([key, e], i) => {
    const own = e.tracks.map(t => languageOf(t)).find(l => l === 'ru' || l === 'ja');
    seedLang.set(key, own || nameLanguage([e.name]) || nameLanguage(seedRelated[i].map(a => a.name)) || 'en');
  });
  const inScene = (key: string) => !scene || scene.has(key);
  let seeds: Seed[] = seedList.map(([key, e], i) => ({ key, name: e.name, w: e.w, artist: seedArtists[i], related: seedRelated[i] }))
    .filter(s => s.artist && (lang === 'all' || seedLang.get(s.key) === lang) && inScene(s.key) && (sessionSkips.get(s.key) || 0) < 2);
  // «Засыпаю» keeps only the listener's artists that fit sleep; strong activities drop the ones that clash.
  if (activity?.strict) seeds = seeds.filter(s => activitySet.has(s.key));
  if (oppositeSet.size) seeds = seeds.filter(s => !oppositeSet.has(s.key));

  // Cold start in this corner: the scene's or language's anchors, newer acts first.
  let coldStart = false;
  if (seeds.length < 2 && lang !== 'all' && !activity?.strict) {
    coldStart = true;
    const pools = sub ? [sub] : rotate(waveSubgenres(lang as WaveLang).filter(s => !s.anime), batch).slice(0, 3);
    const names = rotate(pools.flatMap(s => niche ? s.niche : [...s.niche.slice(0, 4), ...s.popular.slice(0, 3)]), batch * 3).slice(0, 6);
    const anchors = (await Promise.all(names.map(n => settle(deezerArtist(n), null)))).filter((a): a is DzArtist => !!a);
    const related = await Promise.all(anchors.map(a => settle(relatedArtists(a), [] as DzArtist[])));
    anchors.forEach(a => seedLang.set(artistKey(a.name), lang as WaveLang));
    seeds = [...seeds, ...anchors.map((a, i) => ({ key: artistKey(a.name), name: a.name, w: 3, artist: a, related: related[i] }))];
  }

  /* ---------- neighbours: artists related to several seeds at once ---------- */
  const maxW = Math.max(1, ...seeds.map(s => s.w));
  const neighbours = new Map<string, { artist: DzArtist; score: number; via: string; langVotes: Map<WaveLang, number> }>();
  for (const s of seeds) {
    const norm = 0.4 + 0.6 * s.w / maxW, sl = seedLang.get(s.key) || 'en';
    s.related.forEach((a, rank) => {
      const key = artistKey(a.name);
      if (!key || (seedWeight.get(key)?.w || 0) >= 3 || (sessionSkips.get(key) || 0) >= 2) return;
      const n = neighbours.get(key) || { artist: a, score: 0, via: s.name, langVotes: new Map<WaveLang, number>() };
      n.score += norm * (1 - rank / 24) * (sessionLiked.has(s.key) ? 1.8 : 1) * (sessionSkips.has(s.key) ? 0.6 : 1);
      n.langVotes.set(sl, (n.langVotes.get(sl) || 0) + 1);
      neighbours.set(key, n);
    });
  }
  const neighbourLang = (key: string, name: string): WaveLang => {
    const own = nameLanguage([name]);
    if (own) return own;
    const votes = neighbours.get(key)?.langVotes;
    return votes?.size ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0] : 'en';
  };
  let neighbourList = [...neighbours.entries()]
    .filter(([key, n]) => (lang === 'all' || neighbourLang(key, n.artist.name) === lang) && inScene(key) && (!activity?.strict || activitySet.has(key)))
    .filter(([, n]) => !niche || n.artist.fans < 250_000)
    .sort((a, b) => b[1].score - a[1].score);
  // «Нишевое»: one hop further out, among the small acts.
  if (niche && neighbourList.length < 12) {
    const hop = await Promise.all(neighbourList.slice(0, 4).map(([, n]) => settle(relatedArtists(n.artist), [] as DzArtist[])));
    const via = neighbourList[0]?.[1].artist.name || '';
    hop.flat().filter(a => a.fans < 150_000 && !neighbours.has(artistKey(a.name)) && !seedWeight.has(artistKey(a.name)))
      .forEach(a => { const key = artistKey(a.name); neighbours.set(key, { artist: a, score: 0.3, via, langVotes: new Map(lang !== 'all' ? [[lang as WaveLang, 1]] : []) }); neighbourList.push([key, neighbours.get(key)!]); });
  }
  neighbourList = neighbourList.slice(0, 30);

  /* ---------- candidates ---------- */
  const candidates: Candidate[] = [];
  const add = (tracks: Track[], origin: Origin, via?: string) => tracks.forEach(track => candidates.push({ track, origin, via }));
  const tasks: Promise<void>[] = [];
  for (const s of rotate(seeds, batch).slice(0, niche ? 3 : 5)) tasks.push((async () => {
    const [fresh, top] = await Promise.all([settle(artistFreshTracks(s.artist!, 24, 2), [] as Track[]), settle(artistTopTracks(s.artist!, niche ? 25 : 12), [] as Track[])]);
    add([...fresh, ...(niche ? top.slice(8) : top)], coldStart ? 'anchor' : 'familiar', s.name);
  })());
  // Round-robin over the seeds the neighbours came from, so one loud corner of the taste does not take the whole batch.
  const byVia = new Map<string, typeof neighbourList>();
  rotate(neighbourList.slice(0, 24), batch * 5).forEach(entry => byVia.set(entry[1].via, [...(byVia.get(entry[1].via) || []), entry]));
  const fair: typeof neighbourList = [];
  for (let round = 0; fair.length < neighbourList.length && round < 24; round++) byVia.forEach(list => { if (list[round]) fair.push(list[round]); });
  fair.slice(0, niche ? 12 : 10).forEach(([, n], i) => tasks.push((async () => {
    const [top, fresh] = await Promise.all([settle(artistTopTracks(n.artist, 8), [] as Track[]), i < 4 ? settle(artistFreshTracks(n.artist, 18, 1), [] as Track[]) : Promise.resolve([] as Track[])]);
    add([...fresh, ...top], 'neighbour', n.via);
  })()));
  // Deezer's artist radio for the two strongest seeds: its own co-listening picks.
  if (!activity?.strict) seeds.slice(0, 2).forEach(s => tasks.push(settle(artistRadio(s.artist!, 30), [] as Track[]).then(list => add(list, 'radio', s.name))));
  await Promise.all(tasks.map(t => settle(t, undefined, 12000)));
  // The listener's favourites come back now and then (not in «нишевое»).
  if (!niche && !coldStart) add(rotate(taste.likes.filter(t => !recent.has(t.id)), batch * 7).slice(0, 40), 'replay');
  if (activity) add(rotate(activityTracks, batch * 11).slice(0, 60), 'activity');
  if (moodSet?.tracks.length) add(rotate(moodSet.tracks, batch * 9).slice(0, 30), 'activity');

  /* ---------- hard filters ---------- */
  const seen = new Set<string>();
  const sleep = !!activity?.strict;
  const langOk = (c: Candidate) => {
    if (lang === 'all') return true;
    const detected = languageOf(c.track), key = primary(c.track);
    if (detected === lang) return true;
    if (detected !== 'latin') return false;
    // Latin script proves nothing (Russian rappers sing under Latin names): the artist's context decides.
    if (seedLang.has(key)) return seedLang.get(key) === lang;
    if (neighbours.has(key)) return neighbourLang(key, c.track.artist.name) === lang;
    return lang === 'en' && (c.origin === 'activity' || c.origin === 'replay');
  };
  const eligible = candidates.filter(c => {
    const t = c.track, id = trackIdentity(t), key = primary(t);
    if (seen.has(t.id) || seen.has(id)) return false;
    seen.add(t.id); seen.add(id);
    if (excluded.has(t.id) || skippedIds.has(t.id) || recent.has(t.id)) return false;
    if (t.access !== 'playable' || t.duration < 60 || (!sleep && t.duration > 540)) return false;
    if ((sessionSkips.get(key) || 0) >= 2.5) return false;
    if (c.origin !== 'replay' && isJunkUpload(t)) return false;
    if (!langOk(c)) return false;
    if (scene && !scene.has(key)) return false;
    if (oppositeSet.has(key) || (c.via && oppositeSet.has(artistKey(c.via)))) return false;
    if (activity && activity.energy >= 0.6 && LOW_ENERGY.test(`${t.title} ${t.release?.title || ''}`)) return false;
    if (sleep && ((!activitySet.has(key) && !INSTRUMENTAL_TEXT.test(`${t.title} ${t.release?.title || ''}`)) || HIGH_ENERGY.test(t.title))) return false;
    return true;
  });
  if (!eligible.length) {
    logger.info({ lang, subgenre: sub?.id, mood: mood?.id, activity: activity?.id, mode: options.mode, candidates: candidates.length }, 'Personal wave batch empty');
    return { tracks: [], status: 'empty', reason: candidates.length ? 'no-match' : 'unavailable', version: taste.version };
  }

  /* ---------- ranking ---------- */
  const scored = eligible.map(c => {
    const t = c.track, key = primary(t), pop = t.popularity ?? 40, year = trackYear(t);
    const via = c.via ? artistKey(c.via) : '', known = seedWeight.get(key)?.w || 0, near = neighbours.get(key)?.score || 0;
    const text = `${t.title} ${t.release?.title || ''}`;
    let score = Math.random() * 5;
    if (c.origin === 'familiar') score += 10 + Math.min(14, known * 0.8);
    else if (c.origin === 'neighbour') score += 6 + Math.min(22, near * 10);
    else if (c.origin === 'radio') score += 7 + Math.min(10, near * 6) + (known > 3 ? 3 : 0);
    else if (c.origin === 'replay') score += 4 + Math.min(10, known * 0.5);
    else if (c.origin === 'activity') score += 6 + (known > 1 ? 8 : 0) + (near ? 6 : 0);
    else score += 8;
    // New music leads (Yandex pushes fresh releases); favourites replayed are exempt.
    // A new artist is introduced with what people know them for; a known one with what is new.
    const introducing = c.origin === 'neighbour' || c.origin === 'radio';
    if (c.origin !== 'replay') score += recencyScore(year, nowYear) * (niche ? 0.7 : introducing ? 0.65 : 1);
    score += niche ? (100 - pop) * 0.12 : Math.min(introducing ? 14 : 8, pop * (introducing ? 0.16 : 0.1));
    // Unheard first: a song from the history is a repeat, not a recommendation.
    if (c.origin !== 'replay' && (heardIds.has(t.id) || heard.has(trackIdentity(t)))) score -= c.origin === 'familiar' ? 22 : 14;
    if (c.origin !== 'replay' && (likedIds.has(t.id) || likedIdentity.has(trackIdentity(t)))) score -= 18;
    // Session: likes and full plays pull toward an artist and its neighbourhood; skips push away.
    if (sessionLiked.has(key)) score += 18;
    if (sessionFinished.has(key)) score += 5;
    if (via && sessionLiked.has(via)) score += 9;
    if (via && sessionFinished.has(via)) score += 3;
    score -= 24 * (sessionSkips.get(key) || 0);
    if (via) score -= 6 * (sessionSkips.get(via) || 0);
    if (recentArtists.has(key)) score -= 18;
    if (REMIX_TEXT.test(text)) score -= 22;
    if (LOW_QUALITY.test(t.title) || /\b(slowed|sped ?up|nightcore|reverb)\b/i.test(t.title)) score -= 30;
    if (t.source === 'soundcloud') score -= 15;
    if (moodKnown) score += moodSet!.artists.has(key) ? 12 : -14;
    if (activity) {
      score += activitySet.has(key) ? 14 * (1.2 - activity.personal) : -14 * (1 - activity.personal);
      if (activity.energy <= -0.3 && HIGH_ENERGY.test(text)) score -= 40;
      if (activity.energy >= 0.6 && LOW_ENERGY.test(text)) score -= 30;
      if (activity.instrumental > 0 && INSTRUMENTAL_TEXT.test(text)) score += 20 * activity.instrumental;
    }
    return { c, t, key, score };
  }).sort((a, b) => b.score - a.score);

  /* ---------- selection: shares by source, one song per artist ---------- */
  const personal = activity ? activity.personal : 1;
  const share = niche ? { familiar: 0.25, replay: 0 } : coldStart ? { familiar: 0, replay: 0 } : { familiar: 0.3 * personal, replay: 0.15 * personal };
  const bucket = (o: Origin): 'familiar' | 'replay' | 'other' => o === 'familiar' ? 'familiar' : o === 'replay' ? 'replay' : 'other';
  const quota = { familiar: Math.round(limit * share.familiar), replay: Math.round(limit * share.replay), other: 0 };
  quota.other = limit - quota.familiar - quota.replay;
  const picked: typeof scored = [], perArtist = new Map<string, number>(), taken = { familiar: 0, replay: 0, other: 0 };
  // Every credited performer counts: «A, B» and «B, A» are not two different artists in one batch.
  const performers = (t: Track) => [...new Set(t.artist.name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i).map(artistKey).filter(Boolean))];
  const tryPick = (s: typeof scored[number], cap: number, respectQuota: boolean) => {
    const b = bucket(s.c.origin), keys = performers(s.t);
    if (picked.includes(s) || keys.some(k => (perArtist.get(k) || 0) >= cap) || (respectQuota && taken[b] >= quota[b])) return;
    picked.push(s); keys.forEach(k => perArtist.set(k, (perArtist.get(k) || 0) + 1)); taken[b]++;
  };
  for (const [cap, respect] of [[1, true], [1, false], [2, false]] as const) for (const s of scored) { if (picked.length >= limit) break; tryPick(s, cap, respect); }

  const reasonOf = (s: typeof scored[number]) => {
    const year = trackYear(s.t), fresh = !!year && nowYear - year <= 1;
    switch (s.c.origin) {
      case 'familiar': return fresh ? `Новое у ${s.c.via}` : `Вы ещё не слышали · ${s.c.via}`;
      case 'neighbour': case 'radio': return `Похоже на ${s.c.via}`;
      case 'replay': return 'Из ваших любимых';
      case 'activity': return activity ? activity.ru : mood ? `Настроение · ${mood.ru}` : 'Под настроение';
      default: return fresh ? 'Новое' : 'Открытие';
    }
  };
  // Open the stream with something close (Yandex starts from the familiar), then let it flow.
  const ordered = [...picked].sort((a, b) => b.score - a.score);
  const firstClose = ordered.findIndex(s => s.c.origin === 'familiar' || s.c.origin === 'replay');
  if (firstClose > 0 && batch === 0) ordered.unshift(...ordered.splice(firstClose, 1));
  const tracks = spread(dedupe(ordered.map(s => ({ ...s.t, recommendationReason: options.describe ? options.describe(s.t, s.c.via, reasonOf(s), s.c.origin) : reasonOf(s) }))), 2);
  logger.info({ lang, subgenre: sub?.id, mood: mood?.id, activity: activity?.id, mode: options.mode, seeds: seeds.length, neighbours: neighbourList.length, candidates: candidates.length, picked: tracks.length, coldStart }, 'Personal wave batch');
  return { tracks, status: 'ok', moodUnverified: !!mood && !moodKnown, version: taste.version };
}
