import { create } from 'zustand';
import { Playlist, Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { useToastStore } from './useToastStore.js';

interface PlaylistState {
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
  isLoading: boolean;

  fetchPlaylists: () => Promise<void>;
  fetchPlaylistById: (id: string) => Promise<Playlist | null>;
  createPlaylist: (
    title: string,
    description?: string,
    artworkUrl?: string,
    tracks?: Track[]
  ) => Promise<Playlist | null>;
  updatePlaylist: (id: string, data: { title?: string; description?: string; artworkUrl?: string }) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  currentPlaylist: null,
  isLoading: false,

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
    set({ isLoading: true });
    try {
      const playlist = await apiClient.getPlaylist(id);
      set({ currentPlaylist: playlist, isLoading: false });
      return playlist;
    } catch {
      set({ isLoading: false });
      return null;
    }
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
    } catch {
      useToastStore.getState().addToast('Не удалось обновить плейлист', 'error');
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
