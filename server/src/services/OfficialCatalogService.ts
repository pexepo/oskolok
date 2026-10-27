import { artistPersona, namesakeDecisionReady } from './releaseIdentity.js';
import {
  Track,
  Artist,
  Release,
  Playlist,
  SearchResult,
  SearchOptions,
  PaginationOptions,
} from '../types/index.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { logger } from '../utils/logger.js';
import { normalizeMusicText, rankArtist } from './trackRanking.js';

interface DeezerTrackDTO {
  id: number;
  title: string;
  title_short?: string;
  duration: number; // in seconds
  link?: string;
  preview?: string;
  rank?: number;
  explicit_lyrics?: boolean;
  artist: {
    id: number;
    name: string;
    picture_medium?: string;
    picture_big?: string;
    picture_xl?: string;
    link?: string;
  };
  album: {
    id: number;
    title: string;
    cover_medium?: string;
    cover_big?: string;
    cover_xl?: string;
  };
  /** Present on /track, /artist/{id}/top and chart lists, missing from search and album tracks. */
  contributors?: Array<{ id: number; name: string; role?: string }>;
}

// «Song (feat. A & B)», «Song [with A]», «Song ft. A» → title without the credit + the featured names.
const FEAT_RE = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\s+(?:feat\.|ft\.|featuring)\s+(.+)$/i;
export function splitFeaturing(title: string): { title: string; featured: string[] } {
  const m = title.match(FEAT_RE);
  if (!m) return { title, featured: [] };
  const names = (m[1] || m[2] || '').split(/\s*(?:,|&|\+)\s*|\s+(?:and|и|x)\s+/i).map(n => n.trim()).filter(Boolean);
  return { title: title.replace(m[0], '').trim() || title, featured: names };
}

interface DeezerArtistDTO {
  id: number;
  name: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  nb_album?: number;
  nb_fan?: number;
  link?: string;
}

interface DeezerAlbumDTO {
  id: number;
  title: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  release_date?: string;
  record_type?: string;
  nb_tracks?: number;
  link?: string;
  fans?: number;
  artist?: DeezerArtistDTO;
}

interface DeezerSearchPage<T> { data?: T[]; total?: number; next?: string; error?: unknown }

export class OfficialCatalogService {
  private baseUrl = 'https://api.deezer.com';
  private searchCache = new Map<string, { result: SearchResult; expiresAt: number }>();
  private artistTracksCache = new Map<string, { tracks: Track[]; expiresAt: number }>();

  public mapTrack(dto: DeezerTrackDTO): Track {
    // Spotify lists every performer and the app joins them «A, B»; Deezer keeps features in the title
    // (or in contributors on some endpoints), so do the same here or features vanish whenever Spotify is down.
    const main = dto.artist?.name || 'Unknown Artist';
    const split = splitFeaturing(dto.title || dto.title_short || '');
    const fold = (n: string) => n.toLocaleLowerCase().trim();
    const names = [main];
    for (const n of [...(dto.contributors || []).map(c => c.name), ...split.featured]) if (n && !names.some(x => fold(x) === fold(n))) names.push(n);
    const artworkUrl =
      dto.album?.cover_xl ||
      dto.album?.cover_big ||
      dto.album?.cover_medium ||
      dto.artist?.picture_medium;

    return {
      id: `deezer:${dto.id}`,
      source: 'deezer',
      sourceId: String(dto.id),
      title: split.title,
      artist: {
        id: `deezer:artist:${dto.artist?.id}`,
        source: 'deezer',
        sourceId: String(dto.artist?.id),
        name: names.join(', '),
        avatarUrl: dto.artist?.picture_xl || dto.artist?.picture_big || dto.artist?.picture_medium,
        permalinkUrl: dto.artist?.link,
      },
      artworkUrl,
      duration: dto.duration || 0,
      trackUrl: dto.link,
      access: 'playable',
      explicit: typeof dto.explicit_lyrics === 'boolean' ? dto.explicit_lyrics : undefined,
      // Deezer rank runs 0..1,000,000.
      popularity: typeof dto.rank === 'number' && dto.rank > 0 ? Math.min(100, Math.round(dto.rank / 10000)) : undefined,
      release: dto.album?.id ? {id:`deezer:album:${dto.album.id}`,title:dto.album.title} : undefined,
      
    };
  }

