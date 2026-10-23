import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ catalog: vi.fn(), soundcloud: vi.fn(), youtube: vi.fn() }));
vi.mock('../server/src/services/SpicyLyricsService.js', () => ({ spicyLyricsService: {} }));
vi.mock('../server/src/database/client.js', () => ({ prisma: {} }));
vi.mock('../server/src/services/SpotifyService.js', () => ({ spotifyService: {} }));
vi.mock('../server/src/services/SoundCloudService.js', () => ({ soundCloudService: { search: calls.soundcloud } }));
vi.mock('../server/src/services/StreamResolverService.js', () => ({ streamResolverService: {} }));
vi.mock('../server/src/services/StudioMasterService.js', () => ({ studioMasterService: { searchTracks: calls.youtube } }));
vi.mock('../server/src/repositories/trackCacheRepository.js', () => ({ trackCacheRepository: {} }));
vi.mock('../server/src/services/OfficialCatalogService.js', () => ({ officialCatalogService: {} }));
vi.mock('../server/src/services/MusicCatalogService.js', () => ({ musicCatalogService: { search: calls.catalog } }));
vi.mock('../server/src/services/canonicalRelease.js', () => ({ canonicalizeTracks: async (tracks: unknown[]) => tracks }));
vi.mock('../server/src/controllers/musicAccounts.js', () => ({ resolveTidalStream: vi.fn() }));
vi.mock('../server/src/utils/audioProxy.js', () => ({ proxyAudio: vi.fn() }));
import { TrackController } from '../server/src/controllers/trackController.js';
import type { SearchResult } from '../server/src/types/index.js';

const empty = (): SearchResult => ({ tracks: [], artists: [], albums: [], playlists: [], pagination: { page: 1, limit: 25, hasMore: false } });
const album = (id: string, title = 'Random Access Memories') => ({ id: `deezer:album:${id}`, title, artist: { id: 'deezer:artist:27', source: 'deezer' as const, sourceId: '27', name: 'Daft Punk' } });
const search = async (q: string, limit = 25) => {
  const json = vi.fn(), next = vi.fn();
  await new TrackController().search({ query: { q, limit: String(limit) } } as any, { json } as any, next);
  expect(next).not.toHaveBeenCalled();
  return json.mock.calls[0][0].data as SearchResult;
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.catalog.mockResolvedValue(empty());
  calls.soundcloud.mockResolvedValue(empty());
  calls.youtube.mockResolvedValue([]);
});

describe('search response', () => {
  it('returns an album-only match and its pagination when audio search providers fail', async () => {
    calls.catalog.mockResolvedValue({ ...empty(), albums: [album('1')], pagination: { page: 1, limit: 25, hasMore: true, sections: { albums: { hasMore: true, total: 30 } } } });
    calls.soundcloud.mockRejectedValue(new TypeError('network'));
    calls.youtube.mockRejectedValue(new TypeError('network'));
    const result = await search('random access memories');
    expect(result.albums).toMatchObject([{ id: 'deezer:album:1', title: 'Random Access Memories' }]);
    expect(result.tracks).toEqual([]);
    expect(result.correctedQuery).toBeUndefined();
    expect(result.pagination.sections?.albums).toEqual({ hasMore: true, total: 30 });
    expect(calls.catalog).toHaveBeenCalledOnce();
  });
  it('corrects keyboard layout even when only albums match the corrected query', async () => {
    calls.catalog.mockImplementation(async (query: string) => query === 'andy warhol' ? { ...empty(), albums: [album('2', 'Andy Warhol')] } : empty());
    const result = await search('фтвн цфкрщд');
    expect(result.correctedQuery).toBe('andy warhol');
    expect(result.albums).toMatchObject([{ id: 'deezer:album:2', title: 'Andy Warhol' }]);
  });
  it('does not drop unique albums from either provider before advancing both offsets', async () => {
    calls.catalog.mockResolvedValue({ ...empty(), albums: [album('1'), { ...album('2'), id: 'spotify:album:2', title: 'Random Access Memories Deluxe' }] });
    const result = await search('random access memories', 1);
    expect(result.albums).toHaveLength(2);
    expect(result.pagination.hasMore).toBe(false);
  });
});
