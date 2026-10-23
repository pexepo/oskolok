import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
  contributionFindFirst:vi.fn(),
  userFindUnique:vi.fn(),
  profileFindUnique:vi.fn(),
  personal:vi.fn(), shared:vi.fn(), catalogue:vi.fn(),
}));

vi.mock('../server/src/database/client.js',()=>({prisma:{personalTrack:{findUnique:db.personal},sharedTrackOverride:{findUnique:db.shared},
  lyricContribution:{findFirst:db.contributionFindFirst},
  user:{findUnique:db.userFindUnique},
  creatorProfile:{findUnique:db.profileFindUnique},
}}));
vi.mock('../server/src/services/LyricsService.js',()=>({lyricsService:{getLyrics:db.catalogue}}));

import {lyricsController} from '../server/src/controllers/lyricsController.js';

function mockRes(){
  return {locals:{},statusCode:200,body:undefined as any,json(payload:any){this.body=payload;return this;},status(code:number){this.statusCode=code;return this;}};
}

beforeEach(()=>{vi.clearAllMocks();db.personal.mockResolvedValue(null);db.shared.mockResolvedValue(null);});

it('attaches structured author info to an Oskolok contribution',async()=>{
  db.contributionFindFirst.mockResolvedValue({userId:'telegram:7',credit:'boris',lyricsData:JSON.stringify([{time:0,text:'строка'}])});
  db.userFindUnique.mockResolvedValue({id:'telegram:7',name:'Борис',username:'boris',avatarUrl:'tg://a'});
  db.profileFindUnique.mockResolvedValue({displayName:'Боря',avatarUrl:'avatar://x'});
  const res=mockRes();
  await lyricsController.getLyrics({params:{trackId:'s:1'},query:{}} as any,res as any,()=>{});
  expect(res.body.data.author).toEqual({id:'telegram:7',username:'boris',displayName:'Боря',avatarUrl:'avatar://x',credit:'boris'});
  expect(res.body.data.authorId).toBe('telegram:7');
});

it('keeps a plain credit when the contribution has no linked account',async()=>{
  db.contributionFindFirst.mockResolvedValue({userId:'developer',credit:'Редакция',lyricsData:JSON.stringify([{time:0,text:'строка'}])});
  db.userFindUnique.mockResolvedValue(null);
  db.profileFindUnique.mockResolvedValue(null);
  const res=mockRes();
  await lyricsController.getLyrics({params:{trackId:'s:2'},query:{}} as any,res as any,()=>{});
  expect(res.body.data.author).toBeUndefined();
  expect(res.body.data.provider).toBe('Осколок · Редакция');
});

it('falls back to catalogue text when custom content reads fail',async()=>{
  db.personal.mockRejectedValue(new Error('temporary database failure'));
  db.shared.mockRejectedValue(new Error('temporary database failure'));
  db.contributionFindFirst.mockRejectedValue(new Error('temporary database failure'));
  db.catalogue.mockResolvedValue({trackId:'t',provider:'Genius',plainLyrics:'Our lyric',isSynced:false});
  const res=mockRes();res.locals={userId:'qa'} as any;const next=vi.fn();
  await lyricsController.getLyrics({params:{trackId:'t'},query:{trackName:'Song',artistName:'Artist'}} as any,res as any,next);
  expect(next).not.toHaveBeenCalled();expect(res.body.data.provider).toBe('Genius');expect(res.body.data.timingOffset).toBe(0);
});

it('ignores corrupt stored lyrics while retaining the personal timing offset',async()=>{
  db.personal.mockResolvedValue({hasTimingOffset:true,offset:1.5,lyricsData:'broken json'});
  db.contributionFindFirst.mockResolvedValue({userId:'qa',credit:'qa',lyricsData:'{}'});
  db.catalogue.mockResolvedValue({trackId:'t',provider:'lrclib',syncedLyrics:[{time:1,text:'Our lyric'}],isSynced:true});
  const res=mockRes();res.locals={userId:'qa'} as any;const next=vi.fn();
  await lyricsController.getLyrics({params:{trackId:'t'},query:{}} as any,res as any,next);
  expect(next).not.toHaveBeenCalled();expect(res.body.data.provider).toBe('lrclib');expect(res.body.data.timingOffset).toBe(1.5);
});
