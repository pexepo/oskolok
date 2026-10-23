import React,{useMemo,useState} from 'react';
import {PageSkeleton,LoadingSurface,SkeletonRows} from '../components/common/Skeleton.js';
import {ZoomCoverButton} from '../components/common/CoverViewer.js';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Play,Shuffle,Search,X} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {LoadingState} from '../components/common/LoadingState.js';
import {ServiceLogo} from '../components/discovery/MusicAccounts.js';
import {useLanguageStore,useTranslation} from '../stores/useLanguageStore.js';
import {ShardArtwork} from '../components/tracks/ShardArtwork.js';
import {GeniusArtistSection} from '../components/discovery/GeniusPanels.js';
import {ArtistFollowButton} from '../components/community/ArtistFollowButton.js';
import {ArtistUnreleasedSection} from '../components/community/ArtistUnreleasedSection.js';
import type {Release,Track,TrackPopularity} from '../types/index.js';
import '../styles/artist.css';

type Kind='all'|'album'|'ep'|'single';
type Order='new'|'old'|'popular'|'unpopular';

const platformId=(name:string)=>/spotify/i.test(name)?'spotify':/soundcloud/i.test(name)?'soundcloud':/яндекс|yandex/i.test(name)?'yandex':/genius/i.test(name)?'genius':/deezer/i.test(name)?'deezer':'other';
/** Same song on SoundCloud and in the catalogue: credits, «official audio», file extensions and an «Artist - » prefix don't make it different; remix/cover/live words stay. */
const titleKey=(title:string,artist='')=>{let t=title.toLocaleLowerCase();const a=artist.toLocaleLowerCase();if(a&&t.startsWith(a))t=t.slice(a.length).replace(/^\s*[-–—:]\s*/,'');return t.replace(/[([](?:feat|ft|prod|official|audio|video|clip|lyrics?|explicit|\d{4})[^)\]]*[)\]]/g,' ').replace(/\b(?:prod\.?|feat\.?|ft\.?)\s.*$/,' ').replace(/\.(mp3|wav|m4a)\b/g,' ').replace(/[^\p{L}\p{N}]+/gu,'');};
/** Unknown popularity sorts last in both directions. */
const byPopularity=(a:number|undefined,b:number|undefined,desc:boolean)=>a===undefined?(b===undefined?0:1):b===undefined?-1:desc?b-a:a-b;
const SOURCE_NAMES:Record<TrackPopularity['source'],string>={spotify:'Spotify',deezer:'Deezer',lastfm:'Last.fm'};

// Metric labels arrive from the server in Russian.
const METRIC_LABELS:Record<string,string>={'Слушатели за месяц':'Monthly listeners','Подписчики':'Followers','Подписчики страницы':'Page followers','Поклонники':'Fans'};

function SmallLogo({id}:{id:string}){
 return id==='genius'||id==='deezer'||id==='other'?<span className="artist-glyph-text small">{id==='genius'?'G':id==='deezer'?'D':'•'}</span>:<ServiceLogo id={id} size={18}/>;
}

/** Bar is relative to the artist's own biggest track (global ranks squash regional artists into a sliver); the label is the absolute figure. */
function PopularityMeter({value,pending,max=100}:{value?:TrackPopularity|null;pending:boolean;max?:number}){
 const t=useTranslation(),language=useLanguageStore(s=>s.language);
 if(!value)return <span className="artist-pop is-empty" title={pending?undefined:t('Популярность неизвестна','Popularity unknown')}>{pending?'':'—'}</span>;
 const nf=new Intl.NumberFormat(language==='en'?'en-US':'ru-RU'),compact=new Intl.NumberFormat(language==='en'?'en-US':'ru-RU',{notation:'compact',maximumFractionDigits:1});
 const detail=[`${t('Популярность','Popularity')} ${value.popularity}/100 · ${SOURCE_NAMES[value.source]}`,value.rank!==undefined&&`Deezer rank ${nf.format(value.rank)}`,value.plays!==undefined&&t(`Last.fm: ${nf.format(value.plays)} прослушиваний, ${nf.format(value.listeners||0)} слушателей`,`Last.fm: ${nf.format(value.plays)} plays, ${nf.format(value.listeners||0)} listeners`)].filter(Boolean).join('\n');
 return <span className="artist-pop" title={detail} aria-label={detail}>
  <i style={{'--pop':`${Math.max(4,Math.round(value.popularity/Math.max(1,max)*100))}%`} as React.CSSProperties}/>
  <b>{value.plays!==undefined?compact.format(value.plays):value.rank!==undefined?compact.format(value.rank):value.popularity}</b>
 </span>;
}

