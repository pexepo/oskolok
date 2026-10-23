import type { Track } from '../types/index.js';
import { officialCatalogService, splitFeaturing } from './OfficialCatalogService.js';
import { normalizeMusicText, latinFold } from './trackRanking.js';
import { prisma } from '../database/client.js';
import { logger } from '../utils/logger.js';

/**
 * One song — one release across Oskolok. A SoundCloud upload of a song that exists in the official
 * catalogue (same title, same length) is a re-upload, whoever the uploader claims to be: the official
 * track replaces it. Remixes, covers, slowed/live versions and the like are their own works and stay.
 */

// Derivative works keep their own upload even when an official original exists.
// Word edges by hand: JS \b only knows Latin letters, so «кавер» or «ремикс» would never match with it.
const DERIVATIVE = /(?<![\p{L}\p{N}])(remix|rmx|ремикс|cover|кавер|slowed|sped ?up|speed ?up|nightcore|instrumental|инструментал|karaoke|караоке|mashup|мэшап|live|лайв|bass ?boosted|edit|flip|bootleg|rework|acoustic|акустика|reverb|8d|demo|демо|snippet|сниппет|leak|слив|unreleased|разбор|урок|tutorial|how to play|как играть|табы|tabs|reaction|реакция|lesson)(?![\p{L}\p{N}])/iu;
export const isDerivativeTitle = (title: string) => DERIVATIVE.test(title.normalize('NFKC'));

// YouTube «tracks» that are not songs at all: reactions, breakdowns, reviews, whole albums in one video.
const NOT_A_SONG = /реакци|reaction|reacts?\b|разбор|слушает|обзор|review|tutorial|урок|full album|official audio album|\(альбом|альбом,?\s*\d{4}|\bmixtape\)|\bfull ep\b/i;
const isVideoJunk = (t: Track) => (t.source === 'licensed' || t.source === 'youtube') && (NOT_A_SONG.test(t.title) || t.duration > 720 || (t.duration > 0 && t.duration < 45) || (t.source === 'youtube' && !/^[\w-]{11}$/.test(t.sourceId)) || /^UC[\w-]{20,}$/.test(t.sourceId));

/** Text in brackets that is neither an edition, a feature nor a producer tag is usually the real artist: «Легенда (pyrokinesis)». */
function bracketArtist(title: string): string | undefined {
  for (const m of title.matchAll(/[([]([^)\]]{2,40})[)\]]/g)) {
    const inner = m[1].trim();
    if (DERIVATIVE.test(inner) || /^(feat|ft|prod|with|при уч|при участии|official|lyric|клип|премьер)/i.test(inner) || /\d{4}/.test(inner)) continue;
    return inner;
  }
  return undefined;
}

/**
 * Whether a SoundCloud upload comes from the artist's side: the uploader is the credited artist (by name, in any
 * script), a verified account, or a sizeable label/channel. Anything else is someone else's copy.
 * Old cached tracks without uploader data are given the benefit of the doubt.
 */
export function isOwnUpload(t: Track): boolean {
  if (t.source !== 'soundcloud' || !t.uploader) return true;
  const up = t.uploader;
  if (up.verified || (up.followers || 0) >= 5000) return true;
  const claimed = bracketArtist(t.title);
  if (claimed && latinFold(claimed) !== latinFold(up.name)) return false;
  const a = latinFold(t.artist.name.split(/,|&| x | feat\.? /i)[0] || ''), u = latinFold(up.name);
  return !!a && !!u && (a === u || u.includes(a) || a.includes(u));
}

type Decision = { official: Track | null; at: number };
const memo = new Map<string, Decision>();
const TTL = 7 * 24 * 3600_000;
const NEGATIVE_TTL = 24 * 3600_000;
const keyOf = (id: string) => `canon:v2:${id}`;

