import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({signIn:vi.fn(),connect:vi.fn(),warn:vi.fn()}));
vi.mock('teleproto',()=>({TelegramClient:class {
  connect=mocks.connect;
  disconnect=vi.fn(async()=>{});
  signInUserWithQrCode=mocks.signIn;
},Api:{}}));
vi.mock('../server/src/services/telegramQr.js',()=>({signInWithQr:(_client:unknown,credentials:unknown,params:unknown)=>mocks.signIn(credentials,params)}));
vi.mock('teleproto/sessions/index.js',()=>({StringSession:class {}}));
vi.mock('teleproto/client/uploads.js',()=>({CustomFile:class {}}));
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:mocks.warn}}));

describe('Telegram QR login errors',()=>{
  beforeEach(()=>{
    vi.stubEnv('TELEGRAM_API_ID','12345');
    vi.stubEnv('TELEGRAM_API_HASH','test-hash');
    vi.resetModules();vi.resetAllMocks();
    mocks.connect.mockResolvedValue(undefined);
  });
  it('allows another cloud password attempt without replacing the QR session',async()=>{
    mocks.signIn.mockImplementation(async(_credentials,params)=>{
      await params.password('hint');
      expect(await params.onError(new Error('PASSWORD_HASH_INVALID'))).toBe(false);
      await params.password('hint');
      throw new Error('AUTH_USER_CANCEL');
    });
    const {beginLogin,loginStatus,submitLoginPassword,cancelLogin}=await import('../server/src/services/telegramSession.js');
    const id=await beginLogin();
    await vi.waitFor(()=>expect(loginStatus(id)?.state).toBe('password'));
    submitLoginPassword(id,'incorrect');
    await vi.waitFor(()=>expect(loginStatus(id)?.error).toMatch(/Неверный облачный пароль/));
    expect(loginStatus(id)?.state).toBe('password');
    cancelLogin(id);
  });
  it.each([
    ['AUTH_TOKEN_EXPIRED',/QR-код истёк/],
    ['API_ID_INVALID',/настройки приложения/],
    ['ETIMEDOUT',/подключиться к Telegram/],
  ])('explains %s without exposing credentials',async(code,message)=>{
    mocks.signIn.mockRejectedValue(new Error(code));
    const {beginLogin,loginStatus,cancelLogin}=await import('../server/src/services/telegramSession.js');
    const id=await beginLogin();
    await vi.waitFor(()=>expect(loginStatus(id)?.state).toBe('error'));
    expect(loginStatus(id)?.error).toMatch(message);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({method:'qr',code,phase:'qr_handshake'}),'Telegram login failed');
    cancelLogin(id);
  });
});

describe('login failure diagnostics',()=>{
 it('keeps the JavaScript failure and redacts login tokens and phone numbers',async()=>{
  const {loginDiagnostic}=await import('../server/src/services/telegramSession.js');
  const failure=new TypeError('Cannot read properties of undefined; tg://login?token=very-secret-token +375291234567');
  const diagnostic=loginDiagnostic(failure);
  expect(diagnostic.name).toBe('TypeError');
  expect(diagnostic.detail).toContain('Cannot read properties of undefined');
  expect(diagnostic.detail).not.toContain('very-secret-token');
  expect(diagnostic.detail).not.toContain('375291234567');
 });
});
