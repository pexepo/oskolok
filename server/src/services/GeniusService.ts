import { prisma } from '../database/client.js';
import { logger } from '../utils/logger.js';
import { foldName, foldedCoverage } from './searchQuery.js';

// Genius's public web API (the one genius.com itself uses) needs no token and
// returns artist bios, aliases, socials, song pageviews and albums.
const API = 'https://genius.com/api';
const TTL = 12 * 60 * 60 * 1000;

export interface GeniusSong { id: number; title: string; url: string; views?: number; date?: string; art?: string }
export interface GeniusAlbum { id: number; name: string; url: string; date?: string; cover?: string; views?: number; description?: string; trackCount?: number }
export interface GeniusArtist {
  id: number; name: string; url: string; image?: string; header?: string; verified: boolean;
  followers?: number; alternateNames: string[]; description?: string;
  socials: { instagram?: string; twitter?: string; facebook?: string };
  spotifyId?: string;
  stats: { topSongsViews: number; albumCount: number; songCount: number };
  topSongs: GeniusSong[];
  albums: GeniusAlbum[];
}
export interface GeniusRelease extends GeniusAlbum {
  artist: string; tracks: Array<{ number?: number; title: string; url: string; views?: number }>;
  credits: Array<{ role: string; names: string[] }>;
}

async function getJson(path: string, timeout = 8000): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': 'Mozilla/5.0 Oskolok-Music-Player' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Genius ${res.status}`);
  return (await res.json() as any).response;
}

async function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const row = await prisma.artistEnrichment.findUnique({ where: { id: key } }).catch(() => null);
  if (row && Date.now() - row.updatedAt.getTime() < TTL) return JSON.parse(row.data);
  try {
    const fresh = await load();
    if (fresh) await prisma.artistEnrichment.upsert({ where: { id: key }, create: { id: key, data: JSON.stringify(fresh) }, update: { data: JSON.stringify(fresh) } });
    return fresh ?? (row ? JSON.parse(row.data) : null);
  } catch (err) {
    logger.debug({ err, key }, 'Genius lookup failed');
    return row ? JSON.parse(row.data) : null;
  }
}

const compact = (s: string) => foldName(s).replace(/ /g, '');
/** Genius names read "Слава КПСС (Slava KPSS)": match the whole, the outside or the bracketed part. */
function nameVariants(name: string): string[] {
  const inner = [...name.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  return [name, name.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), ...inner].filter(Boolean);
}
const sameArtist = (candidate: string, wanted: string, aliases: string[] = []) => {
  const target = compact(wanted);
  return !!target && [...nameVariants(candidate), ...aliases.flatMap(nameVariants)].some(v => compact(v) === target);
};

