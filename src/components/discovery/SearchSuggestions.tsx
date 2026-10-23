import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiClient} from '../../api/apiClient.js';
import type {SearchResult} from '../../types/index.js';
import {ArtworkImage} from '../common/ArtworkImage.js';
import LumaSpin from '../ui/luma-spin.js';
import { useTranslation } from '../../stores/useLanguageStore.js';
export function SearchSuggestions({query,onChoose}:{query:string;onChoose:()=>void}){
  const t = useTranslation();
 const [data,setData]=useState<SearchResult|null>(null),[loading,setLoading]=useState(false);
 useEffect(()=>{if(query.trim().length<2||query.includes('://')){setData(null);return;}const controller=new AbortController();const timer=setTimeout(()=>{setLoading(true);apiClient.suggestions(query.trim(),controller.signal).then(setData).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},220);return()=>{clearTimeout(timer);controller.abort();};},[query]);
 if(query.trim().length<2||query.includes('://'))return null;
 return <div className="search-suggestions crystal-slab" aria-label={t('Предложения поиска', 'Search suggestions')}><div className="suggestions-caption">{loading?<><LumaSpin size="sm" label={t('Подбираем', 'Matching')}/> {t('Подбираем…', 'Matching…')}</>:<>{t('Быстрый переход','Quick jump')}{data?.correctedQuery&&<em> · «{data.correctedQuery}»</em>}</>}</div>{data?.artists.slice(0,3).map(a=><Link onClick={onChoose} key={a.id} to={`/artist/${encodeURIComponent(a.id)}`}><ArtworkImage src={a.avatarUrl} alt="" className="w-9 h-9 rounded-xl"/><span><strong>{a.name}</strong><small>{t('Исполнитель', 'Artist')}</small></span></Link>)}{data?.tracks.slice(0,4).map(track=><Link onClick={onChoose} key={track.id} to={`/track/${encodeURIComponent(track.id)}`} onMouseEnter={()=>apiClient.prefetchTrack(track.id)} onFocus={()=>apiClient.prefetchTrack(track.id)}><ArtworkImage src={track.artworkUrl} alt="" className="w-9 h-9 rounded-xl"/><span><strong>{track.title}</strong><small>{t('Трек','Track')} · {track.artist.name}</small></span></Link>)}{data?.albums?.slice(0,2).map(album=><Link onClick={onChoose} key={album.id} to={`/release/${encodeURIComponent(album.id)}`}><ArtworkImage src={album.artworkUrl} alt="" className="w-9 h-9 rounded-xl"/><span><strong>{album.title}</strong><small>{t('Релиз','Release')}{album.artist?` · ${album.artist.name}`:''}</small></span></Link>)}{!loading&&data&&!data.tracks.length&&!data.artists.length&&<p>{t('Продолжайте ввод или нажмите Enter для поиска по всем площадкам.', 'Keep typing or press Enter to search every source.')}</p>}</div>;
}
