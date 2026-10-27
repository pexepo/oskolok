import { telegramAuthHeaders, useTelegramStore, apiBase } from '../telegram/runtime.js';
import { tr } from '../stores/useLanguageStore.js';
import { getRecording } from '../utils/playbackPreferences.js';
import {
  SearchResult,
  Track,
  PlaybackInfo,
  Artist,
  Playlist,
  LyricsData,
  HistoryItem,
  HealthStatus,
  ImportPreview, Release, ArtistDetails, GeniusRelease, TrackPopularity,
  UserSummary,
} from '../types/index.js';
import type { GeniusAnnotationSet } from '../utils/geniusAnnotations.js';

export class ApiError extends Error {
  public code: string;
  public details?: any;
  public status?: number;

  constructor(message: string, code: string = 'UNKNOWN_ERROR', details?: any, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

class ApiClient {
  public previewImport(url:string):Promise<ImportPreview>{return this.request('/imports/preview',{method:'POST',body:JSON.stringify({url})});}
  public matchImport(artist:string,title:string):Promise<{track:Track|null;candidates:Track[]}>{return this.request('/imports/match',{method:'POST',body:JSON.stringify({artist,title})});}
  public suggestions(q:string,signal?:AbortSignal):Promise<SearchResult>{return this.request(`/suggestions?q=${encodeURIComponent(q)}`,{signal});}
  public getRelease(id:string):Promise<Release>{return this.request(`/releases/${encodeURIComponent(id)}`);}
  public getArtistDetails(id:string,from?:string):Promise<ArtistDetails>{return this.request(`/artists/${encodeURIComponent(id)}/details${from?`?from=${encodeURIComponent(from)}`:''}`);}
  public getTrackPopularity(artist:string,tracks:Array<{id:string;title:string;artistId?:string}>):Promise<Record<string,TrackPopularity|null>>{return this.request('/artists/popularity',{method:'POST',body:JSON.stringify({artist,tracks})});}
  public getGeniusRelease(artist:string,title:string):Promise<GeniusRelease|null>{return this.request(`/releases/genius?${new URLSearchParams({artist,title})}`);}
  private baseUrl = apiBase;

  public getStreamUrl(trackId: string, source?: string, recordingPreview = false): string {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    const recording=recordingPreview?undefined:getRecording(trackId,source);if(recording)params.set('recording',recording);
    if(recordingPreview)params.set('exact','1');
    const suffix = params.size ? `?${params}` : '';
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

      const text = await response.text();
      let json:any;try{json=text?JSON.parse(text):{};}catch{json={error:{message:response.ok?tr('Некорректный ответ сервера', 'Invalid server response'):`Ошибка сервера (${response.status})`}};}

      if (!response.ok) {
        if(response.status===401)useTelegramStore.setState({user:null});
        const errObj = json.error || {};
        if(errObj.code==='BETA_ACCESS_DENIED')useTelegramStore.setState({betaAllowed:false,access:'beta_denied'});
        throw new ApiError(
          errObj.message || `HTTP ${response.status} Error`,
          errObj.code || `HTTP_${response.status}`,
          errObj.details,
          response.status
        );
      }

      return (endpoint==='/health'?json:json.data) as T;
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

  public async addTrackToTelegramProfile(trackId:string):Promise<{status:string}>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),300000);
    try{return await this.request('/telegram/profile-music',{method:'POST',body:JSON.stringify({trackId}),signal:controller.signal});}
    catch(error){
      if(controller.signal.aborted)throw new ApiError(tr('Сервер не подтвердил добавление. Проверьте музыку в Telegram-профиле перед повторной попыткой.','The server did not confirm the addition. Check your Telegram profile music before retrying.'),'PROFILE_MUSIC_TIMEOUT');
      throw error;
    }finally{clearTimeout(timer);}
  }

  public async downloadTrack(track: Track): Promise<void> {
    const response = await fetch(`${this.baseUrl}/tracks/${encodeURIComponent(track.id)}/download`, { credentials: 'include', headers: telegramAuthHeaders() });
    if (!response.ok) { const json = await response.json(); throw new Error(json.error?.message || tr('Не удалось подготовить аудиофайл.', 'Could not prepare the audio file.')); }
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

  public async prefetchTrack(id: string, mix = false): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/tracks/prefetch`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...telegramAuthHeaders() },
        body: JSON.stringify(mix ? { trackId: id, mix: true } : { trackId: id }),
      });
    } catch {
      // Non-blocking prefetch failure
    }
  }

  public async getArtist(id: string): Promise<Artist> {
    return this.request<Artist>(`/artists/${encodeURIComponent(id)}`);
  }

  public async getArtistTracks(id: string, page = 1, limit = 20, from?: string): Promise<Track[]> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), ...(from ? { from } : {}) });
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
    data: { title?: string; description?: string; artworkUrl?: string; isPublic?: boolean }
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

  /** Appends up to 500 tracks in one request. */
  public addTracksToPlaylist(playlistId: string, tracks: Track[]): Promise<{ added: number; total: number }> {
    return this.request(`/playlists/${encodeURIComponent(playlistId)}/tracks`, { method: 'POST', body: JSON.stringify({ tracks }) });
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
    duration?: number,
    signal?: AbortSignal,
    source?: string
  ): Promise<LyricsData> {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (trackName) params.set('trackName', trackName);
    if (artistName) params.set('artistName', artistName);
    if (duration) params.set('duration', String(duration));
    const qs = params.toString() ? `?${params.toString()}` : '';
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await this.request<LyricsData>(`/lyrics/${encodeURIComponent(trackId)}${qs}`, { signal });
        if (!data || typeof data.provider !== 'string') throw new ApiError('Invalid lyrics response', 'INVALID_RESPONSE');
        return data;
      } catch (error) {
        if (signal?.aborted || attempt >= 2 || !(error instanceof ApiError) || !([429, 502, 503, 504].includes(error.status || 0) || ['UNKNOWN_ERROR', 'INVALID_RESPONSE'].includes(error.code))) throw error;
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
          const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 350 * (attempt + 1));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      }
    }
  }

  public async translateLyrics(lines:string[],target:string,signal?:AbortSignal):Promise<{translations:string[];source:string;sameLanguage:boolean}>{
    const parts:Array<{translations:string[];source:string;sameLanguage:boolean}>=[];
    for(let at=0;at<lines.length;at+=400)parts.push(await this.request(`/lyrics/translate`,{method:'POST',body:JSON.stringify({lines:lines.slice(at,at+400),target}),signal}));
    return {translations:parts.flatMap(p=>p.translations),source:parts[0]?.source||'auto',sameLanguage:parts.length>0&&parts.every(p=>p.sameLanguage)};
  }
  public getLyricsAnnotations(trackId:string,trackName:string,artistName:string,signal?:AbortSignal):Promise<GeniusAnnotationSet>{return this.request<GeniusAnnotationSet>(`/lyrics/${encodeURIComponent(trackId)}/annotations?${new URLSearchParams({trackName,artistName})}`,{signal});}

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
