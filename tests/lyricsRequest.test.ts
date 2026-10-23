import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/telegram/runtime.js', () => ({ apiBase: '/api', telegramAuthHeaders: () => ({}), useTelegramStore: { setState: vi.fn() } }));
vi.mock('../src/stores/useLanguageStore.js', () => ({ tr: (ru: string) => ru }));
vi.mock('../src/utils/playbackPreferences.js', () => ({ getLosslessPreferred: () => false }));
import { apiClient } from '../src/api/apiClient.js';

const data = { trackId: 't', provider: 'Genius', isSynced: false, plainLyrics: 'Our own lyric' };
const success = () => new Response(JSON.stringify({ data }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retries a temporary HTTP error regardless of its application error code', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UPSTREAM_FAILURE' } }), { status: 503 })).mockResolvedValueOnce(success());
  vi.stubGlobal('fetch', fetcher);
  const result = apiClient.getLyrics('t', 'Song', 'Artist');
  await vi.runAllTimersAsync();
  expect(await result).toEqual(data);expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not retry authentication failures', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(apiClient.getLyrics('t')).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('cancels a pending retry when the view changes track or closes', async () => {
  const controller = new AbortController(), fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetcher);
  const result = apiClient.getLyrics('t', 'Song', 'Artist', 120, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejected;await vi.runAllTimersAsync();
  expect(fetcher).toHaveBeenCalledOnce();
});
