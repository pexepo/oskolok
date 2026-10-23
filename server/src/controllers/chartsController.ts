import type { Request, Response, NextFunction } from 'express';
import { chartsService, CHART_SERVICES, type ChartServiceId } from '../services/ChartsService.js';

export const chartsController = {
  /** GET /charts?service=vk|yandex|spotify&limit=20 — cached for an hour per service. */
  getChart: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const service = String(req.query.service || 'yandex') as ChartServiceId;
      if (!CHART_SERVICES.includes(service)) { res.status(400).json({ error: { message: 'Неизвестный сервис чарта', code: 'BAD_CHART_SERVICE' } }); return; }
      const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || '20'), 10) || 20));
      res.set('Cache-Control', 'private, max-age=600');
      res.json({ data: await chartsService.get(service, limit) });
    } catch (err) {
      next(err);
    }
  },
};
