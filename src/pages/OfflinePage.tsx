import React,{useEffect,useMemo,useState} from 'react';
import {ArrowDownToLine,Play,Shuffle,Trash2,X,HardDrive} from 'lucide-react';
import {useTranslation} from '../stores/useLanguageStore.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {formatBytes,loadOfflineIndex,offlineArtworkUrl,removeDownloads,totalOfflineBytes,useOfflineStore} from '../offline/offlineStore.js';
import {formatTime} from '../utils/formatters.js';
import type {Track} from '../types/index.js';
import '../offline/offline.css';

const plural=(n:number,one:string,few:string,many:string)=>{const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many;};

/** Cover from the device's own copy: the network may be gone. */
function OfflineCover({track}:{track:Track}){
  const [src,setSrc]=useState<string|null>(null);
  useEffect(()=>{let url:string|null=null,alive=true;void offlineArtworkUrl(track.id).then(u=>{url=u;if(alive)setSrc(u);});return()=>{alive=false;if(url)URL.revokeObjectURL(url);};},[track.id]);
  return src?<img src={src} alt="" className="offline-row__art" loading="lazy"/>:<span className="offline-row__art is-empty" aria-hidden="true"><ArrowDownToLine size={16}/></span>;
}

/** «Скачанное»: everything kept on this device; works without a network. */
export function OfflinePage(){
  const t=useTranslation();
  useEffect(()=>{loadOfflineIndex();},[]);
  const entries=useOfflineStore(s=>s.entries),pending=useOfflineStore(s=>s.pending),bytes=useOfflineStore(totalOfflineBytes);
  const playCollection=usePlayerStore(s=>s.playCollection),currentId=usePlayerStore(s=>s.currentTrack?.id);
  const [quota,setQuota]=useState<number|null>(null),[confirm,setConfirm]=useState(false);
  useEffect(()=>{void navigator.storage?.estimate?.().then(e=>setQuota(e.quota||null)).catch(()=>{});},[bytes]);
  const tracks=useMemo(()=>Object.values(entries).sort((a,b)=>b.savedAt-a.savedAt).map(e=>e.track),[entries]);
  const busy=Object.values(pending).filter(s=>s==='queued'||s==='downloading').length;
  const failed=Object.values(pending).filter(s=>s==='error').length;
  const shuffled=()=>{const list=[...tracks];for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;};
  return <div className="offline-page">
    <div className="collection-heading">
      <span className="eyebrow">{t('Без интернета','No internet needed')}</span>
      <h1>{t('Скачанное','Downloads')} <em>{t('на устройстве','on this device')}</em></h1>
      <p className="offline-page__meta"><HardDrive size={15} aria-hidden="true"/>{t(`${tracks.length} ${plural(tracks.length,'трек','трека','треков')} · ${formatBytes(bytes)}`,`${tracks.length} tracks · ${formatBytes(bytes)}`)}{quota?t(` из ~${formatBytes(quota)} доступных`,` of ~${formatBytes(quota)} available`):''}{busy?t(` · скачивается ${busy}`,` · ${busy} downloading`):''}{failed?t(` · не удалось: ${failed}`,` · failed: ${failed}`):''}</p>
      {tracks.length>0&&<div className="offline-page__actions">
        <button type="button" className="sg-btn sg-btn--primary" onClick={()=>void playCollection(tracks,0,undefined,'offline')}><Play size={15}/>{t('Слушать','Play')}</button>
        <button type="button" className="sg-btn" onClick={()=>void playCollection(shuffled(),0,undefined,'offline')}><Shuffle size={15}/>{t('Вперемешку','Shuffle')}</button>
        {confirm?<span className="offline-toggle is-confirm">{t('Удалить всё скачанное?','Remove all downloads?')}<button type="button" onClick={()=>{setConfirm(false);void removeDownloads(tracks.map(x=>x.id));}}>{t('Удалить','Remove')}</button><button type="button" onClick={()=>setConfirm(false)}>{t('Нет','No')}</button></span>
          :<button type="button" className="text-button" onClick={()=>setConfirm(true)}><Trash2 size={14}/>{t('Удалить всё','Remove all')}</button>}
      </div>}
    </div>
    {!tracks.length&&!busy&&<section className="offline-empty">
      <ArrowDownToLine size={38} aria-hidden="true"/>
      <h2>{t('Пока ничего не скачано','Nothing downloaded yet')}</h2>
      <p>{t('Нажмите «Скачать» в «Мне нравится» или в плейлисте, или выберите «Скачать на устройство» в меню трека. Скачанное играет без интернета — в метро, в самолёте, в дороге.','Press «Download» in Liked or a playlist, or pick «Download» in a track’s menu. Downloads play without internet — on the subway, a plane or the road.')}</p>
    </section>}
    {tracks.length>0&&<ol className="offline-list">{tracks.map((track,i)=><li key={track.id} className={`offline-row${track.id===currentId?' is-current':''}`}>
      <button type="button" className="offline-row__play" onClick={()=>void playCollection(tracks,i,undefined,'offline')}>
        <OfflineCover track={track}/>
        <span className="offline-row__text"><b>{track.title}</b><small>{track.artist.name}</small></span>
        <span className="offline-row__time">{formatTime(track.duration||0)}</span>
      </button>
      <button type="button" className="offline-row__remove" aria-label={t(`Удалить «${track.title}» с устройства`,`Remove “${track.title}” from device`)} onClick={()=>void removeDownloads([track.id])}><X size={16}/></button>
    </li>)}</ol>}
  </div>;
}
export default OfflinePage;
