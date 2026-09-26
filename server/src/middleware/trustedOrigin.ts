import type { Request, Response, NextFunction } from 'express';
import { isIP } from 'node:net';
import { env } from '../config/env.js';
import { validateTelegramInitData } from '../services/telegramAuth.js';

function isLoopbackHost(hostname:string){
  return hostname==='localhost'||hostname==='::1'||(isIP(hostname)===4&&hostname.startsWith('127.'));
}
function isLoopbackAddress(address:string|undefined){
  const normalized=(address||'').replace(/^::ffff:/i,'');
  return normalized==='::1'||(isIP(normalized)===4&&normalized.startsWith('127.'));
}
export function isTrustedLocalOrigin(req:Request,origin:string){
  try {
    if(!isLoopbackAddress(req.ip||req.socket.remoteAddress))return false;
    const parsed=new URL(origin),requestHost=new URL(`${req.protocol}://${req.get('host')||''}`).hostname;
    return parsed.protocol==='http:'&&isLoopbackHost(parsed.hostname)&&isLoopbackHost(requestHost);
  } catch { return false; }
}

// Cookie mutations require an exact origin. Telegram Mini Apps carry signed
// initData, so they remain valid behind an HTTPS tunnel or reverse proxy whose
// public origin differs from the server's internal protocol and configured URL.
export function requireTrustedMutation(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const origin = req.get('Origin');
  // A tunnel may terminate TLS and forward the request with an internal Host.
  // The browser Origin must still match the public host reported by the proxy.
  const forwardedHost = req.get('X-Forwarded-Host')?.split(',')[0]?.trim();
  const forwardedProto = req.get('X-Forwarded-Proto')?.split(',')[0]?.trim();
  const host=req.get('host')||'';
  const localHost=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const internalOrigin=req.protocol==='https'||localHost?`${req.protocol}://${host}`:undefined;
  const publicOrigin = forwardedHost && forwardedProto && /^https?$/.test(forwardedProto)
    ? `${forwardedProto}://${forwardedHost}` : undefined;
  const sameHost = (() => {
    try {
      if(!origin)return false;
      const parsed=new URL(origin);
      return parsed.host===host&&(parsed.protocol==='https:'||parsed.protocol==='http:'&&localHost);
    } catch { return false; }
  })();
  // A local Vite page proxies writes to the production-mode API on another
  // loopback port. Trust that pairing only when both the Origin and the API
  // host are local and the TCP peer is loopback; never infer trust from Origin
  // alone, since remote browsers can forge it.
  const localDevOrigin = origin ? isTrustedLocalOrigin(req,origin) : false;
  if (origin && origin !== internalOrigin && origin !== publicOrigin && !sameHost && !localDevOrigin && origin !== env.CORS_ORIGIN) {
    const authorization = req.get('Authorization');
    try {
      if (!authorization?.startsWith('tma ')) throw new Error('Missing Telegram signature');
      validateTelegramInitData(authorization.slice(4), env.TELEGRAM_BOT_TOKEN);
    } catch {
      res.status(403).json({error:{message:'Запрос из неизвестного приложения.'}}); return;
    }
  }
  if (!req.is('application/json')) { res.status(415).json({error:{message:'Ожидается JSON.'}}); return; }
  next();
}
