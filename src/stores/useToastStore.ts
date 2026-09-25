import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastStoreState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  addToast: (message, type = 'info', duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    set((state) => {
      // Prevent spamming identical toast messages
      if (state.toasts.some((t) => t.message === message)) {
        return state;
      }
      // Keep at most 3 simultaneous toasts on screen
      const limited = state.toasts.length >= 3 ? state.toasts.slice(-2) : state.toasts;
      return {
        toasts: [...limited, { id, message, type, duration }],
      };
    });

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
