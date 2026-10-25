import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
  userFindUnique:vi.fn(),
  profileFindUnique:vi.fn(),
  musicFindMany:vi.fn(),
  musicCount:vi.fn(),
  playlistsFindMany:vi.fn(),
  publicPlaylists:vi.fn(async()=>[]),
  contributionFindMany:vi.fn(),
  contributionCount:vi.fn(),
  contributionFindFirst:vi.fn(),
  historyCount:vi.fn(),
  historyGroupBy:vi.fn(),
  likedCount:vi.fn(),
}));

vi.mock('../server/src/database/client.js',()=>({prisma:{
  user:{findUnique:db.userFindUnique},
  creatorProfile:{findUnique:db.profileFindUnique},
  profileMusic:{findMany:db.musicFindMany,count:db.musicCount},
  profilePlaylist:{findMany:db.playlistsFindMany},
  playlist:{findMany:db.publicPlaylists},
  lyricContribution:{findMany:db.contributionFindMany,count:db.contributionCount,findFirst:db.contributionFindFirst},
  historyItem:{count:db.historyCount,groupBy:db.historyGroupBy},
  likedTrack:{count:db.likedCount},
}}));
vi.mock('../server/src/services/profileArtwork.js',()=>({profileTrackWithArtwork:async(raw:string)=>JSON.parse(raw)}));
// The showcase reads its own table; profile tests see it through the service.
vi.mock('../server/src/services/profileShowcase.js',()=>({listShowcase:async(userId:string)=>(await db.musicFindMany({where:{userId}})||[]).map((row:{trackData:string},i:number)=>({id:`tile-${i}`,kind:'track',size:'m',caption:'',track:JSON.parse(row.trackData)})),showcaseCount:(userId:string)=>db.musicCount({where:{userId}}),showcaseMedia:vi.fn()}));

import {publicProfileController} from '../server/src/controllers/publicProfileController.js';

function mockRes(){
  return {
    statusCode:200,
    body:undefined as any,
    status(code:number){this.statusCode=code;return this;},
    json(payload:any){this.body=payload;return this;},
    setHeader(){return this;},
  };
}

beforeEach(()=>{vi.clearAllMocks();db.playlistsFindMany.mockResolvedValue([]);});

describe('public profile API',()=>{
  it('returns identity, music and published texts without private data',async()=>{
    db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:'boris',avatarUrl:'tg://a'});
    db.profileFindUnique.mockResolvedValue({displayName:'Боря',avatarUrl:'',bannerUrl:'banner://x',bio:'привет'});
    db.musicFindMany.mockResolvedValue([{trackData:JSON.stringify({id:'s:1',title:'Песня'})}]);
    db.contributionFindMany.mockResolvedValue([{id:'c1',trackId:'s:1',trackTitle:'Песня',artistName:'Артист',credit:'boris',updatedAt:new Date('2026-01-01')}]);
    const res=mockRes();
    await publicProfileController.getPublicProfile({params:{id:'telegram:7'}} as any,res as any,()=>{});
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({userId:'telegram:7',username:'boris',displayName:'Боря',bannerUrl:'banner://x',bio:'привет'});
    expect(res.body.data.showcase[0].track.title).toBe('Песня');
    expect(res.body.data.contributions[0].trackTitle).toBe('Песня');
    expect(JSON.stringify(res.body)).not.toContain('lyricsData');
  });

  it('returns 404 for an unknown user',async()=>{
    db.userFindUnique.mockResolvedValue(null);
    const res=mockRes();
    await publicProfileController.getPublicProfile({params:{id:'telegram:404'}} as any,res as any,()=>{});
    expect(res.statusCode).toBe(404);
  });

  it('returns counts for the hover summary',async()=>{
    db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:null,avatarUrl:'',createdAt:new Date('2025-01-01')});
    db.profileFindUnique.mockResolvedValue(null);
    db.musicCount.mockResolvedValue(3);
    db.contributionFindMany.mockResolvedValue([{trackId:'s:1'},{trackId:'s:2'}]);
    db.contributionFindFirst.mockResolvedValue(null);
    db.historyCount.mockResolvedValue(5);db.historyGroupBy.mockResolvedValue([{userId:'a'},{userId:'b'}]);db.likedCount.mockResolvedValue(1);
    const res=mockRes();
    await publicProfileController.getSummary({params:{id:'telegram:7'}} as any,res as any,()=>{});
    expect(res.body.data).toMatchObject({displayName:'Борис',textsCount:2,musicCount:3,stats:{plays:5,listeners:2,likes:1}});
  });
});

describe('public profile visibility',()=>{
  beforeEach(()=>{
    db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',createdAt:new Date('2025-01-01')});
    db.profileFindUnique.mockResolvedValue({profileVisibility:JSON.stringify({showcase:false,lyrics:false,nowPlaying:false,stats:false})});
    // Hidden data exists: it must not be returned from any public endpoint.
    db.musicFindMany.mockResolvedValue([{trackData:JSON.stringify({id:'hidden-track'})}]);
    db.contributionFindMany.mockResolvedValue([{id:'hidden-lyric',trackId:'hidden-track'}]);
    db.playlistsFindMany.mockResolvedValue([{playlistId:'hidden-playlist'}]);
  });
  it('hides showcase and contributions in the full profile',async()=>{
    const res=mockRes(),next=vi.fn();
    await publicProfileController.getPublicProfile({params:{id:'telegram:7'}} as any,res as any,next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toMatchObject({showcase:[],contributions:[],textsCount:0,currentTrack:null});
    expect(db.musicFindMany).not.toHaveBeenCalled();
    expect(db.contributionFindMany).not.toHaveBeenCalled();
  });
  it('hides counts and latest lyrics from the summary',async()=>{
    const res=mockRes(),next=vi.fn();
    await publicProfileController.getSummary({params:{id:'telegram:7'}} as any,res as any,next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toMatchObject({musicCount:0,textsCount:0,latestLyrics:null,stats:null});
  });
  it('prevents pagination from bypassing hidden lyrics',async()=>{
    const res=mockRes(),next=vi.fn();
    await publicProfileController.getLyrics({params:{id:'telegram:7'},query:{offset:10,limit:2}} as any,res as any,next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toEqual({items:[],total:0,offset:10,limit:2,hasMore:false});
    expect(db.contributionFindMany).not.toHaveBeenCalled();
  });
});
