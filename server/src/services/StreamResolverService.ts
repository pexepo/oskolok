import { hasVersion } from '../utils/versionMatch.js';
import { Track, PlaybackInfo } from '../types/index.js';
import { trackCacheRepository } from '../repositories/trackCacheRepository.js';
import { studioMasterService } from './StudioMasterService.js';
import { logger } from '../utils/logger.js';
import { foldedCoverage, namesMatch } from './searchQuery.js';

interface SoundCloudTranscoding {
  url: string;
  preset: string;
  duration: number;
  snipped: boolean;
  format: {
    protocol: string;
    mime_type: string;
  };
}

interface SoundCloudSearchTrack {
  id: number;
  title: string;
  duration: number; // in ms
  policy?: string;
  created_at?: string;
  playback_count?: number;
  /** Distributor-delivered uploads carry release metadata (album, UPC, ISRC). */
  publisher_metadata?: { album_title?: string; upc_or_ean?: string; isrc?: string; artist?: string };
  user?: {
    username: string;
    verified?: boolean;
  };
  media?: {
    transcodings?: SoundCloudTranscoding[];
  };
  stream_url?: string;
}

export class StreamResolverService {
  private dynamicClientId: string | null = null;
  private clientIdFetchedAt: number = 0;
  private readonly CLIENT_ID_TTL = 1000 * 60 * 60 * 6; // 6 hours

  private fallbackClientIds = [
    'Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo',
    'rB5gM39wzXkPzE4Bw20hTqX1S3Jt7Z94',
    'iZt66xYzpLIU1AwrJGsubm8F62r6tY46',
  ];

