import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
  contributionFindFirst:vi.fn(),
  userFindUnique:vi.fn(),
  profileFindUnique:vi.fn(),
}));

vi.mock('../server/src/database/client.js',()=>({prisma:{
  lyricContribution:{findFirst:db.contributionFindFirst},
  user:{findUnique:db.userFindUnique},
  creatorProfile:{findUnique:db.profileFindUnique},
}}));
vi.mock('../server/src/services/LyricsService.js',()=>({lyricsService:{getLyrics:vi.fn()}}));

import {lyricsController} from '../server/src/controllers/lyricsController.js';

function mockRes(){
  return {statusCode:200,body:undefined as any,json(payload:any){this.body=payload;return this;},status(code:number){this.statusCode=code;return this;}};
}

beforeEach(()=>vi.clearAllMocks());

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
