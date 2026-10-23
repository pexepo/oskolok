import {describe,it,expect,vi,beforeEach} from 'vitest';

const db=vi.hoisted(()=>({
 userFindUnique:vi.fn(),userCount:vi.fn(),historyFindMany:vi.fn(),likedFindMany:vi.fn(),playlistTrackFindMany:vi.fn(),
 lyricCount:vi.fn(),playlistCount:vi.fn(),reportCount:vi.fn(),
 achFindMany:vi.fn(),achCreate:vi.fn(),achUpdateMany:vi.fn(),
 medalFindMany:vi.fn(),medalCreate:vi.fn(),medalUpsert:vi.fn(),medalUpdateMany:vi.fn(),
}));
vi.mock('../server/src/database/client.js',()=>({prisma:{
 user:{findUnique:db.userFindUnique,count:db.userCount},
 historyItem:{findMany:db.historyFindMany},likedTrack:{findMany:db.likedFindMany},playlistTrack:{findMany:db.playlistTrackFindMany},
 lyricContribution:{count:db.lyricCount},playlist:{count:db.playlistCount},userReport:{count:db.reportCount},
 userAchievement:{findMany:db.achFindMany,create:db.achCreate,updateMany:db.achUpdateMany},
 userMedal:{findMany:db.medalFindMany,create:db.medalCreate,upsert:db.medalUpsert,updateMany:db.medalUpdateMany},
}}));

import {ACHIEVEMENTS,MEDALS,achievementById,medalById,tierIndex,tierName,achievementProgress,medalQualifies,streaks,localHour,primaryArtist,trackSource,validateMedalAward,RewardValidationError,type RewardStats} from '../server/src/services/rewardsCatalog.js';
import {awardMedal,revokeMedal,evaluateRewards,onAchievementUnlocked,publicRewards,invalidateRewards} from '../server/src/services/rewards.js';

const DAY=864e5;
const zero:RewardStats={collection:0,listeningMinutes:0,bestStreak:0,currentStreak:0,distinctArtists:0,lyrics:0,likes:0,nightPlays:0,sources:0,playlists:0,reports:0,plays:0,daysSinceJoin:0,topTrackPlays:0,validReports:0,acceptedTimings:0,joinRank:0};

