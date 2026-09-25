import { LyricsData, LyricLine } from '../types/index.js';
import { prisma } from '../database/client.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { spicyLyricsService } from './SpicyLyricsService.js';

const SPICY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class LyricsService {
  private normalize(str: string): string {
    return (str || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Strictly checks whether the returned LRCLIB lyrics record genuinely belongs
   * to the requested artist, title, and duration.
   * If not genuine, rejects the record so mismatched lyrics are NEVER shown.
   */
  private isGenuineMatch(
    item: { trackName?: string; artistName?: string; duration?: number },
    targetTitle: string,
    targetArtist: string,
    targetDuration?: number
  ): boolean {
    if (!item.trackName || !item.artistName) return false;

    const normItemTrack = this.normalize(item.trackName);
    const normTargetTrack = this.normalize(targetTitle);

    const normItemArtist = this.normalize(item.artistName);
    const normTargetArtist = this.normalize(targetArtist);

    if (!normItemTrack || !normTargetTrack || !normItemArtist || !normTargetArtist) {
      return false;
    }

    // 1. Artist MUST match (direct substring or token overlap)
    const targetArtistTokens = normTargetArtist.split(' ').filter((t) => t.length >= 3);
    const itemArtistTokens = normItemArtist.split(' ').filter((t) => t.length >= 3);

    const artistMatch =
      normItemArtist.includes(normTargetArtist) ||
      normTargetArtist.includes(normItemArtist) ||
      targetArtistTokens.some((token) => normItemArtist.includes(token)) ||
      itemArtistTokens.some((token) => normTargetArtist.includes(token));

    if (!artistMatch) {
      return false;
    }

    // 2. Track title MUST match
    const titleMatch =
      normItemTrack === normTargetTrack ||
      normItemTrack.includes(normTargetTrack) ||
      normTargetTrack.includes(normItemTrack);

    if (!titleMatch) {
      return false;
    }

    // 3. Duration check if both durations are available
    if (targetDuration && targetDuration > 30 && item.duration && item.duration > 30) {
      const diff = Math.abs(item.duration - targetDuration);
      if (diff > 18) {
        return false;
      }
    }

    return true;
  }

  public async getLyrics(
    trackId: string,
    trackName?: string,
    artistName?: string,
    duration?: number
  ): Promise<LyricsData | null> {
    try {
      // 1. If trackName or artistName is missing, look up from trackCacheRepository
      if (!trackName || !artistName) {
        const cachedTrack = await trackCacheRepository.getCachedTrack(trackId);
        if (cachedTrack) {
          trackName = trackName || cachedTrack.title;
          artistName = artistName || cachedTrack.artist?.name;
          duration = duration || cachedTrack.duration;
        }
      }

      if (!trackName) {
        return null;
      }

      // Tag cleaner pattern to strip noise like "[Official Video]", "(Remastered)", etc.
      const TAG_PATTERN =
        /\s*[([][^)\]]*(?:prod\.?|produced\s+by|prod\s+by|feat\.?|featuring|ft\.?|with|remix|rmx|edit|version|cover|instrumental|free\s+(?:dl|download)|out\s+now|original\s+mix|extended\s+mix|radio\s+edit|premiere|exclusive|hd|hq|official(?:\s+(?:audio|video))?|lyrics|lyric\s+video|visualizer|sped\s*up|slowed(\s*\+\s*reverb)?)\b[^)\]]*[)\]]/gi;

      const cleanTitle = trackName.replace(TAG_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
      const cleanArtist = (artistName || '').trim();

      // Extract "Artist - Title" if formatted as combined string
      let altTitle = '';
      let altArtist = '';
      const dashMatch = cleanTitle.match(/^(.*?)\s+[-—–]\s+(.*)$/);
      if (dashMatch) {
        altArtist = dashMatch[1].trim();
        altTitle = dashMatch[2].trim();
      }

      const primaryArtist = cleanArtist.split(/\s*(?:&|,|feat\.?|ft\.?|w\/)\s*/i)[0].trim();

      // Check local cache
      const cached = await prisma.lyricsCache.findUnique({
        where: { id: trackId },
      });

      let cachedLyrics: LyricsData | null = null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached.lyricsData) as LyricsData;
          if ((parsed.isSynced && parsed.syncedLyrics?.length) || parsed.plainLyrics) {
            // If duration info is present in both, ensure cached lyrics don't have large mismatch
            if (!duration || !parsed.duration || Math.abs(parsed.duration - duration) <= 12) {
              if (parsed.apiSource !== 'spicy_lyrics' || Date.now() - cached.cachedAt.getTime() < SPICY_CACHE_MAX_AGE_MS) cachedLyrics = parsed;
            }
          }
        } catch {
          // ignore cache parse error
        }
      }

      if (cachedLyrics?.apiSource === 'spicy_lyrics' || (cachedLyrics && !spicyLyricsService.isConfigured())) return cachedLyrics;

      // Prepare search candidates that ALWAYS include both artist AND title
      const candidates: Array<{ track: string; artist: string }> = [];
      if (cleanTitle && cleanArtist) {
        candidates.push({ track: cleanTitle, artist: cleanArtist });
      }
      if (cleanTitle && primaryArtist && primaryArtist !== cleanArtist) {
        candidates.push({ track: cleanTitle, artist: primaryArtist });
      }
      if (altTitle && altArtist) {
        candidates.push({ track: altTitle, artist: altArtist });
      }

      let data: any = null;

      // A first-party/community catalogue can be enabled without changing the
      // client. This keeps the visual player independent from LRCLIB while
      // retaining a verified fallback for tracks that are not in that catalogue.
      if (env.LYRICS_PROVIDER_URL) {
        try {
          const providerUrl = new URL(env.LYRICS_PROVIDER_URL);
          providerUrl.searchParams.set('trackId', trackId);
          providerUrl.searchParams.set('trackName', cleanTitle);
          providerUrl.searchParams.set('artistName', cleanArtist);
          if (duration) providerUrl.searchParams.set('duration', String(Math.round(duration)));
          const providerRes = await fetch(providerUrl, {
            signal: AbortSignal.timeout(4500),
            headers: { Accept: 'application/json', 'User-Agent': 'Oskolok-Music-Player/1.0' },
          });
          if (providerRes.ok) {
            const payload = await providerRes.json() as any;
            const candidate = payload?.data || payload;
            if (candidate && (Array.isArray(candidate.syncedLyrics) || candidate.syncedLyrics || candidate.plainLyrics)) {
              data = candidate;
              data.provider = candidate.provider || 'oskolok';
            }
          }
        } catch (err) {
          logger.debug({ err, trackId }, 'Configured lyrics provider unavailable; using fallback');
        }
      }

      if (!data && spicyLyricsService.isConfigured()) {
        const spicy = await spicyLyricsService.getLyrics(trackId, trackName, artistName || '', duration);
        if (spicy?.isSynced) {
          await this.setLyrics(trackId, spicy);
          await this.replaceSpicyCredits(spicy, trackName, artistName || '');
          return spicy;
        }
        if (spicy?.plainLyrics && !cachedLyrics?.isSynced) data = { ...spicy };
      }

      if (!data && cachedLyrics) return cachedLyrics;

      // 1. Direct LRCLIB /api/get lookup with exact artist and track
      for (const candidate of candidates) {
        if (data) break;
        if (data?.syncedLyrics) break;

        const urlsToTry: string[] = [];
        // Prioritize exact duration match if duration is provided
        if (duration && duration > 0) {
          urlsToTry.push(
            `https://lrclib.net/api/get?track_name=${encodeURIComponent(
              candidate.track
            )}&artist_name=${encodeURIComponent(candidate.artist)}&duration=${Math.round(duration)}`
          );
        }
        urlsToTry.push(
          `https://lrclib.net/api/get?track_name=${encodeURIComponent(
            candidate.track
          )}&artist_name=${encodeURIComponent(candidate.artist)}`
        );

        for (const lrcUrl of urlsToTry) {
          if (data?.syncedLyrics) break;
          try {
            const res = await fetch(lrcUrl, {
              signal: AbortSignal.timeout(4000),
              headers: { 'User-Agent': 'Oskolok-Music-Player/1.0' },
            });

            if (res.ok) {
              const resData = (await res.json()) as any;
              if (
                resData &&
                this.isGenuineMatch(resData, candidate.track, candidate.artist, duration)
              ) {
                if (resData.syncedLyrics || resData.plainLyrics) {
                  data = resData;
                  if (resData.syncedLyrics) break;
                }
              }
            }
          } catch {
            // Continue
          }
        }
      }

      // 2. Verified fallback search on LRCLIB (ALWAYS with artist and title)
      if (!data?.syncedLyrics) {
        const searchUrls: string[] = [];
        for (const candidate of candidates) {
          searchUrls.push(
            `https://lrclib.net/api/search?track_name=${encodeURIComponent(
              candidate.track
            )}&artist_name=${encodeURIComponent(candidate.artist)}`
          );
        }

        const searchQueries = [
          cleanArtist && cleanTitle ? `${cleanArtist} ${cleanTitle}` : '',
          primaryArtist && cleanTitle && primaryArtist !== cleanArtist ? `${primaryArtist} ${cleanTitle}` : '',
          altArtist && altTitle ? `${altArtist} ${altTitle}` : '',
        ].filter(Boolean);

        for (const q of searchQueries) {
          searchUrls.push(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
        }

        const candidateItems: any[] = [];

        for (const sUrl of searchUrls) {
          if (candidateItems.some((x) => x.syncedLyrics)) break;
          try {
            const searchRes = await fetch(sUrl, {
              signal: AbortSignal.timeout(4000),
              headers: { 'User-Agent': 'Oskolok-Music-Player/1.0' },
            });

            if (searchRes.ok) {
              const list = (await searchRes.json()) as any[];
              if (Array.isArray(list) && list.length > 0) {
                for (const item of list) {
                  if (this.isGenuineMatch(item, cleanTitle, cleanArtist, duration)) {
                    candidateItems.push(item);
                  }
                }
              }
            }
          } catch {
            // Continue
          }
        }

        if (candidateItems.length > 0) {
          // Sort candidates:
          // 1. Has syncedLyrics
          // 2. Smallest duration difference to played track
          candidateItems.sort((a, b) => {
            const aSynced = Boolean(a.syncedLyrics);
            const bSynced = Boolean(b.syncedLyrics);
            if (aSynced && !bSynced) return -1;
            if (!aSynced && bSynced) return 1;

            if (duration && a.duration && b.duration) {
              return Math.abs(a.duration - duration) - Math.abs(b.duration - duration);
            }
            return 0;
          });

          data = candidateItems[0];
        }
      }

      // If a genuine match was found
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        const lyricsData: LyricsData = {
          trackId,
          isSynced: Boolean(data.syncedLyrics),
          provider: data.provider || 'lrclib',
          ...(data.apiSource === 'spicy_lyrics' ? { apiSource: 'spicy_lyrics' as const } : {}),
          ...(data.attribution ? { attribution: data.attribution } : {}),
          plainLyrics: data.plainLyrics || undefined,
          syncedLyrics: Array.isArray(data.syncedLyrics) ? data.syncedLyrics : data.syncedLyrics ? this.parseLrc(data.syncedLyrics) : undefined,
          duration: data.duration ? Math.round(data.duration) : undefined,
        };

        await this.setLyrics(trackId, lyricsData);
        if (lyricsData.apiSource === 'spicy_lyrics') await this.replaceSpicyCredits(lyricsData, trackName, artistName || '');
        return lyricsData;
      }

      // NO genuine match found -> return null so mismatched text is NEVER shown
      return null;
    } catch (err) {
      logger.error({ err, trackId }, 'Error retrieving lyrics');
      return null;
    }
  }

  private parseLrc(lrcText: string): LyricLine[] {
    if (!lrcText) return [];

    const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\]/i);
    const offsetSeconds = offsetMatch ? parseInt(offsetMatch[1], 10) / 1000 : 0;

    const lines = lrcText.split('\n');
    const result: LyricLine[] = [];
    const timeRegex = /\[(\d{1,2}):(\d{2})[.:](\d{2,3})\]/g;

    for (const line of lines) {
      const matches = [...line.matchAll(timeRegex)];
      if (matches.length > 0) {
        const text = line.replace(timeRegex, '').trim();
        if (text) {
          for (const match of matches) {
            const mins = parseInt(match[1], 10);
            const secs = parseInt(match[2], 10);
            const msStr = match[3];
            const ms = parseInt(msStr.length === 2 ? `${msStr}0` : msStr, 10);
            const timeInSeconds = Math.max(0, mins * 60 + secs + ms / 1000 + offsetSeconds);
            result.push({ time: timeInSeconds, text });
          }
        }
      }
    }

    return result.sort((a, b) => a.time - b.time);
  }

  public async setLyrics(trackId: string, lyrics: LyricsData): Promise<void> {
    try {
      await prisma.lyricsCache.upsert({
        where: { id: trackId },
        update: { lyricsData: JSON.stringify(lyrics), cachedAt: new Date() },
        create: {
          id: trackId,
          lyricsData: JSON.stringify(lyrics),
        },
      });
    } catch (err) {
      logger.error({ err, trackId }, 'Error caching lyrics');
    }
  }

  private async replaceSpicyCredits(lyrics: LyricsData, trackTitle: string, artistName: string): Promise<void> {
    const credits = lyrics.attribution;
    const entries = [['uploader', credits?.uploader], ['maker', credits?.maker]] as const;
    try {
      const catalogTrack = await trackCacheRepository.getCachedTrack(lyrics.trackId).catch(() => null);
      const title = (catalogTrack?.title || trackTitle).slice(0, 300);
      const artist = (catalogTrack?.artist?.name || artistName).slice(0, 200);
      const writes = entries.filter(([, person]) => person).map(([role, person]) => {
        const author = person!;
        return prisma.spicyLyricsCredit.upsert({
          where: { id: `${author.id}:${role}:${lyrics.trackId}` },
          create: { id: `${author.id}:${role}:${lyrics.trackId}`, contributorId: author.id, role, name: author.name, avatarUrl: author.avatarUrl, profileUrl: author.url, trackId: lyrics.trackId, trackTitle: title, artistName: artist, seenAt: new Date() },
          update: { name: author.name, avatarUrl: author.avatarUrl, profileUrl: author.url, trackTitle: title, artistName: artist, seenAt: new Date() },
        });
      });
      await prisma.$transaction([prisma.spicyLyricsCredit.deleteMany({ where: { trackId: lyrics.trackId } }), ...writes]);
    } catch (error) {
      logger.warn({ message: error instanceof Error ? error.message : String(error) }, 'Could not save Spicy Lyrics attribution');
    }
  }
}

export const lyricsService = new LyricsService();
