import { create } from 'zustand';
import { useThemeStore } from '../stores/useThemeStore.js';
interface TelegramUser { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string }
interface MiniApp {
  initData: string; colorScheme: 'light'|'dark'; contentSafeAreaInset?: { top: number; bottom: number }; safeAreaInset?: { top: number; bottom: number };
  ready(): void; expand(): void; openTelegramLink(url: string): void;
  requestWriteAccess?(callback: (granted: boolean) => void): void;
  onEvent(name: string, callback: () => void): void;
}
declare global { interface Window { Telegram?: { WebApp?: MiniApp } } }
export const useTelegramStore = create<{ user: TelegramUser|null; botUsername: string; profileExportAvailable: boolean }>(() => ({ user: null, botUsername: 'oskolokplayerbot', profileExportAvailable: false }));
export const apiBase = location.protocol==='file:' ? 'http://127.0.0.1:5000/api' : (import.meta as any).env?.VITE_API_URL || '/api';
async function fetchTelegramSession(headers?: Record<string,string>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(`${apiBase}/telegram/session`, { credentials:'include', headers, signal:controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Сервер Осколка не отвечает. Проверьте соединение и попробуйте снова.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
export function telegramAuthHeaders(): Record<string,string> {
  const data = window.Telegram?.WebApp?.initData;
  return data ? { Authorization: `tma ${data}` } : {};
}
export async function initializeTelegram() {
  const expected = new URLSearchParams(location.hash.slice(1)).has('tgWebAppData') || new URLSearchParams(location.search).has('tgWebAppData');
  if (!expected && !window.Telegram?.WebApp?.initData) {
    const response=await fetchTelegramSession();
    if (!response.ok) throw new Error('Не удалось подключиться к серверу Осколка. Попробуйте снова.');
    const json=await response.json();
    useTelegramStore.setState(json.data);
    return;
  }
  if (!window.Telegram?.WebApp) await new Promise<void>((resolve,reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error('Telegram SDK не загрузился. Откройте приложение заново.')),10000);
    script.src = '/vendor/telegram-web-app.js';
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось загрузить Telegram SDK.')); };
    document.head.appendChild(script);
  });
  const app = window.Telegram?.WebApp;
  // Telegram keeps its native loading overlay visible until ready() is called.
  // Release it before network authentication so a slow or failed session
  // request shows the app's own loading/error state instead of a stuck window.
  try { app?.ready(); app?.expand(); } catch { /* Continue to show a useful error below. */ }
  if (!app?.initData) throw new Error('Нет сессии Telegram. Откройте приложение через бота.');
  const response = await fetchTelegramSession(telegramAuthHeaders());
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || 'Не удалось подтвердить Telegram-профиль.');
  useTelegramStore.setState(json.data);
  const updateInsets = () => {
    document.documentElement.style.setProperty('--tg-content-top', `${Math.max(app.contentSafeAreaInset?.top || 0, app.safeAreaInset?.top || 0)}px`);
    document.documentElement.style.setProperty('--tg-content-bottom', `${Math.max(app.contentSafeAreaInset?.bottom || 0, app.safeAreaInset?.bottom || 0)}px`);
  };
  document.documentElement.classList.add('telegram-mini-app');
  updateInsets();
  app.onEvent('safeAreaChanged', updateInsets); app.onEvent('contentSafeAreaChanged', updateInsets);
  if (!localStorage.getItem('oskolok_theme')) useThemeStore.getState().setTheme(app.colorScheme);
}
export function openTelegramChat() {
  const url = `https://t.me/${useTelegramStore.getState().botUsername}`;
  if (window.Telegram?.WebApp?.initData) window.Telegram.WebApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
export async function requestBotWriteAccess() {
  const app = window.Telegram?.WebApp;
  if (!app?.requestWriteAccess) return;
  const granted = await new Promise<boolean>(resolve => app.requestWriteAccess!(resolve));
  if (!granted) throw new Error('Разрешите боту прислать выбранный трек в личный чат.');
}

export function scopedStorageKey(key: string): string {
  const user = useTelegramStore.getState().user;
  return user ? `telegram:${user.id}:${key}` : key;
}
