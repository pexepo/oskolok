import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import {claimTrackDelivery,markTrackDelivery} from '../services/telegramTrackDelivery.js';
import {randomBytes} from 'node:crypto';
import {hashToken} from '../services/telegramSession.js';
import { openAsBlob } from 'node:fs';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { studioMasterService } from '../services/StudioMasterService.js';
import { trackController } from './trackController.js';
import {addProfileMusic} from '../services/telegramSession.js';
import {profileMusicThumbnail,applyStatusTemplate} from '../services/telegramNowPlaying.js';
import {STATUS_DEFAULT,STATUS_FIXED,STATUS_MAX,STATUS_STYLES,statusStyle,validateStatusTemplate} from '../services/telegramStatus.js';
import {sessionHealth} from '../services/telegramSession.js';
import {logger} from '../utils/logger.js';
import {prepareTelegramAudio} from '../services/telegramAudioAsset.js';
import {AudioFileError} from '../services/audioFileCache.js';
import {classifyTelegramError,floodWaitSeconds} from '../services/telegramReliability.js';
const busy = new Set<number>();
const profileMusicBusy=new Set<string>();
const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
export const telegramController = {
  statusTemplate: async(_req:Request,res:Response,next:NextFunction)=>{
    try{
      const userId=res.locals.userId;
      const [profile,user,connection]=await Promise.all([prisma.creatorProfile.findUnique({where:{userId}}),prisma.user.findUnique({where:{id:userId}}),prisma.telegramConnection.findUnique({where:{userId}})]);
      res.setHeader('Cache-Control','no-store');
      res.json({data:{template:statusStyle(profile?.telegramStatusTemplate).id,custom:!!profile?.telegramStatusTemplate,defaultTemplate:STATUS_DEFAULT,maxLength:STATUS_MAX,fixedText:STATUS_FIXED,styles:STATUS_STYLES.map(s=>s.id),telegram:connection&&user?{name:user.name,username:user.username,avatarUrl:user.avatarUrl||''}:null}});
    }catch(e){next(e);}
  },
  saveStatusTemplate: async(req:Request,res:Response,next:NextFunction)=>{
    const userId=res.locals.userId;
    let template:string|null;
    try{template=validateStatusTemplate(req.body?.template);}catch(e){fail(res,400,'INVALID_STATUS_TEMPLATE',e instanceof Error?e.message:'Некорректный стиль.');return;}
    try{
      const before=await prisma.creatorProfile.findUnique({where:{userId}});
      await prisma.creatorProfile.upsert({where:{userId},create:{userId,displayName:'Слушатель',telegramStatusTemplate:template},update:{telegramStatusTemplate:template}});
      if((before?.telegramStatusTemplate||null)!==template)void applyStatusTemplate(userId).catch(error=>logger.warn({userId,message:error instanceof Error?error.message:String(error)},'Telegram status template apply failed'));
      res.json({data:{template:template||STATUS_DEFAULT,custom:!!template}});
    }catch(e){next(e);}
  },
  /** Здоровье интеграции для раздела «Telegram»: состояние сессии + последняя ошибка синхронизации трека. */
  health: async(_req:Request,res:Response,next:NextFunction)=>{
    try{
      const userId=res.locals.userId;
      const [health,profile]=await Promise.all([sessionHealth(userId),prisma.creatorProfile.findUnique({where:{userId},select:{telegramSyncError:true}})]);
      res.setHeader('Cache-Control','no-store');
      res.json({data:{...health,syncError:profile?.telegramSyncError||null}});
    }catch(e){next(e);}
  },
  addMusic: async(req:Request,res:Response,next:NextFunction)=>{
    const userId=res.locals.userId;
    if(profileMusicBusy.has(userId)){fail(res,409,'PROFILE_MUSIC_BUSY','Предыдущий трек ещё добавляется. Дождитесь завершения.');return;}
    profileMusicBusy.add(userId);
    try{
      if(!await prisma.telegramConnection.findUnique({where:{userId}})){fail(res,403,'SESSION_REQUIRED','Подключите сессию Telegram в профиле.');return;}
      const trackId=req.body?.trackId;if(typeof trackId!=='string'||trackId.length>200){fail(res,400,'INVALID_TRACK','Выберите трек.');return;}
      const track=await trackController.resolveTrack(trackId);if(!track||track.access!=='playable'){fail(res,404,'TRACK_UNAVAILABLE','Трек недоступен.');return;}
      const file=await studioMasterService.prepareExportAudio(track);
      const cover=await profileMusicThumbnail(track.artworkUrl).catch(()=>({file:undefined,cleanup:async()=>{}}));
      const asset=await prepareTelegramAudio(file,track.title,track.artist.name,cover.file);
      try{await addProfileMusic(userId,asset.path,track.title,track.artist.name,track.duration,cover.file);}finally{await asset.cleanup();await cover.cleanup();}
      await prisma.profileMusic.upsert({where:{userId_trackId:{userId,trackId}},create:{userId,trackId,trackData:JSON.stringify(track)},update:{trackData:JSON.stringify(track)}});
      res.json({data:{status:'added'}});
    }catch(e){
      logger.warn({userId,message:e instanceof Error?e.message:String(e)},'Telegram profile music failed');
      const kind=classifyTelegramError(e);
      const message=e instanceof AudioFileError?e.message:kind==='revoked'?'Telegram завершил сессию Осколка. Подключите Telegram заново.':kind==='flood'?`Telegram ограничил запросы. Повторите через ${floodWaitSeconds(e)??30} с.`:kind==='network'?'Telegram не подтвердил добавление. Проверьте музыку в своём профиле перед повторной попыткой.':'Не удалось добавить музыку. Проверьте сессию Telegram и доступность полного аудио.';
      fail(res,502,'PROFILE_MUSIC_FAILED',message);
    }finally{profileMusicBusy.delete(userId);}
  },
  session: async (req: Request, res: Response, next: NextFunction) => {
    try {
      let user = res.locals.telegramUser;
      if (user) await prisma.user.upsert({ where: { id: res.locals.userId }, create: { id: res.locals.userId, name: [user.first_name,user.last_name].filter(Boolean).join(' '), username: user.username, avatarUrl: user.photo_url }, update: { name: [user.first_name,user.last_name].filter(Boolean).join(' '), avatarUrl: user.photo_url } });
      else if(String(res.locals.userId).startsWith('telegram:')){
        const stored=await prisma.user.findUnique({where:{id:res.locals.userId}});
        if(stored)user={id:Number(res.locals.userId.slice(9)),first_name:stored.name,photo_url:stored.avatarUrl,username:stored.username};
      }
      // Audio elements cannot attach tma headers; issue a same-origin cookie after verified initData.
      if(user&&req.get('Authorization')?.startsWith('tma ')&&!String(req.headers.cookie||'').includes('oskolok_session=')){
        const token=randomBytes(32).toString('hex');
        await prisma.webSession.create({data:{tokenHash:hashToken(token),userId:res.locals.userId,expiresAt:new Date(Date.now()+30*86400000)}});
        res.cookie('oskolok_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,maxAge:30*86400000,path:'/'});
      }
      res.setHeader('Cache-Control','no-store');
      res.json({ data: { user: user || null,betaAllowed:!!res.locals.betaAllowed,access:!user?'unauthenticated':res.locals.betaAllowed?'allowed':'beta_denied', botUsername: env.TELEGRAM_BOT_USERNAME, profileExportAvailable: Boolean(user && env.TELEGRAM_BOT_TOKEN) } });
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
    if (typeof trackId !== 'string' || !trackId || trackId.length > 200) { fail(res,400,'INVALID_TRACK','Выберите трек.'); return; }
    const userId=`telegram:${user.id}`,link=`https://t.me/${env.TELEGRAM_BOT_USERNAME}`;
    if (busy.has(user.id)) { fail(res,429,'TRANSFER_BUSY','Предыдущий трек ещё отправляется.'); return; }
    busy.add(user.id);
    let jobId:string|undefined,sendStarted=false;
    const uncertain=()=>fail(res,409,'TELEGRAM_TRANSFER_UNCERTAIN','Доставка не подтверждена. Проверьте чат бота: автоматическая повторная отправка остановлена.');
    try {
      const personal=await prisma.personalTrack.findUnique({where:{userId_trackId:{userId,trackId}}});
      const own=personal?.audioFileId?await prisma.userFile.findFirst({where:{id:personal.audioFileId,userId,trackId,kind:'audio'}}):null;
      // A replaced personal file is a new export; another user's file can never be selected.
      const claim=await claimTrackDelivery(userId,trackId,own?.id||'');
      if(!claim.claimed){
        if(claim.job.status==='track_sent'){
          const result=JSON.parse(claim.job.result);
          res.json({data:{status:'sent',chatUrl:link,messageId:result.messageId}});return;
        }
        uncertain();return;
      }
      jobId=claim.job.id;
      const track = await trackController.resolveTrack(trackId);
      if (!track || !own&&track.access !== 'playable') {
        await markTrackDelivery(jobId,'track_failed');fail(res,404,'TRACK_UNAVAILABLE','Трек недоступен.');return;
      }
      const file=own?{path:own.path,size:own.size,mime:own.mime,extension:path.extname(own.fileName).slice(1)||'mp3'}:await studioMasterService.prepareExportAudio(track);
      if(file.size>49*1024*1024){await markTrackDelivery(jobId,'track_failed');fail(res,413,'TELEGRAM_FILE_TOO_LARGE','Файл превышает лимит отправки бота (49 МБ).');return;}
      const form = new FormData();
      form.set('chat_id', String(user.id));
      form.set('title', track.title.slice(0,128));
      form.set('performer', track.artist.name.slice(0,128));
      form.set('audio', await openAsBlob(file.path, { type: file.mime }), `oskolok.${file.extension}`);
      form.set('caption', 'Откройте трек в плеере Telegram → «Добавить в профиль». Для фонового прослушивания используйте этот плеер.');
      await markTrackDelivery(jobId,'track_sending');
      sendStarted=true;
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
      const result=await response.json() as {ok?:boolean;error_code?:number;result?:{message_id?:number}};
      if(result.ok===false&&Number.isInteger(result.error_code)){
        await markTrackDelivery(jobId,'track_failed',{errorCode:result.error_code});
        fail(res,502,'TELEGRAM_TRANSFER_FAILED', result.error_code === 403 ? 'Откройте чат бота, нажмите Start и разрешите ему писать вам, затем повторите.' : 'Telegram не принял аудио. Попробуйте позже.');return;
      }
      if(result.ok!==true||!Number.isSafeInteger(result.result?.message_id))throw new Error('TELEGRAM_DELIVERY_UNCONFIRMED');
      await markTrackDelivery(jobId,'track_sent',{messageId:result.result!.message_id});
      res.json({ data: { status: 'sent', chatUrl: link, messageId: result.result!.message_id } });
    } catch (err) {
      if(jobId)await markTrackDelivery(jobId,sendStarted?'track_uncertain':'track_failed').catch(()=>{});
      if(sendStarted){uncertain();return;}
      next(err);
    } finally { busy.delete(user.id); }
  },
};
