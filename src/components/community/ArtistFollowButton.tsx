import React from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {BellPlus,BellRing} from 'lucide-react';
import {communityApi} from '../../api/communityClient.js';
import {useToastStore} from '../../stores/useToastStore.js';
import {useTranslation,useLanguageStore} from '../../stores/useLanguageStore.js';
import type {Artist} from '../../types/index.js';
import '../../styles/community.css';

/** Follow/unfollow an artist (keyed by normalized name across platforms) with the follower count. */
export function ArtistFollowButton({artist}:{artist:Artist}){
 const t=useTranslation(),language=useLanguageStore(s=>s.language),client=useQueryClient(),[busy,setBusy]=React.useState(false);
 const key=['follow-status',artist.name];
 const status=useQuery({queryKey:key,queryFn:()=>communityApi.followStatus(artist.name),staleTime:60000,retry:false});
 const following=Boolean(status.data?.following),followers=status.data?.followers||0;
 const toggle=async()=>{
  if(busy)return;setBusy(true);
  try{
   const next=following?await communityApi.unfollow(artist.name):await communityApi.follow({name:artist.name,artistId:artist.id,avatar:artist.avatarUrl&&/^https:\/\//.test(artist.avatarUrl)?artist.avatarUrl:undefined});
   client.setQueryData(key,next);void client.invalidateQueries({queryKey:['follows']});
   if(next.following)useToastStore.getState().addToast(t('Сообщим о новых релизах','We will notify you about new releases'),'success');
  }catch(e){useToastStore.getState().addToast(e instanceof Error?e.message:t('Не удалось','Failed'),'error');}finally{setBusy(false);}
 };
 const count=new Intl.NumberFormat(language==='en'?'en-US':'ru-RU',{notation:'compact'}).format(followers);
 return <button className={`profile-btn follow-btn${following?' is-following':''}`} aria-pressed={following} disabled={busy||status.isPending} onClick={()=>void toggle()} title={t(`Подписчиков в Осколке: ${followers}`,`Followers on Oskolok: ${followers}`)}>
  {following?<BellRing size={16}/>:<BellPlus size={16}/>}{following?t('Вы подписаны','Following'):t('Подписаться','Follow')}{followers>0&&<small>{count}</small>}
 </button>;
}
