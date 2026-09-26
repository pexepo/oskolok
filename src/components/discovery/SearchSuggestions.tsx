import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiClient} from '../../api/apiClient.js';
import type {SearchResult} from '../../types/index.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import LumaSpin from '../ui/luma-spin.js';
export function SearchSuggestions({query,onChoose}:{query:string;onChoose:()=>void}){
 const [data,setData]=useState<SearchResult|null>(null),[loading,setLoading]=useState(false);
 useEffect(()=>{setData(null);if(query.trim().length<2||query.includes('://'))return;const controller=new AbortController();const timer=setTimeout(()=>{setLoading(true);apiClient.suggestions(query.trim(),controller.signal).then(setData).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},220);return()=>{clearTimeout(timer);controller.abort();};},[query]);
 if(query.trim().length<2||query.includes('://'))return null;
 return <div className="search-suggestions frost-panel" aria-label="Предложения поиска"><div className="suggestions-caption">{loading?<><LumaSpin size="sm" label="Подбираем"/> Подбираем…</>:'Быстрый переход'}</div>{data?.artists.slice(0,3).map(a=><Link onClick={onChoose} key={a.id} to={`/artist/${encodeURIComponent(a.id)}`}><ArtworkImage src={a.avatarUrl} alt="" className="w-9 h-9 rounded-xl"/><span><strong>{a.name}</strong><small>Исполнитель</small></span></Link>)}{data?.tracks.slice(0,4).map(t=><Link onClick={onChoose} key={t.id} to={`/track/${encodeURIComponent(t.id)}`} onMouseEnter={()=>apiClient.prefetchTrack(t.id)} onFocus={()=>apiClient.prefetchTrack(t.id)}><ArtworkImage src={t.artworkUrl} alt="" className="w-9 h-9 rounded-xl"/><span><strong>{t.title}</strong><small>{t.artist.name}</small></span></Link>)}{!loading&&data&&!data.tracks.length&&!data.artists.length&&<p>Продолжайте ввод или нажмите Enter для поиска по всем площадкам.</p>}</div>;
}
