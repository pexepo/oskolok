import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({follows:[] as any[],watches:new Map<string,any>(),notifications:[] as any[],releases:[] as any[]}));
vi.mock('../server/src/database/client.js',()=>({prisma:{
 artistFollow:{findMany:vi.fn(async({where}:any)=>db.follows.filter(f=>where.userId?f.userId===where.userId:where.artistKey.in.includes(f.artistKey)))},
 artistReleaseWatch:{findUnique:vi.fn(async({where}:any)=>db.watches.get(where.artistKey)||null),create:vi.fn(async({data}:any)=>{const row={knownIds:'[]',...data};db.watches.set(data.artistKey,row);return row;}),update:vi.fn(async({where,data}:any)=>{const row={...db.watches.get(where.artistKey),...data};db.watches.set(where.artistKey,row);return row;})},
 userNotification:{create:vi.fn(async({data}:any)=>{if(db.notifications.some(n=>n.userId===data.userId&&n.dedupeKey===data.dedupeKey))throw Object.assign(new Error('dup'),{code:'P2002'});db.notifications.push(data);return data;})},
}}));
vi.mock('../server/src/controllers/catalogController.js',()=>({catalogController:{artistDetails:vi.fn(async(_req:any,res:any)=>res.json({data:{artist:{name:'Artist'},releases:db.releases}}))}}));
const genius=vi.hoisted(()=>({albums:[] as any[],songs:[] as any[],tracks:{} as Record<number,any[]>}));
vi.mock('../server/src/services/GeniusService.js',()=>({
 geniusArtist:vi.fn(async()=>({id:1,name:'Artist',url:'https://genius.com/artists/Artist'})),
 geniusCached:vi.fn(async(_k:string,load:()=>Promise<any>)=>load()),
 geniusDate:(a:any)=>a.release_date||undefined,
 geniusApi:vi.fn(async(path:string)=>{
  if(path.includes('/albums?'))return {albums:genius.albums,next_page:null};
  if(path.includes('/songs?'))return {songs:genius.songs,next_page:null};
  const id=Number(path.match(/albums\/(\d+)\/tracks/)?.[1]);return {tracks:genius.tracks[id]||[]};
 }),
}));

import {artistKey,artistKeys,checkFollowedReleases} from '../server/src/services/artistFollow.js';
import {geniusUpcoming} from '../server/src/services/geniusUpcoming.js';

describe('artist keys',()=>{
 it('normalizes names and bracketed aliases',()=>{
  expect(artistKey('Слава КПСС (Slava KPSS)')).toBe('славакпсс');
  expect(artistKeys('Слава КПСС (Slava KPSS)')).toEqual(['славакпсс','slavakpss']);
  expect(artistKey('Ёлка')).toBe(artistKey('елка'));
 });
});

describe('follow release check',()=>{
 beforeEach(()=>{db.follows=[{userId:'u1',artistKey:'artist',artistId:'spotify:artist:x',name:'Artist'},{userId:'u2',artistKey:'artist',artistId:'spotify:artist:x',name:'Artist'}];db.watches.clear();db.notifications=[];});
 it('records a baseline first, then notifies every follower about a new release once',async()=>{
  db.releases=[{id:'old',title:'Old',date:'2020-01-01',type:'album'}];
  await checkFollowedReleases('u1',true);
  expect(db.notifications).toHaveLength(0);
  expect(JSON.parse(db.watches.get('artist').knownIds)).toEqual(['old']);
  db.watches.set('artist',{...db.watches.get('artist'),checkedAt:new Date(Date.now()-7*3600000)});
  db.releases=[{id:'new',title:'New',date:new Date().toISOString().slice(0,10),type:'single'},...db.releases];
  await checkFollowedReleases('u1',true);
  expect(db.notifications.map(n=>[n.userId,n.dedupeKey])).toEqual([['u1','release:new'],['u2','release:new']]);
  // Within the 6 h window nothing is fetched again.
  await checkFollowedReleases('u1',true);
  expect(db.notifications).toHaveLength(2);
 });
});

describe('Genius upcoming',()=>{
 it('finds future and undated announced albums and unreleased songs',async()=>{
  const next=`${new Date().getFullYear()+1}-03-01`;
  genius.albums=[{id:10,name:'Next LP',url:'u10',release_date:next},{id:11,name:'Old LP',url:'u11',release_date:'2019-05-05'},{id:12,name:'Announced',url:'u12'},{id:13,name:'Unreleased Songs',url:'u13',release_date:'2021'}];
  genius.tracks={12:[],13:[{song:{id:300,title:'Vault Song',url:'s300',primary_artist:{id:1}}}]};
  genius.songs=[{id:100,title:'Leaked',url:'s100',lyrics_state:'unreleased',primary_artist:{id:1}},{id:101,title:'Hit',url:'s101',lyrics_state:'complete',release_date:'2020-01-01',primary_artist:{id:1}},{id:102,title:'Intro [Snippet]',url:'s102',lyrics_state:'complete',primary_artist:{id:1}},{id:103,title:'Other',url:'s103',lyrics_state:'unreleased',primary_artist:{id:9}}];
  const result=await geniusUpcoming('Artist');
  expect(result.upcoming.map(a=>[a.name,a.dateKnown])).toEqual([['Next LP',true],['Announced',false]]);
  expect(result.unreleased.map(s=>s.id).sort()).toEqual([100,102,300]);
 });
});
