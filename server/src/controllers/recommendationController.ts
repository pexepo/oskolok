import { Request, Response, NextFunction } from 'express';
import { recommendationService, WaveOptions, WaveSignal } from '../services/RecommendationService.js';
import { dailyMixesFor, trackRadio } from '../services/dailyMixes.js';
import { buildWaveV2, releaseContinuation } from '../services/wave/waveV2.js';
import { normalizeWaveRequest, waveOptionsCatalog } from '../services/wave/taxonomy.js';
import { yandexWaveBatch, yandexWaveFeedback } from '../services/wave/yandexWave.js';
import { yandexAccessToken } from './musicAccounts.js';
import { acceptedFriend } from './friendsController.js';
import { buildBlendWave } from '../services/wave/blendWave.js';
import { noteServed, recentlyServed, sessionSalt } from '../services/wave/served.js';
import type { RotorEvent } from '../services/yandex/yandexApi.js';
import type { Track } from '../types/index.js';

// Legacy ids from older clients and the home collections.
const moodAliases: Record<string, string> = { melancholic: 'sad', joyful: 'fun', focus: 'calm', happy: 'fun', chill: 'calm' };
const characterAliases: Record<string, string> = { familiar: 'favorite', discover: 'discovery' };
const languageAliases: Record<string, string> = { russian: 'ru', any: 'all', none: 'instrumental', instrumentals: 'instrumental' };

const text = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = (value: unknown, max: number) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .map(item => text(item)).filter(Boolean).slice(-max);
const signals = (value: unknown, max: number): WaveSignal[] => (Array.isArray(value) ? value : []).slice(-max).flatMap(item => {
  const id = text(item?.id), artist = text(item?.artist);
  return id && artist ? [{ id, artist, title: text(item?.title) || undefined, reason: text(item?.reason) || undefined }] : [];
});

function parseOptions(source: Record<string, unknown>, userId: string): WaveOptions {
  const mood = text(source.mood, 30), character = text(source.character, 30), language = text(source.language, 30);
  return {
    userId,
    limit: parseInt(text(source.limit, 4) || String(source.limit || '20'), 10) || 20,
    scenario: (text(source.scenario, 30) || undefined) as WaveOptions['scenario'],
    mood: (moodAliases[mood] || mood || undefined) as WaveOptions['mood'],
    character: (characterAliases[character] || character || undefined) as WaveOptions['character'],
    language: (languageAliases[language] || language || undefined) as WaveOptions['language'],
    excludeTrackIds: list(source.excludeTrackIds || source.excludeIds, 300),
    skipped: signals(source.skipped, 80),
    liked: signals(source.liked, 40),
    recentArtists: list(source.recentArtists, 12),
    batch: Number(source.batch) || 0,
  };
}

