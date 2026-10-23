import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../server/src/database/client.js',()=>({prisma:{artistEnrichment:{findUnique:vi.fn(),upsert:vi.fn(async()=>({}))}}}));
import {SpotifyService} from '../server/src/services/SpotifyService.js';
import {officialCatalogService} from '../server/src/services/OfficialCatalogService.js';
import {prisma} from '../server/src/database/client.js';
const spotifyId='4tZwfgrHOc3mvqYlEYSvVi';
const match={tracks:[],artists:[{id:'deezer:artist:27',sourceId:'27',name:'Daft Punk',followersCount:1000}],playlists:[],pagination:{page:1,limit:1,hasMore:false}} as any;
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.mocked(prisma.artistEnrichment.findUnique).mockResolvedValue(null);});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
function service(){const s=new SpotifyService();vi.spyOn(s,'getArtist').mockResolvedValue({id:`spotify:artist:${spotifyId}`,name:'Daft Punk'} as any);vi.spyOn(s,'getArtistReleases').mockResolvedValue(null);return s;}
describe('artist fallback recovers after a temporary catalogue failure',()=>{
 it('retries a missing counterpart after five minutes without hammering the provider',async()=>{
  const s=service(),search=vi.spyOn(officialCatalogService,'search').mockResolvedValueOnce({...match,artists:[]}).mockResolvedValue(match);
  expect(await s.deezerCounterpart(spotifyId)).toBeNull();vi.advanceTimersByTime(240000);
  expect(await s.deezerCounterpart(spotifyId)).toBeNull();expect(search).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(61000);expect(await s.deezerCounterpart(spotifyId)).toBe('27');expect(search).toHaveBeenCalledTimes(2);
 });
 it('rechecks an old negative cache rather than hiding releases for three days',async()=>{
  const s=service();vi.mocked(prisma.artistEnrichment.findUnique).mockResolvedValue({data:JSON.stringify({deezerId:null}),updatedAt:new Date(Date.now()-3600000)} as any);
  const search=vi.spyOn(officialCatalogService,'search').mockResolvedValue(match);
  expect(await s.deezerCounterpart(spotifyId)).toBe('27');expect(search).toHaveBeenCalledOnce();
 });
 it('preserves a verified counterpart without new searches',async()=>{
  const s=service();vi.mocked(prisma.artistEnrichment.findUnique).mockResolvedValue({data:JSON.stringify({deezerId:'27',verified:true}),updatedAt:new Date(Date.now()-2*86400000)} as any);
  const search=vi.spyOn(officialCatalogService,'search');expect(await s.deezerCounterpart(spotifyId)).toBe('27');expect(search).not.toHaveBeenCalled();
 });
});
