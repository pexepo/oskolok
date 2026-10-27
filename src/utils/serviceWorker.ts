import {isAppShell} from './nativeShell.js';

/**
 * Registers the offline shell (public/sw.js) inside the installed apps only: without internet they open the player with
 * the downloaded music. The web has no offline mode: a browser without network shows its own error, so the worker
 * and every cache a previous version left there (shell, assets, downloaded audio) are removed.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  if (!isAppShell()) { void dropWebOffline(); return; }
  if (!import.meta.env.PROD) return;
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* The app works without it. */ });
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
}

async function dropWebOffline() {
  try {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    if (typeof caches !== 'undefined') for (const key of await caches.keys()) if (key.startsWith('oskolok-') || key.startsWith('osk-offline-')) await caches.delete(key);
    for (let i = localStorage.length - 1; i >= 0; i--) { const key = localStorage.key(i); if (key?.includes('offline-index')) localStorage.removeItem(key); }
  } catch { /* nothing to remove */ }
}
