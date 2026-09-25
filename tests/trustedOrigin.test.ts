import { createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/src/config/env.js', () => ({ env: {
  CORS_ORIGIN: 'https://oskolok.example',
  TELEGRAM_BOT_TOKEN: 'test-only-token',
} }));

import { requireTrustedMutation } from '../server/src/middleware/trustedOrigin.js';

function signedInitData() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, first_name: 'Тест' }),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test-only-token').digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function mutation(origin: string, authorization?: string, host = '127.0.0.1:5001') {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const next = vi.fn() as NextFunction;
  const req = {
    method: 'PUT', protocol: 'http',
    get: (name: string) => ({ Origin: origin, Authorization: authorization, host })[name as 'Origin' | 'Authorization' | 'host'],
    is: (type: string) => type === 'application/json',
  } as unknown as Request;
  requireTrustedMutation(req, { status, json } as unknown as Response, next);
  return { status, json, next };
}

describe('trusted mutation origin', () => {
  it('accepts a signed Telegram Mini App request through an HTTPS tunnel', () => {
    const result = mutation('https://temporary-tunnel.example', `tma ${signedInitData()}`);
    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).not.toHaveBeenCalled();
  });

  it('rejects unsigned and forged cross-origin mutations', () => {
    for (const authorization of [undefined, `tma ${signedInitData().replace('first_name', 'last_name')}`]) {
      const result = mutation('https://temporary-tunnel.example', authorization);
      expect(result.status).toHaveBeenCalledWith(403);
      expect(result.next).not.toHaveBeenCalled();
    }
  });

  it('preserves the configured origin for cookie sessions', () => {
    expect(mutation('https://oskolok.example').next).toHaveBeenCalledOnce();
  });

  it('accepts the public HTTPS host through a tunnel without accepting HTTP downgrade', () => {
    expect(mutation('https://test.lhr.life', undefined, 'test.lhr.life').next).toHaveBeenCalledOnce();
    expect(mutation('http://test.lhr.life', undefined, 'test.lhr.life').status).toHaveBeenCalledWith(403);
  });
});
