import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const getInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('oskolok_theme') as ThemeMode;
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  return 'light';
};

const resolveIsDark = (theme: ThemeMode): boolean => {
  if (typeof window === 'undefined') return false;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const applyThemeToDOM = (isDark: boolean) => {
  if (typeof document === 'undefined') return;
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }

  // Notify Electron to update window titleBarOverlay symbol color
  if (typeof window !== 'undefined' && (window as any).electronAPI?.setTitleBarOverlay) {
    try {
      (window as any).electronAPI.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: isDark ? '#e2e8f0' : '#162b50',
        height: 34,
      });
    } catch {
      // ignore
    }
  }
};

const initialTheme = getInitialTheme();
const initialIsDark = resolveIsDark(initialTheme);
applyThemeToDOM(initialIsDark);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  isDark: initialIsDark,

  setTheme: (theme: ThemeMode) => {
    const isDark = resolveIsDark(theme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('oskolok_theme', theme);
    }
    applyThemeToDOM(isDark);
    set({ theme, isDark });
  },

  toggleTheme: () => {
    const nextTheme: ThemeMode = get().isDark ? 'light' : 'dark';
    get().setTheme(nextTheme);
  },
}));

// Listen to system changes if theme is 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (useThemeStore.getState().theme === 'system') {
      const isDark = e.matches;
      applyThemeToDOM(isDark);
      useThemeStore.setState({ isDark });
    }
  });
}
