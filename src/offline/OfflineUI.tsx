import React,{useEffect,useState} from 'react';
import {NavLink,useLocation,useNavigate} from 'react-router-dom';
import {ArrowDownToLine,Check,CheckCircle2,Loader2,Trash2,WifiOff} from 'lucide-react';
import {useLibraryStore} from '../stores/useLibraryStore.js';
import {useTranslation} from '../stores/useLanguageStore.js';
import {useOfflineMode} from '../telegram/runtime.js';
import {downloadTracks,removeDownloads,useOfflineStore,loadOfflineIndex,formatBytes,getOfflinePrefs,setOfflinePrefs,knowsNetworkType,totalOfflineBytes,type OfflinePrefs} from './offlineStore.js';
import type {Track} from '../types/index.js';
import {isAppShell} from '../utils/nativeShell.js';
import './offline.css';

/** Spotify-style download toggle for a playlist or the liked tracks. */
export function DownloadCollectionButton({tracks,className=''}:{tracks:Track[];className?:string}){
  const t=useTranslation();
  useEffect(()=>{loadOfflineIndex();},[]);
  const ids=tracks.map(x=>x.id);
  const done=useOfflineStore(s=>ids.filter(id=>s.entries[id]).length);
  const busy=useOfflineStore(s=>ids.filter(id=>s.pending[id]==='queued'||s.pending[id]==='downloading').length);
  const [confirm,setConfirm]=useState(false);
  if(!tracks.length||!isAppShell())return null;
  const all=done===tracks.length;
  if(busy)return <button type="button" className={`offline-toggle is-busy ${className}`} aria-live="polite" onClick={()=>void removeDownloads(ids.filter(id=>!useOfflineStore.getState().entries[id]))} title={t('Остановить скачивание','Stop downloading')}>
    <Loader2 size={16} className="offline-spin" aria-hidden="true"/>{t(`Скачиваем ${done} из ${tracks.length}`,`Downloading ${done} of ${tracks.length}`)}
  </button>;
  if(all)return confirm
    ?<span className={`offline-toggle is-confirm ${className}`}>{t('Удалить с устройства?','Remove from device?')}<button type="button" onClick={()=>{setConfirm(false);void removeDownloads(ids);}}>{t('Удалить','Remove')}</button><button type="button" onClick={()=>setConfirm(false)}>{t('Нет','No')}</button></span>
    :<button type="button" className={`offline-toggle is-done ${className}`} onClick={()=>setConfirm(true)} title={t('Скачано — доступно без сети','Downloaded — available offline')}><CheckCircle2 size={16} aria-hidden="true"/>{t('Скачано','Downloaded')}</button>;
  return <button type="button" className={`offline-toggle ${className}`} onClick={()=>downloadTracks(tracks)} title={t('Слушать без интернета','Listen without internet')}>
    <ArrowDownToLine size={16} aria-hidden="true"/>{done?t(`Скачать ещё ${tracks.length-done}`,`Download ${tracks.length-done} more`):t('Скачать','Download')}
  </button>;
}

/** Menu item for a single track. */
export function DownloadMenuItem({track,onDone,className}:{track:Track;onDone:()=>void;className:string}){
  const t=useTranslation();
  useEffect(()=>{loadOfflineIndex();},[]);
  const downloaded=useOfflineStore(s=>!!s.entries[track.id]),pending=useOfflineStore(s=>s.pending[track.id]);
  if(!isAppShell())return null;
  if(pending==='queued'||pending==='downloading')return <button className={className} onClick={onDone} disabled><Loader2 size={16} className="offline-spin text-[#7188a3] dark:text-slate-400"/><span>{t('Скачивается…','Downloading…')}</span></button>;
  return downloaded
    ?<button className={className} onClick={()=>{onDone();void removeDownloads([track.id]);}}><Trash2 size={16} className="text-[#7188a3] dark:text-slate-400"/><span>{t('Удалить с устройства','Remove download')}</span></button>
    :<button className={className} onClick={()=>{onDone();downloadTracks([track]);}}><ArrowDownToLine size={16} className="text-[#7188a3] dark:text-slate-400"/><span>{t('Скачать на устройство','Download')}</span></button>;
}

/** Small green arrow next to a downloaded track. */
export function DownloadedMark({id}:{id:string}){
  const t=useTranslation();
  const on=useOfflineStore(s=>!!s.entries[id]);
  return on?<span className="offline-mark" title={t('Скачано','Downloaded')} aria-label={t('Скачано','Downloaded')}><ArrowDownToLine size={11} strokeWidth={3}/></span>:null;
}

function useOnline(){
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
  useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off);};},[]);
  return online;
}
/** «Нет сети» strip: points to the downloaded music; offers to reconnect after an offline start. */
export function OfflineBanner(){
  const t=useTranslation(),online=useOnline(),offlineStart=useOfflineMode(s=>s.offline);
  useEffect(()=>{loadOfflineIndex();},[]);
  const count=useOfflineStore(s=>Object.keys(s.entries).length);
  if(online&&!offlineStart)return null;
  return <div className="offline-banner" role="status">
    <WifiOff size={15} aria-hidden="true"/>
    <span>{online?t('Сеть вернулась.','Back online.'):t('Нет сети.','No connection.')} {!isAppShell()?t('Музыка без интернета есть в приложении Осколка.','Offline music is in the Oskolok app.'):count?t(`Скачано треков: ${count}`,`Downloaded tracks: ${count}`):t('Скачанной музыки пока нет','No downloaded music yet')}</span>
    {online?<button type="button" onClick={()=>location.reload()}>{t('Подключиться','Reconnect')}</button>:count>0&&isAppShell()&&<NavLink to="/offline">{t('Слушать','Listen')}</NavLink>}
  </div>;
}

