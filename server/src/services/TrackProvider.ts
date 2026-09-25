import {
  Track,
  Artist,
  Playlist,
  PlaybackInfo,
  SearchResult,
  SearchOptions,
  PaginationOptions,
} from '../types/index.js';

export interface TrackProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  getTrack(id: string): Promise<Track | null>;
  getArtist(id: string): Promise<Artist | null>;
  getArtistTracks(id: string, options?: PaginationOptions): Promise<Track[]>;
  getPlaylist(id: string): Promise<Playlist | null>;
  getPlaybackInfo(id: string): Promise<PlaybackInfo>;
}
