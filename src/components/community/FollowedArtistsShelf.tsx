import {NavLink} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {communityApi} from '../../api/communityClient.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {ShardArtwork} from '../tracks/ShardArtwork.js';
import '../../styles/community.css';

/** «Подписки» shelf for the collection page. Hidden until the user follows someone. */
export function FollowedArtistsShelf(){
 const t=useTranslation();
 const follows=useQuery({queryKey:['follows'],queryFn:communityApi.follows,staleTime:60000,retry:false});
 const rows=follows.data||[];
 if(!rows.length)return null;
 return <section className="follow-shelf"><div className="section-heading collection-section"><h2>{t('Подписки','Following')} <i/></h2><small className="follow-shelf-count">{rows.length}</small></div>
  <div className="collection-artists follow-shelf-grid">{rows.map((f,i)=>{
   const to=f.artistId?`/artist/${encodeURIComponent(f.artistId)}`:`/search?q=${encodeURIComponent(f.name)}`;
   return <NavLink to={to} key={f.id} className="collection-tile"><ShardArtwork src={f.avatar||undefined} alt={f.name} index={i+1} portrait/><h3>{f.name}</h3><p>{t('Новые релизы — в уведомлениях','New releases in notifications')}</p></NavLink>;
  })}</div>
 </section>;
}
