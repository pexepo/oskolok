/* Yandex Music HTTP API, the part Осколок uses: public search (query understanding) and «Моя волна»
   (rotor sessions) for listeners who connected their Yandex account. Endpoints and request shapes were
   read from the desktop client (Electron + Next.js bundle) with rea; the client calls the same paths
   relative to https://api.music.yandex.net. Everything here is best-effort: a slow or failing Yandex
   answer returns null and the caller falls back to Осколок's own catalogue. */
import { logger } from '../../utils/logger.js';

const BASE = 'https://api.music.yandex.net';
const CLIENT = 'YandexMusicAndroid/24023621';

export interface YandexTrack {
  id: string;
  albumId?: string;
  title: string;
  version?: string;
  artists: string[];
  durationMs?: number;
  coverUri?: string;
  /** Wave model hints: hue (0…360) and energy (0…1) drive the client's visual. */
  hue?: number;
  energy?: number;
  bpm?: number;
}
export interface YandexWaveBatch { radioSessionId: string; batchId: string; tracks: YandexTrack[] }
export interface YandexSearchHint {
  /** The query Yandex actually searched (`misspellResult` when it fixed a typo). */
  text: string;
  corrected: boolean;
  best?: { type: 'artist'; name: string } | { type: 'track' | 'album'; title: string; artists: string[] };
  /** Top tracks in Yandex order, for priors. */
  tracks: Array<{ title: string; artists: string[] }>;
  artists: string[];
}

async function call(path: string, init: { method?: 'GET' | 'POST'; token?: string; json?: unknown; timeout?: number } = {}): Promise<any | null> {
  const headers: Record<string, string> = { 'X-Yandex-Music-Client': CLIENT, 'Accept-Language': 'ru', Accept: 'application/json' };
  if (init.token) headers.Authorization = `OAuth ${init.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${BASE}/${path}`, {
      method: init.method || 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: AbortSignal.timeout(init.timeout ?? 6000),
    });
    if (!response.ok) {
      logger.info({ path: path.split('?')[0], status: response.status }, 'Yandex Music request failed');
      return null;
    }
    const body = await response.json().catch(() => null) as { result?: unknown } | null;
    return body && 'result' in body ? body.result : body;
  } catch (error) {
    logger.info({ path: path.split('?')[0], error: (error as Error).message }, 'Yandex Music request failed');
    return null;
  }
}

const str = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** One track object from any Yandex answer (search, rotor sequence); null when unusable. */
export function parseYandexTrack(raw: any): YandexTrack | null {
  const t = raw?.track ?? raw;
  const id = str(t?.id), title = str(t?.title);
  const artists = (Array.isArray(t?.artists) ? t.artists : []).map((a: any) => str(a?.name)).filter(Boolean);
  if (!id || !title || !artists.length || t?.available === false) return null;
  const params = raw?.trackParameters ?? t?.trackParameters ?? {};
  return {
    id, title, artists,
    albumId: str(t?.albums?.[0]?.id) || undefined,
    version: str(t?.version) || undefined,
    durationMs: num(t?.durationMs),
    coverUri: str(t?.coverUri || t?.albums?.[0]?.coverUri) || undefined,
    hue: num(params.hue), energy: num(params.energy), bpm: num(params.bpm),
  };
}

/** Cover URI template («avatars.yandex.net/…/%%») as an https URL of the given size. */
export const yandexCover = (uri: string | undefined, size = '400x400') => uri ? `https://${uri.replace('%%', size)}` : undefined;

/** «trackId:albumId», the form rotor feedback and queues expect. */
export const yandexRef = (t: Pick<YandexTrack, 'id' | 'albumId'>) => t.albumId ? `${t.id}:${t.albumId}` : t.id;

export function parseRotorBatch(result: any): YandexWaveBatch | null {
  const radioSessionId = str(result?.radioSessionId), batchId = str(result?.batchId);
  if (!radioSessionId) return null;
  const tracks = (Array.isArray(result?.sequence) ? result.sequence : [])
    .filter((item: any) => !item?.type || item.type === 'track')
    .map(parseYandexTrack).filter((t: YandexTrack | null): t is YandexTrack => !!t);
  return { radioSessionId, batchId, tracks };
}

/** POST rotor/session/new — a fresh «Моя волна» session for these seeds («user:onyourwave», «settingMoodEnergy:calm», …). */
export async function rotorSessionNew(token: string, seeds: string[], queue: string[] = []): Promise<YandexWaveBatch | null> {
  return parseRotorBatch(await call('rotor/session/new', { method: 'POST', token, json: { seeds, queue, includeTracksInResponse: true, includeWaveModel: true, interactive: true } }));
}

/** POST rotor/session/{id}/tracks — the next batch; `queue` tells the wave what already played. */
export async function rotorSessionTracks(token: string, radioSessionId: string, queue: string[]): Promise<YandexWaveBatch | null> {
  const result = await call(`rotor/session/${encodeURIComponent(radioSessionId)}/tracks`, { method: 'POST', token, json: { queue } });
  return result ? parseRotorBatch({ radioSessionId, ...result }) : null;
}

export type RotorEvent = 'radioStarted' | 'trackStarted' | 'trackFinished' | 'skip' | 'like' | 'unlike' | 'dislike' | 'undislike';
/** POST rotor/session/{id}/feedback — what the listener did, so the wave keeps learning. */
export async function rotorFeedback(token: string, radioSessionId: string, batchId: string, event: { type: RotorEvent; trackId?: string; totalPlayedSeconds?: number }): Promise<boolean> {
  const body = { event: { ...event, timestamp: new Date().toISOString() }, batchId, from: 'oskolok-resonance' };
  return !!await call(`rotor/session/${encodeURIComponent(radioSessionId)}/feedback`, { method: 'POST', token, json: body, timeout: 4000 });
}

/** Search answer → hint. Pure, so it is testable on a recorded answer. */
export function parseSearchHint(result: any, text: string): YandexSearchHint | null {
  if (!result || typeof result !== 'object') return null;
  const tracks = (result.tracks?.results || []).map(parseYandexTrack).filter(Boolean).slice(0, 10) as YandexTrack[];
  const artists = (result.artists?.results || []).map((a: any) => str(a?.name)).filter(Boolean).slice(0, 6);
  const b = result.best, r = b?.result, bestTrack = b?.type === 'track' ? parseYandexTrack(r) : null;
  const best: YandexSearchHint['best'] = b?.type === 'artist' && str(r?.name) ? { type: 'artist', name: str(r.name) }
    : bestTrack ? { type: 'track', title: bestTrack.title, artists: bestTrack.artists }
    : b?.type === 'album' && str(r?.title) ? { type: 'album', title: str(r.title), artists: (r.artists || []).map((a: any) => str(a?.name)).filter(Boolean) }
    : undefined;
  return {
    text: result.misspellCorrected && str(result.misspellResult) ? str(result.misspellResult) : str(result.text) || text,
    corrected: !!result.misspellCorrected,
    best, artists,
    tracks: tracks.map(t => ({ title: t.title, artists: t.artists })),
  };
}

/** GET search — public, no account needed. Used to understand a query, not as a playback source. */
export async function yandexSearch(text: string, timeout = 1500): Promise<YandexSearchHint | null> {
  return parseSearchHint(await call(`search?text=${encodeURIComponent(text)}&type=all&page=0&nocorrect=false`, { timeout }), text);
}
