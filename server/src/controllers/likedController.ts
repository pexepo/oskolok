import { Request, Response, NextFunction } from 'express';
import { likedRepository } from '../repositories/likedRepository.js';

export class LikedController {
  public getLiked = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const tracks = await likedRepository.getLikedTracks(userId);
      res.json({ data: tracks });
    } catch (err) {
      next(err);
    }
  };

  public addLiked = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const track = req.body.track;
      if (!track || !track.id) {
        res.status(400).json({
          error: { code: 'INVALID_TRACK_DATA', message: 'Track object is required' },
        });
        return;
      }
      const added = await likedRepository.addLikedTrack(userId, track);
      res.status(201).json({ data: added });
    } catch (err) {
      next(err);
    }
  };

  public deleteLiked = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const trackId = req.params.trackId;
      await likedRepository.removeLikedTrack(userId, trackId);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  };
}

export const likedController = new LikedController();
