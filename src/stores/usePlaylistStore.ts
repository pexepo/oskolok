import { create } from 'zustand';
import { libraryActions } from '../telemetry/bus.js';
import { Playlist, Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { useToastStore } from './useToastStore.js';

interface PlaylistState {
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
  isLoading: boolean;
  isPlaylistLoading: boolean;
  playlistError: string;

  fetchPlaylists: () => Promise<void>;
  fetchPlaylistById: (id: string) => Promise<Playlist | null>;
  createPlaylist: (
    title: string,
    description?: string,
    artworkUrl?: string,
    tracks?: Track[]
  ) => Promise<Playlist | null>;
  updatePlaylist: (id: string, data: { title?: string; description?: string; artworkUrl?: string; isPublic?: boolean }) => Promise<boolean>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
}

let playlistRequest=0;
export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  isLoading: false,
  isPlaylistLoading:false,playlistError:'',

  fetchPlaylists: async () => {
    set({ isLoading: true });
    try {
      const playlists = await apiClient.getPlaylists();
      set({ playlists, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchPlaylistById: async (id: string) => {
    const request=++playlistRequest;
    set({isPlaylistLoading:true,playlistError:'',currentPlaylist:null});
    try{
      const playlist=await apiClient.getPlaylist(id);
      if(request===playlistRequest)set({currentPlaylist:playlist,isPlaylistLoading:false});
      return playlist;
    }catch(e){if(request===playlistRequest)set({isPlaylistLoading:false,playlistError:(e as Error).message||'Не удалось загрузить плейлист'});return null;}
  },

  createPlaylist: async (title, description, artworkUrl, tracks) => {
    try {
      const newPl = await apiClient.createPlaylist(title, description, artworkUrl, tracks);
      set((state) => ({ playlists: [newPl, ...state.playlists] }));
      useToastStore.getState().addToast(`Плейлист "${title}" добавлен в коллекцию`, 'success');
      return newPl;
    } catch {
      useToastStore.getState().addToast('Ошибка сохранения плейлиста', 'error');
      return null;
    }
  },

  updatePlaylist: async (id, data) => {
    try {
      const updated = await apiClient.updatePlaylist(id, data);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === id ? updated : p)),
        currentPlaylist: state.currentPlaylist?.id === id ? updated : state.currentPlaylist,
      }));
      useToastStore.getState().addToast('Плейлист обновлен', 'success');
      return true;
    } catch {
      useToastStore.getState().addToast('Не удалось обновить плейлист', 'error');
      return false;
    }
  },

  deletePlaylist: async (id) => {
    try {
      await apiClient.deletePlaylist(id);
      set((state) => ({
        playlists: state.playlists.filter((p) => p.id !== id),
        currentPlaylist: state.currentPlaylist?.id === id ? null : state.currentPlaylist,
      }));
      useToastStore.getState().addToast('Плейлист удален', 'info');
    } catch {
      useToastStore.getState().addToast('Не удалось удалить плейлист', 'error');
    }
  },

  addTrackToPlaylist: async (playlistId, track) => {
    libraryActions.emit('playlist_add', track, undefined, `playlist:${playlistId}`);
    try {
      const updated = await apiClient.addTrackToPlaylist(playlistId, track);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === playlistId ? updated : p)),
        currentPlaylist: state.currentPlaylist?.id === playlistId ? updated : state.currentPlaylist,
      }));
      useToastStore.getState().addToast(`Добавлено в плейлист "${updated.title}"`, 'success');
    } catch {
      useToastStore.getState().addToast('Не удалось добавить трек в плейлист', 'error');
    }
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    { const playlist = (Array.isArray(get().playlists) ? get().playlists : []).find(p => p.id === playlistId), item = playlist?.tracks?.find(x => x.track.id === trackId || x.trackId === trackId); libraryActions.emit('playlist_remove', item?.track || { id: trackId, artist: { id: '', name: '' } as never }, undefined, `playlist:${playlistId}`); }
    try {
      const updated = await apiClient.removeTrackFromPlaylist(playlistId, trackId);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === playlistId ? updated : p)),
        currentPlaylist: state.currentPlaylist?.id === playlistId ? updated : state.currentPlaylist,
      }));
      useToastStore.getState().addToast('Трек удален из плейлиста', 'info');
    } catch {
      useToastStore.getState().addToast('Не удалось удалить трек', 'error');
    }
  },

  reorderPlaylistTracks: async (playlistId, trackIds) => {
    // Optimistic UI update
    const current = get().currentPlaylist;
    if (current && current.id === playlistId && current.tracks) {
      const trackMap = new Map(current.tracks.map((item) => [item.trackId, item]));
      const newTracks = trackIds
        .map((tId, idx) => {
          const item = trackMap.get(tId);
          return item ? { ...item, position: idx } : null;
        })
        .filter(Boolean) as any;

      set({
        currentPlaylist: { ...current, tracks: newTracks },
      });
    }

    try {
      const updated = await apiClient.reorderPlaylistTracks(playlistId, trackIds);
      set((state) => ({
        playlists: state.playlists.map((p) => (p.id === playlistId ? updated : p)),
        currentPlaylist: state.currentPlaylist?.id === playlistId ? updated : state.currentPlaylist,
      }));
    } catch {
      // Rollback on error by refetching
      get().fetchPlaylistById(playlistId);
      useToastStore.getState().addToast('Не удалось сохранить новый порядок', 'error');
    }
  },
}));
