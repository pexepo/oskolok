import {create} from 'zustand';
import {apiClient} from '../api/apiClient.js';
import {audioManager} from '../audio/AudioManager.js';
import {queueManager} from '../audio/QueueManager.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {useToastStore} from '../stores/useToastStore.js';
import {tr} from '../stores/useLanguageStore.js';
import {getPreferredSource,inTelegramMiniApp,setPreferredSource,telegramSourceActive} from '../utils/playbackPreferences.js';
import {openTelegramChat,requestBotWriteAccess,scopedStorageKey,useTelegramStore} from './runtime.js';
import type {Track} from '../types/index.js';
import {hashQueue,queueWindow} from './playbackQueue.js';
import {cuedSessionSavedAt} from '../audio/sessionRestore.js';
export {hashQueue,queueWindow};

/** Серверная копия воспроизведения: восстановление после закрытия Mini App и режим «источник Telegram». */
export type ServerPlayback={queue:Track[];queueHash:string;index:number;position:number;isPlaying:boolean;mode:'app'|'telegram';updatedAt:string;clientSessionId:string|null};
export const useTelegramPlayback=create<{remote:ServerPlayback|null;sending:boolean;error:string;resume:ServerPlayback|null;recommend:boolean}>(()=>({remote:null,sending:false,error:'',resume:null,recommend:false}));
const clientSessionId=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():String(Date.now());
function snapshot(track?:Track){
  const q=queueManager.getState();
  const current=q.playbackQueue[q.currentIndex];
  if(track&&current?.id!==track.id)return {tracks:[track],index:0,hash:hashQueue([track])};
  if(!current)return null;
  const w=queueWindow(q.playbackQueue,q.currentIndex);
  return {...w,hash:hashQueue(w.tracks)};
}
export const fmtTime=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
let sentHash='';
async function put(path:string,body:Record<string,unknown>,keepalive=false){
  return apiClient.request<any>(path,{method:path.endsWith('/session')?'PUT':'POST',body:JSON.stringify(body),keepalive});
}
/** Позиция и очередь — на сервер: при смене трека, паузе и раз в 5 с во время игры. */
export async function pushPlayback(keepalive=false){
  if(!useTelegramStore.getState().user||handedOff)return;
  const s=usePlayerStore.getState();if(!s.currentTrack)return;
  const snap=snapshot();if(!snap)return;
  const body={queueHash:snap.hash,index:snap.index,position:Math.round((s.currentTime||0)*10)/10,isPlaying:s.isPlaying,clientSessionId};
  try{
    const r=await put('/playback/session',snap.hash!==sentHash&&!keepalive?{...body,queue:snap.tracks}:body,keepalive);
    if(r?.needQueue&&!keepalive)await put('/playback/session',{...body,queue:snap.tracks});
    if(!keepalive)sentHash=snap.hash;
  }catch{/* следующая попытка через 5 с */}
}
function showRemote(state:ServerPlayback|null){
  useTelegramPlayback.setState({remote:state});
  const track=state?.mode==='telegram'?state.queue[state.index]:undefined;
  if(track)audioManager.setExternalTrack(track);
}
let writeAccessAsked=false;
async function playInTelegram(track:Track){
  const snap=snapshot(track);if(!snap)return;
  useTelegramPlayback.setState({sending:true,error:''});
  try{
    if(!writeAccessAsked){writeAccessAsked=true;await requestBotWriteAccess().catch(()=>{});}
    const body={queueHash:snap.hash,index:snap.index};
    let r=await put('/playback/telegram/play',snap.hash!==sentHash?{...body,queue:snap.tracks}:body);
    if(r?.needQueue)r=await put('/playback/telegram/play',{...body,queue:snap.tracks});
    sentHash=snap.hash;
    showRemote(r?.state||null);
    const hintKey=scopedStorageKey('tg-source-hint');
    if(!localStorage.getItem(hintKey)){localStorage.setItem(hintKey,'1');useToastStore.getState().addToast(tr('Трек придёт в чат с ботом — Telegram сыграет его в фоне. Текст, караоке и аннотации идут здесь; если разошлись со звуком — подвиньте ползунок.','The track goes to the bot chat and Telegram plays it in the background. Lyrics and annotations run here; if they drift, drag the slider.'),'info',7000);}
  }catch(e){
    const message=e instanceof Error?e.message:tr('Не удалось отправить трек в Telegram.','Could not send the track to Telegram.');
    useTelegramPlayback.setState({error:message});useToastStore.getState().addToast(message,'warning');
  }finally{useTelegramPlayback.setState({sending:false});}
}
export async function stepTelegram(delta:number){
  try{const state=await put('/playback/telegram/step',{delta});showRemote(state);}
  catch(e){useToastStore.getState().addToast(e instanceof Error?e.message:tr('Бот не ответил. Попробуйте ещё раз.','The bot did not respond. Try again.'),'warning');}
}
async function pollRemote(){
  if(!telegramSourceActive()||!handedOff)return;
  try{showRemote(await apiClient.request<ServerPlayback|null>('/playback/session'));}catch{}
}
/** Продолжить с сохранённой позиции: очередь и трек восстанавливаются, перемотка — как только аудио узнает длительность. */
export async function resumePlayback(state:ServerPlayback){
  useTelegramPlayback.setState({resume:null});
  const target=state.queue[state.index];if(!target)return;
  await usePlayerStore.getState().playCollection(state.queue,state.index);
  if(state.position<3||telegramSourceActive())return;
  const stop=usePlayerStore.subscribe(s=>{if(s.currentTrack?.id===target.id&&s.duration>0){stop();clearTimeout(timer);if(state.position<s.duration-2)usePlayerStore.getState().seek(state.position);}});
  const timer=setTimeout(stop,30000);
}
export function dismissResume(){useTelegramPlayback.setState({resume:null});}
const recommendKey=()=>scopedStorageKey('tg-source-recommended');
export function answerRecommendation(accept:boolean){
  try{localStorage.setItem(recommendKey(),accept?'accepted':'later');}catch{}
  useTelegramPlayback.setState({recommend:false});
  if(accept){setPreferredSource('telegram');useToastStore.getState().addToast(tr('Источник — Telegram. Включите трек, и бот пришлёт его в чат.','Source set to Telegram. Play a track and the bot will send it to your chat.'),'success',4000);}
}
/**
 * Source «Telegram» = play inside the Mini App while it is open (starts instantly), and hand the queue to the bot
 * when the Mini App is closed or minimised, so the music goes on in Telegram's own player. Telegram never lets a
 * bot press play for the user: the first handed-off track needs one tap, the rest of the queue follows by itself.
 */
