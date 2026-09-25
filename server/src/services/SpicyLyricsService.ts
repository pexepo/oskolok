import type { LyricsData, LyricLine, LyricWord, Track } from '../types/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { spotifyService } from './SpotifyService.js';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const clean = (value: string) => value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const finiteTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sourceName: Record<string, string> = { spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music', spotify: 'Spotify', unknown: 'Неизвестный источник' };

type Contributor = { id?: unknown; username?: unknown; url?: unknown; avatar?: unknown };
type Body = Record<string, any>;

export function spicyContributor(value: Contributor | undefined) {
  if (!value || typeof value.id !== 'string' || !/^\d{5,30}$/.test(value.id)) return undefined;
  const url = `https://spicylyrics.org/uid/${value.id}`;
  return {
    id: `spicy:${value.id}`,
    name: typeof value.username === 'string' && value.username.trim() ? value.username.trim().slice(0, 100) : value.id,
    url,
    avatarUrl: typeof value.avatar === 'string' && /^https:\/\//.test(value.avatar) ? value.avatar : '',
  };
}

function groupToLine(group: Body | null): LyricLine | null {
  group = group || {};
  const syllables = Array.isArray(group.Syllables) ? group.Syllables : [];
  const words: LyricWord[] = syllables.filter((s: Body) => typeof s?.Text === 'string' && finiteTime(s.StartTime))
    .map((s: Body) => ({ text: s.Text, start: s.StartTime, end: finiteTime(s.EndTime) && s.EndTime >= s.StartTime ? s.EndTime : s.StartTime, ...(s.IsPartOfWord ? { joinNext: true } : {}) }));
  if (!words.length) return null;
  const text = words.map((word, index) => `${word.text}${index < words.length - 1 && !word.joinNext ? ' ' : ''}`).join('').trim();
  if (!text) return null;
  const time = finiteTime(group.StartTime) ? group.StartTime : words[0].start;
  const end = finiteTime(group.EndTime) && group.EndTime >= time ? group.EndTime : words.at(-1)!.end;
  return { time, end, text, words, ...(typeof group.TranslatedText === 'string' ? { translation: group.TranslatedText } : {}), ...(typeof group.TransliteratedText === 'string' ? { romanization: group.TransliteratedText } : {}) };
}

/** Convert the documented Spicy Lyrics envelope without guessing missing timings. */
export function mapSpicyLyrics(body: Body, trackId: string, spotifyId: string): LyricsData | null {
  if (body?.id !== spotifyId || !Object.hasOwn(sourceName, body.source)) return null;
  const provider = sourceName[body.source];
  const uploader = body.source === 'spicy_lyrics' ? spicyContributor(body.UploadAttribution?.Uploader) : undefined;
  const maker = body.source === 'spicy_lyrics' ? spicyContributor(body.UploadAttribution?.Maker) : undefined;
  // A community sync without its required uploader cannot meet attribution terms.
  if (body.source === 'spicy_lyrics' && !uploader) return null;
  const attribution = body.source === 'spicy_lyrics' ? {
    uploader: { name: uploader!.name, url: uploader!.url, id: uploader!.id, avatarUrl: uploader!.avatarUrl },
    ...(maker ? { maker: { name: maker.name, url: maker.url, id: maker.id, avatarUrl: maker.avatarUrl } } : {}),
  } : undefined;
  let syncedLyrics: LyricLine[] | undefined;
  let plainLyrics: string | undefined;
  if (body.Type === 'Syllable' && Array.isArray(body.Content)) {
    syncedLyrics = body.Content.flatMap((entry: Body) => {
      if (entry?.Type !== 'Vocal') return [];
      const lead = groupToLine(entry.Lead || {});
      if (!lead) return [];
      const background = Array.isArray(entry.Background) ? entry.Background.map(groupToLine).filter(Boolean) as LyricLine[] : [];
      return [{ ...lead, ...(background.length ? { background: background.map(line => ({ ...line, role: 'background' as const })) } : {}) }];
    });
  } else if (body.Type === 'Line' && Array.isArray(body.Content)) {
    syncedLyrics = body.Content.filter((entry: Body) => entry?.Type === 'Vocal' && typeof entry.Text === 'string' && entry.Text.trim() && finiteTime(entry.StartTime)).map((entry: Body) => ({
      time: entry.StartTime, text: entry.Text.trim(), ...(finiteTime(entry.EndTime) && entry.EndTime >= entry.StartTime ? { end: entry.EndTime } : {}),
      ...(typeof entry.TranslatedText === 'string' ? { translation: entry.TranslatedText } : {}),
      ...(typeof entry.TransliteratedText === 'string' ? { romanization: entry.TransliteratedText } : {}),
    }));
  } else if (body.Type === 'Static' && Array.isArray(body.Lines)) {
    plainLyrics = body.Lines.filter((line: Body) => typeof line?.Text === 'string').map((line: Body) => line.Text).join('\n').trim();
  }
  if (!syncedLyrics?.length && !plainLyrics) return null;
  return { trackId, isSynced: Boolean(syncedLyrics?.length), apiSource: 'spicy_lyrics', provider, ...(attribution ? { attribution } : {}), ...(syncedLyrics?.length ? { syncedLyrics } : {}), ...(plainLyrics ? { plainLyrics } : {}) };
}

