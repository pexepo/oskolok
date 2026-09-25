import {writeFile,unlink,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prisma} from '../database/client.js';
import {studioMasterService} from './StudioMasterService.js';
import {uploadProfileMusic,saveProfileMusic,removeProfileMusic,type MusicDocument} from './telegramSession.js';
import {trackController} from '../controllers/trackController.js';
import {logger} from '../utils/logger.js';
import {prepareTelegramAudio} from './telegramAudioAsset.js';

const queues=new Map<string,Promise<void>>();
const retryAfter=new Map<string,number>();
const lastError=new Map<string,string>();
const TTL=90_000;
function syncMessage(error:unknown){
 const message=error instanceof Error?error.message:String(error);
 if(/FLOOD_WAIT/i.test(message))return 'Telegram ограничил частоту обновлений. Повторим позже.';
 if(/SESSION|AUTH_KEY|Подключите сессию/i.test(message))return 'Подключите сессию Telegram заново.';
 if(/Полный аудиофайл|Загрузка аудио|аудио/i.test(message))return 'Нет полного файла этой версии для Telegram.';
 return 'Не удалось обновить музыку. Осколок повторит попытку.';
}
async function reportFailure(userId:string,error:unknown){
 const message=error instanceof Error?error.message:String(error),wait=message.match(/FLOOD_WAIT_?(\d+)/i);
 retryAfter.set(userId,Date.now()+(wait?Math.min(300,Math.max(10,Number(wait[1])))*1000:30000));
 await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:syncMessage(error)}}).catch(()=>{});
 if(lastError.get(userId)!==message){lastError.set(userId,message);logger.warn({userId,message},'Telegram now playing sync failed');}
}
function enqueue(userId:string,task:()=>Promise<void>){
  const prior=queues.get(userId)||Promise.resolve();
  const next=prior.catch(()=>{}).then(task);
  queues.set(userId,next);
  void next.finally(()=>{if(queues.get(userId)===next)queues.delete(userId);}).catch(()=>{});
  return next;
}
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
  if(Date.now()<(retryAfter.get(userId)||0))return;
  if(row.trackId===desired&&document(row)){
    if(row.operationState==='saving'){
      await saveProfileMusic(userId,document(row)!);
      await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'active'}});
    }
    await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:null}});return;
  }
  if(!await prisma.telegramConnection.findUnique({where:{userId}}))throw new Error('Подключите сессию Telegram в профиле.');
  await clear(userId);
  const track=await trackController.resolveTrack(desired);
  if(!track||track.access!=='playable')throw new Error('Трек недоступен для Telegram');
  const file=await studioMasterService.prepareExportAudio(track);
  const newest=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(newest?.desiredTrackId!==desired||!newest.seenAt||Date.now()-newest.seenAt.getTime()>TTL)return;
  await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'uploading'}});
  const cover=await profileMusicThumbnail(track.artworkUrl).catch(()=>({file:undefined,cleanup:async()=>{}}));
  let doc:MusicDocument;
  const title=`Слушает в Осколок - ${track.title}`.slice(0,128);
  const asset=await prepareTelegramAudio(file,title,track.artist.name,cover.file);
  try{doc=await uploadProfileMusic(userId,asset.path,title,track.artist.name,track.duration,cover.file);}finally{await asset.cleanup();await cover.cleanup();}
  await prisma.telegramNowPlaying.update({where:{userId},data:{trackId:desired,documentId:doc.id,accessHash:doc.accessHash,fileReference:doc.fileReference,operationState:'saving'}});
  const latest=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(latest?.desiredTrackId!==desired||!latest.seenAt||Date.now()-latest.seenAt.getTime()>TTL){await clear(userId);return;}
  await saveProfileMusic(userId,doc);
  const afterSave=await prisma.telegramNowPlaying.findUnique({where:{userId}});
  if(afterSave?.desiredTrackId!==desired||!afterSave.seenAt||Date.now()-afterSave.seenAt.getTime()>TTL){await clear(userId);return;}
  await prisma.telegramNowPlaying.update({where:{userId},data:{operationState:'active'}});
  lastError.delete(userId);retryAfter.delete(userId);
  await prisma.creatorProfile.update({where:{userId},data:{telegramSyncError:null}});
}
export async function updateNowPlaying(userId:string,trackId:string|null,sessionId?:string,heartbeat=false){
  const profile=await prisma.creatorProfile.upsert({where:{userId},create:{userId,displayName:'Слушатель'},update:{}});
  if(heartbeat&&(!sessionId||sessionId!==profile.playbackSessionId||!trackId))return;
  if(!trackId&&sessionId&&profile.playbackSessionId&&sessionId!==profile.playbackSessionId)return;
  const desired=trackId&&profile.telegramFullIntegration?trackId:null;
  const same=trackId&&profile.currentTrackData&&JSON.parse(profile.currentTrackData)?.id===trackId;
  await prisma.creatorProfile.update({where:{userId},data:{currentTrackData:trackId?same?profile.currentTrackData:JSON.stringify(await trackController.resolveTrack(trackId)):null,playbackSeenAt:trackId?new Date():null,playbackSessionId:trackId?sessionId||null:null}});
  await prisma.telegramNowPlaying.upsert({where:{userId},create:{userId,desiredTrackId:desired,seenAt:trackId?new Date():null},update:{desiredTrackId:desired,seenAt:trackId?new Date():null}});
  void enqueue(userId,()=>reconcile(userId)).catch(error=>{void reportFailure(userId,error);});
}
export async function refreshTelegramIntegration(userId:string){
  const profile=await prisma.creatorProfile.findUnique({where:{userId}});
  const trackId=profile?.currentTrackData&&profile.playbackSeenAt&&Date.now()-profile.playbackSeenAt.getTime()<TTL?JSON.parse(profile.currentTrackData)?.id as string|undefined:undefined;
  await prisma.telegramNowPlaying.upsert({where:{userId},create:{userId,desiredTrackId:profile?.telegramFullIntegration?trackId:null,seenAt:profile?.playbackSeenAt},update:{desiredTrackId:profile?.telegramFullIntegration?trackId:null}});
  await enqueue(userId,()=>reconcile(userId)).catch(error=>reportFailure(userId,error));
}
export async function clearNowPlayingOnExit(userId:string){
  await prisma.creatorProfile.updateMany({where:{userId},data:{currentTrackData:null,playbackSeenAt:null,playbackSessionId:null}});
  await prisma.telegramNowPlaying.updateMany({where:{userId},data:{desiredTrackId:null,seenAt:null}});
  await enqueue(userId,()=>reconcile(userId)).catch(error=>reportFailure(userId,error));
}
export async function expireNowPlaying(){
  const stale=await prisma.telegramNowPlaying.findMany({where:{OR:[{operationState:{in:['uploading','saving','clearing']}},{trackId:{not:null},OR:[{seenAt:null},{seenAt:{lt:new Date(Date.now()-TTL)}}]}]}});
  await Promise.allSettled(stale.map(row=>enqueue(row.userId,()=>reconcile(row.userId)).catch(error=>reportFailure(row.userId,error))));
}
