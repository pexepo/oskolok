export type TrackSource = 'spotify' | 'soundcloud' | 'local' | 'licensed' | 'deezer' | 'youtube' | 'unreleased';

export type TrackAccess = 'playable' | 'preview' | 'blocked' | 'unavailable';

export interface Artist {
  id: string;
  source: TrackSource;
  sourceId: string;
  name: string;
  avatarUrl?: string;
  permalinkUrl?: string;
  description?: string;
  trackCount?: number;
  followersCount?: number;
  /** Provider popularity on a 0–100 scale, when available. */
  popularity?: number;
  monthlyListeners?: number;
  /** The same artist on other platforms (search merges them under one card). */
  alsoOn?: Array<{ source: TrackSource; id: string; url?: string }>;
}

export interface Release {
  id: string;
  title: string;
  artworkUrl?: string;
  date?: string;
  type?: string;
  trackCount?: number;
  url?: string;
  artist?: Artist;
  popularity?: number;
  tracks?: Track[];
}

export interface Track {
  explicit?: boolean;
  /** 0..100 across sources (Deezer rank, Spotify popularity, SoundCloud plays); absent when unknown. */
  popularity?: number;
  release?: {id:string;title:string};
  id: string;
  source: TrackSource;
  sourceId: string;
  title: string;
  artist: Artist;
  artworkUrl?: string;
  duration: number; // in seconds
  trackUrl?: string;
  access: TrackAccess;
  streamUrl?: string; // Optional temporary stream URL if known
  waveformUrl?: string;
  genre?: string;
  createdAt?: string;
  downloadable?: boolean;
  recommendationReason?: string;
  audioSource?: string;
  /** Wave model hints from Yandex «Моя волна»: hue 0…360 and energy 0…1 tint the Резонанс visual. */
  vibe?: { hue?: number; energy?: number };
  /** Who actually uploaded a SoundCloud track (the credited artist may be parsed from its title). */
  uploader?: { name: string; followers?: number; verified?: boolean };
}

export type PlaybackType = 'hls' | 'progressive' | 'preview' | 'none';

export interface PlaybackInfo {
  available: boolean;
  type: PlaybackType;
  url?: string;
  expiresAt?: number;
  mimeType?: string;
}

export interface PlaylistTrackItem {
  id: string;
  playlistId: string;
  trackId: string;
  position: number;
  addedAt: string;
  track: Track;
}

export interface PlaylistOwner {
  id: string;
  name: string;
  username?: string;
  source: 'oskolok' | 'soundcloud' | 'spotify';
}

export interface Playlist {
  isPublic?: boolean;
  id: string;
  userId: string;
  owner?: PlaylistOwner;
  title: string;
  description?: string;
  artworkUrl?: string;
  createdAt: string;
  updatedAt: string;
  trackCount?: number;
  tracks?: PlaylistTrackItem[];
}

export interface LyricWord {
  text: string;
  start: number;
  end: number;
  joinNext?: boolean;
}

export interface LyricLine {
  words?: LyricWord[];
  background?: LyricLine[];
  role?: 'lead' | 'background';
  translation?: string;
  romanization?: string;
  end?: number;
  estimated?: boolean;
  time: number; // in seconds, e.g. 12.43
  text: string;
}

export interface LyricsData {
  trackId: string;
  isSynced: boolean;
  apiSource?: 'spicy_lyrics';
  plainLyrics?: string;
  syncedLyrics?: LyricLine[];
  provider: string;
  attribution?: {
    uploader?: { id: string; name: string; url: string; avatarUrl: string };
    maker?: { id: string; name: string; url: string; avatarUrl: string };
  };
  copyright?: string;
  duration?: number;
}

export interface SearchPagination {
  page: number;
  limit: number;
  hasMore: boolean;
  total?: number;
  sections?: Partial<Record<'tracks' | 'artists' | 'albums' | 'playlists', { hasMore: boolean; total?: number }>>;
}

export interface SearchResult {
  tracks: Track[];
  artists: Artist[];
  albums?: Release[];
  playlists: Playlist[];
  pagination: SearchPagination;
  catalogSource?: 'spotify' | 'deezer';
  catalogFallbackReason?: 'not_configured' | 'token' | 'request' | 'rate_limited' | 'premium_required';
  /** Set when the query was re-read in the other keyboard layout. */
  correctedQuery?: string;
  /** Yandex Music's «лучший результат» for the query, when this answer holds the same item. */
  bestHint?: { type: 'artist' | 'track' | 'album'; id: string };
}

export interface SearchOptions {
  page?: number;
  limit?: number;
  type?: 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface SoundCloudTrackDTO {
  id: number | string;
  title: string;
  duration: number; // ms
  permalink_url?: string;
  artwork_url?: string;
  stream_url?: string;
  downloadable?: boolean;
  streamable?: boolean;
  playback_count?: number;
  likes_count?: number;
  reposts_count?: number;
  policy?: string;
  genre?: string;
  created_at?: string;
  waveform_url?: string;
  user?: {
    id: number | string;
    username: string;
    avatar_url?: string;
    permalink_url?: string;
    description?: string;
    followers_count?: number;
    track_count?: number;
    verified?: boolean;
    badges?: {
      pro?: boolean;
      creator?: boolean;
      verified?: boolean;
    };
  };
  media?: {
    transcodings?: Array<{
      url: string;
      preset: string;
      duration: number;
      snipped: boolean;
      format: {
        protocol: string;
        mime_type: string;
      };
    }>;
  };
}

export interface SoundCloudArtistDTO {
  id: number | string;
  username: string;
  avatar_url?: string;
  permalink_url?: string;
  description?: string;
  followers_count?: number;
  track_count?: number;
}

export interface SoundCloudPlaylistDTO {
  id: number | string;
  title: string;
  description?: string;
  artwork_url?: string;
  created_at?: string;
  updated_at?: string;
  track_count?: number;
  tracks?: SoundCloudTrackDTO[];
  user?: SoundCloudArtistDTO;
}