export class SpicyLyricsService {
  private retryAfter = new Map<string, number>();
  private globalRetryAfter = 0;
  public isConfigured() { return Boolean(env.SPICY_LYRICS_SECRET_KEY.trim()); }

  public async resolveSpotifyId(trackId: string, title: string, artist: string, duration?: number): Promise<string | null> {
    const direct = trackId.match(/^spotify:(?:track:)?([A-Za-z0-9]{22})$/)?.[1] || (SPOTIFY_ID.test(trackId) ? trackId : '');
    if (direct) return direct;
    const cached = await trackCacheRepository.getCachedTrack(trackId).catch(() => null);
    if (cached?.source === 'spotify' && SPOTIFY_ID.test(cached.sourceId)) return cached.sourceId;
    if (!spotifyService.isConfigured() || !title || !artist) return null;
    const result = await spotifyService.search(`${artist} ${title}`, { page: 1, limit: 8 });
    const exact = result.tracks.find((track: Track) => track.source === 'spotify' && SPOTIFY_ID.test(track.sourceId)
      && clean(track.title) === clean(title) && clean(track.artist.name) === clean(artist)
      && (!duration || !track.duration || Math.abs(track.duration - duration) <= 5));
    return exact?.sourceId || null;
  }

  public async getLyrics(trackId: string, title: string, artist: string, duration?: number): Promise<LyricsData | null> {
    if (!this.isConfigured()) return null;
    try {
      const spotifyId = await this.resolveSpotifyId(trackId, title, artist, duration);
      if (!spotifyId || this.globalRetryAfter > Date.now() || (this.retryAfter.get(spotifyId) || 0) > Date.now()) return null;
      const response = await fetch(`https://api.spicylyrics.org/v1/lyrics/${spotifyId}`, {
        headers: { Authorization: `Bearer ${env.SPICY_LYRICS_SECRET_KEY}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) {
        if (response.status === 404) this.retryAfter.set(spotifyId, Date.now() + 15 * 60_000);
        if (response.status === 429) this.globalRetryAfter = Date.now() + Math.min(3600, Math.max(30, Number(response.headers.get('Retry-After')) || 60)) * 1000;
        if (response.status === 401 || response.status === 403) {
          this.globalRetryAfter = Date.now() + 10 * 60_000;
          logger.warn({ status: response.status }, 'Spicy Lyrics key rejected');
        }
        return null;
      }
      const payload = await response.json() as { Body?: Body; Status?: number };
      return payload.Status === 200 && payload.Body ? mapSpicyLyrics(payload.Body, trackId, spotifyId) : null;
    } catch (error) {
      logger.debug({ message: error instanceof Error ? error.message : String(error) }, 'Spicy Lyrics unavailable; using lyrics fallback');
      return null;
    }
  }
}

export const spicyLyricsService = new SpicyLyricsService();
