import type { Track } from '../types/index.js';
/** Explicit library actions (not list loads), reported by the stores where the user acted. */
type LibraryAction = 'like' | 'unlike' | 'playlist_add' | 'playlist_remove' | 'open_release' | 'open_artist' | 'select' | 'impression' | 'speed_change';
const listeners = new Set<(action: LibraryAction, track: Pick<Track, 'id' | 'artist'>, data?: Record<string, unknown>, context?: string) => void>();
export const libraryActions = {
  emit(action: LibraryAction, track: Pick<Track, 'id' | 'artist'> | null | undefined, data?: Record<string, unknown>, context?: string) { if (track) listeners.forEach(fn => fn(action, track, data, context)); },
  on(fn: (action: LibraryAction, track: Pick<Track, 'id' | 'artist'>, data?: Record<string, unknown>, context?: string) => void) { listeners.add(fn); return () => listeners.delete(fn); },
};
