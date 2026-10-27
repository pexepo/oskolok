import {artistPath} from '../../utils/artistPath.js';
import React from 'react';
import {useQuery} from '@tanstack/react-query';
import {NavLink,useNavigate} from 'react-router-dom';
import {ArrowUpRight} from 'lucide-react';
import {Modal} from '../common/Modal.js';
import {LoadingState} from '../common/LoadingState.js';
import {apiClient} from '../../api/apiClient.js';
import {contentApi,type GeniusPerson,type GeniusSongInfo} from '../../api/userContentClient.js';
import {useLanguageStore,useTranslation} from '../../stores/useLanguageStore.js';
import {usePlayerStore} from '../../stores/usePlayerStore.js';
import type {Track} from '../../types/index.js';
import {isReupload,performerNames} from '../../utils/trackArtists.js';
export {isReupload,performerNames};

/** Genius song info for a track, shared by the info dialog, the lyrics credits and the artists popup. */
export function useTrackInfo(trackId:string|undefined,enabled=true){
 return useQuery({queryKey:['track-info',trackId],queryFn:()=>contentApi.info(trackId!),enabled:Boolean(trackId)&&enabled,staleTime:30*60*1000,retry:1});
}

const ROLES:Record<string,string>={
 producer:'Продюсер','co-producer':'Сопродюсер','additional production':'Доп. продакшн','executive producer':'Исполнительный продюсер','vocal producer':'Вокальный продюсер',
 writer:'Авторы',songwriter:'Автор песни',lyricist:'Автор текста',composer:'Композитор',beatmaker:'Битмейкер',arranger:'Аранжировка',programmer:'Программирование',
 'mixing engineer':'Сведение','assistant mixing engineer':'Ассистент сведения','mastering engineer':'Мастеринг','recording engineer':'Запись',engineer:'Звукорежиссёр','vocal engineer':'Запись вокала',
 vocals:'Вокал','additional vocals':'Доп. вокал','background vocals':'Бэк-вокал',guitar:'Гитара',bass:'Бас',drums:'Ударные',keyboards:'Клавишные',piano:'Фортепиано',synthesizer:'Синтезатор',
 'video director':'Режиссёр клипа','video producer':'Продюсер клипа',artwork:'Обложка',photographer:'Фотограф','graphic design':'Дизайн',translator:'Перевод','a&r':'A&R',
};
const RELATIONS:Record<string,string>={samples:'Семплирует',sampled_in:'Семплирован в',interpolates:'Интерполирует',interpolated_by:'Интерполирован в',cover_of:'Кавер на',covered_by:'Каверы',remix_of:'Ремикс на',remixed_by:'Ремиксы',live_version_of:'Живая версия',performed_live_as:'Живые версии',translation_of:'Перевод',translations:'Переводы'};
export function useRoleLabel(){
 const language=useLanguageStore(s=>s.language);
 return React.useCallback((role:string)=>language==='en'?role:ROLES[role.toLowerCase()]||role,[language]);
}
export function useRelationLabel(){
 const language=useLanguageStore(s=>s.language);
 return React.useCallback((type:string)=>language==='en'?type.replace(/_/g,' '):RELATIONS[type]||type.replace(/_/g,' '),[language]);
}

/** "2022-10-21" → "21 октября 2022"; partial dates stay partial. */
export function useReleaseDate(){
 const language=useLanguageStore(s=>s.language),locale=language==='en'?'en-US':'ru-RU';
 return React.useCallback((date?:string|null)=>{
  if(!date)return undefined;
  const [y,m,d]=date.split('-').map(Number);
  if(!m)return String(y);
  return new Date(y,m-1,d||1).toLocaleDateString(locale,d?{day:'numeric',month:'long',year:'numeric'}:{month:'long',year:'numeric'});
 },[locale]);
}

/** Genius names read "Слава КПСС (Slava KPSS)"; the bracketed transliteration is noise next to the photo. */
export const displayName=(name:string)=>/[^\x00-\x7F]/.test(name)?name.replace(/\s*\([\x00-\x7F]+\)\s*$/,'').trim()||name:name;

export function PersonAvatar({person,size=28}:{person:GeniusPerson;size?:number}){
 const [broken,setBroken]=React.useState(false);
 // Genius's placeholder pictures read as a broken photo: show the initial instead.
 return person.image&&!broken&&!/default_(?:avatar|cover)/.test(person.image)?<img className="credit-avatar" src={person.image} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>:<span className="credit-avatar credit-avatar--empty" style={{width:size,height:size}} aria-hidden="true">{displayName(person.name).slice(0,1).toUpperCase()}</span>;
}

