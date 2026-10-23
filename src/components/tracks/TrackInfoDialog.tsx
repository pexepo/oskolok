import React from 'react';
import {ArrowUpRight,CalendarDays,Disc3,Languages,MapPin} from 'lucide-react';
import {Modal} from '../common/Modal.js';
import {LoadingState} from '../common/LoadingState.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import {apiClient} from '../../api/apiClient.js';
import {useLanguageStore,useTranslation} from '../../stores/useLanguageStore.js';
import type {Track} from '../../types/index.js';
import {CreditsList,displayName,useRelationLabel,useReleaseDate,useTrackInfo} from './TrackCredits.js';

/** The Genius bio, translated into the interface language on request. */
function SongBio({text}:{text:string}){
 const t=useTranslation(),language=useLanguageStore(s=>s.language);
 const paragraphs=React.useMemo(()=>text.split(/\n+/).map(p=>p.trim()).filter(Boolean),[text]);
 const [translated,setTranslated]=React.useState<string[]|null>(null),[showTranslation,setShowTranslation]=React.useState(false),[busy,setBusy]=React.useState(false),[same,setSame]=React.useState(false);
 const [expanded,setExpanded]=React.useState(false);
 React.useEffect(()=>{setTranslated(null);setShowTranslation(false);setSame(false);},[text,language]);
 const translate=async()=>{
  if(translated){setShowTranslation(v=>!v);return;}
  setBusy(true);
  try{const result=await apiClient.translateLyrics(paragraphs,language);if(result.sameLanguage)setSame(true);else{setTranslated(result.translations);setShowTranslation(true);}}
  catch{/* keep the original */}
  finally{setBusy(false);}
 };
 const shown=showTranslation&&translated?translated:paragraphs,long=text.length>420;
 return <section className="track-info-bio">
  <div className={`track-info-bio-text${long&&!expanded?' is-clamped':''}`}>{shown.map((p,i)=><p key={i}>{p}</p>)}</div>
  <div className="track-info-bio-actions">
   {long&&<button type="button" className="text-button" onClick={()=>setExpanded(v=>!v)}>{expanded?t('Свернуть','Show less'):t('Читать дальше','Read more')}</button>}
   {!same&&<button type="button" className="text-button" onClick={()=>void translate()} disabled={busy} aria-pressed={showTranslation}><Languages size={14}/>{busy?t('Переводим…','Translating…'):showTranslation?t('Оригинал','Original'):t('Перевести','Translate')}</button>}
  </div>
 </section>;
}

export function TrackInfoDialog({track,isOpen,onClose}:{track:Track;isOpen:boolean;onClose:()=>void}){
 const t=useTranslation(),info=useTrackInfo(track.id,isOpen),formatDate=useReleaseDate(),relation=useRelationLabel();
 const g=info.data?.genius;
 const performers=g?[...g.primaryArtists,...g.featuredArtists].map(p=>displayName(p.name)).join(', '):track.artist.name;
 return <Modal isOpen={isOpen} onClose={onClose} title={t('О треке','About the track')} className="max-w-xl">
  <div className="track-info">
   <header className="track-info-head">
    <ArtworkImage src={track.artworkUrl||g?.artwork} alt="" className="track-info-cover"/>
    <div><strong>{track.title}</strong><span>{performers}</span></div>
   </header>
   {info.isPending?<LoadingState size="sm" label={t('Загружаем…','Loading…')}/>:info.isError?<button className="secondary-button" onClick={()=>void info.refetch()}>{t('Не удалось загрузить. Повторить','Could not load. Retry')}</button>:!g?<p className="track-info-empty">{t('На Genius пока нет страницы этой песни — описание и авторы появятся, когда её добавят.','Genius has no page for this song yet — the bio and credits will appear once it is added.')}</p>:<>
    <ul className="track-info-facts">
     {g.releaseDate&&<li><CalendarDays size={15}/><span>{t('Дата выхода','Released')}</span><strong>{formatDate(g.releaseDate)}</strong></li>}
     {g.album&&<li><Disc3 size={15}/><span>{t('Альбом','Album')}</span><strong>{g.album.url?<a href={g.album.url} target="_blank" rel="noreferrer">{g.album.name}</a>:g.album.name}</strong></li>}
     {g.recordingLocation&&<li><MapPin size={15}/><span>{t('Записано','Recorded at')}</span><strong>{g.recordingLocation}</strong></li>}
    </ul>
    {g.description&&<SongBio text={g.description}/>}
    <CreditsList info={g}/>
    {g.relationships.length>0&&<dl className="credits-list track-info-relations">{g.relationships.map(r=><div className="credits-row" key={r.type}><dt>{relation(r.type)}</dt><dd>{r.songs.map(s=><a key={s.url} className="credit-person credit-person--plain" href={s.url} target="_blank" rel="noreferrer">{displayName(s.artist)} — {s.title}</a>)}</dd></div>)}</dl>}
    <a className="credits-genius-link" href={g.url} target="_blank" rel="noreferrer">{t('Страница песни на Genius','Song page on Genius')} <ArrowUpRight size={13}/></a>
   </>}
  </div>
 </Modal>;
}
