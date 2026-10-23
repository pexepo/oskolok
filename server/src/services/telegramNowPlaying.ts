import {writeFile,unlink,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prisma} from '../database/client.js';
import {studioMasterService} from './StudioMasterService.js';
import {uploadProfileMusic,saveProfileMusic,removeProfileMusic,type MusicDocument} from './telegramSession.js';
import {trackController} from '../controllers/trackController.js';
import {logger} from '../utils/logger.js';
import {prepareTelegramAudio} from './telegramAudioAsset.js';
import {renderStatusTitle,STATUS_STYLES} from './telegramStatus.js';
import {backoffDelay,classifyTelegramError,createLatestQueue,floodWaitSeconds} from './telegramReliability.js';

/** Музыка профиля сходится к желаемому состоянию через последовательную очередь на пользователя:
 * быстрые переключения треков сливаются (дебаунс), последнее состояние выигрывает, вызовы одного пользователя не пересекаются. */
export const nowPlayingTiming={debounceMs:1500,maxAttempts:6};
const attempts=new Map<string,number>();
const blockedUntil=new Map<string,number>();
const lastError=new Map<string,string>();
const TTL=90_000;
function syncMessage(error:unknown){
 const kind=classifyTelegramError(error);
 if(kind==='flood'){const s=floodWaitSeconds(error)||0;return `Telegram ограничил частоту обновлений. Повторим через ${s>=90?`${Math.ceil(s/60)} мин`:`${s} с`}.`;}
 if(kind==='revoked'||(error as Error)?.name==='SessionRevokedError')return 'Telegram завершил сессию Осколка. Подключите Telegram заново.';
 if(/Подключите сессию/i.test(String((error as Error)?.message)))return 'Подключите Telegram в профиле, чтобы показывать трек.';
 if(kind==='network')return 'Нет связи с Telegram. Переподключаемся…';
 if(/Полный аудиофайл|Загрузка аудио|аудио/i.test(error instanceof Error?error.message:String(error)))return 'Нет полного файла этой версии для Telegram.';
 return 'Не удалось обновить музыку. Осколок повторит попытку.';
}
async function reportFailure(userId:string,error:unknown){
 const message=error instanceof Error?error.message:String(error),kind=classifyTelegramError(error),attempt=(attempts.get(userId)||0)+1;
 attempts.set(userId,attempt);
 await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:syncMessage(error)}}).catch(()=>{});
 let delay:number|null=null;
 if(kind==='flood')delay=(floodWaitSeconds(error)??30)*1000+Math.round(Math.random()*1000);
 else if(kind!=='revoked'&&(error as Error)?.name!=='SessionRevokedError'&&!/Подключите сессию|недоступен/i.test(message)&&attempt<nowPlayingTiming.maxAttempts)delay=backoffDelay(attempt,{base:2000,max:120000});
 if(delay!==null){blockedUntil.set(userId,Date.now()+delay);queue.retryLater(userId,delay);}
 if(lastError.get(userId)!==message||attempt===1){lastError.set(userId,message);logger.warn({userId,kind,attempt,retryInMs:delay,message,event:'telegram.nowplaying.failed'},'Telegram now playing sync failed');}
}
const queue=createLatestQueue(async userId=>{
 const wait=(blockedUntil.get(userId)||0)-Date.now();
 if(wait>0){queue.retryLater(userId,wait);return;}
 const started=Date.now();
 try{await reconcile(userId);}catch(error){await reportFailure(userId,error);return;}
 if(attempts.has(userId)||lastError.has(userId))logger.info({userId,ms:Date.now()-started,event:'telegram.nowplaying.recovered'},'Telegram now playing sync recovered');
 attempts.delete(userId);blockedUntil.delete(userId);lastError.delete(userId);
});
const schedule=(userId:string,now=false)=>queue.schedule(userId,now?0:nowPlayingTiming.debounceMs);
function document(row:{documentId:string|null;accessHash:string|null;fileReference:string|null}):MusicDocument|null{
  return row.documentId&&row.accessHash&&row.fileReference?{id:row.documentId,accessHash:row.accessHash,fileReference:row.fileReference}:null;
}
export async function profileMusicThumbnail(url?:string){
  if(!url||!url.startsWith('https://'))return {file:undefined,cleanup:async()=>{}};
  const host=new URL(url).hostname;
  if(!/^(i\.scdn\.co|i\d?\.sndcdn\.com|image-cdn-ak\.spotifycdn\.com|mosaic\.scdn\.co|e-cdns-images\.dzcdn\.net|i\.ytimg\.com|img\.youtube\.com)$/.test(host))return {file:undefined,cleanup:async()=>{}};
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok||!String(response.headers.get('content-type')).startsWith('image/'))return {file:undefined,cleanup:async()=>{}};
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>900_000)return {file:undefined,cleanup:async()=>{}};
  const dir=await mkdtemp(path.join(tmpdir(),'oskolok-cover-')),file=path.join(dir,'cover.jpg');
  await writeFile(file,bytes);
  return {file,cleanup:async()=>{await unlink(file).catch(()=>{});await import('node:fs/promises').then(fs=>fs.rmdir(dir)).catch(()=>{});}};
}
async function clear(userId:string){
  const row=await prisma.telegramNowPlaying.findUnique({where:{userId}});if(!row)return;
  await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'clearing'}});
  const old=document(row);if(old)await removeProfileMusic(userId,old);
  await prisma.telegramNowPlaying.update({where:{userId},data:{trackId:null,documentId:null,accessHash:null,fileReference:null,operationState:'idle'}});
}
async function reconcile(userId:string){
  const profile=await prisma.creatorProfile.findUnique({where:{userId}});
  const row=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(!row)return;
  const fresh=!!row.seenAt&&Date.now()-row.seenAt.getTime()<TTL;
  const desired=profile?.telegramFullIntegration&&fresh?row.desiredTrackId:null;
  if(!desired){await clear(userId);await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:null}});return;}
  if(row.trackId===desired&&document(row)){
    if(row.operationState==='saving'){
      await saveProfileMusic(userId,document(row)!);
      await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'active'}});
    }
    await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:null}});return;
  }
  if(!await prisma.telegramConnection.findUnique({where:{userId}}))throw new Error('Подключите сессию Telegram в профиле.');
  const track=await trackController.resolveTrack(desired);
  if(!track||track.access!=='playable')throw new Error('Трек недоступен для Telegram');
  const file=await studioMasterService.prepareExportAudio(track);
  const newest=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(newest?.desiredTrackId!==desired||!newest.seenAt||Date.now()-newest.seenAt.getTime()>TTL)return;
  await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'uploading'}});
  const cover=await profileMusicThumbnail(track.artworkUrl).catch(()=>({file:undefined,cleanup:async()=>{}}));
  let doc:MusicDocument;
  const title=renderStatusTitle(profile?.telegramStatusTemplate,track);
  const asset=await prepareTelegramAudio(file,title,track.artist.name,cover.file);
  try{doc=await uploadProfileMusic(userId,asset.path,title,track.artist.name,track.duration,cover.file);}finally{await asset.cleanup();await cover.cleanup();}
  const latest=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(latest?.desiredTrackId!==desired||!latest.seenAt||Date.now()-latest.seenAt.getTime()>TTL)return;
  // Keep the previous profile track while resolving and uploading the new one.
  // A missing source or a failed upload must not erase the current music.
  await clear(userId);
  await prisma.telegramNowPlaying.update({where:{userId},data:{trackId:desired,documentId:doc.id,accessHash:doc.accessHash,fileReference:doc.fileReference,operationState:'saving'}});
  await saveProfileMusic(userId,doc);
  const afterSave=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(afterSave?.desiredTrackId!==desired||!afterSave.seenAt||Date.now()-afterSave.seenAt.getTime()>TTL){await clear(userId);return;}
  await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'active'}});
  await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:null}});
  logger.info({userId,trackId:desired,event:'telegram.nowplaying.synced'},'Telegram profile music updated');
}
export async function updateNowPlaying(userId:string,trackId:string|null,sessionId?:string,heartbeat=false){
  const profile=await prisma.creatorProfile.upsert({where:{userId},create:{userId,displayName:'Слушатель'},update:{}});
  if(heartbeat&&(!sessionId||sessionId!==profile.playbackSessionId||!trackId))return;
  if(!trackId&&sessionId&&profile.playbackSessionId&&sessionId!==profile.playbackSessionId)return;
  const desired=trackId&&profile.telegramFullIntegration?trackId:null;
  const same=trackId&&profile.currentTrackData&&JSON.parse(profile.currentTrackData)?.id===trackId;
  await prisma.creatorProfile.update({where:{userId},data:{currentTrackData:trackId?same?profile.currentTrackData:JSON.stringify(await trackController.resolveTrack(trackId)):null,playbackSeenAt:trackId?new Date():null,playbackSessionId:trackId?sessionId||null:null}});
  await prisma.telegramNowPlaying.upsert({where:{userId},create:{userId,desiredTrackId:desired,seenAt:trackId?new Date():null},update:{desiredTrackId:desired,seenAt:trackId?new Date():null}});
  void schedule(userId);
}
export async function refreshTelegramIntegration(userId:string){
  const profile=await prisma.creatorProfile.findUnique({where:{userId}});
  const trackId=profile?.currentTrackData&&profile.playbackSeenAt&&Date.now()-profile.playbackSeenAt.getTime()<TTL?JSON.parse(profile.currentTrackData)?.id as string|undefined:undefined;
  await prisma.telegramNowPlaying.upsert({where:{userId},create:{userId,desiredTrackId:profile?.telegramFullIntegration?trackId:null,seenAt:profile?.playbackSeenAt},update:{desiredTrackId:profile?.telegramFullIntegration?trackId:null}});
  await schedule(userId,true);
}
/** Новый шаблон статуса: сбросить trackId (документ остаётся для удаления), чтобы reconcile перезалил музыку с новым title. */
export async function applyStatusTemplate(userId:string){
  await prisma.telegramNowPlaying.updateMany({where:{userId,trackId:{not:null}},data:{trackId:null}});
  await refreshTelegramIntegration(userId);
}
export async function clearNowPlayingOnExit(userId:string){
  await prisma.creatorProfile.updateMany({where:{userId},data:{currentTrackData:null,playbackSeenAt:null,playbackSessionId:null}});
  await prisma.telegramNowPlaying.updateMany({where:{userId},data:{desiredTrackId:null,seenAt:null}});
  await schedule(userId,true);
}
let recovered=false;
/** Первый вызов после старта: старые свободные шаблоны → стиль по умолчанию, прерванные операции (uploading/saving/clearing) доводятся до конца. */
export async function expireNowPlaying(){
  if(!recovered){
    recovered=true;
    const migrated=await prisma.creatorProfile.updateMany({where:{telegramStatusTemplate:{notIn:STATUS_STYLES.map(s=>s.id)}},data:{telegramStatusTemplate:null}}).catch(()=>({count:0}));
    if(migrated.count)logger.info({count:migrated.count,event:'telegram.status.migrated'},'Custom Telegram status templates reset to default style');
  }
  const stale=await prisma.telegramNowPlaying.findMany({where:{OR:[{operationState:{in:['uploading','saving','clearing']}},{trackId:{not:null},OR:[{seenAt:null},{seenAt:{lt:new Date(Date.now()-TTL)}}]}]}});
  await Promise.allSettled(stale.map(row=>schedule(row.userId,true)));
}
