import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cache: vi.fn(), save: vi.fn(), genius: vi.fn() }));
vi.mock('../server/src/database/client.js', () => ({ prisma: { lyricsCache: { findUnique: mocks.cache, upsert: mocks.save } } }));
vi.mock('../server/src/config/env.js', () => ({ env: { LYRICS_PROVIDER_URL: '' } }));
vi.mock('../server/src/services/SpicyLyricsService.js', () => ({ spicyLyricsService: { isConfigured: () => false } }));
vi.mock('../server/src/services/GeniusLyricsService.js', () => ({ geniusLyrics: mocks.genius }));
import { LyricsService } from '../server/src/services/LyricsService.js';

const fallback = { trackId: 't', isSynced: false, provider: 'Genius', plainLyrics: 'Our own lyric' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.cache.mockResolvedValue(null); mocks.save.mockResolvedValue({}); mocks.genius.mockResolvedValue(fallback);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
});

describe('lyrics catalogue fallbacks', () => {
  it('uses Genius only after the existing sources miss and caches its result', async () => {
    expect(await new LyricsService().getLyrics('t', 'Song', 'Artist', 120)).toEqual(fallback);
    expect(mocks.genius).toHaveBeenCalledWith('t', 'Artist', 'Song');
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('keeps a verified synced LRCLIB result ahead of Genius', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ trackName: 'Song', artistName: 'Artist', duration: 120, syncedLyrics: '[00:01.00]Our own lyric' }))));
    const result = await new LyricsService().getLyrics('t', 'Song', 'Artist', 120);
    expect(result?.provider).toBe('lrclib');
    expect(result?.syncedLyrics).toEqual([{ time: 1, text: 'Our own lyric' }]);
    expect(mocks.genius).not.toHaveBeenCalled();
  });
  it('continues to providers when the database cache is unavailable', async () => {
    mocks.cache.mockRejectedValue(new Error('Temporary database failure'));
    expect(await new LyricsService().getLyrics('t', 'Song', 'Artist')).toEqual(fallback);
  });
  it('shares simultaneous catalogue lookups', async () => {
    const service = new LyricsService();
    const a = service.getLyrics('t', 'Song', 'Artist'), b = service.getLyrics('t', 'Song', 'Artist');
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(mocks.genius).toHaveBeenCalledOnce();
  });
});
