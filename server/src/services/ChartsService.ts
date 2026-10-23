import type { Track } from '../types/index.js';
import { spotifyService } from './SpotifyService.js';
import { musicCatalogService } from './MusicCatalogService.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { logger } from '../utils/logger.js';

export type ChartServiceId = 'vk' | 'yandex' | 'spotify';
export const CHART_SERVICES: ChartServiceId[] = ['vk', 'yandex', 'spotify'];

export interface ChartEntry {
  position: number;
  title: string;
  artist: string;
  artworkUrl?: string;
  duration?: number;
  /** Places gained since the previous edition; null for new entries, undefined when the source has no history. */
  shift?: number | null;
  /** Catalogue track to play; null when the row could not be matched (the client searches on click). */
  track: Track | null;
}

export interface ChartResult {
  service: ChartServiceId;
  title: string;
  sourceUrl?: string;
  updatedAt: string;
  items: ChartEntry[];
  /** Human-readable reason when the source cannot provide a chart right now. */
  unavailable?: string;
}

const TTL = 60 * 60 * 1000, FAIL_TTL = 5 * 60 * 1000, MAX = 50;
const SPOTIFY_TOP_GLOBAL = '37i9dQZEVXbMDoHDwVN2tF';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const norm = (v: string) => v.toLocaleLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const decode = (v: string) => v.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\u00a0/g, ' ').trim();

async function getJson<T>(url: string, init: RequestInit = {}, timeout = 10000): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8', ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

/** Runs fn over items with a small worker pool, stopping new work at the deadline. */
async function pool<T>(items: T[], workers: number, deadline: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (cursor < items.length && Date.now() < deadline) await fn(items[cursor++]).catch(() => undefined);
  }));
}

/** Finds the catalogue (Spotify → Deezer) track for a chart row from another service. */
async function matchCatalog(rows: ChartEntry[], budgetMs: number) {
  await pool(rows, 4, Date.now() + budgetMs, async row => {
    const result = await musicCatalogService.search(`${row.artist.split(',')[0]} ${row.title}`, { limit: 8 });
    const title = norm(row.title), artists = row.artist.split(',').map(norm).filter(Boolean);
    const sameTitle = result.tracks.filter(t => norm(t.title) === title || norm(t.title).startsWith(title) || title.startsWith(norm(t.title)));
    const match = sameTitle.find(t => artists.some(a => norm(t.artist.name).includes(a) || a.includes(norm(t.artist.name)))) || sameTitle[0];
    if (!match) return;
    row.track = { ...match, artworkUrl: match.artworkUrl || row.artworkUrl };
    row.duration ||= match.duration;
    await trackCacheRepository.setCachedTrack(row.track).catch(() => undefined);
  });
}

interface YandexChartRow { chart?: { position?: number; shift?: number; progress?: string }; track?: { id?: string | number; title?: string; version?: string; durationMs?: number; coverUri?: string; ogImage?: string; artists?: Array<{ name?: string }> } }

