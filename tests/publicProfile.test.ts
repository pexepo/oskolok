import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
  userFindUnique:vi.fn(),
  profileFindUnique:vi.fn(),
  musicFindMany:vi.fn(),
  musicCount:vi.fn(),
  playlistsFindMany:vi.fn(),
  contributionFindMany:vi.fn(),
  contributionCount:vi.fn(),
}));

vi.mock('../server/src/database/client.js',()=>({prisma:{
  user:{findUnique:db.userFindUnique},
  creatorProfile:{findUnique:db.profileFindUnique},
  profileMusic:{findMany:db.musicFindMany,count:db.musicCount},
  profilePlaylist:{findMany:db.playlistsFindMany},
  lyricContribution:{findMany:db.contributionFindMany,count:db.contributionCount},
}}));
vi.mock('../server/src/services/profileArtwork.js',()=>({profileTrackWithArtwork:async(raw:string)=>JSON.parse(raw)}));

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
    expect(res.body.data.music[0].title).toBe('Песня');
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
    db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:null,avatarUrl:''});
    db.profileFindUnique.mockResolvedValue(null);
    db.musicCount.mockResolvedValue(3);
    db.contributionCount.mockResolvedValue(2);
    const res=mockRes();
    await publicProfileController.getSummary({params:{id:'telegram:7'}} as any,res as any,()=>{});
    expect(res.body.data).toMatchObject({displayName:'Борис',textsCount:2,musicCount:3});
  });
});
