/** Small JSON client for the public site API (/api/site/*). Errors carry the server message and field errors. */
export class SiteApiError extends Error {
  constructor(message: string, public status: number, public code = '', public fields: Record<string, string> = {}) { super(message); this.name = 'SiteApiError'; }
}
export async function siteApi<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/site${path}`, {
      method: init.method || 'GET', credentials: 'same-origin', signal: init.signal,
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new SiteApiError('Нет соединения с сервером. Проверь интернет и попробуй ещё раз.', 0, 'NETWORK');
  }
  const json = await response.json().catch(() => null) as { data?: T; error?: { message?: string; code?: string; fields?: Record<string, string> } } | null;
  if (!response.ok || !json) throw new SiteApiError(json?.error?.message || 'Сервер не ответил. Попробуй чуть позже.', response.status, json?.error?.code, json?.error?.fields);
  return json.data as T;
}

export type BetaConfig = { open: boolean; formToken: string; botUsername: string; channelUrl: string; limits: { min: number; max: number } };
export type ApplicationView = { number: string; status: 'pending' | 'approved' | 'rejected' | 'duplicate'; verified: boolean; telegramUsername: string; platforms: string[]; createdAt: string; reviewedAt: string | null; rejectionReason: string | null; verifyPending: boolean; verifyExpired: boolean };
export type Build = { id: string; variant: string; label: string; version: string; buildNumber: number; releaseDate: string; changelog: string; fileSize: number; checksum: string; availability: string; betaOnly: boolean; downloadUrl: string | null; requirements: string };
export type PlatformEntry = { platform: Platform; status: 'available' | 'beta' | 'development' | 'soon'; note: string; builds: Build[] };
export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web';
export type ReleaseCatalog = { platforms: PlatformEntry[]; betaAllowed: boolean; signedIn: boolean };

/** The applicant's secret status tokens live only in this browser; the server stores hashes. */
const KEY = 'oskolok_beta_applications';
export type SavedApplication = { token: string; number: string; savedAt: number };
export function savedApplications(): SavedApplication[] {
  try { const list = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(list) ? list.filter(a => typeof a?.token === 'string') : []; } catch { return []; }
}
export function saveApplication(entry: SavedApplication) {
  try { localStorage.setItem(KEY, JSON.stringify([entry, ...savedApplications().filter(a => a.token !== entry.token)].slice(0, 5))); } catch { /* Private mode keeps the link on screen only. */ }
}
export function forgetApplication(token: string) {
  try { localStorage.setItem(KEY, JSON.stringify(savedApplications().filter(a => a.token !== token))); } catch { /* Nothing stored. */ }
}
