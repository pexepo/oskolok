import { TrackProvider } from './TrackProvider.js';
import {
  Track,
  Artist,
  Playlist,
  PlaybackInfo,
  SearchResult,
  SearchOptions,
  PaginationOptions,
  SoundCloudTrackDTO,
  SoundCloudArtistDTO,
  SoundCloudPlaylistDTO,
} from '../types/index.js';
import { SoundCloudMapper } from './SoundCloudMapper.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { streamResolverService } from './StreamResolverService.js';
import { env } from '../config/env.js';
import { rankSoundCloud } from './trackRanking.js';
import { logger } from '../utils/logger.js';

const FALLBACK_CLIENT_IDS = [
  'Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo',
  'rB5gM39wzXkPzE4Bw20hTqX1S3Jt7Z94',
  'iZt66xYzpLIU1AwrJGsubm8F62r6tY46',
];

export class SoundCloudService implements TrackProvider {
  private clientId: string;
  private clientSecret: string;
  private baseUrl = 'https://api-v2.soundcloud.com';

  constructor() {
    this.clientId = env.SOUNDCLOUD_CLIENT_ID || FALLBACK_CLIENT_IDS[0];
    this.clientSecret = env.SOUNDCLOUD_CLIENT_SECRET || '';
  }

  public isConfigured(): boolean {
    return true;
  }

