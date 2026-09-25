import {
  Track,
  Artist,
  Playlist,
  SearchResult,
  SearchOptions,
  PaginationOptions,
} from '../types/index.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { logger } from '../utils/logger.js';

interface DeezerTrackDTO {
  id: number;
  title: string;
  title_short?: string;
  duration: number; // in seconds
  link?: string;
  preview?: string;
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

export class OfficialCatalogService {
  private baseUrl = 'https://api.deezer.com';
  private searchCache = new Map<string, { result: SearchResult; expiresAt: number }>();
  private artistTracksCache = new Map<string, { tracks: Track[]; expiresAt: number }>();

  public mapTrack(dto: DeezerTrackDTO): Track {
    const artworkUrl =
      dto.album?.cover_xl ||
      dto.album?.cover_big ||
      dto.album?.cover_medium ||
      dto.artist?.picture_medium;

    return {
      id: `deezer:${dto.id}`,
      source: 'deezer',
      sourceId: String(dto.id),
      title: dto.title || dto.title_short || "",
      artist: {
        id: `deezer:artist:${dto.artist?.id}`,
        source: 'deezer',
        sourceId: String(dto.artist?.id),
        name: dto.artist?.name || 'Unknown Artist',
        avatarUrl: dto.artist?.picture_xl || dto.artist?.picture_big || dto.artist?.picture_medium,
        permalinkUrl: dto.artist?.link,
      },
      artworkUrl,
      duration: dto.duration || 0,
      trackUrl: dto.link,
      access: 'playable',
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

  public async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    if (!query || !query.trim()) {
      return {
        tracks: [],
        artists: [],
        playlists: [],
        pagination: { page: 1, limit: options?.limit || 20, hasMore: false },
      };
    }

    const limit = options?.limit || 20;
    const page = options?.page || 1;
    const index = (page - 1) * limit;
    const cacheKey = `${query.toLowerCase().trim()}:${page}:${limit}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    try {
      const [tracksRes, artistsRes] = await Promise.all([
        fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}&index=${index}`, {
          signal: AbortSignal.timeout(6000),
          headers: { 'User-Agent': 'Oskolok-Music-Player/1.0' },
        }),
        fetch(`${this.baseUrl}/search/artist?q=${encodeURIComponent(query)}&limit=6`, {
          signal: AbortSignal.timeout(6000),
          headers: { 'User-Agent': 'Oskolok-Music-Player/1.0' },
        }),
      ]);

      let tracks: Track[] = [];
      let artists: Artist[] = [];

      if (tracksRes.ok) {
        const tracksJson = (await tracksRes.json()) as { data?: DeezerTrackDTO[]; total?: number };
        const rawTracks = tracksJson.data || [];
        tracks = rawTracks.map((t) => this.mapTrack(t));

        // Background non-blocking SQLite caching
        Promise.all(tracks.map((t) => trackCacheRepository.setCachedTrack(t))).catch(() => {});
      }

      if (artistsRes.ok) {
        const artistsJson = (await artistsRes.json()) as { data?: DeezerArtistDTO[] };
        const rawArtists = artistsJson.data || [];
        artists = rawArtists.map((a) => this.mapArtist(a));
      }

      const result: SearchResult = {
        tracks,
        artists,
        playlists: [],
        pagination: {
          page,
          limit,
          hasMore: tracks.length === limit,
        },
      };

      this.searchCache.set(cacheKey, {
        result,
        expiresAt: Date.now() + 1000 * 60 * 10, // 10 minutes
      });

      return result;
    } catch (err) {
      logger.error({ err, query }, 'Error in OfficialCatalogService.search');
      return {
        tracks: [],
        artists: [],
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

  public async getArtistTracks(id: string, options?: PaginationOptions): Promise<Track[]> {
    const rawId = id.replace(/^(spotify:artist:|deezer:artist:|artist:)/, '');
    const limit = options?.limit || 500;
    const cacheKey = `${rawId}:${limit}`;

    const cached = this.artistTracksCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.tracks;
    }

    try {
      // 1. Fetch top tracks and albums list concurrently
      const [topRes, albumsRes, artistInfo] = await Promise.all([
        fetch(`${this.baseUrl}/artist/${rawId}/top?limit=100`, {
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        fetch(`${this.baseUrl}/artist/${rawId}/albums?limit=60`, {
          signal: AbortSignal.timeout(6000),
        }).catch(() => null),
        this.getArtist(id),
      ]);

      const tracksMap = new Map<string, Track>();

      // 1. Populate top tracks first (so popular songs appear in their natural ranking at the top)
      if (topRes && topRes.ok) {
        const topJson = (await topRes.json()) as { data?: DeezerTrackDTO[] };
        for (const t of topJson.data || []) {
          const mapped = this.mapTrack(t);
          const key = mapped.title.trim().toLowerCase();
          if (!tracksMap.has(key)) {
            tracksMap.set(key, mapped);
          }
        }
      }

      if (tracksMap.size >= limit) {
        const tracks=Array.from(tracksMap.values()).slice(0,limit);
        this.artistTracksCache.set(cacheKey,{tracks,expiresAt:Date.now()+1800000});
        void Promise.all(tracks.map(t=>trackCacheRepository.setCachedTrack(t))).catch(()=>{});
        return tracks;
      }

      // 2. Fetch tracks from the artist's albums with chunking to prevent API rate limits
      if (albumsRes && albumsRes.ok) {
        const albumsJson = (await albumsRes.json()) as { data?: Array<{ id: number }> };
        const albumIds = (albumsJson.data || []).map((a) => a.id).slice(0, 15);

        const chunkSize = 5;
        for (let i = 0; i < albumIds.length; i += chunkSize) {
          const chunk = albumIds.slice(i, i + chunkSize);
          const chunkResults = await Promise.all(
            chunk.map(async (albId) => {
              try {
                const albRes = await fetch(`${this.baseUrl}/album/${albId}/tracks`, {
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
              if (!tracksMap.has(key)) {
                tracksMap.set(key, mapped);
              }
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
                if (!tracksMap.has(key)) {
                  tracksMap.set(key, mapped);
                }
              }
            }
          }
        } catch {}
      }

      const tracks = Array.from(tracksMap.values()).slice(0, limit);
      // Background non-blocking SQLite caching
      Promise.all(tracks.map((t) => trackCacheRepository.setCachedTrack(t))).catch(() => {});

      this.artistTracksCache.set(cacheKey, {
        tracks,
        expiresAt: Date.now() + 1000 * 60 * 30, // 30 minutes
      });

      return tracks;
    } catch (err) {
      logger.error({ err, id }, 'Error fetching artist tracks from OfficialCatalogService');
      return [];
    }
  }
}

export const officialCatalogService = new OfficialCatalogService();
