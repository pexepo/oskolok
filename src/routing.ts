/** Where a URL belongs: the public site (landing, beta, downloads) or the player under /app.
 * Kept free of React so main.tsx can decide before loading either bundle. */
export const APP_BASE = '/app';
const SITE_PATHS = new Set(['/', '/beta', '/beta/status', '/download', '/download/ios', '/download/android', '/download/desktop', '/privacy']);

export function normalizePath(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}
export const isSitePath = (pathname: string) => SITE_PATHS.has(normalizePath(pathname));
export const isAppPath = (pathname: string) => pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`);

type Env = { userAgent: string; search: string; hash: string; standalone: boolean; electron: boolean; telegram: boolean; reload: boolean; appSeen: boolean; siteSeenThisTab: boolean };

/** Native shells, Telegram Mini Apps and installed PWAs open «/»: they always mean the player. */
export function opensPlayerAtRoot(env: Env) {
  if (env.electron || env.telegram || env.standalone) return true;
  if (/\bOskolok(Android|IOS)\//.test(env.userAgent)) return true;
  if (/tgWebAppData|tgWebAppPlatform/.test(env.search + env.hash)) return true;
  // A tab opened before the player moved to /app reloads itself on «/» after an update.
  return env.reload && env.appSeen && !env.siteSeenThisTab;
}

/** Returns the URL to switch to, or null to stay. Old player links (/search, /track/…, /users/…) keep working. */
export function redirectTarget(pathname: string, search: string, hash: string, env: Env): string | null {
  const path = normalizePath(pathname);
  if (isAppPath(pathname)) return null;
  if (path === '/') return opensPlayerAtRoot(env) ? `${APP_BASE}${search}${hash}` : null;
  if (isSitePath(path)) return path !== pathname ? `${path}${search}${hash}` : null;
  if (/^\/(api|downloads|assets)(\/|$)/.test(path)) return null;
  return `${APP_BASE}${path}${search}${hash}`;
}