let handedOff=false;
function handOff(){
  if(handedOff||!telegramSourceActive())return;
  const s=usePlayerStore.getState();if(!s.currentTrack||!s.isPlaying)return;
  const snap=snapshot();if(!snap)return;
  handedOff=true;
  const body:Record<string,unknown>={queueHash:snap.hash,index:snap.index,position:Math.round(s.currentTime||0)};
  if(snap.hash!==sentHash)body.queue=snap.tracks;
  void put('/playback/telegram/play',body,true).catch(()=>{});
  audioManager.pause();
}
function takeBack(){
  if(!handedOff)return;
  handedOff=false;audioManager.stopExternalClock();
  void put('/playback/telegram/stop',{}).catch(()=>{});
  useToastStore.getState().addToast(tr('Вы вернулись — музыка снова играет здесь. Нажмите ▶, чтобы продолжить.','Welcome back — music plays here again. Press ▶ to continue.'),'info',4000);
}
/** Nothing plays here — or only this device's own restored session, older than the server copy from another device. */
function idleFor(state:ServerPlayback){
  const s=usePlayerStore.getState();if(!s.currentTrack)return true;
  const cued=cuedSessionSavedAt();
  return cued!==null&&Date.parse(state.updatedAt)>cued+30000&&state.queue[state.index]?.id!==s.currentTrack.id;
}
let started=false;
/** Однократная инициализация: перехват источника Telegram, синхронизация позиции, восстановление и рекомендация. */
export function initTelegramPlayback(){
  if(started||typeof window==='undefined')return;started=true;
  audioManager.externalPlayback={active:()=>telegramSourceActive()&&handedOff,play:track=>{void playInTelegram(track);},resume:openTelegramChat,step:delta=>{void stepTelegram(delta);}};
  let last={id:'',playing:false};
  usePlayerStore.subscribe(s=>{
    const id=s.currentTrack?.id||'';
    if(id!==last.id||s.isPlaying!==last.playing){last={id,playing:s.isPlaying};if(id)void pushPlayback();}
  });
  setInterval(()=>{if(usePlayerStore.getState().isPlaying)void pushPlayback();},5000);
  setInterval(()=>{void pollRemote();},6000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){void pushPlayback(true);handOff();}else takeBack();});
  window.addEventListener('pagehide',()=>{void pushPlayback(true);handOff();});
  const tg=(window as unknown as {Telegram?:{WebApp?:{onEvent?:(e:string,cb:()=>void)=>void}}}).Telegram?.WebApp;
  tg?.onEvent?.('deactivated',handOff);tg?.onEvent?.('activated',takeBack);
  let wasTelegram=telegramSourceActive();
  window.addEventListener('oskolok-source-change',()=>{
    const now=telegramSourceActive();
    if(wasTelegram&&!now){audioManager.stopExternalClock();useTelegramPlayback.setState({remote:null});void put('/playback/telegram/stop',{}).catch(()=>{});}
    wasTelegram=now;
  });
  void (async()=>{
    if(!useTelegramStore.getState().user)return;
    let state:ServerPlayback|null=null;
    try{state=await apiClient.request<ServerPlayback|null>('/playback/session');}catch{}
    const fresh=state&&state.queue.length&&Date.now()-Date.parse(state.updatedAt)<3*86400000;
    if(state&&fresh&&state.mode==='telegram'&&telegramSourceActive()&&!usePlayerStore.getState().currentTrack){
      // The chat was playing while the app was closed: take the queue back and offer to continue here.
      void put('/playback/telegram/stop',{}).catch(()=>{});
      useTelegramPlayback.setState({resume:{...state,mode:'app'}});
    }else if(state&&fresh&&state.mode==='app'&&state.clientSessionId!==clientSessionId&&(state.position>=5||state.index>0)&&idleFor(state)){
      useTelegramPlayback.setState({resume:state});
    }
    let answered='';try{answered=localStorage.getItem(recommendKey())||'';}catch{}
    void answered; // the Telegram source is retired, nothing to recommend
  })();
}