export class RecommendationController {
  /** GET: shelves and legacy callers (query string). Service validates every enum. */
  public getRecommendations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const options = parseOptions(req.query as Record<string, unknown>, res.locals.userId || 'local-user');
      // Shelves without an explicit mood keep the previous energetic default.
      if (!req.query.mood) options.mood = 'energetic';
      res.json({ data: await recommendationService.getRecommendations(options) });
    } catch (err) {
      next(err);
    }
  };

  /** POST: «Моя волна» with session feedback (skips, likes, recent artists) in the body.
   * `v: 2` (current clients): language / subgenre / mood / mode, answered as {tracks, status, reason}.
   * Without it the legacy array answer stays for clients that have not reloaded yet. */
  public getWave = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      if (body.v === 2) {
        const base = parseOptions(body, res.locals.userId || 'local-user');
        const request = normalizeWaveRequest(body);
        // «Волна на двоих»: both friends' tastes, Осколок's own builder (Yandex knows only one of them).
        const blendWith = text(body.blendWith, 64);
        if (blendWith) {
          const friend = await acceptedFriend(base.userId!, blendWith);
          if (!friend) { res.status(403).json({ error: { code: 'NOT_FRIENDS', message: 'Волна на двоих доступна только с друзьями.' } }); return; }
          const result = await buildBlendWave({ ...request, userId: base.userId!, limit: base.limit || 20, batch: base.batch || 0,
            excludeTrackIds: base.excludeTrackIds || [], skipped: base.skipped || [], liked: base.liked || [], recentArtists: base.recentArtists || [], finished: signals(body.finished, 40) },
            { userId: friend.userId, name: friend.displayName });
          res.json({ data: { ...result, source: 'oskolok', blend: { publicId: friend.publicId, name: friend.displayName } } });
          return;
        }
        // «Моя волна» Яндекса leads for a connected account unless the listener chose Осколок's own picks;
        // an unreachable Yandex or settings it cannot express fall through to the builder below.
        const yandexToken = await yandexAccessToken(res.locals.userId), token = body.engine === 'oskolok' ? null : yandexToken;
        // What earlier sessions already gave stays out for a few days; a pool that small falls back to the session's own list.
        const userId = base.userId!, batch = base.batch || 0, own = base.excludeTrackIds || [], served = recentlyServed(userId), salt = sessionSalt(userId, batch);
        if (token) {
          const tracks = await yandexWaveBatch({ userId, token, request, limit: base.limit || 20, batch,
            excludeTrackIds: [...served, ...own], skippedIds: (base.skipped || []).map(s => s.id) }).catch(() => null);
          if (tracks?.length) { noteServed(userId, tracks.map(t => t.id)); res.json({ data: { tracks, status: 'ok', source: 'yandex', yandexConnected: true, version: 'yandex' } }); return; }
        }
        const build = (excludeTrackIds: string[]) => buildWaveV2({ ...request, userId, limit: base.limit || 20, batch, salt,
          excludeTrackIds, skipped: base.skipped || [], liked: base.liked || [], recentArtists: base.recentArtists || [], finished: signals(body.finished, 40) });
        let result = await build([...served, ...own]);
        if (!result.tracks.length && served.length) result = await build(own);
        noteServed(userId, result.tracks.map(t => t.id));
        res.json({ data: { ...result, source: 'oskolok', yandexConnected: !!yandexToken } });
        return;
      }
      const options = parseOptions(body, res.locals.userId || 'local-user');
      res.json({ data: await recommendationService.getRecommendations(options) });
    } catch (err) {
      next(err);
    }
  };
}

export const recommendationController = new RecommendationController();

/** «Миксы дня»: up to four personal mixes, one edition per day. */
export const getDailyMixes = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = res.locals.userId;
    res.json({ data: userId ? await dailyMixesFor(userId) : [] });
  } catch (err) {
    next(err);
  }
};

/** «Радио по треку»: the seed song, then its artist's neighbourhood. The client sends the track it already shows. */
export const getTrackRadio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as Record<string, any>;
    const id = text(body.id), title = text(body.title, 300), artist = text(body.artist?.name);
    if (!id || !title || !artist) { res.status(400).json({ error: { message: 'Нужен трек.' } }); return; }
    const seed = { ...body, id, title, artist: { ...(body.artist || {}), name: artist } } as Track;
    res.json({ data: await trackRadio(seed) });
  } catch (err) {
    next(err);
  }
};

const ROTOR_EVENTS = new Set<RotorEvent>(['trackStarted', 'trackFinished', 'skip', 'like', 'unlike', 'dislike', 'undislike']);
/** Plays, skips and likes of Yandex-picked wave tracks go back to the listener's Yandex session. */
export const postWaveFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const trackId = text(body.trackId), event = text(body.event, 20) as RotorEvent;
    if (!trackId || !ROTOR_EVENTS.has(event)) { res.status(400).json({ error: { message: 'Нужны трек и событие.' } }); return; }
    const token = await yandexAccessToken(res.locals.userId);
    const played = Number(body.playedSeconds);
    res.json({ data: { relayed: token ? await yandexWaveFeedback(res.locals.userId, token, trackId, event, Number.isFinite(played) ? played : undefined) : false } });
  } catch (err) {
    next(err);
  }
};

/** Settings catalogue for the Резонанс screen: subgenres and moods per music language. */
export const getWaveOptions = (_req: Request, res: Response): void => { res.json({ data: waveOptionsCatalog() }); };

/** What plays after a release ends: built from the release's artists and the listener's taste. */
export const getReleaseContinuation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = (req.body || {}) as Record<string, any>;
    const artists = list(body.artists, 6), trackIds = list(body.trackIds, 200);
    if (!artists.length) { res.status(400).json({ error: { message: 'Нужны исполнители релиза.' } }); return; }
    res.json({ data: await releaseContinuation(res.locals.userId || 'local-user', { artists, trackIds }, Number(body.batch) || 0, list(body.excludeTrackIds, 300), 20) });
  } catch (err) {
    next(err);
  }
};
