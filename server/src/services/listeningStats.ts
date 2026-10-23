import {prisma} from '../database/client.js';

/**
 * «Итоги» — the listener's own statistics for a week, month, year or all time (Spotify Wrapped / Яндекс «Итоги»,
 * but available any day). Built from listening history: a play is logged after 30 s or half of the track.
 */
export type StatsPeriod = 'week' | 'month' | 'year' | 'all';
export interface StatsTrack { id: string; title: string; artist: {id?: string; name: string}; artworkUrl?: string; duration: number; [key: string]: unknown }
export interface HistoryRow { playedAt: Date; trackData: string }
export interface ListeningStats {
  period: StatsPeriod; from: string | null; to: string;
  plays: number; minutes: number; uniqueTracks: number; uniqueArtists: number; newArtists: number;
  topArtists: Array<{name: string; plays: number; minutes: number; artworkUrl?: string; artistId?: string}>;
  topTracks: Array<{track: StatsTrack; plays: number}>;
  byHour: number[]; byWeekday: number[];
  streak: {current: number; longest: number};
  peakHour: number | null; listenerType: 'night' | 'morning' | 'day' | 'evening' | null;
  firstPlayAt: string | null;
}

const DAY = 86400000;
const PERIOD_DAYS: Record<Exclude<StatsPeriod, 'all'>, number> = {week: 7, month: 30, year: 365};
const primary = (name: string) => name.split(/,|\s+(?:feat\.?|ft\.?|&|x)\s+/i)[0].trim();
/** A play counts as the part of the track actually heard: at most 10 minutes for very long uploads. */
const playedMinutes = (t: StatsTrack) => Math.min(Math.max(t.duration || 0, 30), 600) * .92 / 60;

export function computeStats(rows: HistoryRow[], period: StatsPeriod, now = new Date(), tzOffsetMinutes = 0): ListeningStats {
  const local = (d: Date) => new Date(d.getTime() - tzOffsetMinutes * 60000);
  const dayKey = (d: Date) => Math.floor(local(d).getTime() / DAY);
  const from = period === 'all' ? null : new Date(now.getTime() - PERIOD_DAYS[period] * DAY);
  const parsed: Array<{at: Date; t: StatsTrack}> = [];
  for (const r of rows) { try { const t = JSON.parse(r.trackData) as StatsTrack; if (t?.id && t.artist?.name) parsed.push({at: r.playedAt, t}); } catch { /* broken row */ } }
  parsed.sort((a, b) => a.at.getTime() - b.at.getTime());

  const firstSeen = new Map<string, number>();
  for (const p of parsed) { const k = primary(p.t.artist.name).toLowerCase(); if (!firstSeen.has(k)) firstSeen.set(k, p.at.getTime()); }
  const inPeriod = parsed.filter(p => !from || p.at >= from);

  const artists = new Map<string, {name: string; plays: number; minutes: number; artworkUrl?: string; artistId?: string}>();
  const tracks = new Map<string, {track: StatsTrack; plays: number}>();
  const byHour = Array(24).fill(0), byWeekday = Array(7).fill(0);
  let minutes = 0;
  for (const {at, t} of inPeriod) {
    const m = playedMinutes(t); minutes += m;
    const name = primary(t.artist.name), key = name.toLowerCase();
    const a = artists.get(key) || {name, plays: 0, minutes: 0, artworkUrl: undefined, artistId: t.artist.id};
    a.plays++; a.minutes += m; a.artworkUrl = a.artworkUrl || (t.artist as {avatarUrl?: string}).avatarUrl || t.artworkUrl; artists.set(key, a);
    const tr = tracks.get(t.id) || {track: t, plays: 0}; tr.plays++; tr.track = t; tracks.set(t.id, tr);
    const l = local(at); byHour[l.getUTCHours()]++; byWeekday[(l.getUTCDay() + 6) % 7]++;
  }
  const newArtists = from ? [...firstSeen.values()].filter(ts => ts >= from.getTime()).length : firstSeen.size;

  // Streaks count calendar days in the listener's time zone; today without plays yet does not break the current one.
  const days = [...new Set(parsed.map(p => dayKey(p.at)))].sort((a, b) => a - b);
  let longest = 0, run = 0;
  for (let i = 0; i < days.length; i++) { run = i && days[i] === days[i - 1] + 1 ? run + 1 : 1; longest = Math.max(longest, run); }
  const today = dayKey(now), set = new Set(days);
  let current = 0;
  for (let d = set.has(today) ? today : today - 1; set.has(d); d--) current++;

  const peak = inPeriod.length ? byHour.indexOf(Math.max(...byHour)) : null;
  const listenerType = peak === null ? null : peak < 5 || peak >= 23 ? 'night' : peak < 11 ? 'morning' : peak < 18 ? 'day' : 'evening';
  return {
    period, from: from?.toISOString() || null, to: now.toISOString(),
    plays: inPeriod.length, minutes: Math.round(minutes), uniqueTracks: tracks.size, uniqueArtists: artists.size, newArtists,
    topArtists: [...artists.values()].sort((a, b) => b.plays - a.plays || b.minutes - a.minutes).slice(0, 10).map(a => ({...a, minutes: Math.round(a.minutes)})),
    topTracks: [...tracks.values()].sort((a, b) => b.plays - a.plays).slice(0, 20),
    byHour, byWeekday, streak: {current, longest}, peakHour: peak, listenerType,
    firstPlayAt: parsed[0]?.at.toISOString() || null,
  };
}

const cache = new Map<string, {at: number; value: ListeningStats}>();
export async function listeningStats(userId: string, period: StatsPeriod, tzOffsetMinutes: number): Promise<ListeningStats> {
  const key = `${userId}:${period}:${tzOffsetMinutes}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.value;
  // Streaks and «new artists» need the whole history; very long histories are capped at the latest 60 000 plays.
  const rows = await prisma.historyItem.findMany({where: {userId}, select: {playedAt: true, trackData: true}, orderBy: {playedAt: 'desc'}, take: 60000});
  const value = computeStats(rows, period, new Date(), tzOffsetMinutes);
  if (cache.size > 500) cache.clear();
  cache.set(key, {at: Date.now(), value});
  return value;
}