  private mapArtist(dto: DeezerArtistDTO): Artist {
    return {
      id: `deezer:artist:${dto.id}`,
      source: 'deezer',
      sourceId: String(dto.id),
      name: dto.name,
      avatarUrl: dto.picture_xl || dto.picture_big || dto.picture_medium,
      permalinkUrl: dto.link,
      followersCount: dto.nb_fan,
    };
  }

  private mapAlbum(dto: DeezerAlbumDTO): Release {
    return {
      id: `deezer:album:${dto.id}`,
      title: dto.title,
      artworkUrl: dto.cover_xl || dto.cover_big || dto.cover_medium,
      date: dto.release_date,
      type: dto.record_type || 'album',
      trackCount: dto.nb_tracks,
      url: dto.link,
      artist: dto.artist ? this.mapArtist(dto.artist) : undefined,
    };
  }

  public async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    if (!query || !query.trim()) {
      return {
        tracks: [],
        artists: [],
        albums: [],
        playlists: [],
        pagination: { page: 1, limit: options?.limit || 20, hasMore: false },
      };
    }

    const limit = Math.min(50, Math.max(1, options?.limit || 20));
    const page = Math.max(1, options?.page || 1);
    const index = (page - 1) * limit;
    const type = options?.type || 'all';
    const cacheKey = `${query.toLowerCase().trim()}:${page}:${limit}:${type}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    try {
      // Decode each section separately: a timeout, API error or malformed JSON
      // from album search must not discard healthy tracks and artists.
      const fetchPage = async <T>(path: string, count: number, start: number): Promise<DeezerSearchPage<T> | null> => {
        try {
          const response = await fetch(`${this.baseUrl}${path}?q=${encodeURIComponent(query)}&limit=${count}&index=${start}&order=RANKING`, {
            signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Oskolok-Music-Player/1.0' },
          });
          if (!response.ok) return null;
          const body = await response.json() as DeezerSearchPage<T>;
          return body.error || !Array.isArray(body.data) ? null : body;
        } catch { return null; }
      };
      const artistLimit = Math.max(10, limit);
      const [trackPage, artistPage, albumPage] = await Promise.all([
        type === 'all' || type === 'tracks' ? fetchPage<DeezerTrackDTO>('/search', limit, index) : null,
        type === 'all' || type === 'artists' || type === 'tracks' ? fetchPage<DeezerArtistDTO>('/search/artist', artistLimit, (page - 1) * artistLimit) : null,
        type === 'all' || type === 'albums' ? fetchPage<DeezerAlbumDTO>('/search/album', limit, index) : null,
      ]);
      let tracks = (trackPage?.data || []).filter(dto => dto.id && dto.title && dto.artist).map(dto => this.mapTrack(dto));
      const artists = (artistPage?.data || []).filter(dto => dto.id && dto.name).map(dto => this.mapArtist(dto))
        .sort((a, b) => rankArtist(b, query) - rankArtist(a, query));
      const albums = (albumPage?.data || []).filter(dto => dto.id && dto.title && dto.artist).map(dto => this.mapAlbum(dto));

      // Background non-blocking SQLite caching
      void Promise.all(tracks.map(track => trackCacheRepository.setCachedTrack(track))).catch(() => {});

      // Deezer's track search silently drops most region-restricted results (it reports total=181 for
      // «Metallica» yet returns one song), while artist top lists stay complete. When the query names an
      // artist, or the track search came back thin, lead with that artist's top tracks.
      const folded = normalizeMusicText;
      const q = folded(query);
      const named = artists.find(a => folded(a.name) === q) || (tracks.length < Math.min(limit, 10) / 2 ? artists.find(a => q.startsWith(`${folded(a.name)} `) || folded(a.name).startsWith(q)) : undefined);
      if (named && page === 1 && (type === 'all' || type === 'tracks')) {
        const topRes = await fetch(`${this.baseUrl}/artist/${named.sourceId}/top?limit=${Math.min(50, Math.max(10, limit))}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (topRes?.ok) {
          const topJson = await topRes.json().catch(() => ({})) as { data?: DeezerTrackDTO[] };
          const top = (topJson.data || []).map(t => this.mapTrack(t));
          const rest = folded(named.name) === q ? [] : q.slice(folded(named.name).length).trim();
          // «metallica one»: keep only the artist's songs that match the rest of the query.
          const wanted = Array.isArray(rest) ? top : top.filter(t => folded(t.title).includes(rest));
          const ids = new Set(wanted.map(t => t.id));
          tracks = [...wanted, ...tracks.filter(t => !ids.has(t.id))];
        }
      }

      const sectionPage = (body: DeezerSearchPage<unknown> | null, count: number) => ({
        hasMore: !!body && (typeof body.total === 'number' ? page * count < body.total : !!body.next || (body.data?.length || 0) === count),
        total: body?.total,
      });
      const sections = {
        tracks: sectionPage(trackPage, limit), artists: sectionPage(artistPage, artistLimit), albums: sectionPage(albumPage, limit),
      };
      const result: SearchResult = {
        tracks,
        artists,
        albums,
        playlists: [],
        pagination: {
          page,
          limit,
          hasMore: Object.values(sections).some(section => section.hasMore),
          total: trackPage?.total,
          sections,
        },
      };

      if (this.searchCache.size >= 500) this.searchCache.delete(this.searchCache.keys().next().value!);
      this.searchCache.set(cacheKey, {
        result,
        expiresAt: Date.now() + (trackPage && artistPage && albumPage ? 600_000 : 30_000),
      });

      return result;
    } catch (err) {
      logger.error({ err, query }, 'Error in OfficialCatalogService.search');
      return {
        tracks: [],
        artists: [],
        albums: [],
        playlists: [],
        pagination: { page, limit, hasMore: false },
      };
    }
  }

  public async getTrack(id: string): Promise<Track | null> {
    const rawId = id.replace(/^(spotify:|licensed:|deezer:)/, '');
    try {
      const res = await fetch(`${this.baseUrl}/track/${rawId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const dto = (await res.json()) as DeezerTrackDTO;
      if (!dto || !dto.id) return null;
      const track = this.mapTrack(dto);
      await trackCacheRepository.setCachedTrack(track);
      return track;
    } catch (err) {
      logger.error({ err, id }, 'Error fetching track from OfficialCatalogService');
      return null;
    }
  }

  public async getArtist(id: string): Promise<Artist | null> {
    const rawId = id.replace(/^(spotify:artist:|deezer:artist:|artist:)/, '');
    try {
      const res = await fetch(`${this.baseUrl}/artist/${rawId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const dto = (await res.json()) as DeezerArtistDTO;
      if (!dto || !dto.id) return null;
      return this.mapArtist(dto);
    } catch (err) {
      logger.error({ err, id }, 'Error fetching artist from OfficialCatalogService');
      return null;
    }
  }

  /** `referenceTitles`: the discography of the card asking (a linked Spotify profile), which decides whose songs these are on a shared Deezer page. */
  public async getArtistTracks(id: string, options?: PaginationOptions, referenceTitles: string[] = [], seedAlbum?: string): Promise<Track[]> {
    const rawId = id.replace(/^(spotify:artist:|deezer:artist:|artist:)/, '');
    const limit = options?.limit || 500;
    const cacheKey = `${rawId}:${limit}:${referenceTitles.length}:${seedAlbum || ''}`;

    const cached = this.artistTracksCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.tracks;
    }

    try {
      // 1. Fetch top tracks and albums list concurrently
      // One act scattered over same-named profiles: its releases from the others join, strangers' leave.
      const persona = artistPersona(rawId, { referenceTitles, seedAlbum });
      const namesakes = persona.then(p => p?.foreign || new Set<string>());
      const [topRes, albumsRes, artistInfo] = await Promise.all([
        fetch(`${this.baseUrl}/artist/${rawId}/top?limit=100`, {
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        fetch(`${this.baseUrl}/artist/${rawId}/albums?limit=500`, {
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        this.getArtist(id),
      ]);

      const tracksMap = new Map<string, Track>();
      // Same title twice is usually the explicit release and its censored twin: the explicit one wins.
      const keep = (key: string, mapped: Track) => {
        const prev = tracksMap.get(key);
        if (!prev || (mapped.explicit === true && prev.explicit === false)) tracksMap.set(key, mapped);
      };

      // 1. Populate top tracks first (so popular songs appear in their natural ranking at the top)
      if (topRes && topRes.ok) {
        const topJson = (await topRes.json()) as { data?: DeezerTrackDTO[] };
        for (const t of topJson.data || []) {
          const mapped = this.mapTrack(t);
          const key = mapped.title.trim().toLowerCase();
          keep(key, mapped);
        }
      }

      if (tracksMap.size >= limit) {
        const foreign = await namesakes;
        const tracks=Array.from(tracksMap.values()).filter(t => !foreign.has(String(t.release?.id || '').split(':').at(-1) || '')).slice(0,limit);
        this.artistTracksCache.set(cacheKey,{tracks,expiresAt:Date.now()+(namesakeDecisionReady(rawId)?1800000:60000)});
        void Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t))).catch(()=>{});
        return tracks;
      }

      // 2. Fetch tracks from the artist's albums with chunking to prevent API rate limits
      if (albumsRes && albumsRes.ok) {
        const albumsJson = (await albumsRes.json()) as { data?: Array<{ id: number }> };
        // Every release, not just the first 15: albums, EPs, singles and long mixtapes.
        // Album track lists carry no album reference, so a namesake's albums are skipped before they are fetched.
        const skip = await namesakes;
        const borrowed = (await persona)?.borrowed.map(a => a.id) || [];
        const albumIds = [...(albumsJson.data || []).map((a) => a.id).filter((albumId) => !skip.has(String(albumId))), ...borrowed].slice(0, 120);

        const chunkSize = 6;
        for (let i = 0; i < albumIds.length; i += chunkSize) {
          const chunk = albumIds.slice(i, i + chunkSize);
          const chunkResults = await Promise.all(
            chunk.map(async (albId) => {
              try {
                const albRes = await fetch(`${this.baseUrl}/album/${albId}/tracks?limit=500`, {
                  signal: AbortSignal.timeout(4000),
                });
                if (!albRes.ok) return [];
                const albJson = (await albRes.json()) as { data?: DeezerTrackDTO[] };
                return albJson.data || [];
              } catch {
                return [];
              }
            })
          );

          for (const albTracks of chunkResults) {
            for (const rawTrack of albTracks) {
              const mapped = this.mapTrack(rawTrack);
              const key = mapped.title.trim().toLowerCase();
              keep(key, mapped);
            }
          }
        }
      }

      // 3. Search for singles and additional collaborations if artist has a name
      if (artistInfo && artistInfo.name) {
        try {
          const searchRes = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(artistInfo.name)}&limit=100`, {
            signal: AbortSignal.timeout(5000),
          });
          if (searchRes.ok) {
            const searchJson = (await searchRes.json()) as { data?: DeezerTrackDTO[] };
            for (const rawTrack of searchJson.data || []) {
              if (rawTrack.artist?.id === Number(rawId)) {
                const mapped = this.mapTrack(rawTrack);
                const key = mapped.title.trim().toLowerCase();
                keep(key, mapped);
              }
            }
          }
        } catch {}
      }

      // A namesake filed under the same Deezer profile: its songs are not this artist's.
      const foreign = await namesakes;
      const tracks = Array.from(tracksMap.values()).filter(t => !foreign.has(String(t.release?.id || '').split(':').at(-1) || '')).slice(0, limit);
      // Background non-blocking SQLite caching
      Promise.all(tracks.map((t) => trackCacheRepository.setCachedTrack(t))).catch(() => {});

      this.artistTracksCache.set(cacheKey, {
        tracks,
        // Until the namesake check has finished, the list may still hold someone else's songs.
        expiresAt: Date.now() + (namesakeDecisionReady(rawId) ? 1000 * 60 * 30 : 1000 * 60),
      });

      return tracks;
    } catch (err) {
      logger.error({ err, id }, 'Error fetching artist tracks from OfficialCatalogService');
      return [];
    }
  }
}

export const officialCatalogService = new OfficialCatalogService();
