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
import { officialCatalogService } from './OfficialCatalogService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prisma } from '../database/client.js';
import { latinFold } from './trackRanking.js';
import path from 'node:path';
interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifyTrackDTO {
  explicit?: boolean;
  id: string;
  name: string;
  duration_ms: number;
  external_urls?: { spotify?: string };
  artists: Array<{ id: string; name: string; external_urls?: { spotify?: string } }>;
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
  popularity?: number;
  genres?: string[];
  external_urls?: { spotify?: string };
}

interface SpotifyAlbumDTO {
  id: string;
  name: string;
  images?: Array<{ url: string }>;
  album_type?: string;
  release_date?: string;
  total_tracks?: number;
  external_urls?: { spotify?: string };
  artists?: SpotifyArtistDTO[];
  popularity?: number;
}

interface SpotifySearchPage<T> { items?: T[]; total?: number; next?: string | null }
interface SpotifySearchResponse {
  tracks?: SpotifySearchPage<SpotifyTrackDTO>;
  artists?: SpotifySearchPage<SpotifyArtistDTO>;
  albums?: SpotifySearchPage<SpotifyAlbumDTO>;
}

export class SpotifyCatalogUnavailableError extends Error {
  constructor(public readonly reason: 'not_configured' | 'token' | 'request' | 'rate_limited' | 'premium_required') {
    super(`Spotify catalog unavailable: ${reason}`);
  }
}

// Tests get a clean service; only real processes share the pause.
const COOLDOWN_FILE = process.env.VITEST ? '' : path.resolve('.spotify-cooldown.local');

export class SpotifyService {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private tokenRequest: Promise<string | null> | null = null;
  private searchCache = new Map<string, { expiresAt: number; result: Promise<SearchResult> }>();
  private staleSearches = new Map<string, { at: number; result: SearchResult }>();

  constructor() {
    this.clientId = env.SPOTIFY_CLIENT_ID || '';
    this.clientSecret = env.SPOTIFY_CLIENT_SECRET || '';
    // Restarts (tsx watch) must not knock on a door Spotify asked us to leave closed.
    try { this.cooldownUntil = COOLDOWN_FILE ? Number(readFileSync(COOLDOWN_FILE, 'utf8')) || 0 : 0; } catch { this.cooldownUntil = 0; }
  }