  private normalize(str: string): string {
    return (str || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private refreshPromise: Promise<string> | null = null;

  public async getFreshClientId(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.dynamicClientId &&
      Date.now() - this.clientIdFetchedAt < this.CLIENT_ID_TTL
    ) {
      return this.dynamicClientId;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.fetchDynamicClientId().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async fetchDynamicClientId(): Promise<string> {
    try {
      const res = await fetch('https://soundcloud.com', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const html = await res.text();
        const scriptUrls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

        const bundles = await Promise.allSettled(scriptUrls.filter(s => s.includes('sndcdn.com')).slice(-6).map(async url => {
          const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
          return response.ok ? response.text() : '';
        }));
        for (const bundle of bundles) {
          const match = bundle.status === 'fulfilled' && bundle.value.match(/client_id[:=]"([a-zA-Z0-9]{32})"/);
          if (match) {
            this.dynamicClientId = match[1]; this.clientIdFetchedAt = Date.now();
            return match[1];
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Could not extract dynamic SoundCloud client ID, using fallback');
    }

    this.dynamicClientId = this.fallbackClientIds[0];
    this.clientIdFetchedAt = Date.now() - this.CLIENT_ID_TTL + 60000;
    return this.dynamicClientId;
  }

  /**
   * Resolves a full studio audio stream for any official track without 30s cutoffs
   * and with strict title verification to prevent playing unrelated songs.
   */
  public async resolvePlayback(track: Track): Promise<PlaybackInfo> {
    // 1. Primary: Authentic studio master from verified channels (no remakes, no cuts, no pitch shift)
    const studioMaster = await studioMasterService.resolveStudioStream(track);
    if (studioMaster) {
      return {
        available: true,
        type: 'progressive',
        url: `/api/tracks/${encodeURIComponent(track.id)}/stream`,
        expiresAt: studioMaster.expiresAt,
        mimeType: studioMaster.mimeType,
      };
    }

    let clientId = await this.getFreshClientId();

    const cleanTitle = track.title
      .replace(/\s*[\(\[][^\)\]]*(?:official|audio|video|prod|feat|ft)[\)\]]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const cleanArtist = track.artist.name.split(',')[0].trim();
    const targetDuration = track.duration || 0;

    const queries = [
      `${cleanArtist} - ${cleanTitle}`,
      `${cleanArtist} ${cleanTitle}`,
      `${cleanTitle} ${cleanArtist}`,
    ];

    const hasOfficialFallback = Boolean(track.streamUrl);

    // 1. Try to find an unsnipped studio version of this EXACT song on SoundCloud
    for (const query of queries) {
      const playbackInfo = await this.searchAndResolve(
        query,
        cleanTitle,
        cleanArtist,
        targetDuration,
        clientId,
        hasOfficialFallback
      );
      if (playbackInfo.available) {
        return playbackInfo;
      }
    }

    // 2. If no unsnipped full version of this exact title was found on SoundCloud,
    // fallback to the track's official studio stream URL (guarantees exact audio match!)
    if (track.streamUrl) {
      return {
        available: true,
        type: 'progressive',
        url: track.streamUrl,
        expiresAt: Date.now() + 86400000,
        mimeType: 'audio/mp4',
      };
    }

    return {
      available: false,
      type: 'none',
    };
  }

  /** When the label's own copy of an older song went up on SoundCloud: the re-release date that marks
   * which uploads still carry the original recording. Only uploads from 2025 on count (the re-release wave). */
  public async reissueUploadDate(artist: string, title: string, duration: number): Promise<string | undefined> {
    try {
      const clientId = await this.getFreshClientId();
      const res = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(`${artist} ${title}`)}&client_id=${clientId}&limit=25`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return undefined;
      const items = ((await res.json()) as { collection?: SoundCloudSearchTrack[] }).collection || [];
      const dates = items.filter(item => {
        const meta = item.publisher_metadata;
        return (meta?.upc_or_ean || meta?.isrc) && item.created_at && item.created_at >= '2025-01-01'
          && namesMatch(artist, item.user?.username || meta?.artist || '') && foldedCoverage(item.title || '', title) >= .8
          && (!duration || Math.abs(Math.round(item.duration / 1000) - duration) <= 3);
      }).map(item => item.created_at!.slice(0, 10)).sort();
      return dates[0];
    } catch { return undefined; }
  }

  public async searchAndResolve(
    query: string,
    targetTitle: string,
    targetArtist: string,
    targetDuration: number,
    clientId: string,
    hasOfficialFallback = false
  ): Promise<PlaybackInfo> {
    try {
      const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
        query
      )}&client_id=${clientId}&limit=25`;

      let res = await fetch(searchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.status === 401) {
        clientId = await this.getFreshClientId(true);
        const retryUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
          query
        )}&client_id=${clientId}&limit=25`;
        res = await fetch(retryUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(6000),
        });
      }

      if (!res.ok) {
        return { available: false, type: 'none' };
      }

      const data = (await res.json()) as { collection?: SoundCloudSearchTrack[] };
      const items = (data.collection || []).filter(
        (t) => t.policy !== 'BLOCK' && t.media?.transcodings && t.media.transcodings.length > 0
      );

      if (items.length === 0) {
        return { available: false, type: 'none' };
      }

      const cleanTargetTitle = this.normalize(targetTitle);
      const cleanTargetArtist = this.normalize(targetArtist);
      const targetTokens = cleanTargetTitle.split(' ').filter((t) => t.length >= 2);

      const scoredItems: Array<{ item: SoundCloudSearchTrack; score: number }> = [];

      for (const item of items) {
        const titleLower = (item.title || '').toLowerCase();
        const normItemTitle = this.normalize(item.title);

        // 1. MANDATORY TITLE MATCH: The candidate MUST contain the track title tokens
        const hasTitle =
          normItemTitle.includes(cleanTargetTitle) ||
          targetTokens.every((token) => normItemTitle.includes(token)) ||
          foldedCoverage(item.title || '', targetTitle) === 1;

        if (!hasTitle) {
          // REJECT! Prevents playing "Bones" when user asked for "Thunder"
          continue;
        }

        const durSec = Math.round((item.duration || 0) / 1000);
        const trans = item.media?.transcodings || [];
        const hasUnsnipped = trans.some((t) => !t.snipped);

        // Disqualify tracks that only have 30s snippets if full track is >= 60s
        if (!hasUnsnipped && targetDuration >= 60) {
          continue;
        }

        let score = 200;

        // Heavy penalty for non-original modifiers
        const isRemix =
          titleLower.includes('remix') ||
          titleLower.includes('mashup') ||
          titleLower.includes('bootleg') ||
          titleLower.includes('edit');
        const isCover =
          titleLower.includes('cover') ||
          titleLower.includes('кавер') ||
          titleLower.includes('choir') ||
          titleLower.includes('tribute') ||
          titleLower.includes('karaoke') ||
          titleLower.includes('instrumental') ||
          titleLower.includes('remake') ||
          titleLower.includes('ремейк') ||
          titleLower.includes('на русском');
        const isNightcore =
          titleLower.includes('nightcore') ||
          titleLower.includes('sped up') ||
          titleLower.includes('slowed') ||
          titleLower.includes('reverb');

        // Never substitute an unrequested edition, even if no official fallback exists.
        const editions=['remix','ремикс','cover','кавер','karaoke','караоке','nightcore','sped up','speed up','slowed','reverb','mashup','bootleg','instrumental','live','remake','ремейк','tribute','clean','explicit'];
        if(editions.some(e=>hasVersion(titleLower,e)!==hasVersion(targetTitle,e)))continue;
        // If an official studio fallback exists, NEVER settle for a remake, cover, or remix
        if (hasOfficialFallback && (isRemix || isCover || isNightcore)) {
          continue;
        }

        // Pitched copies keep the title and nearly the length: a sped-up upload of a 3-minute song
        // runs only 3–5 s short. More than 1.5% shorter (or 4% longer) is not the release.
        if (targetDuration > 60 && durSec > 0 && ((targetDuration - durSec) / targetDuration > 0.015 || (durSec - targetDuration) / targetDuration > 0.04)) continue;

        // Duration proximity check: Genuine studio release matches within ±8 seconds!
        // If it differs by more than 8 seconds, it is a cut, user edit, or remake.
        const durDiff = Math.abs(durSec - targetDuration);
        if (hasOfficialFallback && targetDuration > 30 && durDiff > 8) {
          continue; // REJECT cut/remake!
        }

        if (isRemix) score -= 180;
        if (isCover) score -= 250;
        if (isNightcore) score -= 250;

        // SoundCloud search often returns user uploads with a convincing title
        // (for example "Imagine Dragons - Believer" uploaded by a random
        // electronic-music account). A title match alone is not provenance.
        // Require the uploader to identify as the requested artist before we
        // use this source as a playback fallback.
        // Compared folded, so "Слава КПСС" counts as "Slava KPSS".
        if (cleanTargetArtist && !namesMatch(targetArtist, item.user?.username || '')) continue;
        if (targetDuration > 30 && durDiff > 8) continue;

        // Bonus for matching artist name
        if (normItemTitle.includes(cleanTargetArtist) || namesMatch(targetArtist, item.user?.username || '')) {
          score += 150;
        }

        // Clean title match bonus (e.g. "Thunder - Imagine Dragons")
        if (
          normItemTitle === `${cleanTargetArtist} ${cleanTargetTitle}` ||
          normItemTitle === `${cleanTargetTitle} ${cleanTargetArtist}` ||
          normItemTitle === cleanTargetTitle
        ) {
          score += 200;
        }

        // The distributor's copy runs to the second; an artist's own early upload can be a different master.
        if (durDiff <= 1) score += 280;
        else if (durDiff <= 4) score += 160;
        else if (durDiff <= 8) score += 80;
        else score -= durDiff * 8;
        if (item.publisher_metadata?.upc_or_ean || item.publisher_metadata?.album_title) score += 90;

        scoredItems.push({ item, score });
      }

      scoredItems.sort((a, b) => b.score - a.score);
      // Lyrics are timed to the release: an upload within 3 s of it beats any looser match.
      if (targetDuration > 30) {
        const close = scoredItems.filter(({ item }) => Math.abs(Math.round((item.duration || 0) / 1000) - targetDuration) <= 3);
        if (close.length) scoredItems.splice(0, scoredItems.length, ...close);
      }

      // Try candidates in score order (only if score is reasonable)
      for (const { item, score } of scoredItems.slice(0, 5)) {
        if (score < 50) continue; // Skip severely penalized tracks

        const transcodings = item.media?.transcodings || [];
        const fullProgressive = transcodings.find((t) => !t.snipped && t.format.protocol === 'progressive');
        // AAC HLS remuxes into a seekable .m4a without re-encoding; MP3 HLS is the last resort.
        const fullHls = transcodings.find((t) => !t.snipped && t.format.protocol === 'hls' && /^audio\/mp4/.test(t.format.mime_type || ''))
          || transcodings.find((t) => !t.snipped && t.format.protocol === 'hls');
        const targetTrans = fullProgressive || fullHls;

        if (targetTrans?.url) {
          try {
            const auth = (item as any).track_authorization ? `&track_authorization=${encodeURIComponent((item as any).track_authorization)}` : '';
            const streamEndpoint = `${targetTrans.url}?client_id=${clientId}${auth}`;
            const streamRes = await fetch(streamEndpoint, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
              signal: AbortSignal.timeout(5000),
            });

            if (streamRes.ok) {
              const streamJson = (await streamRes.json()) as { url?: string };
              if (streamJson.url) {
                logger.info(
                  { matchedTitle: item.title, uploader: item.user?.username, score },
                  'Stream resolved successfully'
                );
                return {
                  available: true,
                  type: targetTrans.format.protocol === 'hls' ? 'hls' : 'progressive',
                  url: streamJson.url,
                  expiresAt: Date.now() + 1800 * 1000,
                  mimeType: targetTrans.format.mime_type,
                };
              }
            }
          } catch {
            // Try next candidate
          }
        }
      }

      return { available: false, type: 'none' };
    } catch (err) {
      logger.error({ err, query }, 'Error in searchAndResolve');
      return { available: false, type: 'none' };
    }
  }
}

export const streamResolverService = new StreamResolverService();
