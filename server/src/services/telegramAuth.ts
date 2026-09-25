import { createHmac, timingSafeEqual } from 'node:crypto';
export interface TelegramUser { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string }
export function validateTelegramInitData(raw: string, token: string, now = Date.now() / 1000): TelegramUser {
  if (!token || !raw || raw.length > 16384) throw new Error('Invalid Telegram session');
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate session fields');
  const hash = params.get('hash') || '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid session signature');
  const timestamp = Number(params.get('auth_date'));
  if (!Number.isFinite(timestamp) || timestamp > now + 30 || now - timestamp > 86400) throw new Error('Telegram session expired');
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('Invalid session signature');
  const user = JSON.parse(params.get('user') || '{}');
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') throw new Error('Invalid Telegram user');
  return { id: user.id, first_name: user.first_name.slice(0,128), last_name: typeof user.last_name === 'string' ? user.last_name.slice(0,128) : undefined, username: typeof user.username === 'string' ? user.username : undefined, photo_url: typeof user.photo_url === 'string' && user.photo_url.startsWith('https://') ? user.photo_url : undefined };
}