/** Who worked on the song: one row per role with the people credited for it. */
export function CreditsList({info,compact=false}:{info:GeniusSongInfo;compact?:boolean}){
 const t=useTranslation(),role=useRoleLabel();
 const rows=[
  ...(info.featuredArtists.length?[{role:t('При участии','Featuring'),people:info.featuredArtists}]:[]),
  ...info.credits.map(c=>({role:role(c.role),people:c.people})),
 ];
 if(!rows.length&&!info.labels.length)return null;
 return <dl className={`credits-list${compact?' credits-list--compact':''}`}>
  {rows.map(row=><div className="credits-row" key={row.role}><dt>{row.role}</dt><dd>{row.people.map(p=><span className="credit-person" key={p.name}><PersonAvatar person={p} size={compact?20:24}/>{displayName(p.name)}</span>)}</dd></div>)}
  {info.labels.length>0&&<div className="credits-row"><dt>{t('Лейбл','Label')}</dt><dd>{info.labels.map(name=><span className="credit-person credit-person--plain" key={name}>{name}</span>)}</dd></div>}
 </dl>;
}

/** Opens an artist inside Осколок: the playing track's own artist directly, anyone else through search. */
/** The artist under a track title: a plain link for one known artist, a chooser for several or for a re-upload. */
export function TrackArtistLink({track,className}:{track:Track;className?:string}){
 const [open,setOpen]=React.useState(false);
 const choose=isReupload(track)||performerNames(track.artist.name).length>1;
 if(!choose)return <NavLink to={artistPath(track.artist.id,track.release?.id)} className={className} title={track.artist.name}>{track.artist.name}</NavLink>;
 return <><button type="button" className={`${className||''} track-artist-choice`} title={track.artist.name} aria-haspopup="dialog" onClick={e=>{e.stopPropagation();setOpen(true);}}>{track.artist.name}</button>{open&&<TrackArtistsPopup track={track} open onClose={()=>setOpen(false)}/>}</>;
}

export function useOpenArtist(){
 const navigate=useNavigate();
 return React.useCallback(async(name:string,track?:Track)=>{
  usePlayerStore.getState().setFullPlayerOpen(false);
  const fold=(value:string)=>value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const variants=[name,displayName(name),...[...name.matchAll(/\(([^)]+)\)/g)].map(m=>m[1])].map(fold);
  if(track?.artist?.id&&!isReupload(track)&&variants.includes(fold(track.artist.name))){navigate(artistPath(track.artist.id,track.release?.id));return;}
  try{
   const found=await apiClient.suggestions(displayName(name));
   const artist=found.artists?.find(a=>variants.includes(fold(a.name)))||found.artists?.[0];
   if(artist){navigate(`/artist/${encodeURIComponent(artist.id)}`);return;}
  }catch{/* fall through to search */}
  navigate(`/search?q=${encodeURIComponent(displayName(name))}`);
 },[navigate]);
}

/** Small centred card with every performer of the track: photos and names, each opening the artist. */
export function TrackArtistsPopup({track,open,onClose}:{track:Track;open:boolean;onClose:()=>void}){
 const t=useTranslation(),info=useTrackInfo(track.id,open),openArtist=useOpenArtist(),navigate=useNavigate();
 const genius=info.data?.genius,reupload=isReupload(track);
 const named=performerNames(track.artist.name);
 // A re-upload's avatar is the uploader's, so performers found by name get no borrowed photo.
 const people:Array<GeniusPerson&{feat?:boolean}>=genius?[...genius.primaryArtists,...genius.featuredArtists.map(p=>({...p,feat:true}))]:named.map((name,i)=>({name,image:reupload||named.length>1?undefined:track.artist.avatarUrl,feat:i>0&&/feat|ft\.|при уч/i.test(track.artist.name)}));
 return <Modal isOpen={open} onClose={onClose} title={t('Исполнители','Artists')} className="max-w-sm">
  {info.isPending?<LoadingState size="sm" label={t('Ищем исполнителей…','Finding artists…')}/>:<ul className="artists-popup">
   {people.map(p=><li key={p.name}><button type="button" onClick={()=>{onClose();void openArtist(p.name,track);}}><PersonAvatar person={p} size={52}/><span><strong>{displayName(p.name)}</strong><small>{p.feat?t('При участии','Featuring'):t('Исполнитель','Artist')}</small></span></button></li>)}
   {reupload&&<li className="artists-popup-uploader"><button type="button" onClick={()=>{onClose();usePlayerStore.getState().setFullPlayerOpen(false);navigate(`/artist/${encodeURIComponent(track.artist.id)}`);}}><PersonAvatar person={{name:track.uploader!.name,image:track.artist.avatarUrl}} size={52}/><span><strong>{track.uploader!.name}</strong><small>{t('Загрузил на SoundCloud','Uploaded to SoundCloud')}</small></span></button></li>}
  </ul>}
  {genius&&<a className="credits-genius-link" href={genius.url} target="_blank" rel="noreferrer">Genius <ArrowUpRight size={13}/></a>}
 </Modal>;
}
