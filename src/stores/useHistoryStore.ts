import { create } from 'zustand';
import { HistoryItem } from '../types/index.js';
import { apiClient } from '../api/apiClient.js';
import { useToastStore } from './useToastStore.js';

interface HistoryState {
  history: HistoryItem[];
  isLoading: boolean;

  fetchHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  history: [],
  isLoading: false,

  fetchHistory: async () => {
    set({ isLoading: true });
    try {
      const items = await apiClient.getHistory();
      set({ history: items, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  clearHistory: async () => {
    try {
      await apiClient.clearHistory();
      set({ history: [] });
      useToastStore.getState().addToast('История прослушиваний очищена', 'info');
    } catch {
      useToastStore.getState().addToast('Не удалось очистить историю', 'error');
    }
  },
}));
