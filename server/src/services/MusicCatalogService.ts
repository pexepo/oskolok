import type { SearchOptions, SearchResult } from '../types/index.js';
import { spotifyService, SpotifyCatalogUnavailableError } from './SpotifyService.js';
import {deduplicateSearchAlbums, deduplicateSearchTracks} from './trackRanking.js';
import { officialCatalogService } from './OfficialCatalogService.js';

// Spotify only adds to an answer; it never holds the page. Its answers are cached in the database,
// so a warm query returns well inside this budget even while Spotify itself is paused.
const SPOTIFY_BUDGET_MS = 1500;

/** Deezer is the catalog of record. Spotify enriches: extra tracks and artists when it answers in time. */
export class MusicCatalogService {
  public async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const deezerPromise = officialCatalogService.search(query, options).catch(() => null);
    let reason: SearchResult['catalogFallbackReason'];
    const spotifyPromise = Promise.race([
      spotifyService.search(query, options).catch(error => { reason = error instanceof SpotifyCatalogUnavailableError ? error.reason : 'request'; return null; }),
      new Promise<null>(resolve => setTimeout(() => { reason ??= 'request'; resolve(null); }, SPOTIFY_BUDGET_MS)),
    ]);
    const [deezer, spotify] = await Promise.all([deezerPromise, spotifyPromise]);
    const page = options?.page || 1, limit = options?.limit || 20;
    const base: SearchResult = deezer || { tracks: [], artists: [], albums: [], playlists: [], pagination: { page, limit, hasMore: false } };
    const sections = Object.fromEntries((['tracks', 'artists', 'albums'] as const).map(section => {
      const pages = [base, spotify].filter((result): result is SearchResult => !!result).map(result => result.pagination.sections?.[section]);
      const totals = pages.flatMap(pagination => typeof pagination?.total === 'number' ? [pagination.total] : []);
      return [section, { hasMore: pages.some(pagination => pagination?.hasMore), total: totals.length ? Math.max(...totals) : undefined }];
    }));
    return {
      ...base,
      tracks: deduplicateSearchTracks([...base.tracks, ...(spotify?.tracks || [])]),
      artists: [...base.artists, ...(spotify?.artists || [])],
      albums: deduplicateSearchAlbums([...(base.albums || []), ...(spotify?.albums || [])]),
      pagination: {
        ...base.pagination,
        hasMore: base.pagination.hasMore || !!spotify?.pagination.hasMore,
        sections,
      },
      catalogSource: !deezer && spotify ? 'spotify' : 'deezer',
      ...(spotify ? {} : { catalogFallbackReason: reason || 'request' }),
    };
  }
}

export const musicCatalogService = new MusicCatalogService();
