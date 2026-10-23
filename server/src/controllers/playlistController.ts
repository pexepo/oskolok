import { Request, Response, NextFunction } from 'express';
import { playlistRepository } from '../repositories/playlistRepository.js';
import { soundCloudService } from '../services/SoundCloudService.js';
import { spotifyService } from '../services/SpotifyService.js';
import { z } from 'zod';

const createPlaylistSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  artworkUrl: z.string().optional(),
  tracks: z.array(z.any()).optional(),
});

const updatePlaylistSchema = z.object({
  isPublic: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().optional(),
  artworkUrl: z.string().optional(),
});

const reorderSchema = z.object({
  trackIds: z.array(z.string()),
});

// Covers follow the existing playlist convention: an image data URL (≤1 MB, checked type) or an https link the
// client loads itself. The server never fetches a user-supplied cover address.
const coverSchema = z.string().max(1_400_000).refine(v => /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || (/^https:\/\/[^\s]+$/.test(v) && v.length <= 2000), 'Обложка: изображение PNG/JPEG/WebP до 1 МБ или https-ссылка.');
const trackSchema = z.object({ id: z.string().min(1).max(200), title: z.string().max(500), artist: z.object({ name: z.string().max(500) }).passthrough(), duration: z.number().finite().min(0).max(36000) }).passthrough();
const importSchema = z.object({
  requestId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  isPublic: z.boolean(),
  artworkUrl: coverSchema.optional(),
  tracks: z.array(trackSchema).max(300),
});
const chunkSchema = z.object({ index: z.number().int().min(1).max(200), tracks: z.array(trackSchema).min(1).max(300) });

export class PlaylistController {
  /** Create the imported playlist once per confirmed request (repeats return the same playlist). */
  public importPlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = importSchema.parse(req.body);
      const result = await playlistRepository.importPlaylist(res.locals.userId || 'local-user', body as never);
      res.status(result.created ? 201 : 200).json({ data: result });
    } catch (err) {
      if ((err as { status?: number }).status) { res.status((err as { status: number }).status).json({ error: { message: (err as Error).message } }); return; }
      next(err);
    }
  };

  public importChunk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requestId = z.string().uuid().parse(req.params.requestId);
      const body = chunkSchema.parse(req.body);
      res.json({ data: await playlistRepository.importChunk(res.locals.userId || 'local-user', requestId, body.index, body.tracks as never) });
    } catch (err) {
      if ((err as { status?: number }).status) { res.status((err as { status: number }).status).json({ error: { message: (err as Error).message } }); return; }
      next(err);
    }
  };

  public getPlaylists = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const playlists = await playlistRepository.getPlaylistsByUser(userId);
      res.json({ data: playlists });
    } catch (err) {
      next(err);
    }
  };

  public getPlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;

      // 1. Check if SoundCloud playlist
      if (id.startsWith('soundcloud:')) {
        const scPlaylist = await soundCloudService.getPlaylist(id);
        if (!scPlaylist) {
          res.status(404).json({
            error: { code: 'PLAYLIST_NOT_FOUND', message: 'SoundCloud playlist not found' },
          });
          return;
        }
        res.json({ data: scPlaylist });
        return;
      }

      // 2. Check if Spotify playlist or album
      if (id.startsWith('spotify:')) {
        const rawId = id.replace(/^spotify:(playlist:|album:)?/, '');
        let spPlaylist = await spotifyService.resolveSpotifyPlaylistFromEmbed(rawId);
        if (!spPlaylist) {
          const albumTracks = await spotifyService.resolveSpotifyAlbumFromEmbed(rawId);
          if (albumTracks && albumTracks.length > 0) {
            spPlaylist = {
              id: `spotify:album:${rawId}`,
              userId: 'spotify',
              title: albumTracks[0].artist.name + ' - Album',
              artworkUrl: albumTracks[0].artworkUrl,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              trackCount: albumTracks.length,
              tracks: albumTracks.map((t, idx) => ({
                id: `sp-album-${rawId}-${t.id}`,
                playlistId: `spotify:album:${rawId}`,
                trackId: t.id,
                position: idx,
                addedAt: new Date().toISOString(),
                track: t,
              })),
            };
          }
        }

        if (spPlaylist) {
          res.json({ data: spPlaylist });
          return;
        }
      }

      // 3. Local SQLite database
      const playlist = await playlistRepository.getPlaylistById(id);
      if (!playlist) {
        res.status(404).json({
          error: { code: 'PLAYLIST_NOT_FOUND', message: 'Playlist not found' },
        });
        return;
      }
      res.json({ data: playlist });
    } catch (err) {
      next(err);
    }
  };

  public createPlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createPlaylistSchema.parse(req.body);
      const userId = res.locals.userId || 'local-user';
      const playlist = await playlistRepository.createPlaylist(
        userId,
        body.title,
        body.description,
        body.artworkUrl,
        body.tracks
      );
      res.status(201).json({ data: playlist });
    } catch (err) {
      next(err);
    }
  };

  public updatePlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const body = updatePlaylistSchema.parse(req.body);
      const updated = await playlistRepository.updatePlaylist(id, body);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };

  public deletePlaylist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      await playlistRepository.deletePlaylist(id);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  };

  public addTrack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      // Imports send their tracks in parts of up to 500 (a single JSON body is capped at 2 MB).
      if (Array.isArray(req.body?.tracks)) {
        const tracks = req.body.tracks.filter((t: any) => t && typeof t.id === 'string');
        if (!tracks.length || tracks.length > 500) {
          res.status(400).json({ error: { code: 'INVALID_TRACK_DATA', message: 'Send 1–500 tracks per request' } });
          return;
        }
        res.json({ data: await playlistRepository.addTracksToPlaylist(id, tracks) });
        return;
      }
      const track = req.body.track;
      if (!track || !track.id) {
        res.status(400).json({
          error: { code: 'INVALID_TRACK_DATA', message: 'Valid track object required' },
        });
        return;
      }

      const updated = await playlistRepository.addTrackToPlaylist(id, track);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };

  public removeTrack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, trackId } = req.params;
      const updated = await playlistRepository.removeTrackFromPlaylist(id, trackId);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };

  public reorderTracks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id;
      const { trackIds } = reorderSchema.parse(req.body);
      const updated = await playlistRepository.reorderTracks(id, trackIds);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  };
}

export const playlistController = new PlaylistController();
