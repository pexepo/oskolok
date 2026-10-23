/** Registers the offline shell (public/sw.js). Production web only: no dev server, no file:// desktop fallback. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* The site works without it. */ });
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
}
