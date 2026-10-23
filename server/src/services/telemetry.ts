/* Listening events and consent.
   Purposes are separate: «personalization» lets the listener's own events shape their own recommendations;
   «training» additionally lets those events be used to evaluate and tune ranking for everyone. Technical
   diagnostics (server logs of playback failures) need no consent and are not stored here.
   Retention: raw events 180 days (then deleted), consent rows until changed. Revoking personalization deletes
   the listener's stored events; revoking training only unmarks them. Ranking parameters already tuned on
   earlier data are not «unlearned» — they are aggregate weights, not per-person data. */
import { z } from 'zod';
import { prisma } from '../database/client.js';
import { logger } from '../utils/logger.js';

export const EVENT_SCHEMA_VERSION = 1;
export const EVENT_RETENTION_DAYS = 180;
export const CONSENT_VERSION = 1;
export const EVENT_TYPES = [
  'impression', 'select', 'play_request', 'play_start', 'listen',
  'queue_add', 'queue_remove', 'queue_move', 'like', 'unlike', 'playlist_add', 'playlist_remove',
  'open_release', 'open_artist', 'speed_change',
] as const;

const id = z.string().regex(/^[0-9a-f-]{36}$/i);
const text = (max: number) => z.string().max(max);
// Only listening facts: positions, durations, ratios, counts, the speed and a reason word. No free text.
const data = z.object({
  position: z.number().finite().min(0).max(36000).optional(),
  duration: z.number().finite().min(0).max(36000).optional(),
  listenedMs: z.number().finite().min(0).max(36_000_000).optional(),
  uniqueRatio: z.number().finite().min(0).max(1).optional(),
  started: z.boolean().optional(),
  endReason: z.enum(['natural', 'manual-skip', 'stop', 'error', 'unavailable', 'interrupted', 'replaced']).optional(),
  repeats: z.number().int().min(0).max(1000).optional(),
  seeks: z.number().int().min(0).max(10000).optional(),
  pauses: z.number().int().min(0).max(10000).optional(),
  speed: z.number().finite().min(0.25).max(4).optional(),
  from: z.number().int().min(0).max(100000).optional(),
  to: z.number().int().min(0).max(100000).optional(),
  rank: z.number().int().min(0).max(1000).optional(),
}).strict();
export const eventSchema = z.object({
  id, v: z.literal(EVENT_SCHEMA_VERSION), type: z.enum(EVENT_TYPES), trackId: text(200).min(1), artist: text(200).default(''),
  sessionId: text(64).min(1), context: z.string().regex(/^[a-z-]{0,24}(:[\w:.-]{0,120})?$/).default(''), at: z.string().datetime(), data: data.default({}),
});
export const batchSchema = z.object({ events: z.array(eventSchema).max(100) });
export type ListeningEvent = z.infer<typeof eventSchema>;

export interface Consent { personalization: boolean; training: boolean; decided: boolean; version: number }
export async function getConsent(userId: string): Promise<Consent> {
  const row = await prisma.userConsent.findUnique({ where: { userId } });
  return { personalization: !!row?.personalization, training: !!row?.training, decided: !!row?.decidedAt, version: CONSENT_VERSION };
}

/** Training implies personalization (events are only stored at all with it). */
export async function setConsent(userId: string, wanted: { personalization: boolean; training: boolean }): Promise<Consent> {
  const personalization = wanted.personalization, training = personalization && wanted.training;
  const before = await getConsent(userId);
  await prisma.userConsent.upsert({ where: { userId }, create: { userId, personalization, training, version: CONSENT_VERSION, decidedAt: new Date() }, update: { personalization, training, version: CONSENT_VERSION, decidedAt: new Date() } });
  if (before.personalization && !personalization) await prisma.trackEvent.deleteMany({ where: { userId } });
  else if (before.training && !training) await prisma.trackEvent.updateMany({ where: { userId }, data: { training: false } });
  return getConsent(userId);
}

/** Store a batch. Re-sent events (same id) are ignored; events older than the retention or from the future are dropped. */
export async function ingestEvents(userId: string, events: ListeningEvent[]): Promise<{ stored: number; duplicates: number; rejected: number }> {
  const consent = await getConsent(userId);
  if (!consent.personalization) return { stored: 0, duplicates: 0, rejected: events.length };
  const now = Date.now(), oldest = now - EVENT_RETENTION_DAYS * 86_400_000;
  const fresh = events.filter(e => { const at = Date.parse(e.at); return at >= oldest && at <= now + 5 * 60_000; });
  const existing = new Set((await prisma.trackEvent.findMany({ where: { id: { in: fresh.map(e => e.id) } }, select: { id: true } })).map(r => r.id));
  let stored = 0;
  for (const e of fresh) {
    if (existing.has(e.id)) continue;
    try {
      await prisma.trackEvent.create({ data: { id: e.id, userId, sessionId: e.sessionId, type: e.type, trackId: e.trackId, artist: e.artist, context: e.context, data: JSON.stringify(e.data), schemaVersion: EVENT_SCHEMA_VERSION, training: consent.training, at: new Date(e.at) } });
      stored++; existing.add(e.id);
    } catch { /* A concurrent copy of the same batch won the insert. */ }
  }
  return { stored, duplicates: fresh.length - stored, rejected: events.length - fresh.length };
}

export async function deleteEvents(userId: string, type?: string): Promise<number> {
  return (await prisma.trackEvent.deleteMany({ where: { userId, ...(type ? { type } : {}) } })).count;
}

let retentionTimer: ReturnType<typeof setInterval> | undefined;
/** Daily: raw events older than the retention period are deleted. */
export function startEventRetention() {
  if (retentionTimer || process.env.VITEST) return;
  const run = () => void prisma.trackEvent.deleteMany({ where: { at: { lt: new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000) } } })
    .then(r => { if (r.count) logger.info({ deleted: r.count }, 'Expired listening events deleted'); })
    .catch(error => logger.warn({ message: error instanceof Error ? error.message : String(error) }, 'Listening event retention failed'));
  setTimeout(run, 60_000).unref?.();
  retentionTimer = setInterval(run, 24 * 3600_000);
  retentionTimer.unref?.();
}
