import { prisma } from '../database/client.js';
import { Track } from '../types/index.js';

export class TrackCacheRepository {
  public async getCachedTrack(trackId: string): Promise<Track | null> {
    const cached = await prisma.trackCache.findUnique({
      where: { id: trackId },
    });

    if (!cached) return null;

    if (new Date() > cached.expiresAt) {
      // Expired metadata
      return null;
    }

    const track = JSON.parse(cached.trackData) as Track;
    // Strip stale Deezer/CDN preview URLs baked into old cache entries
    if (
      track.streamUrl &&
      (track.streamUrl.includes('cdnt-preview') ||
        track.streamUrl.includes('dzcdn.net') ||
        track.streamUrl.includes('preview'))
    ) {
      delete track.streamUrl;
    }
    return track;
  }

  public async setCachedTrack(track: Track, ttlHours: number = 24): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

    await prisma.trackCache.upsert({
      where: { id: track.id },
      update: {
        trackData: JSON.stringify(track),
        cachedAt: new Date(),
        expiresAt,
      },
      create: {
        id: track.id,
        source: track.source,
        sourceId: track.sourceId,
        trackData: JSON.stringify(track),
        expiresAt,
      },
    });
  }
}

export const trackCacheRepository = new TrackCacheRepository();
