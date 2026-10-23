import { create } from 'zustand';
import type { LyricsAuthor } from '../types/index.js';

/** What the caller already knows about the author, shown instantly while the summary loads. */
export type AuthorCardPreview = Partial<Omit<LyricsAuthor, 'id'>> & { id: string; label?: string };

interface AuthorCardState {
  author: AuthorCardPreview | null;
  open: (author: AuthorCardPreview | string) => void;
  close: () => void;
}

export const useAuthorCardStore = create<AuthorCardState>((set) => ({
  author: null,
  open: (author) => set({ author: typeof author === 'string' ? { id: author } : author }),
  close: () => set({ author: null }),
}));

export const openAuthorCard = (author: AuthorCardPreview | string) => useAuthorCardStore.getState().open(author);
export const closeAuthorCard = () => useAuthorCardStore.getState().close();
