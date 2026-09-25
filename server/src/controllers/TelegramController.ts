import type { Request, Response, NextFunction } from 'express';
import { openAsBlob } from 'node:fs';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { studioMasterService } from '../services/StudioMasterService.js';
import { trackController } from './trackController.js';
import {addProfileMusic} from '../services/telegramSession.js';
import {profileMusicThumbnail} from '../services/telegramNowPlaying.js';
import {logger} from '../utils/logger.js';
import {prepareTelegramAudio} from '../services/telegramAudioAsset.js';
const recent = new Map<string, { until: number; messageId: number }>();
const busy = new Set<number>();
const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
export const telegramController = {
  addMusic: async(req:Request,res:Response,next:NextFunction)=>{
    const userId=res.locals.userId;
    try{
      if(!await prisma.telegramConnection.findUnique({where:{userId}})){fail(res,401,'SESSION_REQUIRED','Подключите сессию Telegram в профиле.');return;}
      const trackId=req.body?.trackId;if(typeof trackId!=='string'||trackId.length>200){fail(res,400,'INVALID_TRACK','Выберите трек.');return;}
      const track=await trackController.resolveTrack(trackId);if(!track||track.access!=='playable'){fail(res,404,'TRACK_UNAVAILABLE','Трек недоступен.');return;}
      const file=await studioMasterService.prepareExportAudio(track);
      const cover=await profileMusicThumbnail(track.artworkUrl).catch(()=>({file:undefined,cleanup:async()=>{}}));
      const asset=await prepareTelegramAudio(file,track.title,track.artist.name,cover.file);
      try{await addProfileMusic(userId,asset.path,track.title,track.artist.name,track.duration,cover.file);}finally{await asset.cleanup();await cover.cleanup();}
      await prisma.profileMusic.upsert({where:{userId_trackId:{userId,trackId}},create:{userId,trackId,trackData:JSON.stringify(track)},update:{trackData:JSON.stringify(track)}});
      res.json({data:{status:'added'}});
    }catch(e){logger.warn({userId,message:e instanceof Error?e.message:String(e)},'Telegram profile music failed');fail(res,502,'PROFILE_MUSIC_FAILED','Не удалось добавить музыку. Проверьте сессию Telegram и доступность полного аудио.');}
  },
  session: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      let user = res.locals.telegramUser;
      if (user) await prisma.user.upsert({ where: { id: res.locals.userId }, create: { id: res.locals.userId, name: [user.first_name,user.last_name].filter(Boolean).join(' '), username: user.username, avatarUrl: user.photo_url }, update: { name: [user.first_name,user.last_name].filter(Boolean).join(' '), avatarUrl: user.photo_url } });
      else if(String(res.locals.userId).startsWith('telegram:')){
        const stored=await prisma.user.findUnique({where:{id:res.locals.userId}});
        if(stored)user={id:Number(res.locals.userId.slice(9)),first_name:stored.name,photo_url:stored.avatarUrl,username:stored.username};
      }
      res.setHeader('Cache-Control','no-store');
      res.json({ data: { user: user || null, botUsername: env.TELEGRAM_BOT_USERNAME, profileExportAvailable: Boolean(user && env.TELEGRAM_BOT_TOKEN) } });
    } catch (err) { next(err); }
  },
  download: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const track = await trackController.resolveTrack(req.params.id);
      if (!track || track.access !== 'playable') { fail(res,404,'TRACK_UNAVAILABLE','Трек недоступен.'); return; }
      const file = studioMasterService.getExportAudio(track.id);
      if (!file) { studioMasterService.prefetch(track); fail(res,409,'AUDIO_NOT_READY','Аудиофайл ещё не готов к передаче или его формат не поддерживается. Включите трек и попробуйте снова.'); return; }
      res.type(file.mime).download(file.path, `${track.artist.name} - ${track.title}.${file.extension}`.replace(/[\\/\r\n]/g,'_'));
    } catch (err) { next(err); }
  },
  sendProfileTrack: async (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.telegramUser;
    if (!user || !env.TELEGRAM_BOT_TOKEN) { fail(res,401,'TELEGRAM_AUTH_REQUIRED','Для отправки откройте Осколок через Telegram-бота.'); return; }
    const trackId = req.body?.trackId;
    if (typeof trackId !== 'string' || trackId.length > 200) { fail(res,400,'INVALID_TRACK','Выберите трек.'); return; }
    const key = `${user.id}:${trackId}`;
    const link = `https://t.me/${env.TELEGRAM_BOT_USERNAME}`;
    for (const [id, item] of recent) if (item.until < Date.now()) recent.delete(id);
    if (recent.has(key)) { res.json({ data: { status: 'sent', chatUrl: link, messageId: recent.get(key)!.messageId } }); return; }
    if (busy.has(user.id)) { fail(res,429,'TRANSFER_BUSY','Предыдущий трек ещё отправляется.'); return; }
    busy.add(user.id);
    try {
      const track = await trackController.resolveTrack(trackId);
      if (!track || track.access !== 'playable') { fail(res,404,'TRACK_UNAVAILABLE','Трек недоступен.'); return; }
      const file = await studioMasterService.prepareExportAudio(track);
      const form = new FormData();
      form.set('chat_id', String(user.id));
      form.set('title', track.title.slice(0,128));
      form.set('performer', track.artist.name.slice(0,128));
      form.set('audio', await openAsBlob(file.path, { type: file.mime }), `oskolok.${file.extension}`);
      form.set('caption', 'Откройте трек в плеере Telegram → «Добавить в профиль». Для фонового прослушивания используйте этот плеер.');
      let result: any;
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
        result = await response.json();
      } catch { fail(res,502,'TELEGRAM_TRANSFER_UNCERTAIN','Не удалось подтвердить доставку. Проверьте чат бота перед повторной отправкой.'); return; }
      if (!result.ok) { fail(res,502,'TELEGRAM_TRANSFER_FAILED', result.error_code === 403 ? 'Откройте чат бота, нажмите Start и разрешите ему писать вам, затем повторите.' : 'Telegram не принял аудио. Попробуйте позже.'); return; }
      recent.set(key, { until: Date.now()+300000, messageId: result.result.message_id });
      res.json({ data: { status: 'sent', chatUrl: link, messageId: result.result.message_id } });
    } catch (err) { next(err); }
    finally { busy.delete(user.id); }
  },
};
