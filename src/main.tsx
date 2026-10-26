import { isAppPath, isSitePath, redirectTarget } from './routing.js';
import { captureDiscordRedirect } from './discord/capture.js';

const container = document.getElementById('root')!;
const read = (fn: () => boolean) => { try { return fn(); } catch { return false; } };
const fileMode = location.protocol === 'file:';

if (fileMode) {
  // Desktop fallback build: hash routing, player only.
  void import('./appEntry.js').then(m => m.startApp(container));
} else {
  // Back from Discord: stay in the player, whatever this browser usually opens.
  const fromDiscord = captureDiscordRedirect();
  const target = fromDiscord ? null : redirectTarget(location.pathname, location.search, location.hash, {
    userAgent: navigator.userAgent,
    search: location.search,
    hash: location.hash,
    standalone: read(() => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true),
    // The dev shell exposes electronAPI, the shipped EXE/DMG exposes oskolokDesktop; both open the player.
    electron: read(() => { const w = window as unknown as { electronAPI?: unknown; oskolokDesktop?: unknown }; return !!(w.electronAPI || w.oskolokDesktop) || /\bElectron\//.test(navigator.userAgent); }),
    telegram: read(() => !!(window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData),
    reload: read(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'),
    appSeen: read(() => localStorage.getItem('oskolok_app_seen') === '1'),
    siteSeenThisTab: read(() => sessionStorage.getItem('oskolok_site_seen') === '1'),
  });
  if (target) history.replaceState(history.state, '', target);
  if (isSitePath(location.pathname) && !isAppPath(location.pathname)) void import('./site/siteEntry.js').then(m => m.startSite(container));
  else void import('./appEntry.js').then(m => m.startApp(container));
}
