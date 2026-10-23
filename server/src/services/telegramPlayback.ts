import {openAsBlob} from 'node:fs';
import {prisma} from '../database/client.js';
import {env} from '../config/env.js';
import {logger} from '../utils/logger.js';
import type {Track} from '../types/index.js';
import {trackController} from '../controllers/trackController.js';
import {studioMasterService} from './StudioMasterService.js';
import {prepareTelegramAudio} from './telegramAudioAsset.js';
import {profileMusicThumbnail} from './telegramNowPlaying.js';
import {likedRepository} from '../repositories/likedRepository.js';
import {api,BotApiError,chatAction,editText,Msg,sendPhotoUrl,sendText,type Markup} from './telegramBotApi.js';
import {createLatestQueue} from './telegramReliability.js';

/** Серверная копия воспроизведения пользователя: восстановление после падения Mini App
 * и режим «источник Telegram», где треки играет нативный плеер Telegram, а бот ведёт очередь. */
export type SessionTrack=Pick<Track,'id'|'title'|'artist'|'duration'|'artworkUrl'|'source'|'sourceId'|'access'>&Partial<Pick<Track,'release'|'explicit'>>;
export type PlaybackState={queue:SessionTrack[];queueHash:string;index:number;position:number;isPlaying:boolean;mode:'app'|'telegram';updatedAt:string;clientSessionId:string|null};
export const QUEUE_LIMIT=300;
export const playbackTiming={stepDebounceMs:700,leadSeconds:15,maxAutoAdvance:20};
const isTelegramUser=(userId:string)=>/^telegram:\d+$/.test(userId);
const chatOf=(userId:string)=>userId.slice(9);
/** Снимок трека без тяжёлых полей: очередь до 300 треков укладывается в пару сотен КБ. */
export function compactTrack(t:Partial<Track>&{id:string}):SessionTrack|null{
  if(typeof t?.id!=='string'||!t.id||t.id.length>200||typeof t.title!=='string')return null;
  return {id:t.id,title:String(t.title).slice(0,300),artist:{...(t.artist||{}),id:String(t.artist?.id||''),name:String(t.artist?.name||'').slice(0,200)} as Track['artist'],duration:Number(t.duration)||0,artworkUrl:typeof t.artworkUrl==='string'&&t.artworkUrl.length<1000?t.artworkUrl:undefined,source:t.source as Track['source'],sourceId:String(t.sourceId||''),access:(t.access||'playable') as Track['access'],...(t.release?{release:{id:String(t.release.id),title:String(t.release.title).slice(0,300)}}:{}),...(t.explicit?{explicit:true}:{})};
}
/** Окно очереди вокруг текущего трека, если клиент прислал больше лимита. */
export function windowQueue(queue:SessionTrack[],index:number,limit=QUEUE_LIMIT){
  const i=Math.max(0,Math.min(index,queue.length-1));
  if(queue.length<=limit)return {queue,index:i};
  const start=Math.max(0,Math.min(i-50,queue.length-limit));
  return {queue:queue.slice(start,start+limit),index:i-start};
}
function parse(row:{queueData:string;queueHash:string;currentIndex:number;positionSec:number;isPlaying:boolean;mode:string;updatedAt:Date;clientSessionId:string|null}):PlaybackState{
  let queue:SessionTrack[]=[];try{queue=JSON.parse(row.queueData);}catch{}
  return {queue,queueHash:row.queueHash,index:Math.max(0,Math.min(row.currentIndex,queue.length-1)),position:row.positionSec,isPlaying:row.isPlaying,mode:row.mode==='telegram'?'telegram':'app',updatedAt:row.updatedAt.toISOString(),clientSessionId:row.clientSessionId};
}
export async function getPlayback(userId:string){
  const row=await prisma.playbackSession.findUnique({where:{userId}});
  return row?parse(row):null;
}
export type ClientUpdate={queue?:Array<Partial<Track>&{id:string}>;queueHash:string;index:number;position:number;isPlaying:boolean;clientSessionId?:string};
/** Обновление от клиента. Очередь присылается только при смене хэша; иначе сервер просит её (needQueue). */
export async function saveClientPlayback(userId:string,u:ClientUpdate){
  const row=await prisma.playbackSession.findUnique({where:{userId}});
  const position=Math.max(0,Math.min(Number(u.position)||0,86400)),index=Math.max(0,Math.trunc(Number(u.index)||0));
  if(!u.queue&&row?.queueHash!==u.queueHash)return {needQueue:true};
  const data:Record<string,unknown>={queueHash:String(u.queueHash).slice(0,100),currentIndex:index,positionSec:position,isPlaying:!!u.isPlaying,clientSessionId:u.clientSessionId?.slice(0,100)||null};
  if(u.queue){const w=windowQueue(u.queue.map(compactTrack).filter(Boolean) as SessionTrack[],index);data.queueData=JSON.stringify(w.queue);data.currentIndex=w.index;}
  // Mini App снова играет сам — бот перестаёт вести очередь.
  if(row?.mode==='telegram'&&u.isPlaying){data.mode='app';cancelAuto(userId);}
  await prisma.playbackSession.upsert({where:{userId},create:{userId,...data} as never,update:data});
  return {needQueue:false};
}

