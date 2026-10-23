export type TrackSource = 'spotify' | 'soundcloud' | 'local' | 'licensed' | 'deezer' | 'youtube' | 'unreleased';
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
  /** Provider popularity on a 0–100 scale, when available. */
  popularity?: number;
  monthlyListeners?: number;
  trackCount?: number;
}

export interface Release {
  popularity?: number; description?: string; descriptionUrl?: string;
  id:string; title:string; artworkUrl?:string; date?:string; type?:string; trackCount?:number; url?:string; artist?:Artist; tracks?:Track[];
}
export interface ArtistDetails {
  artist:Artist; imageSource:string; geniusUrl?:string; releaseSource?:string; releases:Release[];
  /** Wide header image (Genius) when the source has one. */
  bannerUrl?:string;
  metrics:Array<{platform:string;label:string;value?:number;url?:string;note?:string}>;
  genius?:GeniusArtist;
  /** The same artist on each platform; Spotify is the card of record. */
  linked?:{spotifyId?:string;soundcloudId?:string;deezerId?:string};
  /** Set when a better-known artist owns this name: the card borrows nothing from that artist and points to it. */
  homonym?:{id:string;name:string;avatarUrl?:string};
}
/** Track popularity normalised to 0–100 (Spotify popularity, Deezer rank or Last.fm listeners) plus the source's raw figure. */
export interface TrackPopularity {popularity:number;source:'spotify'|'deezer'|'lastfm';rank?:number;plays?:number;listeners?:number}
export interface GeniusSong {id:number;title:string;url:string;views?:number;date?:string;art?:string}
export interface GeniusAlbum {id:number;name:string;url:string;date?:string;cover?:string;views?:number;description?:string;trackCount?:number}
export interface GeniusArtist {
  id:number;name:string;url:string;image?:string;header?:string;verified:boolean;followers?:number;alternateNames:string[];description?:string;
  socials:{instagram?:string;twitter?:string;facebook?:string};
  stats:{topSongsViews:number;albumCount:number;songCount:number};
  topSongs:GeniusSong[];albums:GeniusAlbum[];
}
export interface GeniusRelease extends GeniusAlbum {artist:string;tracks:Array<{number?:number;title:string;url:string;views?:number}>;credits:Array<{role:string;names:string[]}>}
export interface ImportPreview {title:string;tracks:Track[];total?:number;warning?:string;source:string;artworkUrl?:string;}

export interface Track {
  explicit?: boolean;
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
  streamUrl?: string;
  waveformUrl?: string;
  genre?: string;
  createdAt?: string;
  downloadable?: boolean;
  recommendationReason?: string;
  audioSource?: string;
  /** Wave model hints from Yandex «Моя волна»: hue 0…360 and energy 0…1 tint the Резонанс visual. */
  vibe?: { hue?: number; energy?: number };
  playbackDevice?: string;
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
  timingOffset?:number;
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
