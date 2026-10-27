import {isAppShell} from '../utils/nativeShell.js';
import { create } from 'zustand';
import { useThemeStore } from '../stores/useThemeStore.js';
import { tr } from '../stores/useLanguageStore.js';
interface TelegramUser { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string }
interface MiniApp {
  initData: string; colorScheme: 'light'|'dark'; contentSafeAreaInset?: { top: number; bottom: number }; safeAreaInset?: { top: number; bottom: number };
  viewportStableHeight?:number; setHeaderColor?(color:string):void; setBackgroundColor?(color:string):void; setBottomBarColor?(color:string):void;
  ready(): void; expand(): void; openTelegramLink(url: string): void;
  requestWriteAccess?(callback: (granted: boolean) => void): void;
  onEvent(name: string, callback: () => void): void;
}
declare global { interface Window { Telegram?: { WebApp?: MiniApp } } }
export const useTelegramStore = create<{ user: TelegramUser|null; botUsername: string; profileExportAvailable: boolean; betaAllowed?:boolean; access?:string }>(() => ({ user: null, botUsername: 'oskolokplayerbot', profileExportAvailable: false }));
export const apiBase = location.protocol==='file:' ? (window as any).electronAPI?.apiBase || (import.meta as any).env?.VITE_API_URL || '/api' : (import.meta as any).env?.VITE_API_URL || '/api';
async function fetchTelegramSession(headers?: Record<string,string>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(`${apiBase}/telegram/session`, { credentials:'include', headers, signal:controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(tr('Сервер Осколка не отвечает. Проверьте соединение и попробуйте снова.', 'The Oskolok server is not responding. Check your connection and try again.'));
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
/** Profile of the last signed-in listener (no tokens): enough to open the player without a network. */
const OFFLINE_SESSION='oskolok-offline-session';
export const useOfflineMode=create<{offline:boolean}>(()=>({offline:false}));
function saveOfflineSession(data:{user?:TelegramUser|null;botUsername?:string;betaAllowed?:boolean}){
  try{if(data?.user&&data.betaAllowed!==false)localStorage.setItem(OFFLINE_SESSION,JSON.stringify({user:data.user,botUsername:data.botUsername,betaAllowed:true,profileExportAvailable:false}));else localStorage.removeItem(OFFLINE_SESSION);}catch{/* private mode */}
}
function readOfflineSession(){
  try{const s=JSON.parse(localStorage.getItem(OFFLINE_SESSION)||'null');return s?.user?.id?s:null;}catch{return null;}
}
export function telegramAuthHeaders(): Record<string,string> {
  const data = window.Telegram?.WebApp?.initData;
  return data ? { Authorization: `tma ${data}` } : {};
}
export async function initializeTelegram() {
  const expected = new URLSearchParams(location.hash.slice(1)).has('tgWebAppData') || new URLSearchParams(location.search).has('tgWebAppData');
  if (!expected && !window.Telegram?.WebApp?.initData) {
    let response:Response;
    try{response=await fetchTelegramSession();}
    catch(error){
      // No network: the last signed-in profile opens the player in offline mode with the downloaded music.
      const cached=readOfflineSession();
      // Only the installed apps start offline: the web has no offline mode.
      if(cached&&isAppShell()){useTelegramStore.setState(cached);useOfflineMode.setState({offline:true});return;}
      throw error;
    }
    const json=await response.json();
    if (!response.ok) throw new Error(json.error?.message||tr('Не удалось подключиться к серверу Осколка. Попробуйте снова.', 'Could not connect to the Oskolok server. Try again.'));
    useTelegramStore.setState(json.data);
    saveOfflineSession(json.data);
    return;
  }
  if (!window.Telegram?.WebApp) await new Promise<void>((resolve,reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error(tr('Telegram SDK не загрузился. Откройте приложение заново.', 'Telegram SDK failed to load. Reopen the app.'))),10000);
    script.src = '/vendor/telegram-web-app.js';
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error(tr('Не удалось загрузить Telegram SDK.', 'Could not load Telegram SDK.'))); };
    document.head.appendChild(script);
  });
  const app = window.Telegram?.WebApp;
  // Telegram keeps its native loading overlay visible until ready() is called.
  // Release it before network authentication so a slow or failed session
  // request shows the app's own loading/error state instead of a stuck window.
  try { app?.ready(); app?.expand(); } catch { /* Continue to show a useful error below. */ }
  if (!app?.initData) throw new Error(tr('Нет сессии Telegram. Откройте приложение через бота.', 'No Telegram session. Open the app through the bot.'));
  const response = await fetchTelegramSession(telegramAuthHeaders());
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || tr('Не удалось подтвердить Telegram-профиль.', 'Could not verify the Telegram profile.'));
  useTelegramStore.setState(json.data);
  const updateInsets = () => {
    if(app.viewportStableHeight&&app.viewportStableHeight>0)document.documentElement.style.setProperty('--app-viewport-height',`${app.viewportStableHeight}px`);
    document.documentElement.style.setProperty('--tg-content-top', `${Math.max(0,app.contentSafeAreaInset?.top || 0) + Math.max(0,app.safeAreaInset?.top || 0)}px`);
    document.documentElement.style.setProperty('--tg-content-bottom', `${Math.max(0,app.contentSafeAreaInset?.bottom || 0) + Math.max(0,app.safeAreaInset?.bottom || 0)}px`);
  };
  document.documentElement.classList.add('telegram-mini-app');
  updateInsets();
  app.onEvent('viewportChanged',updateInsets);
  app.onEvent('safeAreaChanged', updateInsets); app.onEvent('contentSafeAreaChanged', updateInsets);
  if (!localStorage.getItem('oskolok_theme')) useThemeStore.getState().setTheme(app.colorScheme);
  const chrome=()=>{const color=useThemeStore.getState().isDark?'#101b2b':'#eef4fb';try{app.setHeaderColor?.(color);app.setBackgroundColor?.(color);app.setBottomBarColor?.(color);}catch{/* Older Telegram clients keep their native theme. */}};
  chrome();useThemeStore.subscribe(chrome);
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
  if (!granted) throw new Error(tr('Разрешите боту прислать выбранный трек в личный чат.', 'Allow the bot to send the selected track to your private chat.'));
}

export function scopedStorageKey(key: string): string {
  const user = useTelegramStore.getState().user;
  return user ? `telegram:${user.id}:${key}` : key;
}
