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
  title: z.string().optional(),
  description: z.string().optional(),
  artworkUrl: z.string().optional(),
});

const reorderSchema = z.object({
  trackIds: z.array(z.string()),
});

export class PlaylistController {
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
