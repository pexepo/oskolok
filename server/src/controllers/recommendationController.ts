import { Request, Response, NextFunction } from 'express';
import { recommendationService } from '../services/RecommendationService.js';

export class RecommendationController {
  public getRecommendations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = res.locals.userId || 'local-user';
      const limit = parseInt((req.query.limit as string) || '20', 10);
      const moodAliases: Record<string, string> = { melancholic: 'sad', joyful: 'fun', focus: 'calm' };
      const mood = moodAliases[String(req.query.mood)] || String(req.query.mood || 'energetic');
      const characterAliases: Record<string, string> = { familiar: 'favorite', discover: 'discovery' };
      const character = characterAliases[String(req.query.character)] || String(req.query.character || 'popular');
      const language = req.query.language === 'russian' ? 'ru' : String(req.query.language || 'all');
      const rawExclude = (req.query.excludeTrackIds || req.query.excludeIds) as string;
      const excludeTrackIds = rawExclude ? rawExclude.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const tracks = await recommendationService.getRecommendations({
        userId,
        limit,
        mood: ['energetic','calm','sad','fun'].includes(mood) ? mood as any : 'energetic',
        character: ['favorite','discovery','popular'].includes(character) ? character as any : 'popular',
        language: ['ru','foreign','all'].includes(language) ? language as any : 'all',
        excludeTrackIds,
      });
      res.json({ data: tracks });
    } catch (err) {
      next(err);
    }
  };
}

export const recommendationController = new RecommendationController();
