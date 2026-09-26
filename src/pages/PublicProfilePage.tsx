import React from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {apiClient} from '../api/apiClient.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import type {Track} from '../types/index.js';
import {useTelegramStore} from '../telegram/runtime.js';
import {LoadingState} from '../components/common/LoadingState.js';
type PublicProfile={displayName:string;username:string|null;avatarUrl:string;bannerUrl:string;bio:string;externalSource?:string;externalUrl?:string;textsCount?:number;currentTrack:Track|null;music:Track[];playlists:Array<{id:string;title:string;artworkUrl?:string;tracks:Track[]}>;contributions:Array<{id:string;trackId:string;trackTitle:string;artistName:string}>};
export function PublicProfilePage(){
 const signedIn=!!useTelegramStore(s=>s.user);
 const renderTrack=(t:Track,i?:number,collection?:Track[])=><div key={t.id}>{signedIn?<TrackRow track={t} index={i} collection={collection}/>:<div className="profile-public-track"><ArtworkImage src={t.artworkUrl} alt="" className="w-12 h-12 rounded-lg"/><span>{t.artist.name} — {t.title}</span></div>}</div>;
 const {id=''}=useParams();const query=useQuery({queryKey:['public-profile',id],queryFn:()=>apiClient.request<PublicProfile>(`/users/${encodeURIComponent(id)}`),refetchInterval:30000});
 if(query.isPending)return <LoadingState className="route-loading" label="Открываем профиль…"/>;
 if(!query.data)return <div className="frost-panel profile-load-error" role={query.isError?'alert':undefined}><p>{query.error instanceof Error?query.error.message:'Профиль недоступен.'}</p>{query.isError&&<button className="secondary-button" onClick={()=>void query.refetch()}>Повторить загрузку</button>}</div>;
 const p=query.data;
 return <div className="page-crystal profile-page"><header className="profile-cover frost-panel"><div className="profile-banner">{p.bannerUrl&&<img src={p.bannerUrl} alt=""/>}</div><div className="profile-identity">{p.avatarUrl?<img src={p.avatarUrl} alt="Аватар"/>:<span className="profile-avatar">{p.displayName.slice(0,1)}</span>}<div className="profile-identity-copy"><span className="eyebrow">{p.externalSource||'ОСКОЛОК'}</span><h1>{p.displayName}</h1><p>{p.username&&`@${p.username}`}</p>{p.bio&&<p className="profile-bio">{p.bio}</p>}{p.externalUrl&&<a className="primary-button" href={p.externalUrl} target="_blank" rel="noopener noreferrer">Страница автора в Spicy Lyrics ↗</a>}</div></div></header>{!p.externalSource&&<><section className="frost-panel profile-form"><h2>Сейчас слушает</h2>{p.currentTrack?renderTrack(p.currentTrack):<p className="profile-empty">Сейчас ничего не играет.</p>}</section><section className="frost-panel profile-form"><h2>Витрина</h2>{p.music.map((t,i)=>renderTrack(t,i,p.music))}{p.playlists.map(pl=><details key={pl.id} className="profile-playlist"><summary><ArtworkImage src={pl.artworkUrl} alt={pl.title} className="w-12 h-12 rounded-lg"/>{pl.title} · {pl.tracks.length} треков</summary>{pl.tracks.map((t,i)=>renderTrack(t,i,pl.tracks))}</details>)}{!p.music.length&&!p.playlists.length&&<p className="profile-empty">Пока нет музыки.</p>}</section></>}<section className="frost-panel profile-form"><h2>Тексты {p.externalSource&&`· ${p.textsCount??p.contributions.length} в Осколке`}</h2>{p.contributions.map(c=><Link key={c.id} to={`/track/${encodeURIComponent(c.trackId)}`}>{c.artistName} — {c.trackTitle}</Link>)}</section></div>;
}