async function yandexChart(limit: number): Promise<ChartResult> {
  let rows: YandexChartRow[] = [], region = 'russia';
  for (const id of ['russia', 'world']) {
    try {
      const body = await getJson<{ result?: { chart?: { tracks?: YandexChartRow[] } } }>(`https://api.music.yandex.net/landing3/chart/${id}`, { headers: { 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621' } });
      rows = body.result?.chart?.tracks || [];
      if (rows.length) { region = id; break; }
    } catch (err) { logger.debug({ err, id }, 'Yandex chart request failed'); }
  }
  const items: ChartEntry[] = rows.slice(0, limit).flatMap((row, i) => {
    const t = row.track; if (!t?.title) return [];
    const cover = t.coverUri || t.ogImage;
    return [{
      position: row.chart?.position || i + 1,
      title: t.version ? `${t.title} (${t.version})` : t.title,
      artist: (t.artists || []).map(a => a.name).filter(Boolean).join(', ') || 'Неизвестный исполнитель',
      artworkUrl: cover ? `https://${cover.replace('%%', '400x400')}` : undefined,
      duration: t.durationMs ? Math.round(t.durationMs / 1000) : undefined,
      shift: row.chart?.progress === 'new' ? null : row.chart?.shift ?? 0,
      track: null,
    }];
  });
  if (!items.length) return { service: 'yandex', title: 'Чарт Яндекс Музыки', updatedAt: new Date().toISOString(), items, unavailable: 'Яндекс Музыка не отдала чарт — попробуйте позже' };
  await matchCatalog(items, 15000);
  return { service: 'yandex', title: region === 'russia' ? 'Чарт Яндекс Музыки' : 'Глобальный чарт Яндекс Музыки', sourceUrl: 'https://music.yandex.ru/chart', updatedAt: new Date().toISOString(), items };
}

async function spotifyOembedArt(items: ChartEntry[], budgetMs: number) {
  await pool(items.filter(i => i.track && !i.artworkUrl), 8, Date.now() + budgetMs, async item => {
    const body = await getJson<{ thumbnail_url?: string }>(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${item.track!.sourceId}`)}`, {}, 4000);
    if (body.thumbnail_url) { item.artworkUrl = body.thumbnail_url; item.track!.artworkUrl = body.thumbnail_url; }
  });
}

/** kworb.net mirrors Spotify's daily global chart with track ids; used when the editorial playlist is unreachable. */
async function spotifyKworb(limit: number): Promise<ChartEntry[]> {
  const res = await fetch('https://kworb.net/spotify/country/global_daily.html', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`kworb HTTP ${res.status}`);
  const html = await res.text(), items: ChartEntry[] = [];
  for (const row of html.split('<tr>').slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const id = row.match(/track\/([A-Za-z0-9]{22})\.html/)?.[1];
    if (cells.length < 3 || !id) continue;
    const names = [...cells[2].matchAll(/<a href="[^"]*(artist|track)\/[^"]+">([^<]+)<\/a>/g)];
    const title = decode(names.find(n => n[1] === 'track')?.[2] || ''), artists = names.filter(n => n[1] === 'artist').map(n => decode(n[2]));
    if (!title || !artists.length) continue;
    const delta = decode(cells[1].replace(/<[^>]+>/g, ''));
    const artist = artists.join(', ');
    const track: Track = { id: `spotify:${id}`, source: 'spotify', sourceId: id, title, artist: { id: 'spotify:artist:unknown', source: 'spotify', sourceId: 'unknown', name: artist }, duration: 0, trackUrl: `https://open.spotify.com/track/${id}`, access: 'playable' };
    items.push({ position: Number(decode(cells[0])) || items.length + 1, title, artist, shift: delta === 'NEW' || delta === 'RE' ? null : delta === '=' ? 0 : Number(delta.replace('+', '')) || 0, track });
    if (items.length >= limit) break;
  }
  return items;
}

async function spotifyChart(limit: number): Promise<ChartResult> {
  const base = { service: 'spotify' as const, title: 'Spotify Top 50 — Global', sourceUrl: `https://open.spotify.com/playlist/${SPOTIFY_TOP_GLOBAL}`, updatedAt: new Date().toISOString() };
  try {
    // Web API first (often 404 for editorial lists on client-credentials apps), then the public embed.
    const playlist = await spotifyService.resolveSpotifyPlaylistFromEmbed(SPOTIFY_TOP_GLOBAL);
    const tracks = (playlist?.tracks || []).map(item => item.track).filter((t): t is Track => !!t).slice(0, limit);
    if (tracks.length) return { ...base, items: tracks.map((track, i) => ({ position: i + 1, title: track.title, artist: track.artist.name.replace(/\u00a0/g, ' '), artworkUrl: track.artworkUrl, duration: track.duration, track: { ...track, artist: { ...track.artist, name: track.artist.name.replace(/\u00a0/g, ' ') } } })) };
  } catch (err) { logger.debug({ err }, 'Spotify Top 50 playlist unavailable'); }
  try {
    const items = await spotifyKworb(limit);
    await spotifyOembedArt(items, 7000);
    await Promise.all(items.map(i => i.track && trackCacheRepository.setCachedTrack(i.track).catch(() => undefined)));
    if (items.length) return { ...base, title: 'Spotify Daily — Global', sourceUrl: 'https://kworb.net/spotify/country/global_daily.html', items };
  } catch (err) { logger.debug({ err }, 'kworb Spotify chart unavailable'); }
  return { ...base, items: [], unavailable: 'Spotify не отдал чарт — попробуйте позже' };
}

async function vkChart(): Promise<ChartResult> {
  // VK closed audio.* to third-party apps, and vk.com/music/chart and the VK Music
  // web app both require a signed-in VK session, so there is no public source.
  return { service: 'vk', title: 'Чарт VK Музыки', sourceUrl: 'https://vk.com/audio', updatedAt: new Date().toISOString(), items: [], unavailable: 'VK Музыка показывает чарт только авторизованным пользователям ВКонтакте' };
}

class ChartsService {
  private cache = new Map<ChartServiceId, { expires: number; value: Promise<ChartResult> }>();

  public async get(service: ChartServiceId, limit = 20): Promise<ChartResult> {
    const hit = this.cache.get(service);
    if (!hit || hit.expires < Date.now()) {
      const previous = hit?.value;
      const value = (service === 'yandex' ? yandexChart(MAX) : service === 'spotify' ? spotifyChart(MAX) : vkChart()).then(async result => {
        // Keep serving the last good edition when a refresh comes back empty.
        if (!result.items.length && previous) { const old = await previous.catch(() => null); if (old?.items.length) return old; }
        return result;
      });
      const entry = { expires: Date.now() + TTL, value };
      this.cache.set(service, entry);
      value.then(r => { if (!r.items.length) entry.expires = Date.now() + FAIL_TTL; }, () => this.cache.delete(service));
    }
    const result = await this.cache.get(service)!.value;
    return { ...result, items: result.items.slice(0, Math.max(1, Math.min(MAX, limit))) };
  }
}

export const chartsService = new ChartsService();
