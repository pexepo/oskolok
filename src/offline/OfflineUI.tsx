import React,{useEffect,useState} from 'react';
import {NavLink} from 'react-router-dom';
import {ArrowDownToLine,CheckCircle2,Loader2,Trash2,WifiOff} from 'lucide-react';
import {useTranslation} from '../stores/useLanguageStore.js';
import {useOfflineMode} from '../telegram/runtime.js';
import {downloadTracks,removeDownloads,useOfflineStore,loadOfflineIndex} from './offlineStore.js';
import type {Track} from '../types/index.js';
import './offline.css';

/** Spotify-style download toggle for a playlist or the liked tracks. */
export function DownloadCollectionButton({tracks,className=''}:{tracks:Track[];className?:string}){
  const t=useTranslation();
  useEffect(()=>{loadOfflineIndex();},[]);
  const ids=tracks.map(x=>x.id);
  const done=useOfflineStore(s=>ids.filter(id=>s.entries[id]).length);
  const busy=useOfflineStore(s=>ids.filter(id=>s.pending[id]==='queued'||s.pending[id]==='downloading').length);
  const [confirm,setConfirm]=useState(false);
  if(!tracks.length)return null;
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
    <span>{online?t('Сеть вернулась.','Back online.'):t('Нет сети.','No connection.')} {count?t(`Скачано треков: ${count}`,`Downloaded tracks: ${count}`):t('Скачанной музыки пока нет','No downloaded music yet')}</span>
    {online?<button type="button" onClick={()=>location.reload()}>{t('Подключиться','Reconnect')}</button>:count>0&&<NavLink to="/offline">{t('Слушать','Listen')}</NavLink>}
  </div>;
}
