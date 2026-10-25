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
import type {Customization} from '../components/profile/ProfileCustomization.js';
import type {PublicRole} from '../components/profile/RoleBadge.js';
import type {PublicRewards} from '../components/profile/Rewards.js';
import {ProfileHero} from '../components/profile/ProfileHero.js';
import {Showcase,type ShowcaseItem} from '../components/profile/Showcase.js';
type PublicProfile={customization?:Customization;roles?:PublicRole[];rewards?:PublicRewards;displayName:string;username:string|null;avatarUrl:string;bannerUrl:string;bio:string;externalSource?:string;externalUrl?:string;textsCount?:number;currentTrack:Track|null;showcase:ShowcaseItem[];contributions:Array<{id:string;trackId:string;trackTitle:string;artistName:string}>};
export function PublicProfilePage(){
  const t = useTranslation();
 const signedIn=!!useTelegramStore(s=>s.user);
 const [allTexts,setAllTexts]=React.useState(false);const TEXTS_PREVIEW=30;
 const renderTrack=(t:Track)=>signedIn?<TrackRow track={t}/>:<div className="profile-public-track"><ArtworkImage src={t.artworkUrl} alt="" className="w-12 h-12 rounded-lg"/><span>{t.artist.name} — {t.title}</span></div>;
 const {id=''}=useParams();const query=useQuery({queryKey:['public-profile',id],queryFn:()=>apiClient.request<PublicProfile>(`/users/${encodeURIComponent(id)}`),refetchInterval:30000});
 const relation=useQuery({queryKey:['friends','status',id],queryFn:()=>friendsApi.status(id),enabled:signedIn&&!/^spicy:/.test(id)});
 if(query.isPending)return <LoadingState className="route-loading" label={t('Открываем профиль…', 'Opening profile…')}/>;
 if(!query.data)return <div className="frost-panel profile-load-error" role={query.isError?'alert':undefined}><p>{query.error instanceof Error?query.error.message:'Профиль недоступен.'}</p>{query.isError&&<button className="secondary-button" onClick={()=>void query.refetch()}>{t('Повторить загрузку', 'Retry')}</button>}</div>;
 const p=query.data;
 const friendActions=relation.data&&!p.externalSource?<><FriendButton publicId={id} relation={relation.data.relation} onChange={()=>void relation.refetch()}/>{relation.data.relation==='friends'&&<TogetherButtons publicId={id} name={p.displayName}/>}</>:null;
 const actions=p.externalUrl?<a className="profile-btn profile-btn--primary" href={p.externalUrl} target="_blank" rel="noopener noreferrer">{t('Страница в Spicy Lyrics ↗', 'Spicy Lyrics page ↗')}</a>:friendActions;
 return <div className="profile-page profile-v2">
  <ProfileHero displayName={p.displayName} avatarUrl={p.avatarUrl} bannerUrl={p.bannerUrl} username={p.username} bio={p.bio} customization={p.customization} roles={p.roles} nowPlaying={p.currentTrack} eyebrow={p.externalSource} actions={actions}/>
  {!p.externalSource&&<div className="profile-stack">
   {p.currentTrack&&<section className="crystal-slab profile-card"><h2>{t('Сейчас слушает', 'Listening now')}</h2>{renderTrack(p.currentTrack)}</section>}
   {p.customization?.visibility.showcase!==false&&<section className="crystal-slab profile-card"><Showcase items={p.showcase} canPlay={signedIn}/></section>}
  </div>}
  {(p.externalSource||p.contributions.length>0)&&<section className="crystal-slab profile-card"><h2>{t('Тексты','Lyrics')} · {p.textsCount??p.contributions.length}{p.externalSource?t(' в Осколке',' on Oskolok'):''}</h2><div className="profile-texts">{(allTexts?p.contributions:p.contributions.slice(0,TEXTS_PREVIEW)).map(c=><Link key={c.id} to={`/track/${encodeURIComponent(c.trackId)}`}>{c.artistName} — {c.trackTitle}</Link>)}</div>{!p.contributions.length&&<p className="profile-empty">{t('Пока нет опубликованных текстов.','No published lyrics yet.')}</p>}{!allTexts&&p.contributions.length>TEXTS_PREVIEW&&<button type="button" className="secondary-button" onClick={()=>setAllTexts(true)}>{t(`Показать все (${p.contributions.length})`,`Show all (${p.contributions.length})`)}</button>}</section>}
 </div>;
}
