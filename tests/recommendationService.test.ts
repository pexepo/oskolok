import {describe,it,expect,vi} from 'vitest';
import type {Track} from '../server/src/types/index.js';

const seed=(title:string,artist:string,id:string,source:Track['source']='soundcloud'):Track=>({id,source,sourceId:id,title,artist:{id:artist,source,sourceId:artist,name:artist},duration:180,access:'playable'});
const liked=seed('Loved','Seed Artist','soundcloud:loved');
const recent=seed('Recent','Neighbor','soundcloud:recent');
const novel=seed('Fresh','Neighbor','soundcloud:fresh');
const remix=seed('Fresh remix','Neighbor','soundcloud:remix');
vi.mock('../server/src/database/client.js',()=>({prisma:{
 likedTrack:{findMany:vi.fn(async()=>[{trackData:JSON.stringify(liked)}])},
 historyItem:{findMany:vi.fn(async()=>[{trackData:JSON.stringify(recent)}])},
 playlistTrack:{findMany:vi.fn(async()=>[])},
}}));
vi.mock('../server/src/services/SoundCloudService.js',()=>({soundCloudService:{search:vi.fn(async()=>({tracks:[]})),getRelatedTracks:vi.fn(async()=>[recent,novel,remix])}}));
vi.mock('../server/src/services/SpotifyService.js',()=>({spotifyService:{search:vi.fn(async()=>({tracks:[]}))}}));
// Deezer is the catalog of record now: keep it offline like the other catalogues.
vi.mock('../server/src/services/OfficialCatalogService.js',()=>({officialCatalogService:{search:vi.fn(async()=>({tracks:[],artists:[],playlists:[],pagination:{page:1,limit:10,hasMore:false}})),getArtistTracks:vi.fn(async()=>[]),mapTrack:(t:unknown)=>t},splitFeaturing:(title:string)=>({title,featured:[]})}));
vi.mock('../server/src/utils/logger.js',()=>({logger:{warn:vi.fn(),debug:vi.fn(),info:vi.fn(),error:vi.fn()}}));
import {recommendationService} from '../server/src/services/RecommendationService.js';

describe('personalized recommendations',()=>{
 it('prefers a fresh related song over recently heard and remix versions',async()=>{
   const result=await recommendationService.getRecommendations({userId:'telegram:test',limit:10,character:'discovery'});
   expect(result[0].id).toBe(novel.id);
   expect(result.findIndex(t=>t.id===recent.id)).toBeGreaterThan(result.findIndex(t=>t.id===novel.id));
   expect(result.findIndex(t=>t.id===remix.id)).toBeGreaterThan(result.findIndex(t=>t.id===novel.id));
 });
});