// YouTube titles carry packaging: «(Official Video)», «[Lyrics]», «| Премьера клипа».
const PACKAGING = /\s*[([](?:official|официальн|video|видео|audio|аудио|lyric|текст|клип|премьер|visuali[sz]er|hd|4k|mv|m\/v|music video|full)[^)\]]*[)\]]|\s*\|.*$/gi;
const titleKey = (title: string) => normalizeMusicText(splitFeaturing(title.replace(PACKAGING, '')).title);
// A YouTube upload often reads «Artist — Title» in the title itself.
const stripArtistPrefix = (title: string, artist: string) => { const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/); return m && normalizeMusicText(m[1]).includes(normalizeMusicText(artist).split(' ')[0] || '\u0000') ? m[2] : title; };
// «Intro», «Love», «Outro» exist a thousand times: a different artist only counts as the same song
// when the title is specific enough.
const specificTitle = (key: string) => key.length >= 4 && (key.includes(' ') || key.length >= 7);

function pick(sc: Track, candidates: Track[]): Track | null {
  const key = titleKey(stripArtistPrefix(sc.title, sc.artist.name)), artist = normalizeMusicText(sc.artist.name);
  if (!key) return null;
  let best: Track | null = null, bestScore = -1;
  for (const o of candidates) {
    if (o.source === 'soundcloud' || o.source === 'licensed' || o.source === 'youtube') continue;
    if (isDerivativeTitle(o.title)) continue;
    const names = normalizeMusicText(o.artist.name), primary = normalizeMusicText(o.artist.name.split(',')[0] || '');
    // «слава КПСС лето в кайфограде» uploaded by yofidd: the real artist sits inside the title.
    const credited = !!primary && (key.startsWith(`${primary} `) || key.endsWith(` ${primary}`));
    const ownKey = credited ? key.replace(new RegExp(`^${primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} |\\s${primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '').trim() : key;
    if (titleKey(o.title) !== key && titleKey(o.title) !== ownKey) continue;
    const sameArtist = credited || (!!artist && (names === artist || names.split(' ').includes(artist) || artist.includes(names)));
    const gap = sc.duration && o.duration ? Math.abs(sc.duration - o.duration) : sameArtist ? 0 : Infinity;
    if (gap > (sameArtist ? 6 : 2)) continue;
    if (!sameArtist && !specificTitle(key)) continue;
    // A sizeable SoundCloud account is most likely the artist itself: its song is not «someone else's» official track.
    if (!sameArtist && (sc.artist.followersCount || 0) >= 2000) continue;
    const score = (sameArtist ? 100 : 0) + (o.popularity || 0) - gap;
    if (score > bestScore) { best = o; bestScore = score; }
  }
  return best;
}

async function deezerCandidates(query: string): Promise<Track[]> {
  const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: any[] };
  return (json.data || []).map(t => officialCatalogService.mapTrack(t));
}

const inflight = new Map<string, Promise<Track | null>>();
async function lookup(sc: Track): Promise<Track | null> {
  const hit = memo.get(sc.id);
  if (hit && Date.now() - hit.at < (hit.official ? TTL : NEGATIVE_TTL)) return hit.official;
  let pending = inflight.get(sc.id);
  if (pending) return pending;
  pending = (async () => {
    const stored = await prisma.artistEnrichment.findUnique({ where: { id: keyOf(sc.id) } }).catch(() => null);
    if (stored) {
      const data = JSON.parse(stored.data) as { official: Track | null };
      if (Date.now() - stored.updatedAt.getTime() < (data.official ? TTL : NEGATIVE_TTL)) { memo.set(sc.id, { official: data.official, at: stored.updatedAt.getTime() }); return data.official; }
    }
    const title = splitFeaturing(stripArtistPrefix(sc.title, sc.artist.name).replace(PACKAGING, '')).title;
    const claimed = bracketArtist(sc.title);
    const bare = claimed ? title.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').trim() : title;
    const probe = claimed ? { ...sc, title: bare, artist: { ...sc.artist, name: claimed } } : sc;
    let official = pick(probe, await deezerCandidates(`${probe.artist.name} ${bare}`));
    // The uploader may have credited the wrong artist entirely («cupsize — 1 мая» is madk1d's song).
    if (!official && specificTitle(titleKey(bare))) official = pick(probe, await deezerCandidates(bare));
    memo.set(sc.id, { official, at: Date.now() });
    if (memo.size > 20_000) memo.delete(memo.keys().next().value!);
    const data = JSON.stringify({ official });
    await prisma.artistEnrichment.upsert({ where: { id: keyOf(sc.id) }, create: { id: keyOf(sc.id), data }, update: { data } }).catch(() => {});
    return official;
  })().finally(() => inflight.delete(sc.id));
  inflight.set(sc.id, pending);
  return pending;
}

/** The official catalogue release of an upload (null when there is none), cached like every decision here. */
export async function officialFor(track: Track): Promise<Track | null> {
  if (process.env.VITEST || !['soundcloud', 'licensed', 'youtube'].includes(track.source) || isDerivativeTitle(track.title)) return null;
  return lookup(track).catch(() => null);
}

/**
 * Replace SoundCloud re-uploads with the official release.
 * mode 'replace' swaps the track in place (search, Wave); 'drop' removes it (a SoundCloud profile's
 * own uploads: someone else's official song does not belong on that page).
 * Lookups beyond the time budget pass through untouched and keep warming the cache in the background.
 */
export async function canonicalizeTracks(tracks: Track[], { mode = 'replace', budgetMs = 2500, maxLookups = 24 }: { mode?: 'replace' | 'drop'; budgetMs?: number; maxLookups?: number } = {}): Promise<Track[]> {
  // Unit tests run offline on fixtures; they test ranking, not the live catalogue.
  if (process.env.VITEST) return tracks;
  tracks = tracks.filter(t => !isVideoJunk(t));
  const targets = tracks.filter(t => (t.source === 'soundcloud' || t.source === 'licensed' || t.source === 'youtube') && !isDerivativeTitle(t.title)).slice(0, maxLookups);
  if (!targets.length) return tracks;
  const decided = new Map<string, Track | null>();
  const work = targets.map(t => lookup(t).then(o => { decided.set(t.id, o); }).catch(err => { logger.debug({ err: (err as Error).message, id: t.id }, 'canonical lookup failed'); }));
  await Promise.race([Promise.all(work), new Promise(r => setTimeout(r, budgetMs))]);
  // Artists this answer already knows officially: a small upload titled «<one of them> <song>» is a copy.
  const known = new Set(tracks.filter(t => t.source === 'deezer' || t.source === 'spotify' || (t.source === 'soundcloud' && (t.uploader?.verified || (t.uploader?.followers || 0) >= 5000)))
    .map(t => latinFold(t.artist.name.split(',')[0] || '')).filter(n => n.length >= 3));
  const namesOther = (t: Track) => {
    if (t.source !== 'soundcloud' || !t.uploader || t.uploader.verified || (t.uploader.followers || 0) >= 5000) return false;
    const words = normalizeMusicText(t.title).split(' ');
    for (let n = 1; n <= Math.min(4, words.length - 1); n++) {
      const head = latinFold(words.slice(0, n).join(' '));
      if (known.has(head) && head !== latinFold(t.uploader.name)) return true;
    }
    return false;
  };
  const out: Track[] = [], seen = new Set<string>();
  for (const t of tracks) {
    const official = decided.get(t.id);
    if (official) {
      if (mode === 'drop' && normalizeMusicText(official.artist.name) !== normalizeMusicText(t.artist.name)) continue;
      if (seen.has(official.id)) continue;
      seen.add(official.id);
      out.push({ ...official, recommendationReason: t.recommendationReason ?? official.recommendationReason });
      continue;
    }
    // No official version: someone else's copy of a song is not shown at all (remixes and covers excepted).
    if (t.source === 'soundcloud' && !isDerivativeTitle(t.title) && (!isOwnUpload(t) || namesOther(t))) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}