const auto=new Map<string,{timer?:ReturnType<typeof setTimeout>;count:number}>();
function cancelAuto(userId:string){const a=auto.get(userId);if(a?.timer)clearTimeout(a.timer);auto.delete(userId);}
const lastSent=new Map<string,{trackId:string;index:number;at:number}>();
let menuUrl:{url?:string;at:number}={at:0};
export async function miniAppUrl(){
  if(Date.now()-menuUrl.at<600000)return menuUrl.url;
  try{const m=await api<{web_app?:{url:string}}>('getChatMenuButton');menuUrl={url:m.web_app?.url&&/^https:\/\//.test(m.web_app.url)?m.web_app.url:undefined,at:Date.now()};}
  catch{menuUrl={url:menuUrl.url,at:Date.now()-540000};}
  return menuUrl.url;
}
export async function controls(extra:Array<Array<Record<string,unknown>>>=[]):Promise<Markup>{
  const url=await miniAppUrl();
  return {inline_keyboard:[[{text:'⏮',callback_data:'pb:prev'},{text:'⏯',callback_data:'pb:toggle'},{text:'⏭',callback_data:'pb:next'}],[{text:'❤️ В любимые',callback_data:'pb:like'},{text:'📋 Очередь',callback_data:'q:0'}],...extra,...(url?[[{text:'Открыть Осколок',web_app:{url}}]]:[])]};
}
const fmt=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
export function trackCaption(t:SessionTrack,index?:number,total?:number){
  const m=new Msg().e('headphones').t(' ').b(t.title).n().t(t.artist.name||'');
  if(t.duration)m.t(` · ${fmt(t.duration)}`);
  if(index!==undefined&&total)m.n().i(`${index+1} из ${total} · Осколок`);
  return m;
}
/** Отправляет трек аудиосообщением: из кэша file_id мгновенно, иначе готовит файл (обложка и теги вшиты) и кэширует file_id. */
export async function sendTrackAudio(chat:string,track:SessionTrack,caption:Msg,reply_markup?:Markup):Promise<{message_id:number}>{
  const cached=await prisma.telegramAudioCache.findUnique({where:{trackId:track.id}});
  const base={chat_id:chat,title:track.title.slice(0,128),performer:track.artist.name.slice(0,128),duration:Math.round(track.duration||0)||undefined,caption:caption.text,caption_entities:caption.entities.filter(e=>e.type!=='custom_emoji'||process.env.TELEGRAM_BOT_CUSTOM_EMOJI!=='0')};
  if(cached){
    try{return await api<{message_id:number}>('sendAudio',{...base,audio:cached.fileId,reply_markup});}
    catch(error){if(!(error instanceof BotApiError)||error.code!==400)throw error;await prisma.telegramAudioCache.deleteMany({where:{trackId:track.id}});if(/entit|emoji/i.test(error.description))return api<{message_id:number}>('sendAudio',{...base,caption_entities:[],audio:cached.fileId,reply_markup});}
  }
  void chatAction(chat,'upload_audio');
  const ticker=setInterval(()=>void chatAction(chat,'upload_audio'),4500);
  try{
    const resolved=await trackController.resolveTrack(track.id);
    if(!resolved||resolved.access!=='playable')throw new Error('TRACK_UNAVAILABLE');
    const file=await studioMasterService.prepareExportAudio(resolved);
    if(file.size>49*1024*1024)throw new Error('TELEGRAM_FILE_TOO_LARGE');
    const cover=await profileMusicThumbnail(resolved.artworkUrl).catch(()=>({file:undefined,cleanup:async()=>{}}));
    const asset=await prepareTelegramAudio(file,resolved.title,resolved.artist.name,cover.file);
    try{
      const send=async(entities:unknown[])=>{
        const form=new FormData();
        for(const [k,v] of Object.entries({...base,caption_entities:entities,reply_markup}))if(v!==undefined)form.set(k,typeof v==='object'?JSON.stringify(v):String(v));
        form.set('audio',await openAsBlob(asset.path,{type:asset.path.endsWith('.mp3')?'audio/mpeg':'audio/mp4'}),`${resolved.artist.name} - ${resolved.title}.${asset.path.split('.').pop()}`.replace(/[\\/\r\n]/g,'_'));
        return api<{message_id:number;audio?:{file_id:string;file_unique_id?:string}}>('sendAudio',form,120000);
      };
      let sent;
      try{sent=await send(base.caption_entities);}catch(error){if(!(error instanceof BotApiError)||error.code!==400||!/entit|emoji/i.test(error.description))throw error;sent=await send([]);}
      if(sent.audio?.file_id)await prisma.telegramAudioCache.upsert({where:{trackId:track.id},create:{trackId:track.id,fileId:sent.audio.file_id,fileUniqueId:sent.audio.file_unique_id},update:{fileId:sent.audio.file_id,fileUniqueId:sent.audio.file_unique_id}}).catch(()=>{});
      return sent;
    }finally{await asset.cleanup();await cover.cleanup();}
  }finally{clearInterval(ticker);}
}
/** Рендер текущего состояния в чат: новый трек — новое аудиосообщение (так его подхватит плеер Telegram),
 * у прошлого сообщения пульт снимается, чтобы кнопки были только под актуальным треком. */
async function deliver(userId:string){
  const s=await getPlayback(userId);
  if(!s||s.mode!=='telegram'||!s.queue.length)return;
  const track=s.queue[s.index],chat=chatOf(userId),prev=lastSent.get(userId);
  if(prev?.trackId===track.id&&prev.index===s.index&&Date.now()-prev.at<10*60000)return;
  const row=await prisma.playbackSession.findUnique({where:{userId},select:{messageId:true}});
  let sent:{message_id:number};
  const caption=trackCaption(track,s.index,s.queue.length),stoppedAt=resumeAt.get(userId);
  if(stoppedAt){resumeAt.delete(userId);caption.n().i(`В Осколке остановились на ${fmt(stoppedAt)} — нажмите ▶ и перемотайте, дальше очередь пойдёт сама.`);}
  try{sent=await sendTrackAudio(chat,track,caption,await controls());}
  catch(error){
    const reason=error instanceof Error?error.message:String(error);
    logger.warn({userId,trackId:track.id,reason,event:'telegram.playback.send_failed'},'Telegram playback send failed');
    await sendText(chat,new Msg().e('warn').t(' ').b('Не получилось отправить трек').n().t(`${track.artist.name} — ${track.title}`).n().i(/TOO_LARGE/.test(reason)?'Файл больше лимита ботов (49 МБ).':/UNAVAILABLE/.test(reason)?'Трек недоступен. Нажмите ⏭, чтобы перейти дальше.':'Попробуйте ещё раз через минуту.'),{inline_keyboard:[[{text:'↻ Повторить',callback_data:'pb:retry'},{text:'⏭ Дальше',callback_data:'pb:next'}]]}).catch(()=>{});
    throw error;
  }
  lastSent.set(userId,{trackId:track.id,index:s.index,at:Date.now()});
  if(row?.messageId&&row.messageId!==sent.message_id)void api('editMessageReplyMarkup',{chat_id:chat,message_id:row.messageId,reply_markup:{inline_keyboard:[]}}).catch(()=>{});
  await prisma.playbackSession.update({where:{userId},data:{messageId:sent.message_id,isPlaying:true,positionSec:0}});
  scheduleAuto(userId,s.index,track.duration);
  logger.info({userId,trackId:track.id,index:s.index,event:'telegram.playback.sent'},'Track sent to Telegram player');
}
const deliveries=createLatestQueue(deliver,{debounceMs:playbackTiming.stepDebounceMs,onError:()=>{}});
/** Пока трек играет в Telegram, следующий отправляется за ~15 с до конца: нативный плеер продолжит его без паузы.
 * Без действий пользователя бот отправит не больше maxAutoAdvance треков подряд. */
function scheduleAuto(userId:string,index:number,duration:number){
  const prior=auto.get(userId);if(prior?.timer)clearTimeout(prior.timer);
  const count=prior?.count||0;
  if(!duration||count>=playbackTiming.maxAutoAdvance){auto.delete(userId);return;}
  const timer=setTimeout(()=>{void (async()=>{
    const s=await getPlayback(userId);
    if(!s||s.mode!=='telegram'||!s.isPlaying||s.index!==index||index+1>=s.queue.length)return;
    await prisma.playbackSession.update({where:{userId},data:{currentIndex:index+1,positionSec:0}});
    auto.set(userId,{count:count+1});
    await deliveries.now(userId);
  })().catch(error=>logger.warn({userId,reason:error instanceof Error?error.message:String(error),event:'telegram.playback.auto_failed'},'Auto-advance failed'));},Math.max(10,duration-playbackTiming.leadSeconds)*1000);
  timer.unref?.();
  auto.set(userId,{timer,count});
}
/** Mini App выбрал источник Telegram: сохраняем очередь и отдаём трек боту. */
/** Where the Mini App stopped when it handed playback to the chat: shown once in the next caption. */
const resumeAt=new Map<string,number>();
export async function startTelegramPlayback(userId:string,u:{queue?:ClientUpdate['queue'];queueHash:string;index:number;position?:number}){
  if(!isTelegramUser(userId)||!env.TELEGRAM_BOT_TOKEN)throw new Error('TELEGRAM_REQUIRED');
  const row=await prisma.playbackSession.findUnique({where:{userId}});
  if(!u.queue&&row?.queueHash!==u.queueHash)return {needQueue:true as const};
  const data:Record<string,unknown>={mode:'telegram',isPlaying:true,positionSec:0,currentIndex:Math.max(0,Math.trunc(u.index)||0),queueHash:String(u.queueHash).slice(0,100)};
  if(u.queue){const w=windowQueue(u.queue.map(compactTrack).filter(Boolean) as SessionTrack[],Number(data.currentIndex));data.queueData=JSON.stringify(w.queue);data.currentIndex=w.index;}
  await prisma.playbackSession.upsert({where:{userId},create:{userId,...data} as never,update:data});
  cancelAuto(userId);lastSent.delete(userId);
  if((u.position||0)>=5)resumeAt.set(userId,u.position!);else resumeAt.delete(userId);
  void deliveries.now(userId);
  return {needQueue:false as const,state:await getPlayback(userId)};
}
/** ⏮/⏭ из бота или Mini App: индекс меняется сразу (быстрые нажатия суммируются), отправка — после короткого дебаунса. */
export async function stepPlayback(userId:string,delta:number){
  const s=await getPlayback(userId);
  if(!s||!s.queue.length)return null;
  const index=Math.max(0,Math.min(s.queue.length-1,s.index+delta));
  if(index===s.index&&delta!==0)return {state:s,moved:false};
  await prisma.playbackSession.update({where:{userId},data:{currentIndex:index,positionSec:0,mode:'telegram',isPlaying:true}});
  cancelAuto(userId);
  if(delta===0)lastSent.delete(userId);
  void deliveries.schedule(userId);
  return {state:{...s,index,mode:'telegram' as const,isPlaying:true},moved:true};
}
export async function jumpPlayback(userId:string,index:number){const s=await getPlayback(userId);return s?stepPlayback(userId,index-s.index):null;}
export async function togglePlayback(userId:string){
  const s=await getPlayback(userId);if(!s)return null;
  const isPlaying=!s.isPlaying;
  await prisma.playbackSession.update({where:{userId},data:{isPlaying,mode:'telegram'}});
  if(isPlaying)scheduleAuto(userId,s.index,s.queue[s.index]?.duration||0);else cancelAuto(userId);
  return {...s,isPlaying};
}
export async function stopTelegramPlayback(userId:string){
  cancelAuto(userId);lastSent.delete(userId);
  await prisma.playbackSession.updateMany({where:{userId},data:{mode:'app',isPlaying:false}});
}
/** Новый сеанс бота (кнопка или /search): очередь из выбранных треков сразу в режиме Telegram. */
export async function playTracksInTelegram(userId:string,tracks:SessionTrack[],index:number){
  const queue=tracks.map(t=>compactTrack(t)).filter(Boolean) as SessionTrack[];
  return startTelegramPlayback(userId,{queue,queueHash:`bot:${Date.now()}`,index});
}
export async function likeCurrent(userId:string){
  const s=await getPlayback(userId);
  let track:Track|null=s?.queue[s.index]?await trackController.resolveTrack(s.queue[s.index].id).catch(()=>null)||s.queue[s.index] as Track:null;
  if(!track){const p=await prisma.creatorProfile.findUnique({where:{userId}});track=p?.currentTrackData?JSON.parse(p.currentTrackData):null;}
  if(!track)return null;
  await likedRepository.addLikedTrack(userId,track);
  return track;
}
/** Сейчас играет: серверная сессия или трек, опубликованный Mini App (heartbeat свежее 90 с). */
export async function currentTrack(userId:string):Promise<{track:SessionTrack;state:PlaybackState|null}|null>{
  const s=await getPlayback(userId);
  if(s?.queue[s.index]&&(s.mode==='telegram'||Date.now()-Date.parse(s.updatedAt)<6*3600000))return {track:s.queue[s.index],state:s};
  const p=await prisma.creatorProfile.findUnique({where:{userId}});
  const t=p?.currentTrackData&&p.playbackSeenAt&&Date.now()-p.playbackSeenAt.getTime()<90000?JSON.parse(p.currentTrackData):null;
  return t?{track:t,state:s}:null;
}
/** Поиск для бота: тот же ранжированный поиск, что и в приложении. */
export async function searchTracks(q:string,limit=8):Promise<SessionTrack[]>{
  const data=await new Promise<{tracks?:Track[]}>((resolve,reject)=>{
    const res={json:(b:{data?:{tracks?:Track[]}})=>resolve(b?.data||{}),status:()=>res,setHeader:()=>res} as never;
    void trackController.search({query:{q,limit:String(limit),page:'1'}} as never,res,reject);
  });
  return (data.tracks||[]).filter(t=>t.access==='playable').slice(0,limit).map(t=>compactTrack(t)).filter(Boolean) as SessionTrack[];
}
export async function sendNowCard(chat:string,userId:string){
  const now=await currentTrack(userId);
  if(!now)return null;
  const {track,state}=now;
  const m=new Msg().e('music').t(' ').b('Сейчас играет').n(2).b(track.title).n().t(track.artist.name);
  if(state?.mode==='telegram')m.n(2).i('Играет в плеере Telegram — кнопки ниже управляют очередью.');
  else if(state)m.n(2).i(`В Осколке · ${fmt(state.position)}${track.duration?` / ${fmt(track.duration)}`:''}`);
  const more=[{text:'📝 Текст',callback_data:'ly'},{text:'🌊 Похожие',callback_data:'sim'},{text:'📤 Поделиться',switch_inline_query:`${track.artist.name} ${track.title}`.slice(0,60)}];
  return sendPhotoUrl(chat,track.artworkUrl,m,await controls(state?.mode==='telegram'?[more]:[[{text:'▶️ Слушать в Telegram',callback_data:'pb:here'}],more]));
}
/** /queue: следующие треки с кнопками перехода; листание редактирует то же сообщение. */
export async function queueView(userId:string,page=0):Promise<{msg:Msg;markup:Markup}|null>{
  const s=await getPlayback(userId);
  if(!s||!s.queue.length)return null;
  const per=8,start=Math.max(0,s.index+page*per),items=s.queue.slice(start,start+per);
  const m=new Msg().e('list').t(' ').b('Очередь').t(` · ${s.queue.length} ${s.queue.length%10===1&&s.queue.length%100!==11?'трек':'треков'}`).n(2);
  items.forEach((t,i)=>{const n=start+i;(n===s.index?m.t('▶︎ ').b(`${t.artist.name} — ${t.title}`):m.t(`${n+1}. ${t.artist.name} — ${t.title}`)).n();});
  const rows:Array<Array<Record<string,unknown>>>=items.map((t,i)=>({t,n:start+i})).filter(x=>x.n!==s.index).slice(0,6).map(({t,n})=>[{text:`▸ ${n+1}. ${t.title}`.slice(0,60),callback_data:`pb:jump:${n}`}]);
  const nav=[...(page>0?[{text:'← Назад',callback_data:`q:${page-1}`}]:[]),...(start+per<s.queue.length?[{text:'Дальше →',callback_data:`q:${page+1}`}]:[])];
  return {msg:m,markup:{inline_keyboard:[...rows,...(nav.length?[nav]:[])]}};
}
export async function editOrSend(chat:string,messageId:number|undefined,m:Msg,markup:Markup){
  if(messageId)try{await editText(chat,messageId,m,markup);return;}catch{}
  await sendText(chat,m,markup);
}
