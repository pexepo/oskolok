import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { validateTelegramInitData } from '../services/telegramAuth.js';
import { createHash } from 'node:crypto';

/**
 * Единственный способ входа в Осколок — Telegram.
 * 1) Mini App: заголовок `Authorization: tma <initData>` (подпись проверяется токеном бота).
 * 2) Веб/десктоп: cookie `oskolok_session`, выданная после QR-входа через Telegram.
 * Без сессии доступны только health, статус входа и публичный аудиопоток.
 */
const readCookie = (req: Request, name: string) =>
  String(req.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);

const isPublicRoute = (req: Request) =>
  req.path.startsWith('/telegram/login/') ||
  req.path === '/telegram/session' ||
  (req.method === 'GET' && (req.path === '/health' || /^\/tracks\/[^/]+\/stream$/.test(req.path) || /^\/users\/[^/]+(?:\/summary)?$/.test(req.path)));

export async function userIdentity(req: Request, res: Response, next: NextFunction) {
  const raw = req.get('Authorization');
  res.locals.userId = undefined;
  if (raw?.startsWith('tma ')) {
    try {
      const user = validateTelegramInitData(raw.slice(4), env.TELEGRAM_BOT_TOKEN);
      const id = `telegram:${user.id}`;
      await prisma.user.upsert({where:{id},create:{id,name:[user.first_name,user.last_name].filter(Boolean).join(' '),username:user.username,avatarUrl:user.photo_url},update:{name:[user.first_name,user.last_name].filter(Boolean).join(' '),avatarUrl:user.photo_url}});
      res.locals.telegramUser = user;
      res.locals.userId = `telegram:${user.id}`;
      next();
      return;
    } catch {
      res.status(401).json({ error: { code: 'TELEGRAM_AUTH_INVALID', message: 'Сессия Telegram истекла или недействительна. Откройте приложение заново через бота.' } });
      return;
    }
  }
  const token = readCookie(req, 'oskolok_session');
  if (token) {
    try {
      const session = await prisma.webSession.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } });
      if (session && session.expiresAt > new Date()) {
        res.locals.userId = session.userId;
        next();
        return;
      }
    } catch (e) { next(e); return; }
  }
  if (isPublicRoute(req)) { next(); return; }
  res.status(401).json({ error: { code: 'TELEGRAM_AUTH_REQUIRED', message: 'Войдите в Осколок через Telegram.' } });
}

export async function ownPlaylist(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method === 'GET' && /^(soundcloud|spotify):/.test(req.params.id)) { next(); return; }
    const playlist = await prisma.playlist.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (!playlist || playlist.userId !== res.locals.userId) { res.status(404).json({ error: { code: 'PLAYLIST_NOT_FOUND', message: 'Плейлист не найден.' } }); return; }
    next();
  } catch (err) { next(err); }
}
