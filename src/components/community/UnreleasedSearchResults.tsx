import {useQuery} from '@tanstack/react-query';
import {communityApi} from '../../api/communityClient.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import {TrackRow} from '../tracks/TrackRow.js';

/** Approved community unreleased tracks matching the search query. Renders nothing when there are none. */
export function UnreleasedSearchResults({query}:{query:string}){
 const t=useTranslation(),q=query.trim();
 const result=useQuery({queryKey:['unreleased-search',q],queryFn:({signal})=>communityApi.searchUnreleased(q,signal),enabled:q.length>=2,staleTime:60000,retry:false});
 const tracks=result.data||[];
 if(!tracks.length)return null;
 return <section className="search-section"><h3>{t('Анрелизы','Unreleased')}</h3><div className="crystal-slab search-list">{tracks.map((track,i)=><TrackRow key={track.id} track={track} index={i} collection={tracks}/>)}</div></section>;
}