  public async resolveLink(url: string): Promise<{title:string;tracks:Track[];total:number}> {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||!['soundcloud.com','www.soundcloud.com'].includes(parsed.hostname))throw new Error('Нужна полная ссылка soundcloud.com.');
    const dto=await this.fetchWithClientKey<any>('/resolve',{url:parsed.href});
    if(dto?.kind==='track') {const track=SoundCloudMapper.mapTrack(dto);await trackCacheRepository.setCachedTrack(track);return {title:track.title,tracks:[track],total:1};}
    if(dto?.kind==='playlist') {const playlist=await this.getPlaylist(`soundcloud:${dto.id}`);return {title:playlist?.title||dto.title,tracks:playlist?.tracks?.map(t=>t.track).filter(t=>Boolean(t.title))||[],total:dto.track_count||0};}
    throw new Error('Откройте публичный трек или плейлист SoundCloud и скопируйте полную ссылку.');
  }

  private async fetchWithClientKey<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
    const dynamicKey = await streamResolverService.getFreshClientId().catch(() => null);
    const keysToTry = [...new Set([dynamicKey, this.clientId, ...FALLBACK_CLIENT_IDS].filter(Boolean))].slice(0, 2) as string[];

    for (const key of keysToTry) {
      const queryParams = new URLSearchParams({
        client_id: key,
        ...params,
      });

      const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}?${queryParams.toString()}`;

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(6000),
          headers: {
            Accept: 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });

        if (response.ok) {
          this.clientId = key;
          return (await response.json()) as T;
        }
      } catch (err) {
        // Try next fallback key
      }
    }

    return null;
  }

  /**
   * Intelligently scores a SoundCloud track to prioritize official releases
   * and heavily penalize 30s snippets, random low-effort nightcores/slowed/re-uploads.
   */
  private scoreTrack(t: SoundCloudTrackDTO, query: string): number {
    return rankSoundCloud(t, query);
  }

  /**
   * Universal Search prioritizing original full-length releases and authentic artists
   */
  public async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    if (!query || !query.trim()) {
      return {
        tracks: [],
        artists: [],
        playlists: [],
        pagination: { page: options?.page || 1, limit: options?.limit || 20, hasMore: false },
      };
    }

    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    try {
      // Fetch directly from SoundCloud v2 for full audio streams
      const [trackRes, userRes, playlistRes] = await Promise.all([
        this.fetchWithClientKey<{ collection?: SoundCloudTrackDTO[] }>('/search/tracks', {
          q: query,
          limit: String(limit + 15),
          offset: String(offset),
        }),
        options?.type === 'tracks' ? Promise.resolve(null) : this.fetchWithClientKey<{ collection?: SoundCloudArtistDTO[] }>('/search/users', {
          q: query,
          limit: String(8),
        }),
        options?.type === 'tracks' ? Promise.resolve(null) : this.fetchWithClientKey<{ collection?: SoundCloudPlaylistDTO[] }>('/search/playlists', {
          q: query,
          limit: String(8),
        }),
      ]);

      // Rank SoundCloud tracks by popularity, authentic artists, and relevance
      let rawScTracks = trackRes?.collection || [];
      rawScTracks.sort((a, b) => this.scoreTrack(b, query) - this.scoreTrack(a, query));

      const scTracks = rawScTracks.map((t) => SoundCloudMapper.mapTrack(t));
      for (const t of scTracks) {
        await trackCacheRepository.setCachedTrack(t);
      }

      // Filter out duplicate or low quality tracks
      const seen = new Set<string>();
      const filteredTracks: Track[] = [];

      for (const t of scTracks) {
        const key = `${t.title.toLowerCase()}:::${t.artist.name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          filteredTracks.push(t);
        }
        if (filteredTracks.length >= limit) break;
      }

      const rawUsers = userRes?.collection || [];
      const rawPlaylists = playlistRes?.collection || [];

      const artists = rawUsers.map((a) => SoundCloudMapper.mapArtist(a));
      const playlists = rawPlaylists.map((p) => SoundCloudMapper.mapPlaylist(p));

      return {
        tracks: filteredTracks,
        artists,
        playlists,
        pagination: {
          page,
          limit,
          hasMore: filteredTracks.length === limit,
        },
      };
    } catch (err: any) {
      logger.error({ err }, 'Error during music search');
      return {
        tracks: [],
        artists: [],
        playlists: [],
        pagination: { page, limit, hasMore: false },
      };
    }
  }

  public async getRelatedTracks(id: string, limit = 15): Promise<Track[]> {
    const rawId = id.replace(/^soundcloud:/, '');
    if (!/^\d+$/.test(rawId)) return [];
    const result = await this.fetchWithClientKey<{ collection?: SoundCloudTrackDTO[] }>(`/tracks/${rawId}/related`, { limit: String(limit) });
    const tracks = (result?.collection || []).filter(t => t.policy !== 'BLOCK' && t.policy !== 'SNIP').map(t => SoundCloudMapper.mapTrack(t));
    await Promise.all(tracks.map(t => trackCacheRepository.setCachedTrack(t)));
    return tracks;
  }

  public async getTrack(id: string): Promise<Track | null> {
    if (id.startsWith('licensed:')) {
      return await trackCacheRepository.getCachedTrack(id);
    }

    const numericId = id.replace(/^soundcloud:/, '');
    const dto = await this.fetchWithClientKey<SoundCloudTrackDTO>(`/tracks/${numericId}`);
    if (!dto) return null;
    return SoundCloudMapper.mapTrack(dto);
  }

  public async getArtist(id: string): Promise<Artist | null> {
    const numericId = id.replace(/^soundcloud:/, '');
    const dto = await this.fetchWithClientKey<SoundCloudArtistDTO>(`/users/${numericId}`);
    if (!dto) return null;
    return SoundCloudMapper.mapArtist(dto);
  }

  public async getArtistTracks(id: string, options?: PaginationOptions): Promise<Track[]> {
    const numericId = id.replace(/^soundcloud:/, '');
    const limit = options?.limit || 20;
    const page = options?.page || 1;
    const offset = (page - 1) * limit;

    const res = await this.fetchWithClientKey<{ collection?: SoundCloudTrackDTO[] }>(
      `/users/${numericId}/tracks`,
      {
        limit: String(limit),
        offset: String(offset),
      }
    );

    const dtos = res?.collection || [];
    return dtos.map((t) => SoundCloudMapper.mapTrack(t));
  }

  public async getPlaylist(id: string): Promise<Playlist | null> {
    const numericId = id.replace(/^soundcloud:/, '');
    const dto = await this.fetchWithClientKey<SoundCloudPlaylistDTO>(`/playlists/${numericId}`);
    if (!dto) return null;

    // Batch resolve stub tracks (where title is missing)
    if (dto.tracks && dto.tracks.length > 0) {
      const stubIds = dto.tracks
        .filter((t: any) => !t.title && t.id)
        .map((t: any) => t.id);

      if (stubIds.length > 0) {
        const resolvedMap = new Map<string, SoundCloudTrackDTO>();
        for (let i = 0; i < stubIds.length; i += 50) {
          const chunk = stubIds.slice(i, i + 50);
          try {
            const resolved = await this.fetchWithClientKey<SoundCloudTrackDTO[]>(`/tracks`, {
              ids: chunk.join(','),
            });
            if (resolved && Array.isArray(resolved)) {
              for (const rt of resolved) {
                resolvedMap.set(String(rt.id), rt);
              }
            }
          } catch (e) {
            logger.warn({ err: e }, 'Failed to batch resolve SoundCloud playlist tracks');
          }
        }

        dto.tracks = dto.tracks.map((t: any) => resolvedMap.get(String(t.id)) || t);
      }
    }

    const playlist = SoundCloudMapper.mapPlaylist(dto);

    // Cache tracks for instant playback and prefetching
    for (const item of playlist.tracks || []) {
      if (item.track) {
        await trackCacheRepository.setCachedTrack(item.track).catch(() => {});
      }
    }

    return playlist;
  }

  public async getPlaybackInfo(id: string): Promise<PlaybackInfo> {
    // 1. If track is licensed (official release with streamUrl)
    if (id.startsWith('licensed:')) {
      const cached = await trackCacheRepository.getCachedTrack(id);
      if (cached && cached.streamUrl) {
        return {
          available: true,
          type: 'progressive',
          url: cached.streamUrl,
          expiresAt: Date.now() + 86400000,
          mimeType: 'audio/mp4',
        };
      }
    }

    const numericId = id.replace(/^soundcloud:/, '');

    try {
      const dto = await this.fetchWithClientKey<SoundCloudTrackDTO>(`/tracks/${numericId}`);
      if (!dto) {
        return { available: false, type: 'none' };
      }

      if (
        dto.policy === 'BLOCK' ||
        dto.policy === 'SNIP' ||
        (dto as any).snipped ||
        (dto.duration && (dto as any).full_duration && dto.duration < (dto as any).full_duration - 5000)
      ) {
        logger.debug({ trackId: id, policy: dto.policy }, 'SoundCloud track is blocked or snipped (Go+ preview with ad), rejecting stream');
        return { available: false, type: 'none' };
      }

      // Look up media transcodings
      if (dto.media?.transcodings && dto.media.transcodings.length > 0) {
        const progressive = dto.media.transcodings.find(
          (t) => t.format.protocol === 'progressive'
        );
        const targetTrans =
          progressive ||
          dto.media.transcodings.find((t) => t.format.protocol === 'hls') ||
          dto.media.transcodings[0];

        if (targetTrans?.url) {
          const streamEndpoint = `${targetTrans.url}?client_id=${this.clientId}`;
          const streamRes = await fetch(streamEndpoint, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (streamRes.ok) {
            const streamJson = (await streamRes.json()) as { url?: string };
            if (streamJson.url) {
              return {
                available: true,
                type: targetTrans.format.protocol === 'hls' ? 'hls' : 'progressive',
                url: streamJson.url,
                expiresAt: Date.now() + 1800 * 1000,
                mimeType: targetTrans.format.mime_type,
              };
            }
          }
        }
      }

      if (dto.stream_url) {
        return {
          available: true,
          type: 'progressive',
          url: `${dto.stream_url}?client_id=${this.clientId}`,
          expiresAt: Date.now() + 3600 * 1000,
        };
      }

      return { available: false, type: 'none' };
    } catch (err: any) {
      logger.error({ err }, `Error fetching playback info for track ${id}`);
      return { available: false, type: 'none' };
    }
  }
}

export const soundCloudService = new SoundCloudService();
