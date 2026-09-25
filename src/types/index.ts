export type TrackSource = 'spotify' | 'soundcloud' | 'local' | 'licensed' | 'deezer' | 'youtube';
export type TrackAccess = 'playable' | 'preview' | 'blocked' | 'unavailable';
export type RepeatMode = 'off' | 'all' | 'one';

export interface Artist {
  id: string;
  source: TrackSource;
  sourceId: string;
  name: string;
  avatarUrl?: string;
  permalinkUrl?: string;
  description?: string;
  followersCount?: number;
  monthlyListeners?: number;
  trackCount?: number;
}

export interface Release {
  id:string; title:string; artworkUrl?:string; date?:string; type?:string; trackCount?:number; url?:string; artist?:Artist; tracks?:Track[];
}
export interface ArtistDetails {
  artist:Artist; imageSource:string; geniusUrl?:string; releaseSource?:string; releases:Release[];
  metrics:Array<{platform:string;label:string;value?:number;url?:string;note?:string}>;
}
export interface ImportPreview {title:string;tracks:Track[];total?:number;warning?:string;source:string;artworkUrl?:string;}

export interface Track {
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
  streamUrl?: string;
  waveformUrl?: string;
  genre?: string;
  createdAt?: string;
  downloadable?: boolean;
  recommendationReason?: string;
  audioSource?: string;
  playbackDevice?: string;
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

export interface Playlist {
  id: string;
  userId: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  createdAt: string;
  updatedAt: string;
  trackCount?: number;
  tracks?: PlaylistTrackItem[];
}

export interface LyricWord {
  joinNext?: boolean;
  /** Internal marker for formats that omit the final segment end. */
  endEstimated?: boolean;
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  agent?: string;
  agentName?: string;
  role?: 'lead' | 'background';
  translation?: string;
  romanization?: string;
  background?: LyricLine[];
  words?: LyricWord[];
  end?: number;
  estimated?: boolean;
  time: number;
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
  authorId?: string;
  author?: LyricsAuthor;
  copyright?: string;
  duration?: number;
}

export interface LyricsAuthor {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  credit: string;
}

export interface UserSummary {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string;
  bio: string;
  textsCount: number;
  musicCount: number;
  externalSource?: string;
  externalUrl?: string;
}

export interface SearchPagination {
  page: number;
  limit: number;
  hasMore: boolean;
  total?: number;
}

export interface SearchResult {
  tracks: Track[];
  artists: Artist[];
  playlists: Playlist[];
  pagination: SearchPagination;
}

export interface HistoryItem {
  id: string;
  userId: string;
  trackId: string;
  track: Track;
  playedAt: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  database: 'ok' | 'error';
  soundcloud: 'ok' | 'not_configured' | 'error';
  timestamp: string;
}
