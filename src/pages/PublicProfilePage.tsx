import React from 'react';
import {Link,useParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {friendsApi} from '../api/friendsApi.js';
import {FriendButton,TogetherButtons} from '../components/friends/FriendButton.js';
import {apiClient} from '../api/apiClient.js';
import {TrackRow} from '../components/tracks/TrackRow.js';
import {ArtworkImage} from '../components/common/ArtworkImage.js';
import type {Track} from '../types/index.js';
import {useTelegramStore} from '../telegram/runtime.js';
import {LoadingState} from '../components/common/LoadingState.js';
import { useTranslation } from '../stores/useLanguageStore.js';
import {ProfileStatus,SocialLinks,accentStyle,type Customization} from '../components/profile/ProfileCustomization.js';
import {RoleBadges,topRoleColor,type PublicRole} from '../components/profile/RoleBadge.js';
import type {PublicRewards} from '../components/profile/Rewards.js';
type PublicProfile={customization?:Customization;roles?:PublicRole[];rewards?:PublicRewards;displayName:string;username:string|null;avatarUrl:string;bannerUrl:string;bio:string;externalSource?:string;externalUrl?:string;textsCount?:number;currentTrack:Track|null;music:Track[];playlists:Array<{id:string;title:string;artworkUrl?:string;tracks:Track[]}>;contributions:Array<{id:string;trackId:string;trackTitle:string;artistName:string}>};
export function PublicProfilePage(){
  const t = useTranslation();
 const signedIn=!!useTelegramStore(s=>s.user);
 const [allTexts,setAllTexts]=React.useState(false);const TEXTS_PREVIEW=30;
 const renderTrack=(t:Track,i?:number,collection?:Track[])=><div key={t.id}>{signedIn?<TrackRow track={t} index={i} collection={collection}/>:<div className="profile-public-track"><ArtworkImage src={t.artworkUrl} alt="" className="w-12 h-12 rounded-lg"/><span>{t.artist.name} — {t.title}</span></div>}</div>;
 const {id=''}=useParams();const query=useQuery({queryKey:['public-profile',id],queryFn:()=>apiClient.request<PublicProfile>(`/users/${encodeURIComponent(id)}`),refetchInterval:30000});
 const relation=useQuery({queryKey:['friends','status',id],queryFn:()=>friendsApi.status(id),enabled:signedIn&&!/^spicy:/.test(id)});
 if(query.isPending)return <LoadingState className="route-loading" label={t('Открываем профиль…', 'Opening profile…')}/>;
 if(!query.data)return <div className="frost-panel profile-load-error" role={query.isError?'alert':undefined}><p>{query.error instanceof Error?query.error.message:'Профиль недоступен.'}</p>{query.isError&&<button className="secondary-button" onClick={()=>void query.refetch()}>{t('Повторить загрузку', 'Retry')}</button>}</div>;
 const p=query.data;
 return <div className="page-crystal profile-page"><header className={`profile-cover frost-panel profile-theme--${p.customization?.theme||'default'}`} style={accentStyle(p.customization)}><div className="profile-banner">{p.bannerUrl&&<img src={p.bannerUrl} alt=""/>}</div><div className="profile-identity">{p.avatarUrl?<img src={p.avatarUrl} alt={t('Аватар', 'Avatar')}/>:<span className="profile-avatar">{p.displayName.slice(0,1)}</span>}<div className="profile-identity-copy"><span className="eyebrow">{p.externalSource||'Осколок'}</span><h1 style={{color:topRoleColor(p.roles)}}>{p.displayName} <RoleBadges roles={p.roles}/></h1><p>{p.username&&`@${p.username}`}</p>{relation.data&&!p.externalSource&&<div className="profile-friend-action"><FriendButton publicId={id} relation={relation.data.relation} onChange={()=>void relation.refetch()}/></div>}{relation.data?.relation==='friends'&&!p.externalSource&&<TogetherButtons publicId={id} name={p.displayName}/>}<ProfileStatus c={p.customization}/>{p.bio&&<p className="profile-bio">{p.bio}</p>}<SocialLinks links={p.customization?.socialLinks}/>{p.externalUrl&&<a className="primary-button" href={p.externalUrl} target="_blank" rel="noopener noreferrer">{t('Страница автора в Spicy Lyrics ↗', 'Author page on Spicy Lyrics ↗')}</a>}</div></div></header>{!p.externalSource&&<><section className="frost-panel profile-form"><h2>{t('Сейчас слушает', 'Listening now')}</h2>{p.currentTrack?renderTrack(p.currentTrack):<p className="profile-empty">{t('Сейчас ничего не играет.', 'Nothing is playing right now.')}</p>}</section>{p.customization?.visibility.showcase!==false&&<section className="frost-panel profile-form"><h2>{t('Витрина', 'Showcase')}</h2>{p.music.map((t,i)=>renderTrack(t,i,p.music))}{p.playlists.map(pl=><details key={pl.id} className="profile-playlist"><summary><ArtworkImage src={pl.artworkUrl} alt={pl.title} className="w-12 h-12 rounded-lg"/>{pl.title} · {pl.tracks.length} треков</summary>{pl.tracks.map((t,i)=>renderTrack(t,i,pl.tracks))}</details>)}{!p.music.length&&!p.playlists.length&&<p className="profile-empty">{t('Пока нет музыки.', 'No music yet.')}</p>}</section>}</>}{(p.externalSource||p.contributions.length>0)&&<section className="frost-panel profile-form"><h2>{t('Тексты','Lyrics')} · {p.textsCount??p.contributions.length}{p.externalSource?t(' в Осколке',' on Oskolok'):''}</h2>{(allTexts?p.contributions:p.contributions.slice(0,TEXTS_PREVIEW)).map(c=><Link key={c.id} to={`/track/${encodeURIComponent(c.trackId)}`}>{c.artistName} — {c.trackTitle}</Link>)}{!p.contributions.length&&<p className="profile-empty">{t('Пока нет опубликованных текстов.','No published lyrics yet.')}</p>}{!allTexts&&p.contributions.length>TEXTS_PREVIEW&&<button type="button" className="secondary-button" onClick={()=>setAllTexts(true)}>{t(`Показать все (${p.contributions.length})`,`Show all (${p.contributions.length})`)}</button>}</section>}</div>;
}
