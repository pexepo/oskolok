import React,{useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Play,ArrowUpRight,Search} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {TrackRow} from '../components/tracks/TrackRow.js';

export function ArtistPage(){
 const {id=''}=useParams(),[filter,setFilter]=useState('');
 const detail=useQuery({queryKey:['artist-details',id],queryFn:()=>apiClient.getArtistDetails(id)});
 const songs=useQuery({queryKey:['artist-tracks',id],queryFn:()=>apiClient.getArtistTracks(id,1,30)});
 const play=usePlayerStore(s=>s.playCollection);
 if(detail.isPending)return <div className="frost-panel" role="status">Собираем портрет исполнителя…</div>;
 if(!detail.data)return <div className="frost-panel"><h1>Не удалось открыть артиста</h1><button className="secondary-button" onClick={()=>detail.refetch()}>Попробовать снова</button></div>;
 const {artist,metrics,releases,imageSource,geniusUrl,releaseSource}=detail.data,tracks=songs.data||[],filtered=tracks.filter(t=>t.title.toLowerCase().includes(filter.toLowerCase()));
 return <div className="artist-page page-crystal"><header className="artist-hero frost-panel"><div className="artist-portrait-wrap"><div className="artist-portrait"><ArtworkImage src={artist.avatarUrl} alt={artist.name} className="w-full h-full"/><i/><b/></div><a href={geniusUrl||artist.permalinkUrl} target="_blank" rel="noreferrer" className="image-credit">Фото · {imageSource}</a></div><div className="artist-intro"><span className="eyebrow">ИСПОЛНИТЕЛЬ</span><h1>{artist.name}</h1>{artist.description&&<p className="line-clamp-3">{artist.description}</p>}<p>{releases.length} релизов в каталоге {releaseSource||''}</p><button className="primary-button" disabled={!tracks.length} onClick={()=>play(tracks,0)}><Play size={18}/>Слушать</button></div></header>
 <div className="artist-metrics">{metrics.map(m=><a className="frost-panel" key={m.platform} href={m.url} target="_blank" rel="noreferrer"><span>{m.platform}<ArrowUpRight size={14}/></span><strong>{m.value===undefined?'Нет данных':new Intl.NumberFormat('ru').format(m.value)}</strong><small>{m.label}</small>{m.value===undefined&&<p>{m.note}</p>}</a>)}</div>
 <section><div className="section-heading"><h2>Релизы <i/></h2><span className="eyebrow">АЛЬБОМЫ И СИНГЛЫ</span></div>{releases.length?<div className="release-grid">{releases.map(r=><Link to={'/release/'+encodeURIComponent(r.id)} key={r.id} className="release-card frost-panel"><ArtworkImage src={r.artworkUrl} alt={r.title} className="aspect-square rounded-2xl"/><h3>{r.title}</h3><p>{r.date?.slice(0,4)||'—'} · {r.type==='single'?'Сингл':r.type==='ep'?'EP':'Альбом'}</p></Link>)}</div>:<p className="frost-panel">Источник пока не предоставил список релизов этого исполнителя.</p>}</section>
 <section className="frost-panel"><div className="section-heading"><h2>Треки исполнителя</h2><label className="artist-filter"><Search size={16}/><input className="glass-input" placeholder="Найти трек" value={filter} onChange={e=>setFilter(e.target.value)}/></label></div>{songs.isPending?<p>Загружаем треки…</p>:songs.isError?<button onClick={()=>songs.refetch()}>Повторить загрузку</button>:filtered.map((t,i)=><TrackRow key={t.id} track={t} index={i} collection={filtered}/>)}</section></div>;
}
