import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{ disconnect: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn>; signInUser: ReturnType<typeof vi.fn> }>,
  userUpsert: vi.fn(),
  connectionUpsert: vi.fn(),
}));

vi.mock('teleproto', () => ({
  TelegramClient: class {
    session = { save: () => 'test-session' };
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    invoke = vi.fn(async () => {});
    signInUser = vi.fn(async (_credentials, params) => {
      await params.phoneCode(true);
      return { id: 99 };
    });
    constructor() { mocks.clients.push(this); }
  },
  Api: { User: class {}, auth: { LogOut: class {} } },
}));
vi.mock('teleproto/sessions/index.js', () => ({ StringSession: class {} }));
vi.mock('teleproto/client/uploads.js', () => ({ CustomFile: class {} }));
vi.mock('../server/src/database/client.js', () => ({ prisma: {
  user: { upsert: mocks.userUpsert },
  creatorProfile: { upsert: vi.fn() },
  telegramConnection: { upsert: mocks.connectionUpsert },
} }));

describe('phone login for Telegram Mini App', () => {
  beforeEach(() => {
    vi.stubEnv('TELEGRAM_API_ID', '12345');
    vi.stubEnv('TELEGRAM_API_HASH', 'test-hash');
    mocks.clients.length = 0;
    mocks.userUpsert.mockClear();
    mocks.connectionUpsert.mockClear();
    vi.resetModules();
  });

  it('accepts a code without QR and rejects another Telegram account', async () => {
    const { beginPhoneLogin, loginStatus, submitPhoneCode } = await import('../server/src/services/telegramSession.js');
    const id = await beginPhoneLogin('telegram:42', '+375 29 123 45 67');
    await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('code'));
    expect(loginStatus(id)?.codeViaApp).toBe(true);
    submitPhoneCode(id, '12345');
    await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('error'));
    expect(loginStatus(id)?.error).toMatch(/тем же аккаунтом/);
    expect(mocks.clients[0].invoke).toHaveBeenCalledOnce();
    expect(mocks.userUpsert).not.toHaveBeenCalled();
  });

  it('rejects malformed numbers before creating a Telegram client', async () => {
    const { beginPhoneLogin } = await import('../server/src/services/telegramSession.js');
    await expect(beginPhoneLogin('telegram:42', '123')).rejects.toThrow(/международном формате/);
    expect(mocks.clients).toHaveLength(0);
  });

  it('stores the session only after the code confirms the same account', async () => {
    const privateDir = mkdtempSync(path.join(tmpdir(), 'oskolok-phone-login-'));
    vi.stubEnv('OSKOLOK_PRIVATE_DIR', privateDir);
    try {
      const { beginPhoneLogin, loginStatus, submitPhoneCode, consumeLogin } = await import('../server/src/services/telegramSession.js');
      const id = await beginPhoneLogin('telegram:99', '+375291234568');
      await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('code'));
      submitPhoneCode(id, '54321');
      await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('connected'));
      expect(loginStatus(id)?.userId).toBe('telegram:99');
      expect(mocks.connectionUpsert).toHaveBeenCalledOnce();
      expect(mocks.clients[0].invoke).not.toHaveBeenCalled();
      consumeLogin(id);
    } finally {
      rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('pairs the bot conversation with the Mini App account before accepting a phone', async () => {
    const { beginBotLogin, attachBotLogin, botLoginForUser, startBotPhoneLogin, loginStatus } = await import('../server/src/services/telegramSession.js');
    const id = beginBotLogin('telegram:99', 'https://oskolok.example');
    expect(attachBotLogin(id, '42')).toBe(false);
    expect(botLoginForUser('42')).toBeUndefined();
    expect(attachBotLogin(id, '99')).toBe(true);
    expect(loginStatus(id)?.state).toBe('bot_phone');
    startBotPhoneLogin(id, '+375291234569');
    await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('code'));
    expect(botLoginForUser('99')?.id).toBe(id);
  });
});
