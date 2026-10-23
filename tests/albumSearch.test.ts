import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/src/repositories/trackCacheRepository.js', () => ({ trackCacheRepository: { setCachedTrack: vi.fn(async () => undefined) } }));

import { OfficialCatalogService, officialCatalogService } from '../server/src/services/OfficialCatalogService.js';
import { SpotifyService, spotifyService, SpotifyCatalogUnavailableError } from '../server/src/services/SpotifyService.js';
import { musicCatalogService } from '../server/src/services/MusicCatalogService.js';

const response = (body: unknown) => new Response(JSON.stringify(body));
const deezerAlbum = { id: 6575789, title: 'Random Access Memories', cover_xl: 'https://example.com/cover.jpg', nb_tracks: 13, record_type: 'album', artist: { id: 27, name: 'Daft Punk' }, link: 'https://www.deezer.com/album/6575789' };
const spotifyAlbum = { id: 'spotify-album', name: 'Random Access Memories', images: [{ url: 'https://example.com/spotify.jpg' }], total_tracks: 13, album_type: 'album', release_date: '2013-05-17', artists: [{ id: 'spotify-artist', name: 'Daft Punk' }] };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Deezer album search', () => {
  it('uses the real album endpoint with the requested query and page, independent of track count', async () => {
    const service = new OfficialCatalogService();
    const requests: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      requests.push(new URL(input));
      return response({ data: [deezerAlbum], total: 7, next: 'https://api.deezer.com/search/album?index=4' });
    }));
    const result = await service.search('Daft Punk', { type: 'albums', page: 2, limit: 2 });
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe('/search/album');
    expect(requests[0].searchParams.get('q')).toBe('Daft Punk');
    expect(requests[0].searchParams.get('index')).toBe('2');
    expect(result.albums).toMatchObject([{ id: 'deezer:album:6575789', title: 'Random Access Memories', trackCount: 13, artist: { name: 'Daft Punk' } }]);
    expect(result.tracks).toEqual([]);
    expect(result.pagination).toMatchObject({ hasMore: true, sections: { albums: { hasMore: true, total: 7 }, tracks: { hasMore: false } } });
  });
  it('keeps albums when other sections time out or return malformed JSON', async () => {
    const service = new OfficialCatalogService();
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === '/search/album') return response({ data: [deezerAlbum], total: 1 });
      if (path === '/search/artist') throw new TypeError('network');
      return new Response('<html>upstream error</html>');
    }));
    const result = await service.search('Random Access Memories');
    expect(result.albums).toHaveLength(1);
    expect(result.artists).toEqual([]);
    expect(result.tracks).toEqual([]);
    expect(result.pagination.hasMore).toBe(false);
  });
  it('keeps track results when album decoding fails', async () => {
    const service = new OfficialCatalogService();
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === '/search/album') return new Response('not json');
      if (path === '/search/artist') return response({ data: [] });
      return response({ data: [{ id: 123, title: 'Song', duration: 180, artist: deezerAlbum.artist, album: deezerAlbum }], total: 1 });
    }));
    const result = await service.search('Song', { limit: 1 });
    expect(result.tracks).toHaveLength(1);
    expect(result.albums).toEqual([]);
    expect(result.pagination.hasMore).toBe(false);
  });
  it('fetches the popular exact artist’s top songs instead of the first homonym', async () => {
    const service = new OfficialCatalogService();
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const path = new URL(input).pathname; requested.push(path);
      if (path === '/search/artist') return response({ data: [{ id: 1, name: 'Rizza', nb_fan: 4 }, { id: 2, name: 'Rizza', nb_fan: 200_000 }] });
      if (path === '/artist/2/top') return response({ data: [{ id: 456, title: 'Song', duration: 180, artist: { id: 2, name: 'Rizza' }, album: { id: 789, title: 'Album' } }] });
      return response({ data: [], total: 0 });
    }));
    const result = await service.search('Rizza');
    expect(result.artists[0].sourceId).toBe('2');
    expect(result.tracks[0].id).toBe('deezer:456');
    expect(requested).toContain('/artist/2/top');
    expect(requested).not.toContain('/artist/1/top');
  });
});

describe('Spotify album search', () => {
  it('maps albums, optional popularity metrics and album-only pagination', async () => {
    const service = new SpotifyService();
    vi.spyOn(service as any, 'getAccessToken').mockResolvedValue('token');
    const fetch = vi.spyOn(service as any, 'apiFetch').mockImplementation(async (input: unknown) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('type')).toContain('album');
      expect(url.searchParams.get('offset')).toBe('1');
      return response({ albums: { total: 4, items: [spotifyAlbum] }, tracks: { total: 0, items: [] }, artists: { total: 1, items: [{ id: 'artist', name: 'Daft Punk', popularity: 85, followers: { total: 100_000 } }] } });
    });
    const result = await service.search('Daft Punk', { page: 2, limit: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.albums).toMatchObject([{ id: 'spotify:album:spotify-album', title: 'Random Access Memories', date: '2013-05-17', artist: { id: 'spotify:artist:spotify-artist' } }]);
    expect(result.artists).toMatchObject([{ popularity: 85, followersCount: 100_000 }]);
    expect(result.pagination).toMatchObject({ hasMore: true, sections: { albums: { hasMore: true, total: 4 }, tracks: { hasMore: false } } });
  });
  it('preserves successful batches if a later Spotify request fails', async () => {
    const service = new SpotifyService();
    vi.spyOn(service as any, 'getAccessToken').mockResolvedValue('token');
    vi.spyOn(service as any, 'apiFetch').mockImplementation(async (input: unknown) => {
      const offset = Number(new URL(String(input)).searchParams.get('offset'));
      if (offset) throw new TypeError('network');
      return response({ albums: { total: 30, items: [spotifyAlbum] } });
    });
    const result = await service.search('random access memories', { type: 'albums', limit: 20 });
    expect(result.albums).toHaveLength(1);
    expect(result.pagination.hasMore).toBe(true);
  });
});

describe('merged catalog albums', () => {
  it('retains albums and their pagination while Spotify is unavailable', async () => {
    vi.spyOn(spotifyService, 'search').mockRejectedValue(new SpotifyCatalogUnavailableError('not_configured'));
    vi.spyOn(officialCatalogService, 'search').mockResolvedValue({ tracks: [], artists: [], albums: [{ id: 'deezer:album:1', title: 'Album' }], playlists: [], pagination: { page: 1, limit: 10, hasMore: true, sections: { albums: { total: 40, hasMore: true } } } });
    const result = await musicCatalogService.search('album');
    expect(result.albums).toHaveLength(1);
    expect(result.pagination.sections?.albums).toEqual({ total: 40, hasMore: true });
    expect(result.catalogFallbackReason).toBe('not_configured');
  });
});
