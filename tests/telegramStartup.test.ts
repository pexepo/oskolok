import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/stores/useThemeStore.js', () => ({
  useThemeStore: { getState: () => ({ setTheme: vi.fn() }) },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Telegram Mini App startup', () => {
  it('dismisses Telegram loading before waiting for the session request', async () => {
    const ready = vi.fn();
    const expand = vi.fn();
    const setProperty = vi.fn();
    let finishRequest!: (response: Response) => void;
    const sessionRequest = new Promise<Response>(resolve => { finishRequest = resolve; });

    vi.stubGlobal('location', { protocol: 'https:', hash: '#tgWebAppData=signed', search: '' });
    vi.stubGlobal('window', {
      Telegram: { WebApp: { initData: 'signed', colorScheme: 'dark', ready, expand, onEvent: vi.fn() } },
      setTimeout, clearTimeout,
    });
    vi.stubGlobal('document', { documentElement: { style: { setProperty }, classList: { add: vi.fn() } } });
    vi.stubGlobal('localStorage', { getItem: () => 'dark' });
    vi.stubGlobal('fetch', vi.fn(() => sessionRequest));

    const { initializeTelegram } = await import('../src/telegram/runtime.js');
    const startup = initializeTelegram();
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();

    finishRequest(new Response(JSON.stringify({ data: { user: { id: 1, first_name: 'Test' } } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(startup).resolves.toBeUndefined();
  });
});
