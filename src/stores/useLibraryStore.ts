import { scopedStorageKey } from '../telegram/runtime.js';
import { libraryActions } from '../telemetry/bus.js';
import { create } from 'zustand';
import { Track } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { useToastStore } from './useToastStore.js';
import { recordingKey } from '../utils/recordingKey.js';

interface LibraryState {
  likedTracks: Track[];
  likedTrackIds: Set<string>;
  isLoading: boolean;

  fetchLiked: () => Promise<void>;
  toggleLike: (track: Track) => Promise<void>;
  /** Likes every track not liked yet; returns how many were added. */
  likeAll: (tracks: Track[]) => Promise<number>;
  /** By id, or — given the track — by recording, so a song liked from another catalogue still reads as liked. */
  isLiked: (track: string | Track) => boolean;
  likedKeys: Map<string, string>;
  reorderLikedTracks: (newTracks: Track[]) => void;
}

const keysOf = (tracks: Track[]) => new Map(tracks.map(t => [recordingKey(t), t.id] as [string, string]).filter(([key]) => key));

export const useLibraryStore = create<LibraryState>((set, get) => ({
  likedTracks: [],
  likedTrackIds: new Set<string>(),
  likedKeys: new Map<string, string>(),
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

      set({ likedTracks: orderedTracks, likedTrackIds: ids, likedKeys: keysOf(orderedTracks), isLoading: false });
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

  toggleLike: async (input: Track) => {
    // A song liked through another catalogue is unliked through the stored copy.
    const twin = get().likedTrackIds.has(input.id) ? undefined : get().likedKeys.get(recordingKey(input));
    const track = twin ? get().likedTracks.find(t => t.id === twin) || input : input;
    const isCurrentlyLiked = get().likedTrackIds.has(track.id);
    libraryActions.emit(isCurrentlyLiked ? 'unlike' : 'like', track);

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

  likeAll: async (tracks: Track[]) => {
    const fresh = [...new Map(tracks.filter(t => t?.id && !get().isLiked(t)).map(t => [t.id, t])).values()];
    if (!fresh.length) { useToastStore.getState().addToast('Все треки уже в Избранном', 'info'); return 0; }
    set({ likedTracks: [...fresh, ...get().likedTracks], likedTrackIds: new Set([...get().likedTrackIds, ...fresh.map(t => t.id)]) });
    const failed: Track[] = [];
    // A few at a time: a 300-track playlist must not open 300 requests at once.
    for (let i = 0; i < fresh.length; i += 4) {
      const batch = fresh.slice(i, i + 4);
      const results = await Promise.allSettled(batch.map(t => apiClient.addLiked(t)));
      results.forEach((r, j) => { if (r.status === 'rejected') failed.push(batch[j]); });
    }
    if (failed.length) {
      const lost = new Set(failed.map(t => t.id));
      set({ likedTracks: get().likedTracks.filter(t => !lost.has(t.id)), likedTrackIds: new Set([...get().likedTrackIds].filter(id => !lost.has(id))) });
    }
    const added = fresh.length - failed.length;
    useToastStore.getState().addToast(failed.length ? `В Избранное: ${added}, не удалось: ${failed.length}` : `В Избранное добавлено треков: ${added}`, failed.length ? 'error' : 'success');
    return added;
  },

  isLiked: (track: string | Track) => {
    if (typeof track === 'string') return get().likedTrackIds.has(track);
    if (get().likedTrackIds.has(track.id)) return true;
    const key = recordingKey(track);
    return Boolean(key && get().likedKeys.has(key));
  },
}));

// likedKeys follows likedTracks through optimistic updates and rollbacks alike.
useLibraryStore.subscribe((state, previous) => {
  if (state.likedTracks !== previous.likedTracks) useLibraryStore.setState({ likedKeys: keysOf(state.likedTracks) });
});