describe('rewards catalogue',()=>{
 it('has unique ids and ascending thresholds',()=>{
  expect(new Set(ACHIEVEMENTS.map(a=>a.id)).size).toBe(ACHIEVEMENTS.length);
  expect(new Set(MEDALS.map(m=>m.id)).size).toBe(MEDALS.length);
  for(const a of ACHIEVEMENTS){expect(a.thresholds.length).toBeGreaterThan(0);expect(a.thresholds.length).toBeLessThanOrEqual(3);for(let i=1;i<a.thresholds.length;i++)expect(a.thresholds[i]).toBeGreaterThan(a.thresholds[i-1]);}
  expect(achievementById.get('collection')!.thresholds).toEqual([100,1000,5000]);
  expect(achievementById.get('minutes')!.thresholds).toEqual([60,600,6000]);
 });
 it('counts tiers at exact thresholds',()=>{
  const th=[100,1000,5000];
  expect(tierIndex(th,0)).toBe(0);expect(tierIndex(th,99)).toBe(0);expect(tierIndex(th,100)).toBe(1);
  expect(tierIndex(th,999)).toBe(1);expect(tierIndex(th,1000)).toBe(2);expect(tierIndex(th,5000)).toBe(3);expect(tierIndex(th,1e9)).toBe(3);
  expect(tierIndex(th,Number.NaN)).toBe(0);
  expect(tierName(th,0)).toBeNull();expect(tierName(th,1)).toBe('bronze');expect(tierName(th,2)).toBe('silver');expect(tierName(th,3)).toBe('gold');
  expect(tierName([1],1)).toBe('gold');
 });
 it('computes progress between tiers',()=>{
  const def=achievementById.get('collection')!;
  expect(achievementProgress(def,50)).toMatchObject({tier:null,next:100,progress:.5,maxed:false});
  expect(achievementProgress(def,550)).toMatchObject({tier:'bronze',tiersReached:1,next:1000,progress:.5});
  expect(achievementProgress(def,7000)).toMatchObject({tier:'gold',next:null,progress:1,maxed:true});
  expect(achievementProgress(def,-5)).toMatchObject({value:0,progress:0});
  expect(achievementProgress(achievementById.get('first_like')!,1)).toMatchObject({tier:'gold',maxed:true});
 });
 it('evaluates medal rules',()=>{
  const community=medalById.get('community')!,first=medalById.get('first_100')!,manual=medalById.get('near_dev')!;
  expect(medalQualifies(community,{...zero,lyrics:9})).toBe(false);
  expect(medalQualifies(community,{...zero,lyrics:10})).toBe(true);
  expect(medalQualifies(first,{...zero,joinRank:100})).toBe(true);
  expect(medalQualifies(first,{...zero,joinRank:101})).toBe(false);
  expect(medalQualifies(first,{...zero,joinRank:0})).toBe(false);
  expect(medalQualifies(manual,{...zero,lyrics:1e6,joinRank:1})).toBe(false);
 });
 it('computes streaks in Moscow days',()=>{
  const now=Date.UTC(2026,5,10,12);
  const days=(...offsets:number[])=>offsets.map(d=>now-d*DAY);
  expect(streaks([],now)).toEqual({best:0,current:0});
  expect(streaks(days(0,1,2,5,6),now)).toEqual({best:3,current:3});
  expect(streaks(days(1,2,3,4),now)).toEqual({best:4,current:4});// yesterday still counts as current
  expect(streaks(days(3,4),now)).toEqual({best:2,current:0});
  // 20:30 and 21:30 UTC straddle Moscow midnight: one UTC day, two local days
  expect(streaks([Date.UTC(2026,5,9,20,30),Date.UTC(2026,5,9,21,30)],now).best).toBe(2);
  expect(localHour(Date.UTC(2026,0,1,22))).toBe(1);
 });
 it('normalises artists and sources',()=>{
  expect(primaryArtist('Oxxxymiron feat. Слава КПСС')).toBe('oxxxymiron');
  expect(primaryArtist('A, B & C')).toBe('a');
  expect(trackSource('licensed:abc')).toBe('youtube');expect(trackSource('spotify:1')).toBe('spotify');expect(trackSource('weird')).toBe('other');
 });
 it('validates medal awards',()=>{
  expect(validateMedalAward({medalId:'near_dev',note:'  за\nпомощь  '})).toEqual({medalId:'near_dev',note:'за помощь'});
  expect(validateMedalAward({medalId:'patron'})).toEqual({medalId:'patron',note:''});
  expect(()=>validateMedalAward({medalId:'nope'})).toThrow(RewardValidationError);
  expect(()=>validateMedalAward({medalId:''})).toThrow(RewardValidationError);
  expect(()=>validateMedalAward({medalId:7})).toThrow(RewardValidationError);
  expect(()=>validateMedalAward({medalId:'patron',note:5})).toThrow(RewardValidationError);
  expect(()=>validateMedalAward({medalId:'patron',note:'я'.repeat(201)})).toThrow(/200/);
 });
});

