import { scopedStorageKey } from '../telegram/runtime.js';
import { create } from 'zustand';
import { Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { useToastStore } from './useToastStore.js';

interface LibraryState {
  likedTracks: Track[];
  likedTrackIds: Set<string>;
  isLoading: boolean;

  fetchLiked: () => Promise<void>;
  toggleLike: (track: Track) => Promise<void>;
  isLiked: (trackId: string) => boolean;
  reorderLikedTracks: (newTracks: Track[]) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  likedTracks: [],
  likedTrackIds: new Set<string>(),
  isLoading: false,

  fetchLiked: async () => {
    set({ isLoading: true });
    try {
      const tracks = await apiClient.getLiked();
      const ids = new Set(tracks.map((t) => t.id));

      let orderedTracks = tracks;
      try {
        const savedOrder = JSON.parse(localStorage.getItem(scopedStorageKey('liked_tracks_order')) || '[]');
        if (Array.isArray(savedOrder) && savedOrder.length > 0) {
          const orderMap = new Map<string, number>();
          savedOrder.forEach((id, idx) => orderMap.set(id, idx));
          orderedTracks = [...tracks].sort((a, b) => {
            const posA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
            const posB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
            return posA - posB;
          });
        }
      } catch {}

      set({ likedTracks: orderedTracks, likedTrackIds: ids, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  reorderLikedTracks: (newTracks: Track[]) => {
    set({ likedTracks: newTracks });
    try {
      const order = newTracks.map((t) => t.id);
      localStorage.setItem(scopedStorageKey('liked_tracks_order'), JSON.stringify(order));
    } catch {}
  },

  toggleLike: async (track: Track) => {
    const isCurrentlyLiked = get().likedTrackIds.has(track.id);

    // Optimistic UI update
    if (isCurrentlyLiked) {
      const updatedTracks = get().likedTracks.filter((t) => t.id !== track.id);
      const updatedIds = new Set(get().likedTrackIds);
      updatedIds.delete(track.id);
      set({ likedTracks: updatedTracks, likedTrackIds: updatedIds });
      useToastStore.getState().addToast('Удалено из Избранного', 'info');

      try {
        await apiClient.removeLiked(track.id);
      } catch {
        // Rollback on error
        set({
          likedTracks: [...get().likedTracks, track],
          likedTrackIds: new Set([...get().likedTrackIds, track.id]),
        });
        useToastStore.getState().addToast('Не удалось обновить Избранное', 'error');
      }
    } else {
      const updatedTracks = [track, ...get().likedTracks];
      const updatedIds = new Set(get().likedTrackIds);
      updatedIds.add(track.id);
      set({ likedTracks: updatedTracks, likedTrackIds: updatedIds });
      useToastStore.getState().addToast('Добавлено в Избранное', 'success');

      try {
        await apiClient.addLiked(track);
      } catch {
        // Rollback on error
        const rolledBack = get().likedTracks.filter((t) => t.id !== track.id);
        const rolledIds = new Set(get().likedTrackIds);
        rolledIds.delete(track.id);
        set({ likedTracks: rolledBack, likedTrackIds: rolledIds });
        useToastStore.getState().addToast('Не удалось обновить Избранное', 'error');
      }
    }
  },

  isLiked: (trackId: string) => {
    return get().likedTrackIds.has(trackId);
  },
}));