const plain = (text?: string) => (text || '').replace(/\n{3,}/g, '\n\n').trim();
const trimText = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max))}…`;

/** ISO-ish date from Genius's components ("2025", "2025-11", "2025-11-28") so sorting is stable. */
function isoDate(a: any): string | undefined {
  if (a.release_date) return a.release_date;
  const c = a.release_date_components;
  if (!c?.year) return undefined;
  return [c.year, c.month && String(c.month).padStart(2, '0'), c.month && c.day && String(c.day).padStart(2, '0')].filter(Boolean).join('-');
}

function mapAlbum(a: any): GeniusAlbum {
  return { id: a.id, name: a.name, url: a.url, date: isoDate(a), cover: a.cover_art_url || a.cover_art_thumbnail_url || undefined };
}

async function albumDetails(id: number): Promise<Pick<GeniusRelease, 'views' | 'description' | 'trackCount' | 'tracks' | 'credits' | 'date'>> {
  const [album, tracks] = await Promise.all([
    getJson(`/albums/${id}?text_format=plain`).then(r => r.album),
    getJson(`/albums/${id}/tracks?per_page=50`).then(r => r.tracks || []).catch(() => []),
  ]);
  const description = plain(album.description_preview || album.description_annotation?.annotations?.[0]?.body?.plain);
  return {
    date: isoDate(album),
    views: typeof album.song_pageviews === 'number' ? album.song_pageviews : undefined,
    description: description && description !== '?' ? trimText(description, 900) : undefined,
    trackCount: tracks.length || undefined,
    tracks: tracks.map((t: any) => ({ number: t.number ?? undefined, title: t.song?.title, url: t.song?.url, views: t.song?.stats?.pageviews })).filter((t: any) => t.title),
    credits: (album.performance_groups || []).map((g: any) => ({ role: g.label, names: (g.artists || []).map((a: any) => a.name) })).filter((g: any) => g.role && g.names.length).slice(0, 8),
  };
}

export async function geniusArtist(name: string): Promise<GeniusArtist | null> {
  if (!name.trim()) return null;
  return cached(`genius2:${compact(name)}`, async () => {
    const search = await getJson(`/search/artist?q=${encodeURIComponent(name)}`, 6000);
    const hits = (search.sections?.[0]?.hits || []).map((h: any) => h.result).filter(Boolean);
    const direct = hits.find((h: any) => sameArtist(h.name, name));
    // Aliases are only known after fetching details, so check the top hits.
    let artist: any;
    for (const candidate of direct ? [direct] : hits.slice(0, 3)) {
      const detail = (await getJson(`/artists/${Number(candidate.id)}?text_format=plain`)).artist;
      if (sameArtist(detail.name, name, detail.alternate_names || [])) { artist = detail; break; }
    }
    if (!artist) return null;

    const [songsRes, albumPages] = await Promise.all([
      getJson(`/artists/${artist.id}/songs?sort=popularity&per_page=10`).catch(() => ({ songs: [] })),
      (async () => {
        const all: any[] = [];
        for (let page = 1; page && page <= 3;) {
          const r = await getJson(`/artists/${artist.id}/albums?per_page=50&page=${page}`).catch(() => null);
          if (!r) break;
          all.push(...(r.albums || []));
          page = r.next_page || 0;
        }
        return all;
      })(),
    ]);
    const songs: any[] = (songsRes.songs || []).filter((s: any) => s.primary_artist?.id === artist.id || (s.primary_artists || []).some((a: any) => a.id === artist.id));
    const topSongs: GeniusSong[] = songs.slice(0, 6).map(s => ({ id: s.id, title: s.title, url: s.url, views: s.stats?.pageviews, date: s.release_date_for_display || undefined, art: s.song_art_image_thumbnail_url || undefined }));

    const albums = albumPages.map(mapAlbum).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // Pageviews and blurbs for the newest releases; older ones stay as links.
    const enriched = await Promise.all(albums.slice(0, 6).map(async a => {
      try { const d = await albumDetails(a.id); return { ...a, views: d.views, description: d.description, trackCount: d.trackCount, date: d.date || a.date }; }
      catch { return a; }
    }));

    const description = plain(artist.description?.plain);
    return {
      id: artist.id, name: artist.name, url: artist.url,
      image: artist.image_url && !/default_avatar/.test(artist.image_url) ? artist.image_url : undefined,
      header: artist.header_image_url && !/default/i.test(artist.header_image_url) ? artist.header_image_url : undefined,
      verified: Boolean(artist.is_verified),
      followers: typeof artist.followers_count === 'number' ? artist.followers_count : undefined,
      alternateNames: (artist.alternate_names || []).slice(0, 8),
      description: description && description !== '?' ? trimText(description, 1400) : undefined,
      socials: { instagram: artist.instagram_name || undefined, twitter: artist.twitter_name || undefined, facebook: artist.facebook_name || undefined },
      spotifyId: artist.social_links?.spotify?.match?.(/artist\/([A-Za-z0-9]{22})/)?.[1],
      stats: { topSongsViews: songs.reduce((sum, s) => sum + (s.stats?.pageviews || 0), 0), albumCount: albums.length, songCount: songs.length },
      topSongs,
      albums: [...enriched, ...albums.slice(6, 24)],
    };
  });
}

/** Genius page for one release: description, pageviews, tracklist views, credits. */
export async function geniusRelease(artist: string, title: string): Promise<GeniusRelease | null> {
  const clean = title.replace(/\s*[([](?:deluxe|remaster(?:ed)?|expanded|edition)[^)\]]*[)\]]/gi, '').trim();
  if (!artist.trim() || !clean) return null;
  return cached(`geniusalbum:${compact(artist)}|${compact(clean)}`, async () => {
    const search = await getJson(`/search/album?q=${encodeURIComponent(`${artist} ${clean}`)}`, 6000);
    const hits = (search.sections?.[0]?.hits || []).map((h: any) => h.result).filter(Boolean);
    // Genius appends translations in brackets: compare against each variant.
    const sameTitle = (name: string) => nameVariants(name).some(v => foldedCoverage(v, clean) === 1 && foldedCoverage(clean, v) >= .6);
    const hit = hits.find((a: any) => sameArtist(a.artist?.name || '', artist) && sameTitle(a.name));
    if (!hit) return null;
    const details = await albumDetails(hit.id);
    const base = mapAlbum(hit);
    return { ...base, ...details, date: details.date || base.date, artist: hit.artist?.name || artist };
  });
}

/** Shared with geniusUpcoming.ts: public-API fetch and the 12h ArtistEnrichment cache. */
export {getJson as geniusApi,cached as geniusCached,isoDate as geniusDate};
