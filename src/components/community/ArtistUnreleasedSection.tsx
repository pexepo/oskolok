import React from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ExternalLink,Play,Plus,Hammer,FileText} from 'lucide-react';
import {communityApi} from '../../api/communityClient.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import {useTranslation,useLanguageStore} from '../../stores/useLanguageStore.js';
import {TrackRow} from '../tracks/TrackRow.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import type {Track} from '../../types/index.js';
import {WipPlaceholder} from '../common/WipPlaceholder.js';
import {UNRELEASED_OPEN} from '../../config/beta.js';
import '../../styles/community.css';

const formatDate=(date:string|undefined,language:string)=>{if(!date)return undefined;const [y,m,d]=date.split('-').map(Number);if(!m)return String(y);return new Intl.DateTimeFormat(language==='en'?'en-US':'ru-RU',d?{day:'numeric',month:'long',year:'numeric'}:{month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,d||1)));};

/** «Анрелизы» (approved community uploads), «В разработке» and «Неизданное на Genius» for one artist. */
export function ArtistUnreleasedSection({artistName,artistIds}:{artistName:string;artistIds:string[]}){
 const t=useTranslation(),language=useLanguageStore(s=>s.language),play=usePlayerStore(s=>s.playCollection);
 const uploads=useQuery({queryKey:['artist-unreleased',artistName,artistIds.join(',')],queryFn:()=>communityApi.artistUnreleased(artistName,artistIds),staleTime:5*60000,retry:1,enabled:UNRELEASED_OPEN});
 const genius=useQuery({queryKey:['genius-upcoming',artistName],queryFn:()=>communityApi.geniusUpcoming(artistName),staleTime:60*60000,retry:1});
 const tracks=uploads.data||[],upcoming=genius.data?.upcoming||[],songs=genius.data?.unreleased||[];
 // Genius songs with a matching approved upload join the queue of playable unreleased tracks.
 const geniusPlayable=songs.map(s=>s.track).filter(Boolean) as Track[];
 const queue=[...tracks,...geniusPlayable.filter(g=>!tracks.some(tr=>tr.id===g.id))];
 const suggest=`/unreleased?${new URLSearchParams({artist:artistName,...(artistIds[0]?{artistId:artistIds[0]}:{})})}`;
 return <>
  {!UNRELEASED_OPEN?<WipPlaceholder compact title={t('Анрелизы пока на стройке','Unreleased is under construction')} text={t('Скоро здесь будут сливы и сниппеты этого артиста.','Leaks and snippets of this artist will live here soon.')}/>:<section className="artist-tracks crystal-slab unrel-artist">
   <div className="artist-toolbar"><h2>{t('Анрелизы','Unreleased')}</h2>{tracks.length>0&&<small>{tracks.length}</small>}<Link to={suggest} className="text-button unrel-suggest"><Plus size={14}/>{t('Предложить','Submit')}</Link></div>
   {tracks.length?tracks.map((track,i)=><TrackRow key={track.id} track={track} index={i} collection={tracks}/>):<p className="artist-empty-line">{uploads.isPending?t('Загружаем…','Loading…'):t('Пока нет одобренных анрелизов. Есть слив или сниппет? Предложите его.','No approved unreleased tracks yet. Have a leak or snippet? Submit it.')}</p>}
  </section>}
  {upcoming.length>0&&<section className="artist-releases unrel-upcoming">
   <div className="artist-toolbar"><h2><Hammer size={18}/>{t('В разработке','In development')}</h2><small>Genius</small></div>
   <div className="artist-release-grid">{upcoming.map(a=><a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="artist-release">
    <span className="artist-release-cover"><ArtworkImage src={a.cover} alt={a.name} className="w-full h-full"/><i/></span>
    <strong>{a.name}</strong><small>{a.dateKnown?formatDate(a.date,language):t('Дата не объявлена','Date TBA')}{a.trackCount?` · ${a.trackCount} ${t('треков','tracks')}`:''}</small>
   </a>)}</div>
  </section>}
  {songs.length>0&&<section className="artist-tracks crystal-slab unrel-genius">
   <div className="artist-toolbar"><h2>{t('Неизданное на Genius','Unreleased on Genius')}</h2><small>{songs.length}</small></div>
   <ul>{songs.map(s=><li key={s.id}>
    {s.track?<button className="unrel-play" aria-label={t('Слушать','Play')} onClick={()=>void play(queue,Math.max(0,queue.findIndex(q=>q.id===s.track!.id)))}><ArtworkImage src={s.track.artworkUrl||s.art} alt="" className="w-full h-full"/><Play size={14} fill="currentColor"/></button>:<span className="unrel-play is-static"><ArtworkImage src={s.art} alt="" className="w-full h-full"/></span>}
    <span className="unrel-meta"><strong>{s.title}</strong><small>{[s.track?t('Есть запись','Playable'):'',s.reason==='future'&&s.date?formatDate(s.date,language):'',s.views?`${new Intl.NumberFormat(language==='en'?'en-US':'ru-RU',{notation:'compact'}).format(s.views)} ${t('просмотров','views')}`:''].filter(Boolean).join(' · ')||t('Не издано','Unreleased')}</small></span>
    <a className="text-button" href={s.url} target="_blank" rel="noreferrer"><FileText size={14}/>{t('Текст','Lyrics')}<ExternalLink size={12}/></a>
   </li>)}</ul>
  </section>}
 </>;
}