  // One guard for every Web API call. Spotify answers 429 with Retry-After
  // (hours for development-mode apps); retrying early only extends the ban, so
  // the whole service waits it out and callers fall back immediately.
  private cooldownUntil = 0;
  private recentCalls: number[] = [];
  private static readonly WINDOW_MS = 30_000;
  // Well under Spotify's own (undocumented) rolling limit: a development-mode app that trips it is paused for hours.
  private static readonly WINDOW_LIMIT = 20;
  /** Every Web API call of the last hour, by endpoint shape (ids collapsed), to see what eats the quota. */
  private callLog: Array<{ at: number; endpoint: string }> = [];
  private lastUsageLog = 0;
  private static endpointOf(url: string): string {
    try { return new URL(url).pathname.replace(/\/[A-Za-z0-9]{22}(?=\/|$)/g, '/:id').replace(/^\/v1/, ''); } catch { return 'other'; }
  }
  public usage() {
    const hourAgo = Date.now() - 3600_000;
    this.callLog = this.callLog.filter(c => c.at > hourAgo);
    const counts = new Map<string, number>();
    for (const c of this.callLog) counts.set(c.endpoint, (counts.get(c.endpoint) || 0) + 1);
    return { lastHour: this.callLog.length, byEndpoint: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([endpoint, count]) => ({ endpoint, count })), windowLimit: SpotifyService.WINDOW_LIMIT, windowSeconds: SpotifyService.WINDOW_MS / 1000, cacheHitsLastHour: this.cacheHits.filter(at => at > hourAgo).length };
  }
  private cacheHits: number[] = [];

  /** Why the Web API is paused right now: '' when it is available. */
  private blockReason: '' | 'rate_limited' | 'premium_required' = '';
  public rateLimitedUntil(): number { return this.cooldownUntil > Date.now() ? this.cooldownUntil : 0; }
  public status() { return { configured: this.isConfigured(), blockedUntil: this.rateLimitedUntil(), reason: this.rateLimitedUntil() ? this.blockReason || 'rate_limited' : '', usage: this.usage() }; }

  /* Identical GETs share one network call and a short-lived cached body: catalogue pages fire
     the same artist/album lookups many times, which is what exhausted the 30-second window. */
  private responses = new Map<string, { at: number; status: number; body: string; type: string }>();
  private inflight = new Map<string, Promise<{ status: number; body: string; type: string }>>();
  private static readonly RESPONSE_TTL = 10 * 60_000;

  /** How long a successful answer stays fresh: catalogue facts change slowly, search a bit faster. */
  private static ttlFor(url: string): number {
    const p = SpotifyService.endpointOf(url);
    if (p.startsWith('/search')) return 3600_000;
    if (/^\/(artists|albums|tracks)\b/.test(p)) return 24 * 3600_000;
    return SpotifyService.RESPONSE_TTL;
  }
  private static dbKey(url: string) { return `sp:v1:${createHash('sha1').update(url).digest('hex')}`; }
  // A paused Spotify still answers from answers it gave before, up to a week old: pages never go empty because of a 429.
  private static readonly STALE_LIMIT = 7 * 24 * 3600_000;

  private async apiFetch(url: string, init: RequestInit): Promise<Response> {
    const method = (init.method || 'GET').toUpperCase();
    if (method !== 'GET') return this.rawFetch(url, init);
    const ttl = SpotifyService.ttlFor(url);
    const respond = (r: { status: number; body: string; type: string }) => new Response(r.body, { status: r.status, headers: { 'content-type': r.type } });
    const hit = this.responses.get(url);
    if (hit && Date.now() - hit.at < ttl) { this.cacheHits.push(Date.now()); return respond(hit); }
    // Persistent layer: survives restarts (tsx watch reloads on every edit).
    const stored = process.env.VITEST ? null : await prisma.artistEnrichment.findUnique({ where: { id: SpotifyService.dbKey(url) } }).catch(() => null);
    if (stored && Date.now() - stored.updatedAt.getTime() < ttl) {
      const r = JSON.parse(stored.data); this.responses.set(url, { at: stored.updatedAt.getTime(), ...r }); this.cacheHits.push(Date.now()); return respond(r);
    }
    let pending = this.inflight.get(url);
    if (!pending) {
      pending = this.rawFetch(url, init).then(async res => ({ status: res.status ?? (res.ok ? 200 : 500), body: typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json()), type: res.headers?.get?.('content-type') || 'application/json' }));
      this.inflight.set(url, pending);
      void pending.finally(() => this.inflight.delete(url)).catch(() => {});
    }
    let r: { status: number; body: string; type: string };
    try { r = await pending; }
    catch (error) {
      if (error instanceof SpotifyCatalogUnavailableError && stored && Date.now() - stored.updatedAt.getTime() < SpotifyService.STALE_LIMIT) { this.cacheHits.push(Date.now()); return respond(JSON.parse(stored.data)); }
      throw error;
    }
    if (r.status === 200) {
      this.responses.set(url, { at: Date.now(), ...r });
      if (this.responses.size > 800) this.responses.delete(this.responses.keys().next().value!);
      if (!process.env.VITEST) { const id = SpotifyService.dbKey(url), data = JSON.stringify(r); void prisma.artistEnrichment.upsert({ where: { id }, create: { id, data }, update: { data } }).catch(() => {}); }
    }
    return respond(r);
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response> {
    const now = Date.now();
    if (now < this.cooldownUntil) throw new SpotifyCatalogUnavailableError(this.blockReason === 'premium_required' ? 'premium_required' : 'rate_limited');
    this.recentCalls = this.recentCalls.filter(at => now - at < SpotifyService.WINDOW_MS);
    if (this.recentCalls.length >= SpotifyService.WINDOW_LIMIT) throw new SpotifyCatalogUnavailableError('rate_limited');
    this.recentCalls.push(now);
    this.callLog.push({ at: now, endpoint: SpotifyService.endpointOf(url) });
    if (now - this.lastUsageLog > 15 * 60_000) { this.lastUsageLog = now; const u = this.usage(); logger.info({ lastHour: u.lastHour, top: u.byEndpoint }, 'Spotify Web API usage'); }
    const res = await fetch(url, init);
    if (res.status === 429) {
      const retryAfter = Number(res.headers?.get?.('retry-after')) || 30;
      const until = Date.now() + Math.max(30, retryAfter) * 1000;
      if (until > this.cooldownUntil) {
        this.cooldownUntil = until;
        if (COOLDOWN_FILE) try { writeFileSync(COOLDOWN_FILE, String(until)); } catch { /* best effort */ }
        logger.warn({ retryAfterSeconds: retryAfter, lastHour: this.usage() }, 'Spotify rate limit: pausing Web API calls until Retry-After');
      }
      this.blockReason = 'rate_limited';
      throw new SpotifyCatalogUnavailableError('rate_limited');
    }
    // Since 2026 a development-mode app answers every call with 403 unless its owner has Premium.
    // After the owner buys Premium it takes a few hours to reach every Spotify backend, so answers flap between 200 and
    // this 403. Pause briefly (every request falls back to Deezer meanwhile) rather than for long, to pick Spotify up soon.
    if (res.status === 403) {
      const text = typeof res.clone === 'function' ? await res.clone().text().catch(() => '') : '';
      if (/premium/i.test(text)) {
        if (this.blockReason !== 'premium_required') logger.error('Spotify Web API refused: the app owner account needs an active Spotify Premium subscription (developer.spotify.com). Falling back to Deezer.');
        this.blockReason = 'premium_required';
        this.cooldownUntil = Date.now() + 5 * 60_000;
        if (COOLDOWN_FILE) try { writeFileSync(COOLDOWN_FILE, String(this.cooldownUntil)); } catch { /* best effort */ }
        throw new SpotifyCatalogUnavailableError('premium_required');
      }
    }
    return res;
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

    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = this.refreshAccessToken();
    try { return await this.tokenRequest; }
    finally { this.tokenRequest = null; }
  }

  private async refreshAccessToken(): Promise<string | null> {
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
      explicit: dto.explicit,
      popularity: typeof (dto as { popularity?: number }).popularity === 'number' ? (dto as { popularity?: number }).popularity : undefined,
      artist: {
        id: `spotify:artist:${primaryArtist?.id || 'unknown'}`,
        source: 'spotify',
        sourceId: primaryArtist?.id || '',
        name: artistName,
        avatarUrl: artworkUrl,
        permalinkUrl: primaryArtist?.external_urls?.spotify || (primaryArtist?.id ? `https://open.spotify.com/artist/${primaryArtist.id}` : undefined),
      },
      artworkUrl,
      duration: Math.round((dto.duration_ms || 0) / 1000),
      trackUrl: dto.external_urls?.spotify,
      access: 'playable',
      release: dto.album?.id ? {id:`spotify:album:${dto.album.id}`,title:dto.album.name} : undefined,
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
      popularity: dto.popularity,
    };
  }

  private mapAlbum(dto: SpotifyAlbumDTO): Release {
    return {
      id: `spotify:album:${dto.id}`,
      title: dto.name,
      artworkUrl: dto.images?.[0]?.url,
      type: dto.album_type || 'album',
      date: dto.release_date,
      trackCount: dto.total_tracks,
      url: dto.external_urls?.spotify || `https://open.spotify.com/album/${dto.id}`,
      artist: dto.artists?.[0] ? this.mapArtist(dto.artists[0]) : undefined,
      popularity: dto.popularity,
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

    const key = `${query.trim().toLocaleLowerCase()}:${options?.page || 1}:${options?.limit || 20}:${options?.type || 'all'}`;
    const cached = this.searchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (this.searchCache.size >= 500) this.searchCache.delete(this.searchCache.keys().next().value!);
    const result = this.searchUncached(query, options);
    this.searchCache.set(key, { expiresAt: Date.now() + 30 * 60_000, result });
    void result.then(value => {
      this.staleSearches.set(key, { at: Date.now(), result: value });
      if (this.staleSearches.size > 1000) this.staleSearches.delete(this.staleSearches.keys().next().value!);
    }, () => { if (this.searchCache.get(key)?.result === result) this.searchCache.delete(key); });
    // While Spotify is unavailable, a recent Spotify answer beats a different catalog.
    return result.catch(error => {
      const stale = this.staleSearches.get(key);
      if (stale && Date.now() - stale.at < 24 * 60 * 60_000) return stale.result;
      throw error;
    });
  }

  private async searchUncached(query: string, options?: SearchOptions): Promise<SearchResult> {

    const token = await this.getAccessToken();

    if (!token) {
      throw new SpotifyCatalogUnavailableError(this.isConfigured() ? 'token' : 'not_configured');
    }

    const limit = Math.min(50, Math.max(1, options?.limit || 20));
    const page = Math.max(1, options?.page || 1);
    const offset = (page - 1) * limit;

    try {
      // Spotify's current Search API accepts at most 10 results per type.
      // A single 20/25-result request used to produce HTTP 400 and a hidden Deezer fallback.
      const type = options?.type === 'albums' ? 'album' : options?.type === 'artists' ? 'artist' : options?.type === 'tracks' ? 'track,artist' : 'track,artist,album';
      const responses = await Promise.allSettled(Array.from({ length: Math.ceil(limit / 10) }, async (_, index) => {
        const batchLimit = Math.min(10, limit - index * 10);
        const batchOffset = offset + index * 10;
        if (batchOffset > 1000) return null;
        const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&market=US&limit=${batchLimit}&offset=${batchOffset}`;
        const res = await this.apiFetch(searchUrl, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          logger.warn({ status: res.status }, 'Spotify catalog search unavailable');
          throw new SpotifyCatalogUnavailableError('request');
        }
        return res.json() as Promise<SpotifySearchResponse>;
      }));
      const batches = responses.flatMap(response => response.status === 'fulfilled' && response.value ? [response.value] : []);
      if (!batches.length) {
        const failure = responses.find(response => response.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }

      const rawTracks = batches.flatMap(batch => batch?.tracks?.items || []);
      const rawArtists = batches.flatMap(batch => batch?.artists?.items || []);
      const rawAlbums = batches.flatMap(batch => batch?.albums?.items || []);

      const tracks = rawTracks.map((t) => this.mapTrack(t));
      const artists = [...new Map(rawArtists.map(a => [a.id, this.mapArtist(a)])).values()];
      const albums = [...new Map(rawAlbums.filter(a => a.id && a.name).map(a => [a.id, this.mapAlbum(a)])).values()];
      const sectionPage = (section: 'tracks' | 'artists' | 'albums') => {
        const total = batches.find(batch => typeof batch[section]?.total === 'number')?.[section]?.total;
        return { total, hasMore: offset + limit <= 1000 && (typeof total === 'number' ? offset + limit < total : batches.some(batch => !!batch[section]?.next)) };
      };
      const sections = { tracks: sectionPage('tracks'), artists: sectionPage('artists'), albums: sectionPage('albums') };

      // Background non-blocking SQLite caching — never hold up the caller
      Promise.all(tracks.map((t) => trackCacheRepository.setCachedTrack(t))).catch(() => {});

      return {
        tracks,
        artists,
        albums,
        playlists: [],
        pagination: {
          page,
          limit,
          hasMore: Object.values(sections).some(section => section.hasMore),
          total: sections.tracks.total,
          sections,
        },
      };
    } catch (err) {
      if (err instanceof SpotifyCatalogUnavailableError) throw err;
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, 'Spotify catalog search unavailable');
      throw new SpotifyCatalogUnavailableError('request');
    }
  }

  public async getTrack(id: string): Promise<Track | null> {
    const rawId = id.replace(/^spotify:(track:)?/, '');
    const token = await this.getAccessToken();

    if (token) {
      try {
        const res = await this.apiFetch(`https://api.spotify.com/v1/tracks/${rawId}`, {
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

  public async getAlbumFromApi(albumId: string): Promise<{ id: string; title: string; artworkUrl?: string; date?: string; type?: string; trackCount: number; url: string; artist?: Artist; tracks: Track[] } | null> {
    const rawId = albumId.replace(/^spotify:album:/, '');
    if (!/^[a-zA-Z0-9]{22}$/.test(rawId)) return null;
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await this.apiFetch(`https://api.spotify.com/v1/albums/${rawId}?market=US`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const album = await res.json() as {
        id: string; name: string; images?: Array<{ url: string }>;
        artists?: Array<{ id: string; name: string }>;
        release_date?: string; album_type?: string; total_tracks?: number;
        external_urls?: { spotify?: string };
        tracks?: { items?: SpotifyTrackDTO[]; next?: string | null };
      };
      const tracks = [...(album.tracks?.items || [])];
      let offset = tracks.length;
      while (album.tracks?.next && offset < Math.min(album.total_tracks || 0, 300)) {
        const page = await this.apiFetch(`https://api.spotify.com/v1/albums/${rawId}/tracks?market=US&limit=50&offset=${offset}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000),
        });
        if (!page.ok) return null;
        const data = await page.json() as { items?: SpotifyTrackDTO[]; next?: string | null };
        const items = data.items || [];
        tracks.push(...items);
        offset += items.length;
        album.tracks.next = data.next;
        if (!items.length) break;
      }
      const albumInfo = { id: rawId, name: album.name, images: album.images };
      const mapped = tracks.filter(track => track.id).map(track => this.mapTrack({ ...track, album: albumInfo }));
      await Promise.all(mapped.map(track => trackCacheRepository.setCachedTrack(track).catch(() => undefined)));
      return {
        id: `spotify:album:${rawId}`, title: album.name,
        artworkUrl: album.images?.[0]?.url, date: album.release_date,
        type: album.album_type, trackCount: album.total_tracks || mapped.length,
        url: album.external_urls?.spotify || `https://open.spotify.com/album/${rawId}`,
        artist: mapped[0]?.artist, tracks: mapped,
      };
    } catch (error) {
      logger.warn({ message: error instanceof Error ? error.message : String(error) }, 'Spotify album unavailable');
      return null;
    }
  }

  public async getArtistReleases(artistId: string): Promise<Array<{ id: string; title: string; artworkUrl?: string; date?: string; type?: string; trackCount?: number; url: string }> | null> {
    const rawId = artistId.replace(/^spotify:artist:/, '');
    if (!/^[a-zA-Z0-9]{22}$/.test(rawId)) return null;
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const releases: Array<{ id: string; title: string; artworkUrl?: string; date?: string; type?: string; trackCount?: number; url: string }> = [];
      // Whole discography (prolific artists have hundreds of singles), not just the first 50 entries.
      for (let offset = 0; offset < 300; offset += 10) {
        const res = await this.apiFetch(`https://api.spotify.com/v1/artists/${rawId}/albums?include_groups=album,single,compilation&market=US&limit=10&offset=${offset}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return releases.length?releases:null;
        const page = await res.json() as { items?: Array<{ id: string; name: string; images?: Array<{ url: string }>; release_date?: string; album_type?: string; total_tracks?: number; external_urls?: { spotify?: string } }>; next?: string | null };
        for (const item of page.items || []) releases.push({
          id: `spotify:album:${item.id}`, title: item.name,
          artworkUrl: item.images?.[0]?.url, date: item.release_date,
          type: item.album_type, trackCount: item.total_tracks,
          url: item.external_urls?.spotify || `https://open.spotify.com/album/${item.id}`,
        });
        if (!page.next || !page.items?.length) break;
      }
      return [...new Map(releases.map(release => [release.id, release])).values()];
    } catch (error) {
      logger.warn({ message: error instanceof Error ? error.message : String(error) }, 'Spotify artist releases unavailable');
      return null;
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
          },
          artworkUrl,
          duration: Math.round((t.duration || 0) / 1000) || 180,
          explicit: typeof t.isExplicit === 'boolean' ? t.isExplicit : undefined,
          trackUrl: `https://open.spotify.com/track/${trId}`,
          access: 'playable',
        };
      });

      await this.attachTrackArtwork(tracks, artworkUrl, 7000);
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

  /**
   * The public playlist embed carries one cover for the whole list. Per-track
   * covers come from Spotify's oEmbed endpoint, which needs no app quota;
   * whatever does not arrive within the budget keeps the playlist cover.
   */
  private async attachTrackArtwork(tracks: Track[], fallback: string | undefined, budgetMs: number): Promise<void> {
    const deadline = Date.now() + budgetMs;
    let cursor = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
      while (cursor < tracks.length && Date.now() < deadline) {
        const track = tracks[cursor++];
        try {
          const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${track.sourceId}`)}`, {
            signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())),
          });
          if (!res.ok) continue;
          const body = await res.json() as { thumbnail_url?: string };
          if (body.thumbnail_url) track.artworkUrl = body.thumbnail_url;
        } catch { /* keep the playlist cover */ }
      }
    }));
    for (const track of tracks) track.artworkUrl ||= fallback;
  }

  private async resolveSpotifyPlaylistFromApi(rawId: string): Promise<Playlist | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const first = await this.apiFetch(`https://api.spotify.com/v1/playlists/${rawId}?market=US&fields=name,description,images,tracks.total`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(7000),
      });
      if (!first.ok) return null;
      const meta = await first.json() as any;
      const all: SpotifyTrackDTO[] = [];
      let offset = 0;
      const pageSize = 100;
      while (offset < 1000) {
        const page = await this.apiFetch(`https://api.spotify.com/v1/playlists/${rawId}/tracks?market=US&limit=${pageSize}&offset=${offset}&fields=items(track(id,name,duration_ms,external_urls,artists,album)),next,total`, {
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

  private artistMemo = new Map<string, { at: number; artist: Artist }>();
  public async getArtist(id: string): Promise<Artist | null> {
    const rawId = id.replace(/^spotify:artist:/, '');
    // The paused-API fallback scrapes the public embed page each time; one answer a day is enough.
    const memo = this.artistMemo.get(rawId);
    if (memo && Date.now() - memo.at < 24 * 3600_000) return memo.artist;
    const artist = await this.getArtistUncached(rawId);
    if (artist) { this.artistMemo.set(rawId, { at: Date.now(), artist }); if (this.artistMemo.size > 3000) this.artistMemo.delete(this.artistMemo.keys().next().value!); }
    return artist;
  }

  private async getArtistUncached(rawId: string): Promise<Artist | null> {
    const token = await this.getAccessToken();

    if (!token) {
      return this.getPublicArtist(rawId);
    }

    try {
      const res = await this.apiFetch(`https://api.spotify.com/v1/artists/${rawId}`, {
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

  /**
   * Releases known from Spotify tracks already in the local cache, for when the Web API is paused: albums that exist
   * only on Spotify (Слава КПСС «Ангельское True») keep their place in the discography. Their pages open via the embed.
   */
  public async cachedReleases(rawId: string, artistName?: string): Promise<Array<{ id: string; title: string; artworkUrl?: string; type?: string; trackCount?: number; url: string }>> {
    // Albums opened through the public embed were cached without the artist id («spotify:artist:unknown»): those match by name.
    const rows = await prisma.trackCache.findMany({ where: { source: 'spotify', OR: [{ trackData: { contains: `spotify:artist:${rawId}` } }, ...(artistName ? [{ trackData: { contains: '"spotify:artist:unknown"' } }] : [])] }, select: { trackData: true } }).catch(() => []);
    const wanted = artistName ? latinFold(artistName) : '';
    const byRelease = new Map<string, { id: string; title: string; artworkUrl?: string; tracks: Set<string> }>();
    for (const row of rows) {
      let t: Track; try { t = JSON.parse(row.trackData); } catch { continue; }
      const mine = t.artist?.id === `spotify:artist:${rawId}` || (!!wanted && t.artist?.id === 'spotify:artist:unknown' && latinFold((t.artist.name || '').split(',')[0]) === wanted);
      if (!mine || !t.release?.id?.startsWith('spotify:album:')) continue;
      const r = byRelease.get(t.release.id) || { id: t.release.id, title: t.release.title, artworkUrl: t.artworkUrl, tracks: new Set<string>() };
      r.tracks.add(t.id); byRelease.set(t.release.id, r);
    }
    // One title, one card: a single cut from a mixtape shares its name; the fullest release represents it.
    const byTitle = new Map<string, { id: string; title: string; artworkUrl?: string; tracks: Set<string> }>();
    for (const r of byRelease.values()) { const k = r.title.toLocaleLowerCase().trim(), prev = byTitle.get(k); if (!prev || r.tracks.size > prev.tracks.size) byTitle.set(k, r); }
    return [...byTitle.values()].map(r => ({ id: r.id, title: r.title, artworkUrl: r.artworkUrl, trackCount: r.tracks.size, type: r.tracks.size >= 7 ? 'album' : r.tracks.size >= 4 ? 'ep' : 'single', url: `https://open.spotify.com/album/${r.id.split(':').at(-1)}` }));
  }

  /**
   * The same artist on Deezer, so a Spotify card can be served from the catalog of record.
   * Same-named Deezer profiles must share a release title with the Spotify discography when it is
   * known (homonyms: the rapper «pyrokinesis» vs the metal band); otherwise the larger audience wins.
   * Verified matches live for 30 days. A miss expires quickly: upstream
   * timeouts must not hide an existing discography for days.
   */
  private counterparts = new Map<string, string | null>();
  private counterpartMissUntil = new Map<string,number>();
  public async deezerCounterpart(rawId: string): Promise<string | null> {
    if(this.counterparts.has(rawId)){
      const known=this.counterparts.get(rawId)!;
      if(known||(this.counterpartMissUntil.get(rawId)||0)>Date.now())return known;
      this.counterparts.delete(rawId);this.counterpartMissUntil.delete(rawId);
    }
    const key = `sp2dz:v1:${rawId}`;
    const stored = await prisma.artistEnrichment.findUnique({ where: { id: key } }).catch(() => null);
    if (stored) {
      const saved = JSON.parse(stored.data) as { deezerId: string | null; verified?: boolean }, value = saved.deezerId;
      const ttl=value?(saved.verified?30:3)*24*3600_000:5*60_000;
      if(Date.now()-stored.updatedAt.getTime()<ttl){this.counterparts.set(rawId,value);if(!value)this.counterpartMissUntil.set(rawId,stored.updatedAt.getTime()+ttl);return value;}
    }
    const artist = await this.getArtist(`spotify:artist:${rawId}`).catch(() => null);
    if (!artist?.name) return null;
    const fold = (t: string) => t.normalize('NFKC').toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const found = await officialCatalogService.search(artist.name, { limit: 1 }).catch(() => null);
    const same = (found?.artists || []).filter(a => fold(a.name) === fold(artist.name) || (!!latinFold(a.name) && latinFold(a.name) === latinFold(artist.name)));
    let deezerId: string | null = null, verified = false;
    if (same.length) {
      const spotifyTitles = (await this.getArtistReleases(rawId).catch(() => null))?.map(r => fold(r.title)) || [];
      if (spotifyTitles.length) {
        for (const candidate of same.slice(0, 3)) {
          const albums = await fetch(`https://api.deezer.com/artist/${candidate.sourceId}/albums?limit=100`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null) as { data?: Array<{ title: string }> } | null;
          if ((albums?.data || []).some(a => spotifyTitles.includes(fold(a.title)))) { deezerId = candidate.sourceId; verified = true; break; }
        }
      } else {
        deezerId = [...same].sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0))[0].sourceId;
      }
    }
    this.counterparts.set(rawId, deezerId);
    if(!deezerId)this.counterpartMissUntil.set(rawId,Date.now()+5*60_000);
    if(this.counterparts.size>5000){const oldest=this.counterparts.keys().next().value!;this.counterparts.delete(oldest);this.counterpartMissUntil.delete(oldest);}
    const data = JSON.stringify({ deezerId, verified, name: artist.name });
    await prisma.artistEnrichment.upsert({ where: { id: key }, create: { id: key, data }, update: { data } }).catch(() => {});
    return deezerId;
  }

  public async getArtistTracks(id: string, options?: PaginationOptions): Promise<Track[]> {
    const rawId = id.replace(/^spotify:artist:/, '');
    // Deezer first: the catalog of record answers the artist's songs without spending Spotify quota.
    if (/^[a-zA-Z0-9]{22}$/.test(rawId)) {
      const deezerId = await this.deezerCounterpart(rawId).catch(() => null);
      if (deezerId) {
        const titles = ((await this.getArtistReleases(rawId).catch(() => null)) || []).map(r => r.title);
        const tracks = await officialCatalogService.getArtistTracks(`deezer:artist:${deezerId}`, options, titles).catch(() => []);
        if (tracks.length) return tracks;
      }
    }
    if (!this.isConfigured()) {
      return this.matchedCatalogTracks(id, options);
    }

    try {
      const artist = await this.getArtist(id);
      if (!artist) return this.matchedCatalogTracks(id, options);
      // The former /artists/{id}/top-tracks endpoint was removed in 2026.
      const result = await this.search(`artist:"${artist.name.replace(/"/g, '')}"`, { page: options?.page || 1, limit: Math.min(options?.limit || 30, 30) });
      const own = result.tracks.filter(track => track.artist.sourceId === rawId);
      if (own.length >= 5 || (options?.page || 1) > 1) return own;
      // A lesser artist sharing a famous name drowns in that name's search results: read its own latest releases instead.
      const seen = new Set(own.map(track => track.id));
      for (const release of (await this.getArtistReleases(rawId))?.slice(0, 4) || []) {
        const album = await this.getAlbumFromApi(release.id).catch(() => null);
        for (const track of album?.tracks || []) if (!seen.has(track.id) && track.artist.sourceId === rawId) { seen.add(track.id); own.push(track); }
        if (own.length >= 20) break;
      }
      return own;
    } catch {
      return this.matchedCatalogTracks(id, options);
    }
  }

  private popularityBlockedUntil = 0;
  /** Track popularity (0–100) and ISRC via GET /v1/tracks, 50 ids per call. Apps the
   * Web API refuses (403: no premium owner / endpoint retired) back off for 30 minutes. */
  public async getTracksPopularity(ids: string[]): Promise<Map<string, { popularity?: number; isrc?: string }>> {
    const out = new Map<string, { popularity?: number; isrc?: string }>();
    if (Date.now() < this.popularityBlockedUntil) return out;
    const token = await this.getAccessToken();
    if (!token) return out;
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const res = await this.apiFetch(`https://api.spotify.com/v1/tracks?ids=${ids.slice(i, i + 50).join(',')}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) { if (res.status === 403 || res.status === 404) this.popularityBlockedUntil = Date.now() + 30 * 60_000; break; }
        const data = await res.json() as { tracks?: Array<{ id: string; popularity?: number; external_ids?: { isrc?: string } } | null> };
        for (const t of data.tracks || []) if (t) out.set(t.id, { popularity: typeof t.popularity === 'number' ? t.popularity : undefined, isrc: t.external_ids?.isrc });
      } catch { break; }
    }
    return out;
  }
}

export const spotifyService = new SpotifyService();
