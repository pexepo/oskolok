import {
  Track,
  Artist,
  Playlist,
  SearchResult,
  SearchOptions,
  PaginationOptions,
} from '../types/index.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { officialCatalogService } from './OfficialCatalogService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifyTrackDTO {
  id: string;
  name: string;
  duration_ms: number;
  external_urls?: { spotify?: string };
  artists: Array<{ id: string; name: string }>;
  album?: {
    id: string;
    name: string;
    images?: Array<{ url: string; height?: number; width?: number }>;
  };
}

interface SpotifyArtistDTO {
  id: string;
  name: string;
  images?: Array<{ url: string; height?: number; width?: number }>;
  followers?: { total: number };
  genres?: string[];
  external_urls?: { spotify?: string };
}

export class SpotifyService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.clientId = env.SPOTIFY_CLIENT_ID || '';
    this.clientSecret = env.SPOTIFY_CLIENT_SECRET || '';
  }

  public isConfigured(): boolean {
    return Boolean(this.clientId.trim() && this.clientSecret.trim());
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.isConfigured()) {
      return null;
    }

    // Return cached token if valid for at least 60 more seconds
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, 'Spotify OAuth token request failed');
        return null;
      }

      const data = (await res.json()) as SpotifyTokenResponse;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
      logger.info('Spotify OAuth token refreshed successfully');
      return this.accessToken;
    } catch (err) {
      logger.error({ err }, 'Error fetching Spotify access token');
      return null;
    }
  }

  public mapTrack(dto: SpotifyTrackDTO): Track {
    const artworkUrl = dto.album?.images?.[0]?.url || dto.album?.images?.[1]?.url;
    const artistName = dto.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
    const primaryArtist = dto.artists?.[0];

    return {
      id: `spotify:${dto.id}`,
      source: 'spotify',
      sourceId: dto.id,
      title: dto.name,
      artist: {
        id: `spotify:artist:${primaryArtist?.id || 'unknown'}`,
        source: 'spotify',
        sourceId: primaryArtist?.id || '',
        name: artistName,
        avatarUrl: artworkUrl,
        permalinkUrl: dto.external_urls?.spotify,
      },
      artworkUrl,
      duration: Math.round((dto.duration_ms || 0) / 1000),
      trackUrl: dto.external_urls?.spotify,
      access: 'playable',
      release: dto.album?.id ? {id:`spotify:album:${dto.album.id}`,title:dto.album.name} : undefined,
      genre: 'Pop/Rock',
    };
  }

  private mapArtist(dto: SpotifyArtistDTO): Artist {
    const avatarUrl = dto.images?.[0]?.url || dto.images?.[1]?.url;
    return {
      id: `spotify:artist:${dto.id}`,
      source: 'spotify',
      sourceId: dto.id,
      name: dto.name,
      avatarUrl,
      permalinkUrl: dto.external_urls?.spotify,
      followersCount: dto.followers?.total,
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

    const token = await this.getAccessToken();

    // If Spotify is not configured or token fails, fallback seamlessly to official catalog
    if (!token) {
      return officialCatalogService.search(query, options);
    }

    const limit = options?.limit || 20;
    const page = options?.page || 1;
    const offset = (page - 1) * limit;

    try {
      const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=track,artist&limit=${limit}&offset=${offset}`;

      const res = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        // Fallback to official catalog on Spotify rate limit / quota
        logger.warn({ status: res.status }, 'Spotify search returned non-200, falling back to official catalog');
        return officialCatalogService.search(query, options);
      }

      const json = (await res.json()) as {
        tracks?: { items?: SpotifyTrackDTO[]; total?: number };
        artists?: { items?: SpotifyArtistDTO[] };
      };

      const rawTracks = json.tracks?.items || [];
      const rawArtists = json.artists?.items || [];

      const tracks = rawTracks.map((t) => this.mapTrack(t));
      const artists = rawArtists.map((a) => this.mapArtist(a));

      // Background non-blocking SQLite caching — never hold up the caller
      Promise.all(tracks.map((t) => trackCacheRepository.setCachedTrack(t))).catch(() => {});

      return {
        tracks,
        artists,
        playlists: [],
        pagination: {
          page,
          limit,
          hasMore: tracks.length === limit,
        },
      };
    } catch (err) {
      logger.error({ err, query }, 'Spotify search error, falling back to official catalog');
      return officialCatalogService.search(query, options);
    }
  }

  public async getTrack(id: string): Promise<Track | null> {
    const rawId = id.replace(/^spotify:(track:)?/, '');
    const token = await this.getAccessToken();

    if (token) {
      try {
        const res = await fetch(`https://api.spotify.com/v1/tracks/${rawId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const dto = (await res.json()) as SpotifyTrackDTO;
          const track = this.mapTrack(dto);
          await trackCacheRepository.setCachedTrack(track);
          return track;
        }
      } catch (err) {}
    }

    // Try official catalog
    let track = await officialCatalogService.getTrack(id);
    if (track) return track;

    // Fallback: resolve directly via Spotify embed (for authentic Spotify track IDs without API keys)
    track = await this.resolveSpotifyTrackFromEmbed(rawId);
    return track;
  }

  /**
   * Resolves Spotify track metadata directly from Spotify's embed page.
   * Works globally without any client ID or API credentials.
   */
  public async resolveSpotifyTrackFromEmbed(trackId: string): Promise<Track | null> {
    const rawId = trackId.replace(/^spotify:(track:)?/, '');
    try {
      const res = await fetch(`https://open.spotify.com/embed/track/${rawId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      const match = text.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
      if (!match) return null;
      const data = JSON.parse(match[1]);
      const entity = data?.props?.pageProps?.state?.data?.entity;
      if (!entity) return null;

      const artworkUrl = entity.visualIdentity?.image?.[0]?.url || entity.visualIdentity?.image?.[1]?.url;
      const artistName = (entity.artists || []).map((a: any) => a.name).join(', ') || 'Unknown Artist';
      const primaryArtist = entity.artists?.[0];

      const track: Track = {
        id: `spotify:${entity.id || rawId}`,
        source: 'spotify',
        sourceId: entity.id || rawId,
        title: entity.name || entity.title || 'Untitled Track',
        artist: {
          id: `spotify:artist:${primaryArtist?.uri?.replace('spotify:artist:', '') || 'unknown'}`,
          source: 'spotify',
          sourceId: primaryArtist?.uri?.replace('spotify:artist:', '') || '',
          name: artistName,
          avatarUrl: artworkUrl,
        },
        artworkUrl,
        duration: Math.round((entity.duration || 0) / 1000),
        trackUrl: `https://open.spotify.com/track/${entity.id || rawId}`,
        access: 'playable',
      };

      await trackCacheRepository.setCachedTrack(track);
      return track;
    } catch (err) {
      logger.debug({ err, trackId }, 'Error resolving track from Spotify embed');
      return null;
    }
  }

  /**
   * Resolves Spotify album tracks directly from Spotify's embed page.
   */
  public async resolveSpotifyAlbumFromEmbed(albumId: string): Promise<Track[]> {
    const rawId = albumId.replace(/^spotify:(album:)?/, '');
    try {
      const res = await fetch(`https://open.spotify.com/embed/album/${rawId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return [];
      const text = await res.text();
      const match = text.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
      if (!match) return [];
      const data = JSON.parse(match[1]);
      const entity = data?.props?.pageProps?.state?.data?.entity;
      if (!entity || !entity.trackList || !Array.isArray(entity.trackList)) return [];

      const albumArt = entity.visualIdentity?.image?.[0]?.url || entity.visualIdentity?.image?.[1]?.url;

      const tracks: Track[] = entity.trackList.map((t: any) => {
        const trId = (t.uri || '').replace('spotify:track:', '') || String(Math.random());
        const artistName = t.subtitle || entity.artists?.[0]?.name || 'Unknown Artist';
        return {
          id: `spotify:${trId}`,
          source: 'spotify',
          sourceId: trId,
          title: t.title || 'Untitled Track',
          artist: {
            id: `spotify:artist:${entity.artists?.[0]?.uri?.replace('spotify:artist:', '') || 'unknown'}`,
            source: 'spotify',
            sourceId: entity.artists?.[0]?.uri?.replace('spotify:artist:', '') || '',
            name: artistName,
            avatarUrl: albumArt,
          },
          artworkUrl: albumArt,
          duration: Math.round((t.duration || 0) / 1000) || 180,
          trackUrl: `https://open.spotify.com/track/${trId}`,
          access: 'playable',
          release: {id:`spotify:album:${rawId}`,title:entity.name||entity.title||'Релиз Spotify'},
        };
      });

      for (const t of tracks) {
        await trackCacheRepository.setCachedTrack(t);
      }
      return tracks;
    } catch (err) {
      logger.debug({ err, albumId }, 'Error resolving album from Spotify embed');
      return [];
    }
  }

  /**
   * Resolves a Spotify playlist directly from Spotify's embed page.
   */
  public async resolveSpotifyPlaylistFromEmbed(playlistId: string): Promise<Playlist | null> {
    const rawId = playlistId.replace(/^spotify:(playlist:)?/, '');
    // Prefer the official Web API when credentials are configured. The embed
    // document is intentionally capped and is only a fallback for public links.
    const apiPlaylist = await this.resolveSpotifyPlaylistFromApi(rawId);
    if (apiPlaylist) return apiPlaylist;
    try {
      const res = await fetch(`https://open.spotify.com/embed/playlist/${rawId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      const match = text.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
      if (!match) return null;
      const data = JSON.parse(match[1]);
      const entity = data?.props?.pageProps?.state?.data?.entity;
      if (!entity || !entity.trackList || !Array.isArray(entity.trackList)) return null;

      const artworkUrl = entity.visualIdentity?.image?.[0]?.url || entity.visualIdentity?.image?.[1]?.url;
      const title = entity.title || 'Spotify Playlist';
      const description = entity.subtitle || entity.description;

      const tracks: Track[] = entity.trackList.map((t: any) => {
        const trId = (t.uri || '').replace('spotify:track:', '') || String(Math.random());
        const artistName = t.subtitle || 'Unknown Artist';
        return {
          id: `spotify:${trId}`,
          source: 'spotify',
          sourceId: trId,
          title: t.title || 'Untitled Track',
          artist: {
            id: `spotify:artist:unknown`,
            source: 'spotify',
            sourceId: 'unknown',
            name: artistName,
            avatarUrl: artworkUrl,
          },
          artworkUrl,
          duration: Math.round((t.duration || 0) / 1000) || 180,
          trackUrl: `https://open.spotify.com/track/${trId}`,
          access: 'playable',
        };
      });

      for (const t of tracks) {
        await trackCacheRepository.setCachedTrack(t);
      }

      const playlistItems = tracks.map((t, idx) => ({
        id: `sp-pl-item-${rawId}-${t.id}`,
        playlistId: `spotify:playlist:${rawId}`,
        trackId: t.id,
        position: idx,
        addedAt: new Date().toISOString(),
        track: t,
      }));

      return {
        id: `spotify:playlist:${rawId}`,
        userId: 'spotify',
        title,
        description,
        artworkUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trackCount: tracks.length,
        tracks: playlistItems,
      };
    } catch (err) {
      logger.debug({ err, playlistId }, 'Error resolving playlist from Spotify embed');
      return null;
    }
  }

  private async resolveSpotifyPlaylistFromApi(rawId: string): Promise<Playlist | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const first = await fetch(`https://api.spotify.com/v1/playlists/${rawId}?market=US&fields=name,description,images,tracks.total`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(7000),
      });
      if (!first.ok) return null;
      const meta = await first.json() as any;
      const all: SpotifyTrackDTO[] = [];
      let offset = 0;
      const pageSize = 100;
      while (offset < 1000) {
        const page = await fetch(`https://api.spotify.com/v1/playlists/${rawId}/tracks?market=US&limit=${pageSize}&offset=${offset}&fields=items(track(id,name,duration_ms,external_urls,artists,album)),next,total`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(7000),
        });
        if (!page.ok) return null;
        const json = await page.json() as any;
        const items = Array.isArray(json.items) ? json.items : [];
        for (const item of items) if (item?.track?.id) all.push(item.track as SpotifyTrackDTO);
        offset += items.length;
        if (!json.next || items.length === 0) break;
      }
      if (!all.length) return null;
      const tracks = all.map((dto) => this.mapTrack(dto));
      await Promise.all(tracks.map((track) => trackCacheRepository.setCachedTrack(track).catch(() => undefined)));
      const artworkUrl = meta.images?.[0]?.url;
      const playlistItems = tracks.map((track, index) => ({
        id: `sp-pl-item-${rawId}-${index}-${track.id}`,
        playlistId: `spotify:playlist:${rawId}`,
        trackId: track.id, position: index, addedAt: new Date().toISOString(), track,
      }));
      return {
        id: `spotify:playlist:${rawId}`, userId: 'spotify',
        title: meta.name || 'Spotify Playlist',
        description: typeof meta.description === 'string' ? meta.description : undefined,
        artworkUrl, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        trackCount: tracks.length, tracks: playlistItems,
      };
    } catch (err) {
      logger.debug({ err, playlistId: rawId }, 'Spotify playlist API resolution failed; using embed fallback');
      return null;
    }
  }

  /**
   * Detects and resolves pasted Spotify links (tracks, albums, and playlists).
   */
  public async resolveSpotifyUrl(url: string): Promise<SearchResult | null> {
    const trackMatch = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/) || url.match(/^spotify:track:([a-zA-Z0-9]+)/);
    const albumMatch = url.match(/open\.spotify\.com\/album\/([a-zA-Z0-9]+)/) || url.match(/^spotify:album:([a-zA-Z0-9]+)/);
    const playlistMatch = url.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/) || url.match(/^spotify:playlist:([a-zA-Z0-9]+)/);

    if (trackMatch) {
      const trackId = trackMatch[1];
      const track = await this.resolveSpotifyTrackFromEmbed(trackId);
      if (track) {
        return {
          tracks: [track],
          artists: [track.artist],
          playlists: [],
          pagination: { page: 1, limit: 20, hasMore: false },
        };
      }
    }

    if (albumMatch) {
      const albumId = albumMatch[1];
      const albumTracks = await this.resolveSpotifyAlbumFromEmbed(albumId);
      if (albumTracks && albumTracks.length > 0) {
        return {
          tracks: albumTracks,
          artists: [albumTracks[0].artist],
          playlists: [],
          pagination: { page: 1, limit: albumTracks.length, hasMore: false },
        };
      }
    }

    if (playlistMatch) {
      const playlistId = playlistMatch[1];
      const playlist = await this.resolveSpotifyPlaylistFromEmbed(playlistId);
      if (playlist && playlist.tracks && playlist.tracks.length > 0) {
        const tracks = playlist.tracks.map((t) => t.track);
        return {
          tracks,
          artists: [tracks[0].artist],
          playlists: [playlist],
          pagination: { page: 1, limit: tracks.length, hasMore: false },
        };
      }
    }

    return null;
  }

  public async getArtist(id: string): Promise<Artist | null> {
    const rawId = id.replace(/^spotify:artist:/, '');
    const token = await this.getAccessToken();

    if (!token) {
      return this.getPublicArtist(rawId);
    }

    try {
      const res = await fetch(`https://api.spotify.com/v1/artists/${rawId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return this.getPublicArtist(rawId);
      }

      const dto = (await res.json()) as SpotifyArtistDTO;
      return this.mapArtist(dto);
    } catch (err) {
      return this.getPublicArtist(rawId);
    }
  }

  private async getPublicArtist(rawId:string):Promise<Artist|null>{
    if(/^\d+$/.test(rawId))return officialCatalogService.getArtist(`deezer:artist:${rawId}`);
    if(!/^[a-zA-Z0-9]{22}$/.test(rawId))return null;
    try{
      const r=await fetch(`https://open.spotify.com/embed/artist/${rawId}`,{signal:AbortSignal.timeout(6000)});
      if(!r.ok)return null;const html=await r.text();const match=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);if(!match)return null;
      const e=JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity;
      if(!e?.name&&!e?.title)return null;
      let followersCount:number|undefined;
      let monthlyListeners:number|undefined;
      try {
        const page=await fetch(`https://open.spotify.com/artist/${rawId}`,{signal:AbortSignal.timeout(6000),headers:{'User-Agent':'Mozilla/5.0'}});
        if(page.ok){const body=await page.text();const m=body.match(/>([\d,.\s]+)<\/p>\s*<p[^>]*>Followers<\/p>/i);if(m)followersCount=Number(m[1].replace(/[,\.\s]/g,''));const listeners=body.match(/>([\d,\s]+) monthly listeners<\//i);if(listeners)monthlyListeners=Number(listeners[1].replace(/[,\s]/g,''));}
      } catch {}
      return {id:`spotify:artist:${rawId}`,source:'spotify',sourceId:rawId,name:e.name||e.title,avatarUrl:e.visualIdentity?.image?.[0]?.url,permalinkUrl:`https://open.spotify.com/artist/${rawId}`,followersCount,monthlyListeners};
    }catch{return null;}
  }

  private async matchedCatalogTracks(id:string,options?:PaginationOptions):Promise<Track[]>{
    const rawId=id.replace(/^spotify:artist:/,'');
    if(/^\d+$/.test(rawId))return officialCatalogService.getArtistTracks(id,options);
    const artist=await this.getPublicArtist(rawId);if(!artist)return [];
    const result=await officialCatalogService.search(artist.name,{limit:1});
    const match=result.artists.find(a=>a.name.toLowerCase()===artist.name.toLowerCase());
    return match?officialCatalogService.getArtistTracks(match.id,options):[];
  }

  public async getArtistTracks(id: string, options?: PaginationOptions): Promise<Track[]> {
    const rawId = id.replace(/^spotify:artist:/, '');
    const token = await this.getAccessToken();

    if (!token) {
      return this.matchedCatalogTracks(id, options);
    }

    try {
      const res = await fetch(`https://api.spotify.com/v1/artists/${rawId}/top-tracks?market=US`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        return this.matchedCatalogTracks(id, options);
      }

      const json = (await res.json()) as { tracks?: SpotifyTrackDTO[] };
      const tracks = (json.tracks || []).map((t) => this.mapTrack(t));

      for (const t of tracks) {
        await trackCacheRepository.setCachedTrack(t);
      }

      return tracks;
    } catch (err) {
      return this.matchedCatalogTracks(id, options);
    }
  }
}

export const spotifyService = new SpotifyService();
