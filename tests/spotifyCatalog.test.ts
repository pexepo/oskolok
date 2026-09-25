import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/src/repositories/trackCacheRepository.js', () => ({
  trackCacheRepository: { setCachedTrack: vi.fn(async () => undefined) },
}));

import { SpotifyService, SpotifyCatalogUnavailableError, spotifyService } from '../server/src/services/SpotifyService.js';
import { musicCatalogService } from '../server/src/services/MusicCatalogService.js';
import { officialCatalogService } from '../server/src/services/OfficialCatalogService.js';

afterEach(() => vi.restoreAllMocks());

describe('Spotify primary catalog', () => {
  it('splits a 25-result search into requests within Spotify’s 10-item limit', async () => {
    const service = new SpotifyService();
    vi.spyOn(service as any, 'getAccessToken').mockResolvedValue('test-token');
    const requested: Array<{ limit: number; offset: number }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      requested.push({ limit, offset });
      return { ok: true, json: async () => ({
        tracks: { total: 40, items: Array.from({ length: limit }, (_, i) => ({
          id: String(offset + i).padStart(22, '0'), name: `Song ${offset + i}`,
          duration_ms: 180000, artists: [{ id: 'artist', name: 'Artist' }],
          album: { id: 'album', name: 'Album', images: [] },
        })) }, artists: { items: [] },
      }) };
    }));
    try {
      const result = await service.search('Artist', { limit: 25, page: 1 });
      expect(requested.sort((a, b) => a.offset - b.offset)).toEqual([
        { limit: 10, offset: 0 }, { limit: 10, offset: 10 }, { limit: 5, offset: 20 },
      ]);
      expect(result.tracks).toHaveLength(25);
      expect(result.pagination).toMatchObject({ total: 40, hasMore: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('labels Deezer as the fallback only when Spotify is unavailable', async () => {
    vi.spyOn(spotifyService, 'search').mockRejectedValue(new SpotifyCatalogUnavailableError('not_configured'));
    vi.spyOn(officialCatalogService, 'search').mockResolvedValue({
      tracks: [], artists: [], playlists: [], pagination: { page: 1, limit: 10, hasMore: false },
    });
    const result = await musicCatalogService.search('Artist', { limit: 10 });
    expect(result.catalogSource).toBe('deezer');
    expect(result.catalogFallbackReason).toBe('not_configured');
  });
});
