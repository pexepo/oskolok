import type { Platform } from './api.js';

export const PLATFORM_NAMES: Record<Platform, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iPhone', web: 'Веб' };
export const STATUS_NAMES = { available: 'Доступно', beta: 'Бета', development: 'В разработке', soon: 'Скоро' } as const;

/** Best guess of the visitor's device. A hint for the default tab only: the visitor can always pick another. */
export function detectPlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  const hinted = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform?.toLowerCase() || '';
  // iPadOS reports a Mac user agent; a touch screen gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua) || hinted === 'android') return 'android';
  if (/windows/i.test(ua) || hinted === 'windows') return 'windows';
  if (/macintosh|mac os x/i.test(ua) || hinted === 'macos') return 'macos';
  if (/linux|x11|cros/i.test(ua) || hinted === 'linux' || hinted === 'chrome os') return 'linux';
  return null;
}

export const formatSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
export const formatDate = (iso: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
