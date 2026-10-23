/* Offline evaluation of ranking parameters on consented data, in time order.
   For every listener who allowed «training»: everything before the split time builds the taste profile,
   everything after it is the test — artists listened to the end, liked or repeated are positives, artists
   skipped early are negatives. Nothing after the split leaks into the profile. Compared: the baseline
   (library only — the ranking before listening events existed) and a candidate parameter set. */
import { prisma } from '../database/client.js';
import type { Track } from '../types/index.js';
import { DEFAULT_PARAMS, artistKey, scoreTaste, resetRankingCache, type RankingParams, type TasteEvent } from './wave/profile.js';

export interface EvalMetrics { users: number; events: number; testPositives: number; hitAt10: number; mrr: number; skipInTop10: number; coverage: number }
export interface EvalReport { split: string; baseline: EvalMetrics; candidate: EvalMetrics; enoughData: boolean; note: string }

const parseTrack = (raw: string): Track | null => { try { const t = JSON.parse(raw); return t?.id && t?.artist?.name ? t : null; } catch { return null; } };
const NO_EVENTS: RankingParams = { ...DEFAULT_PARAMS, complete: 0, repeat: 0, queueAdd: 0, skipEarly: 0, unlike: 0, playlistRemove: 0 };

export async function evaluateRanking(candidate: RankingParams, splitRatio = 0.8): Promise<EvalReport> {
  const consented = (await prisma.userConsent.findMany({ where: { training: true }, select: { userId: true } })).map(r => r.userId);
  const empty: EvalMetrics = { users: 0, events: 0, testPositives: 0, hitAt10: 0, mrr: 0, skipInTop10: 0, coverage: 0 };
  if (!consented.length) return { split: '', baseline: empty, candidate: empty, enoughData: false, note: 'Нет пользователей с согласием на общее улучшение.' };
  const totals = { baseline: { ...empty }, candidate: { ...empty } };
  let splitAt = '';
  for (const userId of consented) {
    const events = await prisma.trackEvent.findMany({ where: { userId, training: true }, orderBy: { at: 'asc' } });
    if (events.length < 20) continue;
    const split = events[Math.floor(events.length * splitRatio)].at;
    splitAt = split.toISOString();
    const [likes, history] = await Promise.all([
      prisma.likedTrack.findMany({ where: { userId, addedAt: { lt: split } } }),
      prisma.historyItem.findMany({ where: { userId, playedAt: { lt: split } }, orderBy: { playedAt: 'desc' }, take: 400 }),
    ]);
    const toEvent = (e: typeof events[number]): TasteEvent => { let data = {}; try { data = JSON.parse(e.data); } catch { /* empty */ } return { type: e.type, trackId: e.trackId, artist: e.artist, at: e.at, data }; };
    const train = events.filter(e => e.at < split).map(toEvent), test = events.filter(e => e.at >= split).map(toEvent);
    const positives = new Set<string>(), negatives = new Set<string>();
    for (const e of test) {
      const d = e.data as { started?: boolean; endReason?: string; uniqueRatio?: number; repeats?: number };
      if (e.type === 'like' || (e.type === 'listen' && d.started && ((d.endReason === 'natural' && (d.uniqueRatio ?? 0) >= 0.8) || (d.repeats || 0) > 0))) positives.add(artistKey(e.artist));
      if (e.type === 'listen' && d.started && d.endReason === 'manual-skip' && (d.uniqueRatio ?? 1) < 0.3) negatives.add(artistKey(e.artist));
    }
    positives.forEach(a => negatives.delete(a));
    if (!positives.size) continue;
    const input = { likes: likes.map(l => parseTrack(l.trackData)).filter((t): t is Track => !!t), library: [] as Track[], history: history.map(h => parseTrack(h.trackData)).filter((t): t is Track => !!t), now: split.getTime() };
    for (const [name, params, evs] of [['baseline', NO_EVENTS, [] as TasteEvent[]], ['candidate', candidate, train]] as const) {
      const ranked = [...scoreTaste({ ...input, events: evs as TasteEvent[] }, params).artists.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const top = ranked.slice(0, 10), m = totals[name];
      m.users++; m.events += events.length; m.testPositives += positives.size;
      m.hitAt10 += [...positives].filter(a => top.includes(a)).length / positives.size;
      const firstHit = ranked.findIndex(a => positives.has(a));
      m.mrr += firstHit >= 0 ? 1 / (firstHit + 1) : 0;
      m.skipInTop10 += top.filter(a => negatives.has(a)).length / 10;
      m.coverage += new Set(top).size / 10;
    }
  }
  const finish = (m: EvalMetrics): EvalMetrics => m.users ? { ...m, hitAt10: round(m.hitAt10 / m.users), mrr: round(m.mrr / m.users), skipInTop10: round(m.skipInTop10 / m.users), coverage: round(m.coverage / m.users) } : m;
  const baseline = finish(totals.baseline), result = finish(totals.candidate);
  const enoughData = baseline.users >= 5 && baseline.testPositives >= 50;
  return { split: splitAt, baseline, candidate: result, enoughData, note: enoughData ? '' : `Мало данных для надёжного вывода: ${baseline.users} слушателей с ≥20 событиями, ${baseline.testPositives} положительных примеров (нужно ≥5 и ≥50).` };
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Store a parameter version with its metrics; activation is a separate, explicit step. */
export async function saveVersion(version: string, params: RankingParams, metrics: unknown) {
  await prisma.recommendationModel.upsert({ where: { version }, create: { version, params: JSON.stringify(params), metrics: JSON.stringify(metrics) }, update: { params: JSON.stringify(params), metrics: JSON.stringify(metrics) } });
}
/** Exactly one active version; activating the built-in (no row) means deactivating all. Rollback = activate the previous one. */
export async function activateVersion(version: string | null) {
  await prisma.$transaction([
    prisma.recommendationModel.updateMany({ where: { active: true }, data: { active: false } }),
    ...(version ? [prisma.recommendationModel.update({ where: { version }, data: { active: true } })] : []),
  ]);
  resetRankingCache();
}