describe('rewards service',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();invalidateRewards('telegram:1');
  db.userFindUnique.mockResolvedValue({id:'telegram:1',createdAt:new Date(Date.now()-40*DAY)});db.userCount.mockResolvedValue(500);
  db.historyFindMany.mockResolvedValue([]);db.likedFindMany.mockResolvedValue([]);db.playlistTrackFindMany.mockResolvedValue([]);
  db.lyricCount.mockResolvedValue(0);db.playlistCount.mockResolvedValue(0);db.reportCount.mockResolvedValue(0);
  db.achFindMany.mockResolvedValue([]);db.medalFindMany.mockResolvedValue([]);
  db.achCreate.mockResolvedValue({});db.medalCreate.mockImplementation(async({data}:any)=>({id:'m',...data,revokedAt:null}));
 });

 it('awards a known medal to an existing user and emits an event',async()=>{
  db.medalUpsert.mockResolvedValue({medalId:'near_dev',note:'спасибо'});
  const events:any[]=[];const off=onAchievementUnlocked('telegram:1',e=>{events.push(e);});
  await awardMedal('telegram:1',{medalId:'near_dev',note:'спасибо'});
  off();
  expect(db.medalUpsert).toHaveBeenCalledWith(expect.objectContaining({where:{userId_medalId:{userId:'telegram:1',medalId:'near_dev'}},update:expect.objectContaining({revokedAt:null,awardedBy:'admin'})}));
  expect(events).toEqual([expect.objectContaining({kind:'medal',id:'near_dev',awardedBy:'admin',note:'спасибо'})]);
 });
 it('rejects unknown medals and missing users',async()=>{
  await expect(awardMedal('telegram:1',{medalId:'fake'})).rejects.toThrow(RewardValidationError);
  db.userFindUnique.mockResolvedValueOnce(null);
  await expect(awardMedal('telegram:404',{medalId:'patron'})).rejects.toThrow('Пользователь не найден.');
  expect(db.medalUpsert).not.toHaveBeenCalled();
 });
 it('revokes only an active medal',async()=>{
  db.medalUpdateMany.mockResolvedValueOnce({count:1});
  await revokeMedal('telegram:1','patron');
  expect(db.medalUpdateMany).toHaveBeenCalledWith({where:{userId:'telegram:1',medalId:'patron',revokedAt:null},data:{revokedAt:expect.any(Date)}});
  db.medalUpdateMany.mockResolvedValueOnce({count:0});
  await expect(revokeMedal('telegram:1','patron')).rejects.toThrow('нет этой медали');
  await expect(revokeMedal('telegram:1','fake')).rejects.toThrow('Неизвестная медаль.');
 });
 it('persists new tiers once, notifies, and respects revoked auto medals',async()=>{
  const now=Date.now();
  db.historyFindMany.mockResolvedValue(Array.from({length:30},(_,i)=>({trackId:i%2?'spotify:1':'soundcloud:2',playedAt:new Date(now-i*36e5),trackData:JSON.stringify({duration:180,artist:{name:`Artist ${i%3}`}})})));
  db.likedFindMany.mockResolvedValue([{trackId:'spotify:1'}]);
  db.lyricCount.mockResolvedValue(12);
  db.achFindMany.mockResolvedValue([{userId:'telegram:1',achievementId:'first_like',tier:1,unlockedAt:new Date(),seenAt:new Date()}]);
  db.medalFindMany.mockResolvedValue([{userId:'telegram:1',medalId:'community',note:'',awardedBy:'auto',awardedAt:new Date(),revokedAt:new Date(),seenAt:null}]);
  const events:any[]=[];const off=onAchievementUnlocked(e=>{events.push(e);});
  const result=await evaluateRewards('telegram:1',true);
  off();
  const created=db.achCreate.mock.calls.map(c=>`${c[0].data.achievementId}:${c[0].data.tier}`);
  expect(created).toContain('minutes:1');// 30 × 3 min = 90 min ≥ 60
  expect(created).toContain('lyricist:2');// 12 ≥ 10
  expect(created).toContain('explorer:1');
  expect(created).not.toContain('first_like:1');// already stored
  expect(db.medalCreate).not.toHaveBeenCalled();// community was revoked by an admin → no re-grant
  expect(result.stats).toMatchObject({plays:30,listeningMinutes:90,lyrics:12,sources:2,distinctArtists:3,topTrackPlays:15,collection:1});
  expect(events.every(e=>e.kind==='achievement'&&e.backfill===false)).toBe(true);// user already had rows: not a backfill
  expect(events.length).toBe(created.length);
  // second call within 5 minutes is served from cache
  await evaluateRewards('telegram:1');
  expect(db.historyFindMany).toHaveBeenCalledTimes(1);
 });
 it('stores a first big batch silently as backfill',async()=>{
  db.lyricCount.mockResolvedValue(60);db.playlistCount.mockResolvedValue(30);db.reportCount.mockResolvedValue(25);
  await evaluateRewards('telegram:1',true);
  expect(db.achCreate.mock.calls.length).toBeGreaterThan(3);
  expect(db.achCreate.mock.calls.every(c=>c[0].data.seenAt instanceof Date)).toBe(true);
  expect(db.medalCreate).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({medalId:'community',awardedBy:'auto'})}));
 });
 it('public view lists active medals and the best achievement tier',async()=>{
  db.medalFindMany.mockResolvedValue([{medalId:'patron',note:'',awardedBy:'admin',awardedAt:new Date(),revokedAt:null},{medalId:'community',note:'',awardedBy:'auto',awardedAt:new Date(),revokedAt:null}]);
  db.achFindMany.mockResolvedValue([{achievementId:'minutes',tier:1,unlockedAt:new Date(1)},{achievementId:'minutes',tier:2,unlockedAt:new Date(2)},{achievementId:'curator',tier:1,unlockedAt:new Date(3)}]);
  const view=await publicRewards('telegram:1');
  expect(view.medals.map(m=>m.id)).toEqual(['community','patron']);// catalogue order
  expect(view.achievements[0]).toMatchObject({id:'minutes',tier:'silver'});
  expect(view.achievementsUnlocked).toBe(2);
 });
});