export function ArtistPage(){
 const {id=''}=useParams(),t=useTranslation();
 const [filter,setFilter]=useState(''),[kind,setKind]=useState<Kind>('all'),[order,setOrder]=useState<Order>('new');
 const detail=useQuery({queryKey:['artist-details',id],queryFn:()=>apiClient.getArtistDetails(id)});
 const navigate=useNavigate();
 const songs=useQuery({queryKey:['artist-tracks',id],queryFn:()=>apiClient.getArtistTracks(id,1,500)});
 // One artist, one card: a SoundCloud profile (or a stray catalogue duplicate) opens the canonical card — Spotify when available, otherwise Deezer.
 const canonicalCard=detail.data?.linked?.spotifyId||(id.startsWith('spotify:')?undefined:detail.data?.linked?.deezerId);
 React.useEffect(()=>{if(canonicalCard&&canonicalCard!==id&&!id.startsWith('spotify:'))navigate(`/artist/${encodeURIComponent(canonicalCard)}`,{replace:true});},[canonicalCard,id,navigate]);
 const soundcloudId=!id.startsWith('soundcloud:')?detail.data?.linked?.soundcloudId:undefined;
 const soundcloudSongs=useQuery({queryKey:['artist-tracks',soundcloudId],queryFn:()=>apiClient.getArtistTracks(soundcloudId!,1,200),enabled:Boolean(soundcloudId),staleTime:10*60*1000});
 const play=usePlayerStore(s=>s.playCollection);
 const data=detail.data;
 const tracks=useMemo(()=>songs.data||[],[songs.data]);
 const artistName=data?.artist.name;
 // Real per-track popularity (Spotify / Deezer rank / Last.fm), fetched after the list so it never blocks it.
 const popularity=useQuery({
  queryKey:['artist-popularity',id,artistName],
  queryFn:()=>apiClient.getTrackPopularity(artistName!,tracks.map(tr=>({id:tr.id,title:tr.title,artistId:tr.artist.id}))),
  enabled:Boolean(artistName&&tracks.length),staleTime:6*60*60*1000,retry:1,
 });
 const pop=useMemo(()=>popularity.data||{},[popularity.data]);
 const popMax=useMemo(()=>Math.max(1,...Object.values(pop).map(v=>v?.popularity||0)),[pop]);
 const soundcloudOnly=useMemo(()=>{
  const known=new Set(tracks.map(track=>titleKey(track.title,track.artist.name)));
  const seen=new Set<string>();
  return (soundcloudSongs.data||[]).filter(track=>{const k=titleKey(track.title,track.artist.name);if(!k||known.has(k)||seen.has(k))return false;seen.add(k);return true;});
 },[tracks,soundcloudSongs.data]);
 const q=filter.trim().toLocaleLowerCase();
 const releases=useMemo(()=>data?.releases||[],[data?.releases]);
 // A release is as popular as its most popular known track (matched by id, else by title).
 const releasePopularity=useMemo(()=>{
  const byId=new Map<string,number>(),byTitle=new Map<string,number>();
  for(const tr of tracks){const p=pop[tr.id]?.popularity;if(p===undefined||!tr.release)continue;const k=titleKey(tr.release.title);byId.set(tr.release.id,Math.max(byId.get(tr.release.id)??-1,p));byTitle.set(k,Math.max(byTitle.get(k)??-1,p));}
  return (r:Release)=>byId.get(r.id)??byTitle.get(titleKey(r.title))??r.popularity;
 },[tracks,pop]);
 const hasPopularity=tracks.some(tr=>pop[tr.id])||releases.some(r=>typeof r.popularity==='number');
 const popular=order==='popular'||order==='unpopular';
 // Popularity orders need data; fall back to newest until it arrives.
 const effectiveOrder:Order=popular&&!hasPopularity?'new':order;
 const kindCount=useMemo(()=>({all:releases.length,album:releases.filter(r=>r.type==='album').length,ep:releases.filter(r=>r.type==='ep').length,single:releases.filter(r=>r.type==='single').length}),[releases]);
 const visible=useMemo(()=>releases
  .filter(r=>(kind==='all'||r.type===kind)&&(!q||r.title.toLocaleLowerCase().includes(q)||tracks.some(tr=>tr.release?.id===r.id&&tr.title.toLocaleLowerCase().includes(q))))
  .sort((a,b)=>effectiveOrder==='popular'||effectiveOrder==='unpopular'?byPopularity(releasePopularity(a),releasePopularity(b),effectiveOrder==='popular')||(b.date||'').localeCompare(a.date||'')
   :effectiveOrder==='old'?(a.date||'9999').localeCompare(b.date||'9999'):(b.date||'').localeCompare(a.date||'')),[releases,kind,q,effectiveOrder,tracks,releasePopularity]);
 const filteredTracks=useMemo(()=>{
  const list=tracks.filter(tr=>(!q||tr.title.toLocaleLowerCase().includes(q))&&(kind==='all'||releases.some(r=>r.id===tr.release?.id&&r.type===kind)));
  if(effectiveOrder!=='popular'&&effectiveOrder!=='unpopular')return list;
  // Stable sort: equal popularity keeps the source's own order.
  return list.map((tr,i)=>({tr,i})).sort((a,b)=>byPopularity(pop[a.tr.id]?.popularity,pop[b.tr.id]?.popularity,effectiveOrder==='popular')||a.i-b.i).map(x=>x.tr);
 },[tracks,q,kind,releases,effectiveOrder,pop]);

 if(detail.isPending)return <PageSkeleton label={t('Собираем портрет исполнителя…','Loading artist…')} rows={5}/>;
 if(!data)return <div className="crystal-slab artist-error"><h1>{t('Не удалось открыть артиста','Artist unavailable')}</h1><button className="profile-btn" onClick={()=>detail.refetch()}>{t('Попробовать снова','Retry')}</button></div>;
 const {artist,metrics,imageSource,geniusUrl,bannerUrl,genius}=data;
 const source=artist.source==='soundcloud'?'soundcloud':'spotify';
 const aliases=(genius?.alternateNames||[]).filter(n=>n.trim()&&n.toLocaleLowerCase()!==artist.name.toLocaleLowerCase());
 const shuffled=()=>{const list=[...tracks];for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;};
 const typeLabel=(type?:string)=>type==='single'?t('Сингл','Single'):type==='ep'?'EP':type==='album'?t('Альбом','Album'):t('Релиз','Release');
 const kinds:Array<[Kind,string]>=[['all',t('Все','All')],['album',t('Альбомы','Albums')],['ep','EP'],['single',t('Синглы','Singles')]];
 const orders:Array<[Order,string,boolean]>=[['new',t('Новые','Newest'),true],['old',t('Старые','Oldest'),true],['popular',t('Популярные','Popular'),hasPopularity],['unpopular',t('Непопулярные','Less popular'),hasPopularity]];
 const popularityHint=popularity.isFetching?t('Загружаем популярность треков…','Loading track popularity…'):t('Источники не сообщили популярность треков этого исполнителя','No source reported track popularity for this artist');
 const trackRows=(list:Track[],meter:boolean)=>list.map((track,i)=><div key={track.id} className={meter?'artist-track-line':undefined}>
  <TrackRow track={track} index={i} collection={list}/>
  {meter&&<PopularityMeter value={pop[track.id]} pending={popularity.isFetching} max={popMax}/>}
 </div>);

 return <div className="artist-v2">
  <section className="artist-card crystal-slab">
   <div className="artist-card-banner">
    {bannerUrl?<img src={bannerUrl} alt="" referrerPolicy="no-referrer"/>:<><img className="artist-banner-fill" src={artist.avatarUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer"/><img className="artist-banner-photo" src={artist.avatarUrl} alt={artist.name} referrerPolicy="no-referrer"/></>}
    <i className="artist-banner-glint"/>
    <i className="artist-card-fade"/>
    <a href={geniusUrl||artist.permalinkUrl} target="_blank" rel="noreferrer" className="artist-banner-credit">{t('Фото','Photo')} · {bannerUrl?'Genius':imageSource}</a>
   </div>
   <div className="artist-card-body">
    <div className="artist-card-portrait">
     <ShardArtwork src={artist.avatarUrl} alt={artist.name} mask="/shards/shard_tl.png" natural portrait className="shard-artwork--hero"/>
    </div>
    <div className="artist-card-main">
     <span className="eyebrow">{t('Исполнитель','Artist')}</span>
     <h1>{artist.name}</h1>
     {data.homonym&&<p className="artist-homonym">{t('Другой исполнитель с тем же именем. Вы, возможно, искали','A different artist with the same name. You may be looking for')} <button type="button" onClick={()=>navigate(`/artist/${encodeURIComponent(data.homonym!.id)}`)}>{data.homonym.avatarUrl&&<img src={data.homonym.avatarUrl} alt="" referrerPolicy="no-referrer"/>}{data.homonym.name}</button></p>}
     {aliases.length>0&&<p className="artist-card-aka"><span>{t('Также известен как','Also known as')}</span>{aliases.map(n=><b key={n}>{n}</b>)}</p>}
     {(tracks.length>0||releases.length>0)&&<p className="artist-card-meta">{[tracks.length?`${tracks.length} ${t('треков','tracks')}`:'',releases.length?`${releases.length} ${t('релизов','releases')}`:''].filter(Boolean).join(' · ')}</p>}
     <div className="artist-card-actions">
      <button className="artist-play" disabled={!tracks.length} onClick={()=>play(tracks,0)}><Play size={18} fill="currentColor"/>{t('Слушать','Play')}</button>
      <button className="profile-btn" disabled={tracks.length<2} onClick={()=>play(shuffled(),0)}><Shuffle size={16}/>{t('Вперемешку','Shuffle')}</button>
      <ArtistFollowButton artist={artist}/>
     </div>
    </div>
   </div>
   {metrics.length>0&&<ul className="artist-card-stats" aria-label={t('Аудитория на площадках','Audience by platform')}>
    {metrics.map(m=>{const pid=platformId(m.platform);return <li key={m.platform} className={`platform-${pid}`}>
     <a href={m.url} target="_blank" rel="noreferrer" title={m.note||undefined}>
      <span className="artist-metric-logo"><SmallLogo id={pid}/></span>
      <span className="artist-metric-copy"><strong>{m.value===undefined?'—':new Intl.NumberFormat().format(m.value)}</strong><small>{m.platform==='Яндекс Музыка'?t('Яндекс Музыка','Yandex Music'):m.platform} · {t(m.label,METRIC_LABELS[m.label]||m.label)}</small></span>
     </a>
    </li>;})}
   </ul>}
  </section>

  <GeniusArtistSection genius={genius} fallback={artist.description}/>

  <section className="artist-releases">
   <div className="artist-toolbar">
    <h2>{t('Релизы','Releases')}</h2>
    <div className="artist-segments" role="radiogroup" aria-label={t('Тип релиза','Release type')}>{kinds.map(([value,label])=><button key={value} role="radio" aria-checked={kind===value} className={kind===value?'is-active':''} disabled={value!=='all'&&!kindCount[value]} onClick={()=>setKind(value)}>{label}<small>{kindCount[value]}</small></button>)}</div>
    <div className="artist-segments" role="radiogroup" aria-label={t('Сортировка','Sort')}>{orders.map(([value,label,enabled])=><button key={value} role="radio" aria-checked={effectiveOrder===value} className={effectiveOrder===value?'is-active':''} disabled={!enabled} title={!enabled?popularityHint:undefined} onClick={()=>setOrder(value)}>{label}</button>)}</div>
    <label className="artist-search"><Search size={15}/><input placeholder={t('Найти трек или релиз','Find a track or release')} value={filter} onChange={e=>setFilter(e.target.value)}/>{filter&&<button type="button" aria-label={t('Очистить','Clear')} onClick={()=>setFilter('')}><X size={13}/></button>}</label>
   </div>
   {!hasPopularity&&!popularity.isFetching&&tracks.length>0&&<p className="artist-note">{t('Сортировка по популярности недоступна: источники не сообщили этот показатель.','Popularity sorting is unavailable: no source reported it.')}</p>}
   {visible.length?<div className="artist-release-grid">{visible.map(r=><Link to={'/release/'+encodeURIComponent(r.id)} key={r.id} className="artist-release">
    <span className="artist-release-cover"><ArtworkImage src={r.artworkUrl} alt={r.title} className="w-full h-full"/><i/><ZoomCoverButton src={r.artworkUrl} title={r.title}/></span>
    <strong>{r.title}</strong><small>{r.date?.slice(0,4)||'—'} · {typeLabel(r.type)}</small>
   </Link>)}</div>:<p className="crystal-slab artist-empty">{t('Релизы не найдены.','No releases found.')}</p>}
  </section>

  <section className="artist-tracks crystal-slab">
   <div className="artist-toolbar"><h2>{t('Треки','Tracks')}</h2>{q&&<small>{filteredTracks.length} {t('найдено','found')}</small>}{hasPopularity&&<small className="artist-pop-legend">{t('Популярность','Popularity')}</small>}</div>
   {songs.isPending?<LoadingSurface loading label={t('Загружаем треки…','Loading tracks…')} skeleton={<SkeletonRows rows={8}/>}/>:songs.isError?<button className="profile-btn" onClick={()=>songs.refetch()}>{t('Повторить загрузку','Retry')}</button>:filteredTracks.length?trackRows(filteredTracks,true):<p className="artist-empty-line">{t('Треки не найдены','No tracks found')}</p>}
  </section>
  {soundcloudOnly.length>0&&<section className="artist-tracks crystal-slab artist-tracks--extra">
   <div className="artist-toolbar"><h2><span className="artist-extra-logo"><ServiceLogo id="soundcloud" size={18}/></span>{t('Только на SoundCloud','Only on SoundCloud')}</h2><small>{soundcloudOnly.length}</small></div>
   {trackRows(soundcloudOnly,false)}
  </section>}
  <ArtistUnreleasedSection artistName={artist.name} artistIds={[artist.id,data.linked?.spotifyId,data.linked?.soundcloudId].filter((v):v is string=>Boolean(v))}/>
 </div>;
}
