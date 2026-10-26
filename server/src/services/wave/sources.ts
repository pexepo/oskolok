/* Catalogue access for Резонанс v2: Deezer (artists, their top tracks and related acts, themed playlists)
   and AnimeThemes (which songs really are anime openings/endings). Every call is paced and cached:
   a wave refill fans out to a dozen requests and must not eat the shared Deezer quota (50 calls / 5 s). */
import type { Track } from '../../types/index.js';
import { officialCatalogService } from '../OfficialCatalogService.js';
import { latinFold, normalizeMusicText } from '../trackRanking.js';
import { logger } from '../../utils/logger.js';
import { noteReleaseYear } from './freshness.js';

const DEEZER = 'https://api.deezer.com';
const ANIME = 'https://api.animethemes.moe';
const HOUR = 3600_000;

type Entry<T> = { at: number; value: T };
function memo<T>(ttl: number, max = 2000) {
  const map = new Map<string, Entry<T> | Promise<T>>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = map.get(key);
    if (hit instanceof Promise) return hit;
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const pending = load().then(value => { map.set(key, { at: Date.now(), value }); if (map.size > max) map.delete(map.keys().next().value!); return value; },
      error => { map.delete(key); throw error; });
    map.set(key, pending);
    return pending;
  };
}

// Pacing shared by every wave request: 4 at a time, at least 110 ms between starts.
let active = 0, nextStart = 0;
const waiting: Array<() => void> = [];
async function paced<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  const now = Date.now(), at = Math.max(now, nextStart); nextStart = at + 110;
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
  try { return await run(); } finally { active--; waiting.shift()?.(); }
}
async function getJson(url: string, timeout = 7000): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const data: any = await paced(async (): Promise<any> => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Oskolok/1.0 (+https://oskolok.lol)' } });
      return response.ok ? response.json() : null;
    }).catch(() => null);
    // Deezer reports its quota with HTTP 200 and an error body.
    if (data?.error?.code === 4) { await new Promise(resolve => setTimeout(resolve, 900 * (attempt + 1))); continue; }
    return data && !data.error ? data : null;
  }
  return null;
}

export interface DzArtist { id: number; name: string; fans: number }
const artistCache = memo<DzArtist | null>(24 * HOUR);
/** The Deezer artist with this exact name (any script), the most followed when several share it. */
export function deezerArtist(name: string): Promise<DzArtist | null> {
  const want = latinFold(name);
  return artistCache(want, async () => {
    const found = await getJson(`${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=8`);
    const match = (found?.data || []).filter((a: any) => latinFold(String(a.name || '')) === want).sort((a: any, b: any) => (b.nb_fan || 0) - (a.nb_fan || 0))[0];
    return match ? { id: Number(match.id), name: String(match.name), fans: Number(match.nb_fan) || 0 } : null;
  });
}

const byIdCache = memo<DzArtist | null>(24 * HOUR);
export function deezerArtistById(id: string | number): Promise<DzArtist | null> {
  return byIdCache(String(id), async () => {
    const a = await getJson(`${DEEZER}/artist/${encodeURIComponent(String(id))}`);
    return a?.id ? { id: Number(a.id), name: String(a.name), fans: Number(a.nb_fan) || 0 } : null;
  });
}

