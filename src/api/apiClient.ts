import { telegramAuthHeaders, useTelegramStore } from '../telegram/runtime.js';
import {
  SearchResult,
  Track,
  PlaybackInfo,
  Artist,
  Playlist,
  LyricsData,
  HistoryItem,
  HealthStatus,
  ImportPreview, Release, ArtistDetails,
  UserSummary,
} from '../types/index.js';

export class ApiError extends Error {
  public code: string;
  public details?: any;

  constructor(message: string, code: string = 'UNKNOWN_ERROR', details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

class ApiClient {
  public previewImport(url:string):Promise<ImportPreview>{return this.request('/imports/preview',{method:'POST',body:JSON.stringify({url})});}
  public matchImport(artist:string,title:string):Promise<{track:Track|null;candidates:Track[]}>{return this.request('/imports/match',{method:'POST',body:JSON.stringify({artist,title})});}
  public suggestions(q:string,signal?:AbortSignal):Promise<SearchResult>{return this.request(`/suggestions?q=${encodeURIComponent(q)}`,{signal});}
  public getRelease(id:string):Promise<Release>{return this.request(`/releases/${encodeURIComponent(id)}`);}
  public getArtistDetails(id:string):Promise<ArtistDetails>{return this.request(`/artists/${encodeURIComponent(id)}/details`);}
  private baseUrl =
    typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? 'http://127.0.0.1:5000/api'
      : ((import.meta as any).env?.VITE_API_URL || '/api');

  public getStreamUrl(trackId: string, source?: string): string {
    const suffix = source ? `?source=${encodeURIComponent(source)}` : '';
    return `${this.baseUrl}/tracks/${encodeURIComponent(trackId)}/stream${suffix}`;
  }

  public async request<T>(endpoint: string, options?: RequestInit & { signal?: AbortSignal }): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    try {
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...telegramAuthHeaders(),
          ...(options?.headers as Record<string, string>),
        },
      });

      const json = await response.json();

      if (!response.ok) {
        if(response.status===401)useTelegramStore.setState({user:null});
        const errObj = json.error || {};
        throw new ApiError(
          errObj.message || `HTTP ${response.status} Error`,
          errObj.code || `HTTP_${response.status}`,
          errObj.details
        );
      }

