import React from 'react';
import {Modal} from '../common/Modal.js';
import {apiClient} from '../../api/apiClient.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {setRecording,setRecordingBetaEnabled,recordingBetaEnabled} from '../../utils/playbackPreferences.js';
import type {Track} from '../../types/index.js';

export function RecordingPicker({track,source,onClose,onSelect}:{track:Track;source:string;onClose:()=>void;onSelect:()=>void}){
 const t=useTranslation(),[items,setItems]=React.useState<Array<Track&{censored?:boolean}>>([]),[loading,setLoading]=React.useState(true),[error,setError]=React.useState(''),[beta,setBeta]=React.useState(recordingBetaEnabled),[votes,setVotes]=React.useState<Record<string,boolean>>({}),[preview,setPreview]=React.useState<Track|null>(null);
 const [showAll,setShowAll]=React.useState(false);
 const audio=React.useRef<HTMLAudioElement>(null),pausedPlayer=React.useRef<{id:string;playing:boolean}>();
 React.useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');apiClient.request<Array<Track&{censored?:boolean}>>(`/tracks/${encodeURIComponent(track.id)}/recordings?source=${source}`,{signal:controller.signal}).then(rows=>{setItems(rows);setVotes(Object.fromEntries(rows.filter(row=>typeof row.censored==='boolean').map(row=>[row.id,row.censored as boolean])));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[track.id,source]);
 React.useEffect(()=>{const element=audio.current;return()=>element?.pause();},[preview?.id]);
 React.useEffect(()=>()=>{const p=usePlayerStore.getState(),prior=pausedPlayer.current;if(prior?.playing&&p.currentTrack?.id===prior.id&&!p.isPlaying&&!p.isBuffering)p.togglePlay();},[]);
 const vote=async(id:string,censored:boolean)=>{try{await apiClient.request(`/tracks/${encodeURIComponent(track.id)}/recordings/vote`,{method:'POST',body:JSON.stringify({source,recordingId:id,censored})});setVotes(v=>({...v,[id]:censored}));}catch(e){setError((e as Error).message);}};
 return <Modal isOpen onClose={onClose} title={`${source==='youtube'?'YouTube':'SoundCloud'} · ${t('Аудиодорожки','Recordings')}`}>
  <label className="recording-beta"><input type="checkbox" checked={beta} onChange={e=>{setBeta(e.target.checked);setRecordingBetaEnabled(e.target.checked);}}/>{t('Альфа/бета: сравнить три записи и отметить цензуру','Alpha/beta: compare three recordings and mark censorship')}</label>
  {loading&&<p role="status">{t('Ищем доступные записи…','Finding recordings…')}</p>}{error&&<p role="alert">{error}</p>}
  {!loading&&!items.length&&<p>{t('Других записей пока не найдено','No other recordings found')}</p>}
  {preview&&<audio ref={audio} key={preview.id} controls autoPlay src={apiClient.getStreamUrl(preview.id,source,true)} onPlay={()=>{const p=usePlayerStore.getState();if(!pausedPlayer.current&&p.currentTrack)pausedPlayer.current={id:p.currentTrack.id,playing:p.isPlaying};if(p.isPlaying)p.togglePlay();}} onTimeUpdate={e=>{if(e.currentTarget.currentTime>=15){e.currentTarget.pause();e.currentTarget.currentTime=0;}}} onError={()=>setError(t('Эта запись недоступна. Попробуйте другую.','This recording is unavailable. Try another.'))}/>}
  {(beta&&!showAll?items.slice(0,3):items).map(item=><article className="recording-option" key={item.id}><strong>{item.title}</strong><small>{item.artist.name} · {Math.floor(item.duration/60)}:{String(Math.round(item.duration%60)).padStart(2,'0')}</small><div><button className="secondary-button" onClick={()=>{audio.current?.pause();setPreview(item);if(preview?.id===item.id){const a=audio.current;if(a){a.currentTime=0;void a.play().catch(()=>setError(t('Не удалось запустить превью','Could not play preview')));}}}}>{t('Превью · 15 секунд','Preview · 15 seconds')}</button><button className="primary-button" onClick={()=>{setRecording(track.id,source,item.id);onSelect();onClose();}}>{t('Выбрать','Choose')}</button></div>{beta&&<div><button className="secondary-button" aria-pressed={votes[item.id]===true} onClick={()=>void vote(item.id,true)}>{t('Есть цензура','Censored')}</button><button className="secondary-button" aria-pressed={votes[item.id]===false} onClick={()=>void vote(item.id,false)}>{t('Без цензуры','Uncensored')}</button></div>}</article>)}
  {beta&&items.length>3&&<button className="text-button" onClick={()=>setShowAll(!showAll)}>{showAll?t("Показать три записи","Show three recordings"):t("Все аудиодорожки","All recordings")}</button>}
  <button className="text-button" onClick={()=>{setRecording(track.id,source);onSelect();onClose();}}>{t('Автоматический подбор','Automatic recording')}</button>
  <button className="text-button" onClick={onClose}>{t('Пропустить','Skip')}</button>
 </Modal>;
}
