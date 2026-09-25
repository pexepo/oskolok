import { Request, Response, NextFunction } from 'express';
import { historyRepository } from '../repositories/historyRepository.js';

export class HistoryController {
  public getHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const history = await historyRepository.getHistory(userId, limit);
      res.json({ data: history });
    } catch (err) {
      next(err);
    }
  };

  public addHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const track = req.body.track;
      if (!track || !track.id) {
        res.status(400).json({
          error: { code: 'INVALID_TRACK_DATA', message: 'Track object is required' },
        });
        return;
      }
      const entry = await historyRepository.addHistoryItem(userId, track);
      res.status(201).json({ data: entry });
    } catch (err) {
      next(err);
    }
  };

  public clearHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      await historyRepository.clearHistory(userId);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  };
}

export const historyController = new HistoryController();