      return json.data as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw err; // Re-throw abort error for caller to handle cleanly
      }
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(err.message || 'Network error communicating with Oskolok API');
    }
  }

  public async sendTrackToTelegram(trackId: string): Promise<{ status: string; chatUrl: string }> {
    return this.request('/telegram/profile-track', { method: 'POST', body: JSON.stringify({ trackId }) });
  }

  public async downloadTrack(track: Track): Promise<void> {
    const response = await fetch(`${this.baseUrl}/tracks/${encodeURIComponent(track.id)}/download`, { credentials: 'include', headers: telegramAuthHeaders() });
    if (!response.ok) { const json = await response.json(); throw new Error(json.error?.message || 'Не удалось подготовить аудиофайл.'); }
    const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
    const extension = blob.type.includes('mpeg') ? 'mp3' : 'm4a';
    a.href = url; a.download = `${track.artist.name} - ${track.title}.${extension}`.replace(/[\\/]/g, '_'); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  public async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>('/health');
  }

  public async search(query: string, page = 1, limit = 20, signal?: AbortSignal): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });
    return this.request<SearchResult>(`/search?${params.toString()}`, { signal });
  }

  public async getTrack(id: string): Promise<Track> {
    return this.request<Track>(`/tracks/${encodeURIComponent(id)}`);
  }

  public async getPlaybackInfo(id: string): Promise<PlaybackInfo> {
    return this.request<PlaybackInfo>(`/tracks/${encodeURIComponent(id)}/playback`);
  }

  public async prefetchTrack(id: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/tracks/prefetch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...telegramAuthHeaders() },
        body: JSON.stringify({ trackId: id }),
      });
    } catch {
      // Non-blocking prefetch failure
    }
  }

  public async getArtist(id: string): Promise<Artist> {
    return this.request<Artist>(`/artists/${encodeURIComponent(id)}`);
  }

  public async getArtistTracks(id: string, page = 1, limit = 20): Promise<Track[]> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.request<Track[]>(`/artists/${encodeURIComponent(id)}/tracks?${params.toString()}`);
  }

  public async getSoundCloudPlaylist(id: string): Promise<Playlist> {
    return this.request<Playlist>(`/soundcloud-playlists/${encodeURIComponent(id)}`);
  }

  // Playlists
  public async getPlaylists(): Promise<Playlist[]> {
    return this.request<Playlist[]>('/playlists');
  }

  public async getPlaylist(id: string): Promise<Playlist> {
    return this.request<Playlist>(`/playlists/${encodeURIComponent(id)}`);
  }

  public async createPlaylist(title: string, description?: string, artworkUrl?: string, tracks?: Track[]): Promise<Playlist> {
    return this.request<Playlist>('/playlists', {
      method: 'POST',
      body: JSON.stringify({ title, description, artworkUrl, tracks }),
    });
  }

  public async updatePlaylist(
    id: string,
    data: { title?: string; description?: string; artworkUrl?: string }
  ): Promise<Playlist> {
    return this.request<Playlist>(`/playlists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async deletePlaylist(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  public async addTrackToPlaylist(playlistId: string, track: Track): Promise<Playlist> {
    return this.request<Playlist>(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ track }),
    });
  }

  public async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<Playlist> {
    return this.request<Playlist>(
      `/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
      { method: 'DELETE' }
    );
  }

  public async reorderPlaylistTracks(playlistId: string, trackIds: string[]): Promise<Playlist> {
    return this.request<Playlist>(`/playlists/${encodeURIComponent(playlistId)}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ trackIds }),
    });
  }

  // Liked Tracks
  public async getLiked(): Promise<Track[]> {
    return this.request<Track[]>('/liked');
  }

  public async addLiked(track: Track): Promise<Track> {
    return this.request<Track>('/liked', {
      method: 'POST',
      body: JSON.stringify({ track }),
    });
  }

  public async removeLiked(trackId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/liked/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
    });
  }

  // History
  public async getHistory(limit = 50): Promise<HistoryItem[]> {
    return this.request<HistoryItem[]>(`/history?limit=${limit}`);
  }

  public async addHistory(track: Track): Promise<HistoryItem> {
    return this.request<HistoryItem>('/history', {
      method: 'POST',
      body: JSON.stringify({ track }),
    });
  }

  public async clearHistory(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/history', {
      method: 'DELETE',
    });
  }

  // Lyrics
  public async getLyrics(
    trackId: string,
    trackName?: string,
    artistName?: string,
    duration?: number
  ): Promise<LyricsData> {
    const params = new URLSearchParams();
    if (trackName) params.set('trackName', trackName);
    if (artistName) params.set('artistName', artistName);
    if (duration) params.set('duration', String(duration));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<LyricsData>(`/lyrics/${encodeURIComponent(trackId)}${qs}`);
  }

  public async getUserSummary(userId: string): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${encodeURIComponent(userId)}/summary`);
  }

  // Recommendations / Wave
  public async getRecommendations(
    limitOrOptions?:
      | number
      | {
          limit?: number;
          mood?: string;
          character?: string;
          language?: string;
          excludeTrackIds?: string[];
        }
  ): Promise<Track[]> {
    const params = new URLSearchParams();
    if (typeof limitOrOptions === 'number') {
      params.set('limit', String(limitOrOptions));
    } else if (limitOrOptions) {
      if (limitOrOptions.limit) params.set('limit', String(limitOrOptions.limit));
      if (limitOrOptions.mood) params.set('mood', limitOrOptions.mood);
      if (limitOrOptions.character) params.set('character', limitOrOptions.character);
      if (limitOrOptions.language) params.set('language', limitOrOptions.language);
      if (limitOrOptions.excludeTrackIds && limitOrOptions.excludeTrackIds.length > 0) {
        params.set('excludeTrackIds', limitOrOptions.excludeTrackIds.join(','));
      }
    }
    return this.request<Track[]>(`/recommendations?${params.toString()}`);
  }
}

export const apiClient = new ApiClient();
