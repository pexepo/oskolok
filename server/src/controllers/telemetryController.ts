import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { batchSchema, deleteEvents, getConsent, ingestEvents, setConsent, EVENT_RETENTION_DAYS } from '../services/telemetry.js';

const asyncRoute = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => { try { await fn(req, res); } catch (e) { next(e); } };
const userOf = (res: Response) => String(res.locals.userId || '');

export const telemetryController = {
  getConsent: asyncRoute(async (_req, res) => { res.json({ data: { ...(await getConsent(userOf(res))), retentionDays: EVENT_RETENTION_DAYS } }); }),
  setConsent: asyncRoute(async (req, res) => {
    const body = z.object({ personalization: z.boolean(), training: z.boolean() }).parse(req.body);
    res.json({ data: { ...(await setConsent(userOf(res), body)), retentionDays: EVENT_RETENTION_DAYS } });
  }),
  /** A batch of listening events. Without personalisation consent nothing is stored (403 tells the client to drop its buffer). */
  ingest: asyncRoute(async (req, res) => {
    const consent = await getConsent(userOf(res));
    if (!consent.personalization) { res.status(403).json({ error: { code: 'NO_CONSENT', message: 'Нет согласия на персонализацию.' } }); return; }
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: 'BAD_EVENTS', message: 'Некорректные события.' } }); return; }
    res.json({ data: await ingestEvents(userOf(res), parsed.data.events) });
  }),
  /** «Сбросить данные персонализации»: deletes every stored listening event of the listener. */
  reset: asyncRoute(async (_req, res) => { res.json({ data: { deleted: await deleteEvents(userOf(res)) } }); }),
};