const namesakesCache = memo<DzArtist[]>(24 * HOUR);
const songKey = (title: string) => normalizeMusicText(title.replace(/\s*[([].*$/, ''));
/** The listener's own artist, not a namesake: the Deezer id their tracks carry, else the namesake whose
 * catalogue shares a song title with those tracks, else the most followed one. */
export async function deezerArtistFor(name: string, known: Track[]): Promise<DzArtist | null> {
  const want = latinFold(name);
  const own = known.find(t => t.source === 'deezer' && t.artist.sourceId && latinFold(t.artist.name.split(/\s*,\s*/)[0]) === want);
  if (own) { const exact = await deezerArtistById(own.artist.sourceId!).catch(() => null); if (exact) return exact; }
  const namesakes = await namesakesCache(want, async () => ((await getJson(`${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=10`))?.data || [])
    .filter((a: any) => latinFold(String(a.name || '')) === want)
    .map((a: any) => ({ id: Number(a.id), name: String(a.name), fans: Number(a.nb_fan) || 0 }))
    .sort((a: DzArtist, b: DzArtist) => b.fans - a.fans));
  if (namesakes.length < 2 || !known.length) return namesakes[0] || null;
  const titles = new Set(known.map(t => songKey(t.title)));
  for (const a of namesakes.slice(0, 4)) {
    const top = await artistTopTracks(a, 50).catch(() => [] as Track[]);
    if (top.some(t => titles.has(songKey(t.title)))) return a;
  }
  return namesakes[0];
}

const topCache = memo<Track[]>(12 * HOUR);
export function artistTopTracks(artist: DzArtist, limit = 25): Promise<Track[]> {
  return topCache(`${artist.id}:${limit}`, async () => ((await getJson(`${DEEZER}/artist/${artist.id}/top?limit=${limit}`))?.data || [])
    .filter((t: any) => t?.id && t?.readable !== false).map((t: any) => officialCatalogService.mapTrack(t)));
}

const relatedCache = memo<DzArtist[]>(24 * HOUR);
export function relatedArtists(artist: DzArtist): Promise<DzArtist[]> {
  return relatedCache(String(artist.id), async () => ((await getJson(`${DEEZER}/artist/${artist.id}/related?limit=20`))?.data || [])
    .map((a: any) => ({ id: Number(a.id), name: String(a.name), fans: Number(a.nb_fan) || 0 })));
}

const radioCache = memo<Track[]>(12 * HOUR);
/** Deezer's artist radio: tracks of similar artists picked by Deezer's own listening data. */
export function artistRadio(artist: DzArtist, limit = 40): Promise<Track[]> {
  return radioCache(`${artist.id}:${limit}`, async () => ((await getJson(`${DEEZER}/artist/${artist.id}/radio?limit=${limit}`))?.data || [])
    .filter((t: any) => t?.id && t?.readable !== false).map((t: any) => officialCatalogService.mapTrack(t)));
}

export interface DzRelease { id: number; title: string; date: string; type: string; cover?: string }
const releasesCache = memo<DzRelease[]>(12 * HOUR);
/** The artist's releases, newest first (Deezer already sorts them so). */
export function artistReleases(artist: DzArtist): Promise<DzRelease[]> {
  return releasesCache(String(artist.id), async () => ((await getJson(`${DEEZER}/artist/${artist.id}/albums?limit=25`))?.data || [])
    .filter((a: any) => a?.id && a?.release_date)
    .map((a: any) => { noteReleaseYear(Number(a.id), String(a.release_date)); return { id: Number(a.id), title: String(a.title || ''), date: String(a.release_date), type: String(a.record_type || 'album'), cover: a.cover_xl || a.cover_big || a.cover_medium }; }));
}

const albumTracksCache = memo<Track[]>(24 * HOUR);
/** A release's tracks, with the release attached (Deezer omits it on this endpoint). */
export function releaseTracks(release: DzRelease, limit = 14): Promise<Track[]> {
  return albumTracksCache(`${release.id}:${limit}`, async () => ((await getJson(`${DEEZER}/album/${release.id}/tracks?limit=${limit}`))?.data || [])
    .filter((t: any) => t?.id && t?.readable !== false)
    .map((t: any) => officialCatalogService.mapTrack({ ...t, album: { id: release.id, title: release.title, cover_xl: release.cover } })));
}

/** What the artist released lately (within `months`), newest first: at most `count` releases. */
export async function artistFreshTracks(artist: DzArtist, months = 24, count = 2): Promise<Track[]> {
  const since = new Date(Date.now() - months * 30 * 86_400_000).toISOString().slice(0, 10);
  const fresh = (await artistReleases(artist)).filter(r => r.date >= since && r.date <= new Date().toISOString().slice(0, 10)).slice(0, count);
  return (await Promise.all(fresh.map(r => releaseTracks(r, r.type === 'single' ? 4 : 10)))).flat();
}

const playlistCache = memo<Track[]>(12 * HOUR, 400);
/** Tracks of the best-followed Deezer playlists for a phrase («русский рок грустный», «j-rock chill»). */
export function themedPlaylistTracks(phrase: string, playlists = 2): Promise<Track[]> {
  return playlistCache(`${normalizeMusicText(phrase)}:${playlists}`, async () => {
    const found = await getJson(`${DEEZER}/search/playlist?q=${encodeURIComponent(phrase)}&limit=25`);
    // A playlist counts only if its title carries the phrase's words (as stems: «грустн» matches «грустные»),
    // so «sad» does not pull a random «Sadie» mix. The last word is the mood and is always required.
    const stems = normalizeMusicText(phrase).split(' ').filter(w => w.length >= 3).map(w => w.length > 5 ? w.slice(0, w.length - 2) : w);
    const has = (title: string, stem: string) => normalizeMusicText(title).split(' ').some(word => word.startsWith(stem));
    const lists = (found?.data || []).filter((p: any) => (p.nb_tracks || 0) >= 15 && (!stems.length || has(String(p.title || ''), stems[stems.length - 1]))
      && stems.filter(stem => has(String(p.title || ''), stem)).length >= Math.min(2, stems.length)).slice(0, playlists);
    const pages = await Promise.all(lists.map((p: any) => getJson(`${DEEZER}/playlist/${p.id}/tracks?limit=100`)));
    return pages.flatMap(page => (page?.data || []).filter((t: any) => t?.id && t?.readable !== false).map((t: any) => officialCatalogService.mapTrack(t)));
  });
}

/* ---------- AnimeThemes: which songs are anime openings or endings ---------- */
export interface AnimeSong { title: string; artists: string[]; anime: string; year?: number; type: 'OP' | 'ED' }
const themePageCache = memo<AnimeSong[]>(24 * HOUR, 300);
function themePage(type: 'OP' | 'ED', page: number): Promise<AnimeSong[]> {
  return themePageCache(`${type}:${page}`, async () => {
    const data = await getJson(`${ANIME}/animetheme?filter%5Btype%5D=${type}&include=song.artists,anime&page%5Bsize%5D=50&page%5Bnumber%5D=${page}&sort=-id`, 9000);
    return (data?.animethemes || []).flatMap((theme: any) => {
      const song = theme?.song, artists = (song?.artists || []).map((a: any) => String(a.name || '')).filter(Boolean);
      return song?.title && artists.length ? [{ title: String(song.title), artists, anime: String(theme.anime?.name || ''), year: Number(theme.anime?.year) || undefined, type }] : [];
    });
  });
}
/** A spread of anime songs: the newest pages for the default mode, older pages for «нишевое». */
export async function animeSongs(type: 'OP' | 'ED', batch: number, niche: boolean): Promise<AnimeSong[]> {
  const pages = niche ? [8 + (batch * 3) % 50, 9 + (batch * 5) % 50] : [1 + batch % 4, 2 + (batch * 3) % 6];
  return (await Promise.all(pages.map(p => themePage(type, p).catch(() => [] as AnimeSong[])))).flat();
}

const verifyCache = memo<'OP' | 'ED' | null>(30 * 24 * HOUR, 5000);
/** Is this catalogue track an anime opening/ending? Confirmed by AnimeThemes song search (title and artist). */
export function animeThemeType(track: Track): Promise<'OP' | 'ED' | null> {
  const title = track.title.replace(/\s*[([].*$/, '').trim();
  return verifyCache(`${latinFold(track.artist.name)}:${latinFold(title)}`, async () => {
    const data = await getJson(`${ANIME}/search?q=${encodeURIComponent(title)}&fields%5Bsearch%5D=songs&include%5Bsong%5D=artists,animethemes`, 9000);
    const artist = track.artist.name.split(/\s*,\s*/).map(latinFold);
    for (const song of data?.search?.songs || []) {
      if (latinFold(String(song.title || '')) !== latinFold(title)) continue;
      if (!(song.artists || []).some((a: any) => artist.includes(latinFold(String(a.name || ''))))) continue;
      const types = new Set((song.animethemes || []).map((t: any) => t.type));
      return types.has('OP') ? 'OP' : types.has('ED') ? 'ED' : null;
    }
    return null;
  });
}

const songLookup = memo<Track | null>(30 * 24 * HOUR, 5000);
/** The catalogue recording of an AnimeThemes song: same title, one of its credited artists. */
export function resolveAnimeSong(song: AnimeSong): Promise<Track | null> {
  return songLookup(`${song.type}:${latinFold(song.artists[0])}:${latinFold(song.title)}`, async () => {
    const data = await getJson(`${DEEZER}/search?q=${encodeURIComponent(`${song.artists[0]} ${song.title}`)}&limit=6`);
    const artists = song.artists.map(latinFold), title = latinFold(song.title);
    const hit = (data?.data || []).find((t: any) => {
      const tt = latinFold(String(t.title_short || t.title || '').replace(/\s*[([].*$/, ''));
      return t.readable !== false && (tt === title || (title.length >= 6 && tt.startsWith(title))) && artists.includes(latinFold(String(t.artist?.name || '')));
    });
    return hit ? officialCatalogService.mapTrack(hit) : null;
  });
}

export function logSourceFailure(what: string, error: unknown) {
  logger.debug({ what, message: error instanceof Error ? error.message : String(error) }, 'Wave source failed');
}