/** Settings → «Музыка без интернета» (apps only): what is stored, how much may be, and when to download. */
export function OfflineSettings({onNavigate}:{onNavigate?:()=>void}){
  const t=useTranslation();
  useEffect(()=>{loadOfflineIndex();},[]);
  const count=useOfflineStore(s=>Object.keys(s.entries).length),bytes=useOfflineStore(totalOfflineBytes);
  const [prefs,setPrefs]=useState(getOfflinePrefs),[quota,setQuota]=useState<number|null>(null),[confirm,setConfirm]=useState(false);
  useEffect(()=>{void navigator.storage?.estimate?.().then(e=>setQuota(e.quota||null)).catch(()=>{});},[bytes]);
  const liked=useLibraryStore(s=>s.likedTracks);
  if(!isAppShell())return null;
  const update=(patch:Partial<OfflinePrefs>)=>{setOfflinePrefs(patch);setPrefs(getOfflinePrefs());if(patch.autoLiked)downloadTracks(liked,{quiet:true});};
  const limits:Array<[number,string]>=[[2,t('2 ГБ','2 GB')],[5,t('5 ГБ','5 GB')],[10,t('10 ГБ','10 GB')],[0,t('Без лимита','No limit')]];
  return <section className="set-group">
    <h4>{t('Музыка без интернета','Offline music')}</h4>
    <div className="set-row"><span>{t(`Скачано: ${count} · ${formatBytes(bytes)}`,`Downloaded: ${count} · ${formatBytes(bytes)}`)}<small>{quota?t(`Устройство разрешает приложению до ~${formatBytes(quota)}. Музыка хранится только на этом устройстве.`,`This device allows the app up to ~${formatBytes(quota)}. Music stays on this device only.`):t('Музыка хранится только на этом устройстве.','Music stays on this device only.')}</small></span>
      <NavLink className="sg-btn" to="/offline" onClick={onNavigate}>{t('Открыть','Open')}</NavLink></div>
    <label className={`set-row set-check ${prefs.autoLiked?'is-on':''}`}>
      <span>{t('Скачивать «Мне нравится»','Download liked songs')}<small>{t('Все любимые треки хранятся на устройстве, новые лайки — сразу','All liked songs stay on this device, new likes right away')}</small></span>
      <input type="checkbox" checked={prefs.autoLiked} onChange={e=>update({autoLiked:e.target.checked})}/><i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3}/></i>
    </label>
    {knowsNetworkType()&&<label className={`set-row set-check ${prefs.wifiOnly?'is-on':''}`}>
      <span>{t('Только по Wi-Fi','Wi-Fi only')}<small>{t('В мобильной сети скачивание ждёт Wi-Fi','On mobile data downloads wait for Wi-Fi')}</small></span>
      <input type="checkbox" checked={prefs.wifiOnly} onChange={e=>update({wifiOnly:e.target.checked})}/><i className="set-check-box" aria-hidden="true"><Check size={14} strokeWidth={3}/></i>
    </label>}
    <div className="set-row set-row--stack"><span>{t('Лимит места','Storage limit')}<small>{t('Когда скачанное займёт столько, новые треки перестанут скачиваться','Once downloads take this much, new tracks stop downloading')}</small></span>
      <div className="set-segmented" role="radiogroup" aria-label={t('Лимит места','Storage limit')}>{limits.map(([gb,label])=><button key={gb} type="button" role="radio" aria-checked={prefs.limitGb===gb} className={prefs.limitGb===gb?'is-active':''} onClick={()=>update({limitGb:gb})}>{label}</button>)}</div></div>
    {count>0&&<div className="set-row"><span>{t('Удалить всё скачанное','Remove all downloads')}<small>{t('Освободит место; треки останутся в библиотеке','Frees space; the tracks stay in your library')}</small></span>
      {confirm?<span className="offline-toggle is-confirm">{t('Точно?','Sure?')}<button type="button" onClick={()=>{setConfirm(false);void removeDownloads(Object.keys(useOfflineStore.getState().entries));}}>{t('Удалить','Remove')}</button><button type="button" onClick={()=>setConfirm(false)}>{t('Нет','No')}</button></span>
        :<button type="button" className="sg-btn" onClick={()=>setConfirm(true)}><Trash2 size={14}/>{t('Удалить','Remove')}</button>}</div>}
  </section>;
}

/** Apps only: new likes download by themselves when the listener asked for it; an offline start opens «Скачанное». */
export function OfflineAutomation(){
  const liked=useLibraryStore(s=>s.likedTracks),offlineStart=useOfflineMode(s=>s.offline),navigate=useNavigate(),location=useLocation();
  useEffect(()=>{if(isAppShell()&&liked.length&&getOfflinePrefs().autoLiked)downloadTracks(liked,{quiet:true});},[liked]);
  useEffect(()=>{if(offlineStart&&isAppShell()&&!/^\/(offline|settings)/.test(location.pathname))navigate('/offline',{replace:true});},[offlineStart]);
  return null;
}
