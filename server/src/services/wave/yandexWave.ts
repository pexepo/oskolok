/* Резонанс on top of Yandex «Моя волна». For a listener who connected Yandex Music, the wave asks the
   rotor for its next tracks (the same session API the Yandex desktop client uses), maps each one onto
   Осколок's catalogue and relays plays, skips and likes back, so the Yandex model keeps learning.
   Settings travel as rotor seeds; combinations Yandex cannot express (Japanese, scenes without a
   Yandex genre, «из коллекции») stay with Осколок's own builder. */
import type { Track } from '../../types/index.js';
import { musicCatalogService } from '../MusicCatalogService.js';
import { trackCacheRepository } from '../../repositories/trackCacheRepository.js';
import { matchScore } from '../importMatch.js';
import { logger } from '../../utils/logger.js';
import { rotorFeedback, rotorSessionNew, rotorSessionTracks, yandexCover, yandexRef, type RotorEvent, type YandexTrack, type YandexWaveBatch } from '../yandex/yandexApi.js';
import type { WaveRequestV2 } from './taxonomy.js';

/* Yandex settings as the client sends them: «характер» (settingDiversity), «настроение»
   (settingMoodEnergy) and «язык» (settingLanguage); each group holds one value at a time. */
const MOOD_SEED: Record<string, string> = {
  calm: 'settingMoodEnergy:calm', energetic: 'settingMoodEnergy:active', melancholic: 'settingMoodEnergy:sad',
  bright: 'settingMoodEnergy:fun', uplifting: 'settingMoodEnergy:fun', inspiring: 'settingMoodEnergy:fun',
};
const GENRE_SEED: Record<string, Record<string, string>> = {
  ru: { rock: 'genre:rusrock', pop: 'genre:ruspop', hiphop: 'genre:rusrap', indie: 'genre:indie', electronic: 'genre:electronics' },
  en: { rock: 'genre:rock', pop: 'genre:pop', hiphop: 'genre:rap', indie: 'genre:indie', electronic: 'genre:electronics', souljazz: 'genre:soul' },
};

/** Rotor seeds for these settings, or null when Yandex cannot honour them exactly. */
export function yandexSeeds(req: WaveRequestV2): string[] | null {
  if (req.mode === 'collection' || req.language === 'ja') return null;
  const seeds = ['user:onyourwave'];
  if (req.mode === 'niche') seeds.push('settingDiversity:discover');
  if (req.language === 'ru') seeds.push('settingLanguage:russian');
  if (req.language === 'en') seeds.push('settingLanguage:not-russian');
  if (req.subgenre) {
    const genre = req.language === 'all' ? undefined : GENRE_SEED[req.language]?.[req.subgenre];
    if (!genre) return null;
    seeds.push(genre);
  }
  // Atmospheric has no Yandex counterpart: the scene and language still apply, the mood is left open.
  if (req.mood && MOOD_SEED[req.mood]) seeds.push(MOOD_SEED[req.mood]);
  // Activity agents of the Yandex client (rotor-activity-*).
  const ACTIVITY_SEED: Record<string, string> = { wake: 'activity:wake-up', work: 'activity:work-background', workout: 'activity:workout', road: 'activity:road-trip', sleep: 'activity:fall-asleep' };
  if (req.activity && ACTIVITY_SEED[req.activity]) seeds.push(ACTIVITY_SEED[req.activity]);
  return seeds;
}

type Session = { key: string; radioSessionId: string; batchId: string; at: number; played: string[]; byTrackId: Map<string, string> };
const sessions = new Map<string, Session>();
const SESSION_TTL = 40 * 60_000;

/** Yandex track id → catalogue track (null: not in the catalogue). Bounded; a miss is retried after a day. */
const mapped = new Map<string, { at: number; track: Track | null }>();
const MAP_TTL = 24 * 3600_000;

