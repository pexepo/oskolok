import React from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Play,ArrowUpRight,RadioTower,ChevronDown} from 'lucide-react';
import {apiClient} from '../api/apiClient.js';
import {usePlayerStore} from '../stores/usePlayerStore.js';
import {usePlaylistStore} from '../stores/usePlaylistStore.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {PlaybackSourcePicker} from '../components/tracks/PlaybackSourcePicker.js';
import {LoadingState} from '../components/common/LoadingState.js';
export function ReleasePage(){
 const {id=''}=useParams(),play=usePlayerStore(s=>s.playCollection),[saved,setSaved]=React.useState(false),[busy,setBusy]=React.useState(false),[source,setSource]=React.useState('auto');
 const query=useQuery({queryKey:['release',id],queryFn:()=>apiClient.getRelease(id)});
 React.useEffect(()=>{setSaved(false);setSource('auto');},[id]);
 if(query.isPending)return <LoadingState className="route-loading" label="Открываем релиз…"/>;
 if(!query.data)return <div className="frost-panel"><h1>Релиз недоступен</h1><button onClick={()=>query.refetch()}>Повторить</button></div>;
 const r=query.data,tracks=r.tracks||[];
 return <div className="page-crystal release-page"><header className="artist-hero frost-panel"><ArtworkImage src={r.artworkUrl} alt={r.title} className="release-cover"/><div className="artist-intro"><span className="eyebrow">{r.type==='single'?'СИНГЛ':'РЕЛИЗ'}</span><h1>{r.title}</h1>{r.artist&&<Link to={`/artist/${encodeURIComponent(r.artist.id)}`}>{r.artist.name}</Link>}<p>{r.date?.slice(0,4)} · {tracks.length} треков</p><div className="release-actions"><button className="primary-button" disabled={!tracks.length} onClick={()=>play(tracks,0,source)}><Play size={16}/>Слушать</button><PlaybackSourcePicker value={source} onChange={setSource} deezer={tracks.every(t=>t.source==="deezer")}/><button className="secondary-button" disabled={busy||saved||!tracks.length} onClick={async()=>{setBusy(true);const p=await usePlaylistStore.getState().createPlaylist(r.title,'Релиз в коллекции',r.artworkUrl,tracks);setSaved(Boolean(p));setBusy(false);}}>{saved?'В коллекции':busy?'Сохраняем…':'В коллекцию'}</button>{r.url&&<a href={r.url} target="_blank" rel="noreferrer" className="text-button">Источник <ArrowUpRight size={15}/></a>}</div></div></header><section className="frost-panel">{tracks.map((t,i)=><TrackRow key={t.id} track={t} index={i} collection={tracks}/>)}</section></div>;
}
