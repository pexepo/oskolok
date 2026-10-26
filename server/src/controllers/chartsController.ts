import type { Request, Response, NextFunction } from 'express';
import { chartsService, CHART_SERVICES, type ChartServiceId } from '../services/ChartsService.js';
import { prisma } from '../database/client.js';
import type { Track } from '../types/index.js';

export interface OskolokPopular { track: Track; listeners: number; plays: number }
/** «Популярно в Осколке»: songs played by the most different listeners lately (then by plays). Pure, for tests. */
export function rankListening(rows: Array<{ trackId: string; userId: string; trackData: string }>, limit = 20): OskolokPopular[] {
  const by = new Map<string, { data: string; users: Set<string>; plays: number }>();
  for (const r of rows) { const e = by.get(r.trackId) || { data: r.trackData, users: new Set<string>(), plays: 0 }; e.users.add(r.userId); e.plays++; by.set(r.trackId, e); }
  // Two listeners at least: the shelf is a crowd's taste, never one person's history.
  return [...by.values()].filter(e => e.users.size >= 2).sort((a, b) => b.users.size - a.users.size || b.plays - a.plays).flatMap(e => {
    try { const track = JSON.parse(e.data) as Track; return track?.id && track.artist?.name ? [{ track, listeners: e.users.size, plays: e.plays }] : []; } catch { return []; }
  }).slice(0, limit);
}
let popularCache: { at: number; value: OskolokPopular[] } | null = null;
async function oskolokPopular(): Promise<OskolokPopular[]> {
  if (popularCache && Date.now() - popularCache.at < 10 * 60_000) return popularCache.value;
  // A week of plays; a quiet week widens to a month so the shelf is not empty.
  let value: OskolokPopular[] = [];
  for (const days of [7, 30]) {
    const rows = await prisma.historyItem.findMany({ where: { playedAt: { gte: new Date(Date.now() - days * 86_400_000) } }, select: { trackId: true, userId: true, trackData: true }, orderBy: { playedAt: 'desc' }, take: 30_000 });
    value = rankListening(rows);
    if (value.length >= 8) break;
  }
  popularCache = { at: Date.now(), value };
  return value;
}

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
  /** GET /charts/oskolok — what listeners of Осколок play this week. */
  getOskolok: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { res.set('Cache-Control', 'private, max-age=300'); res.json({ data: await oskolokPopular() }); } catch (err) { next(err); }
  },
};
