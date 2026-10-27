import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{ disconnect: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> }>,
  /** What auth.sendCode answers: the code channel Telegram picked. */
  sent: undefined as unknown,
  userUpsert: vi.fn(),
  connectionUpsert: vi.fn(),
}));

vi.mock('teleproto', () => {
  const tl = (name: string) => ({ [name]: class { className = `auth.${name}`; constructor(args: Record<string, unknown> = {}) { Object.assign(this, args); } } })[name];
  const auth: Record<string, ReturnType<typeof tl>> = {};
  for (const name of ['LogOut', 'SendCode', 'SignIn', 'ResendCode', 'SentCode', 'SentCodeSuccess', 'SentCodePaymentRequired', 'Authorization', 'SentCodeTypeApp', 'SentCodeTypeSms', 'SentCodeTypeSmsWord', 'SentCodeTypeSmsPhrase', 'SentCodeTypeEmailCode', 'SentCodeTypeSetUpEmailRequired', 'SentCodeTypeFragmentSms', 'SentCodeTypeCall', 'SentCodeTypeFlashCall', 'SentCodeTypeMissedCall', 'SentCodeTypeFirebaseSms', 'CodeTypeSms', 'CodeTypeCall', 'CodeTypeFlashCall', 'CodeTypeMissedCall', 'CodeTypeFragmentSms']) auth[name] = tl(name);
  const Api = { User: class {}, CodeSettings: class {}, EmailVerificationCode: class { constructor(public args: unknown) {} }, auth };
  return {
    Api,
    TelegramClient: class {
      session = { save: () => 'test-session' };
      connect = vi.fn(async () => {});
      disconnect = vi.fn(async () => {});
      invoke = vi.fn(async (request: { className?: string }) => {
        if (request instanceof auth.SendCode) return mocks.sent ?? new auth.SentCode({ type: new auth.SentCodeTypeApp({ length: 5 }), phoneCodeHash: 'hash' });
        if (request instanceof auth.SignIn) return new auth.Authorization({ user: { id: 99 } });
        if (request instanceof auth.ResendCode) return new auth.SentCode({ type: new auth.SentCodeTypeSms({ length: 5 }), phoneCodeHash: 'hash2' });
        return undefined;
      });
      constructor() { mocks.clients.push(this); }
    },
  };
});
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
    mocks.sent = undefined;
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
    expect(mocks.clients[0].invoke.mock.calls.map(([r]) => (r as { className: string }).className)).toEqual(['auth.SendCode', 'auth.SignIn', 'auth.LogOut']);
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
      expect(mocks.clients[0].invoke.mock.calls.map(([r]) => (r as { className: string }).className)).toEqual(['auth.SendCode', 'auth.SignIn']);
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

  it('says where the code went and switches to the next channel on request', async () => {
    const teleproto = await import('teleproto') as unknown as { Api: { auth: Record<string, new (a?: object) => object> } };
    const { auth } = teleproto.Api;
    mocks.sent = new auth.SentCode({ type: new auth.SentCodeTypeEmailCode({ emailPattern: 'p***@mail.ru', length: 6 }), phoneCodeHash: 'hash', nextType: new auth.CodeTypeSms(), timeout: 0 });
    const { beginPhoneLogin, loginStatus, resendPhoneCode } = await import('../server/src/services/telegramSession.js');
    const id = await beginPhoneLogin(undefined, '+375291234570');
    await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('code'));
    expect(loginStatus(id)).toMatchObject({ codeChannel: 'email', emailPattern: 'p***@mail.ru', codeLength: 6, nextChannel: 'sms' });
    await resendPhoneCode(id);
    expect(loginStatus(id)).toMatchObject({ codeChannel: 'sms', phoneCodeHash: 'hash2' });
  });

  it('explains a paid SMS instead of waiting for a code that never comes', async () => {
    const teleproto = await import('teleproto') as unknown as { Api: { auth: Record<string, new (a?: object) => object> } };
    mocks.sent = new teleproto.Api.auth.SentCodePaymentRequired({ phoneCodeHash: 'hash' });
    const { beginPhoneLogin, loginStatus } = await import('../server/src/services/telegramSession.js');
    const id = await beginPhoneLogin(undefined, '+375291234571');
    await vi.waitFor(() => expect(loginStatus(id)?.state).toBe('error'));
    expect(loginStatus(id)?.error).toMatch(/оплатить SMS.*QR/);
  });
});
