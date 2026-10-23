import type { LyricsData } from '../types/index.js';
import { findGeniusSong } from './GeniusAnnotationService.js';
import { decodeEntities, lyricContainers } from './geniusPage.js';
import { logger } from '../utils/logger.js';

/** Read only Genius's lyric containers, retaining breaks and inline annotation
 * text. No page scripts, headers, recommendations or markup reach the client. */
export function parseGeniusLyrics(html: string): string | null {
  const lyrics = lyricContainers(html).map(container => decodeEntities(container
    .replace(/<(script|style|noscript|button|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/?(?:div|p)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .split('\n').map(line => line.replace(/[\t\r ]+/g, ' ').trim()).join('\n').trim())
    .filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return /[\p{L}\p{N}]/u.test(lyrics) ? lyrics : null;
}

export async function geniusLyrics(trackId: string, artist: string, title: string): Promise<LyricsData | null> {
  try {
    const song = await findGeniusSong(artist, title);
    if (!song) return null;
    const url = new URL(song.url);
    if (url.protocol !== 'https:' || !/^(?:www\.)?genius\.com$/.test(url.hostname)) return null;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Oskolok-Music-Player', Accept: 'text/html' },
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (html.length > 3_000_000) return null;
    const plainLyrics = parseGeniusLyrics(html);
    return plainLyrics ? { trackId, isSynced: false, provider: 'Genius', plainLyrics } : null;
  } catch (err) {
    logger.debug({ err, trackId }, 'Genius lyrics fallback unavailable');
    return null;
  }
}
