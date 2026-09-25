import type { SearchOptions, SearchResult } from '../types/index.js';
import { spotifyService, SpotifyCatalogUnavailableError } from './SpotifyService.js';
import { officialCatalogService } from './OfficialCatalogService.js';

/** Spotify is the catalog of record. Deezer is an explicit availability fallback. */
export class MusicCatalogService {
  public async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    try {
      const result = await spotifyService.search(query, options);
      return { ...result, catalogSource: 'spotify' };
    } catch (error) {
      if (!(error instanceof SpotifyCatalogUnavailableError)) throw error;
      const result = await officialCatalogService.search(query, options);
      return { ...result, catalogSource: 'deezer', catalogFallbackReason: error.reason };
    }
  }
}

export const musicCatalogService = new MusicCatalogService();
