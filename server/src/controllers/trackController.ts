import { Request, Response, NextFunction } from 'express';
import { Track } from '../types/index.js';
import { spotifyService } from '../services/SpotifyService.js';
import { soundCloudService } from '../services/SoundCloudService.js';
import { streamResolverService } from '../services/StreamResolverService.js';
import { studioMasterService } from '../services/StudioMasterService.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { officialCatalogService } from '../services/OfficialCatalogService.js';
import { rankTrack, deduplicateSearchTracks, normalizeMusicText } from '../services/trackRanking.js';
import { logger } from '../utils/logger.js';

export class TrackController {
  public search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = (req.query.q as string) || '';
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '20', 10) || 20));

      if (!q.trim()) {
        res.json({
          data: {
            tracks: [],
            artists: [],
            playlists: [],
            pagination: { page: 1, limit, hasMore: false },
          },
        });
        return;
      }

      const deezerMatch = q.match(/^https:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)(?:[/?#]|$)/i);
      if (deezerMatch) {
        const track = await officialCatalogService.getTrack(`deezer:${deezerMatch[1]}`);
        res.json({ data: { tracks: track ? [track] : [], artists: track ? [track.artist] : [], playlists: [], pagination: { page: 1, limit, hasMore: false } } });
        return;
      }

      // Check if user pasted a Spotify link (track or album)
      if (q.includes('spotify.com') || q.startsWith('spotify:')) {
        const spotifyResolved = await spotifyService.resolveSpotifyUrl(q);
        if (spotifyResolved && spotifyResolved.tracks.length > 0) {
          res.json({ data: spotifyResolved });
          return;
        }
      }

      // Query Spotify/Deezer, SoundCloud, and YouTube studio in parallel
      // YouTube search is capped with a 2-second timeout so search results return instantly (<600ms)
      const ytPromise = Promise.race([
        studioMasterService.searchTracks(q, 6),
        new Promise<Track[]>((resolve) => setTimeout(() => resolve([]), 2000)),
      ]);

      const [spotifyResResult, soundCloudResResult, youtubeResResult] = await Promise.allSettled([
        spotifyService.search(q, { page, limit }),
        soundCloudService.search(q, { page, limit }),
        ytPromise,
      ]);

      const spotifyResults =
        spotifyResResult.status === 'fulfilled'
          ? spotifyResResult.value
          : { tracks: [], artists: [], playlists: [] };
      const soundCloudResults =
        soundCloudResResult.status === 'fulfilled'
          ? soundCloudResResult.value
          : { tracks: [], artists: [], playlists: [] };
      const youtubeTracks =
        youtubeResResult.status === 'fulfilled' ? youtubeResResult.value : [];

      // Deduplicate and merge tracks:
      // 1. Official studio releases from Spotify/Deezer
      // 2. YouTube tracks (official anime openings, Japanese releases, game soundtracks)
      // 3. SoundCloud tracks (remixes, community releases)
      const candidates = [...spotifyResults.tracks, ...soundCloudResults.tracks, ...youtubeTracks]
        .sort((a, b) => rankTrack(b, q) - rankTrack(a, q));
      const mergedTracks = deduplicateSearchTracks(candidates);

      // Merge artists (deduplicated by name)
      const seenArtistNames = new Set<string>();
      const mergedArtists = [];

      for (const a of [...(spotifyResults.artists || []), ...(soundCloudResults.artists || [])]) {
        const norm = (a.name || '').toLowerCase().trim();
        if (a.source === 'soundcloud' && normalizeMusicText(a.name) !== normalizeMusicText(q)) continue;
        if (norm && !seenArtistNames.has(norm)) {
          seenArtistNames.add(norm);
          mergedArtists.push(a);
        }
      }

      // Merge playlists (SoundCloud has rich community playlists)
      const mergedPlaylists = [
        ...(spotifyResults.playlists || []),
        ...(soundCloudResults.playlists || []),
      ];

      res.json({
        data: {
          tracks: mergedTracks.slice(0, limit * 2),
          artists: mergedArtists.slice(0, 10),
          playlists: mergedPlaylists.slice(0, 12),
          pagination: {
            page,
            limit,
            hasMore: mergedTracks.length > limit,
          },
        },
      });
    } catch (err: any) {
      logger.error({ err }, 'Search controller error');
      next(err);
    }
  };

  public resolveTrack = async (id: string): Promise<Track | null> => {
    if (!id) return null;

    // 1. Try cache
    const cached = await trackCacheRepository.getCachedTrack(id);
    if (cached) {
      return cached;
    }

    // 2. Resolve based on source ID format
    let track: Track | null = null;

    if (id.startsWith('youtube:')) {
      const vidId = id.replace('youtube:', '');
      track = {
        id,
        source: 'licensed',
        sourceId: vidId,
        title: 'YouTube Audio',
        artist: {
          id: 'youtube:unknown',
          source: 'licensed',
          sourceId: 'unknown',
          name: 'YouTube',
        },
        artworkUrl: `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
        duration: 180,
        trackUrl: `https://www.youtube.com/watch?v=${vidId}`,
        access: 'playable',
      };
    } else if (id.startsWith('deezer:')) {
      track = await officialCatalogService.getTrack(id);
    } else if (id.startsWith('spotify:') || id.startsWith('licensed:')) {
      track = await spotifyService.getTrack(id);
    } else if (id.startsWith('soundcloud:')) {
      track = await soundCloudService.getTrack(id);
    } else {
      // Fallback for unknown prefix: try soundCloud then spotify
      try {
        track = await soundCloudService.getTrack(id);
      } catch {}
      if (!track) {
        try {
          track = await spotifyService.getTrack(id);
        } catch {}
      }
    }

    if (track) {
      await trackCacheRepository.setCachedTrack(track).catch(() => {});
    }

    return track;
  };

  public getTrack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const track = await this.resolveTrack(id);

      if (!track) {
        res.status(404).json({
          error: { code: 'TRACK_NOT_FOUND', message: 'Track not found' },
        });
        return;
      }

      res.json({ data: track });
    } catch (err) {
      next(err);
    }
  };

  public getPlaybackInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const track = await this.resolveTrack(id);

      if (track) {
        // Return stream URL immediately so frontend audio element begins buffering without lag
        res.json({
          data: {
            available: true,
            type: 'progressive',
            url: `/api/tracks/${encodeURIComponent(track.id)}/stream`,
            expiresAt: Date.now() + 86400000,
            mimeType: 'audio/mp4',
          },
        });
        // Kick off background stream preparation
        studioMasterService.prefetch(track);
        return;
      }

      // Fallback for native SoundCloud ID
      if (!id.startsWith('spotify:') && !id.startsWith('licensed:') && !id.startsWith('youtube:')) {
        const playbackInfo = await soundCloudService.getPlaybackInfo(id);
        if (playbackInfo.available) {
          res.json({ data: playbackInfo });
          return;
        }
      }

      res.json({
        data: {
          available: false,
          type: 'none',
          message: 'Аудиодорожка временно недоступна для этого трека.',
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public prefetchTrack = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = (req.body?.trackId || req.query?.trackId || req.params?.id) as string;
      if (!id) {
        res.json({ ok: true });
        return;
      }

      const track = await this.resolveTrack(id);
      if (track) {
        studioMasterService.prefetch(track);
      }

      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  };

  public streamAudio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const track = await this.resolveTrack(id);

      if (!track) {
        res.status(404).json({
          error: { code: 'TRACK_NOT_FOUND', message: 'Track not found' },
        });
        return;
      }

      const requestedSource = typeof req.query.source === 'string' ? req.query.source : undefined;
      await studioMasterService.handleAudioStream(track, req, res, requestedSource);
    } catch (err) {
      next(err);
    }
  };

  public getArtist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      let artist = null;

      if (id.startsWith('soundcloud:')) {
        artist = await soundCloudService.getArtist(id);
      } else {
        artist = id.startsWith('deezer:') ? await officialCatalogService.getArtist(id) : await spotifyService.getArtist(id);
      }

      if (!artist) {
        res.status(404).json({
          error: { code: 'ARTIST_NOT_FOUND', message: 'Artist not found' },
        });
        return;
      }
      res.json({ data: artist });
    } catch (err) {
      next(err);
    }
  };

  public getArtistTracks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '500', 10);

      let tracks = [];
      if (id.startsWith('soundcloud:')) {
        tracks = await soundCloudService.getArtistTracks(id, { page, limit });
      } else {
        tracks = id.startsWith('deezer:') ? await officialCatalogService.getArtistTracks(id, { page, limit }) : await spotifyService.getArtistTracks(id, { page, limit });
      }

      res.json({ data: tracks });
    } catch (err) {
      next(err);
    }
  };

  public getPlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const playlist = await soundCloudService.getPlaylist(id);
      if (!playlist) {
        res.status(404).json({
          error: { code: 'PLAYLIST_NOT_FOUND', message: 'SoundCloud playlist not found' },
        });
        return;
      }
      res.json({ data: playlist });
    } catch (err) {
      next(err);
    }
  };
}

export const trackController = new TrackController();