async function toCatalogue(y: YandexTrack): Promise<Track | null> {
  const hit = mapped.get(y.id);
  if (hit && Date.now() - hit.at < MAP_TTL) return hit.track;
  const title = y.version ? `${y.title} (${y.version})` : y.title, artist = y.artists.join(', ');
  const result = await musicCatalogService.search(`${y.artists[0]} ${y.title}`, { limit: 8 }).catch(() => null);
  const ranked = (result?.tracks || []).filter(t => t.access === 'playable')
    .map(t => ({ t, score: matchScore(artist, title, t) - (y.durationMs && Math.abs(t.duration - y.durationMs / 1000) > 12 ? 0.2 : 0) }))
    .sort((a, b) => b.score - a.score);
  const track = ranked[0] && ranked[0].score >= 0.7 ? { ...ranked[0].t, artworkUrl: ranked[0].t.artworkUrl || yandexCover(y.coverUri) } : null;
  mapped.set(y.id, { at: Date.now(), track });
  if (mapped.size > 4000) mapped.delete(mapped.keys().next().value!);
  if (track) void trackCacheRepository.setCachedTrack(track).catch(() => {});
  return track;
}

async function mapAll(items: YandexTrack[]): Promise<Array<{ y: YandexTrack; track: Track | null }>> {
  const out: Array<{ y: YandexTrack; track: Track | null }> = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < items.length) { const i = cursor++; out[i] = { y: items[i], track: await toCatalogue(items[i]) }; }
  }));
  return out;
}

export interface YandexWaveOptions { userId: string; token: string; request: WaveRequestV2; limit: number; batch: number; excludeTrackIds: string[]; skippedIds: string[] }

/** The next tracks from the listener's own Yandex wave; null when Yandex is unreachable or the settings need Осколок's builder. */
export async function yandexWaveBatch(options: YandexWaveOptions): Promise<Track[] | null> {
  const seeds = yandexSeeds(options.request);
  if (!seeds) return null;
  const key = seeds.join('|');
  let session = sessions.get(options.userId);
  if (session && (session.key !== key || options.batch === 0 || Date.now() - session.at > SESSION_TTL)) session = undefined;

  const excluded = new Set([...options.excludeTrackIds, ...options.skippedIds]);
  const limit = Math.max(1, Math.min(30, options.limit));
  const tracks: Track[] = [];
  // Yandex hands out small batches (about five); ask a few times, never long enough to stall a refill.
  for (let round = 0, started = Date.now(); round < 5 && tracks.length < limit && Date.now() - started < 9000; round++) {
    let batch: YandexWaveBatch | null;
    if (!session) {
      batch = await rotorSessionNew(options.token, seeds);
      if (!batch) return tracks.length ? tracks : null;
      session = { key, radioSessionId: batch.radioSessionId, batchId: batch.batchId, at: Date.now(), played: [], byTrackId: new Map() };
      sessions.set(options.userId, session);
      void rotorFeedback(options.token, session.radioSessionId, session.batchId, { type: 'radioStarted' });
    } else {
      batch = await rotorSessionTracks(options.token, session.radioSessionId, session.played.slice(-30));
      if (!batch) break;
      session.batchId = batch.batchId || session.batchId;
      session.at = Date.now();
    }
    if (!batch.tracks.length) break;
    for (const { y, track } of await mapAll(batch.tracks)) {
      session.played.push(yandexRef(y));
      if (!track || excluded.has(track.id) || tracks.some(t => t.id === track.id)) continue;
      session.byTrackId.set(track.id, yandexRef(y));
      tracks.push({ ...track, recommendationReason: 'Моя волна Яндекса', vibe: { hue: y.hue, energy: y.energy } });
    }
    if (session.played.length > 200) session.played = session.played.slice(-120);
    if (session.byTrackId.size > 600) session.byTrackId = new Map([...session.byTrackId].slice(-300));
  }
  logger.info({ seeds: key, tracks: tracks.length }, 'Yandex wave batch');
  return tracks;
}

/** Relays one listener action on a wave track to the Yandex session that issued it. */
export async function yandexWaveFeedback(userId: string, token: string, trackId: string, type: RotorEvent, playedSeconds?: number): Promise<boolean> {
  const session = sessions.get(userId), ref = session?.byTrackId.get(trackId);
  if (!session || !ref) return false;
  return rotorFeedback(token, session.radioSessionId, session.batchId, { type, trackId: ref, totalPlayedSeconds: playedSeconds === undefined ? undefined : Math.max(0, Math.round(playedSeconds)) });
}

/** Test seam: forget sessions and mappings. */
export function resetYandexWave() { sessions.clear(); mapped.clear(); }
