import {prisma} from '../database/client.js';
import {ACHIEVEMENTS,MEDALS,achievementById,medalById,evaluateAchievements,medalQualifies,streaks,localHour,primaryArtist,trackSource,validateMedalAward,RewardValidationError,tierName,type RewardStats,type Tier,type Text} from './rewardsCatalog.js';

/* Rewards engine: computes per-user stats with a handful of aggregate queries, persists unlocks
   (UserAchievement one row per tier, UserMedal one row per medal) and emits events for notifiers. */

export {RewardValidationError};
export type RewardEvent=
 |{kind:'achievement';userId:string;id:string;tier:Tier;tierIndex:number;title:Text;icon:string;at:string;backfill:boolean}
 |{kind:'medal';userId:string;id:string;title:Text;icon:string;color:string;note:string;awardedBy:'admin'|'auto';at:string;backfill:boolean};
type Listener=(event:RewardEvent)=>void|Promise<void>;
const listeners=new Set<{userId?:string;fn:Listener}>();
/** Subscribe to unlocks (achievement tiers and medals). Pass a userId to listen to one user. Returns an unsubscribe. */
export function onAchievementUnlocked(fn:Listener):()=>void;
export function onAchievementUnlocked(userId:string,fn:Listener):()=>void;
export function onAchievementUnlocked(a:string|Listener,b?:Listener){
 const entry=typeof a==='function'?{fn:a}:{userId:a,fn:b!};
 listeners.add(entry);return ()=>{listeners.delete(entry);};
}
function emit(event:RewardEvent){
 for(const l of listeners)if(!l.userId||l.userId===event.userId){try{void Promise.resolve(l.fn(event)).catch(()=>{});}catch{/* a listener must not break awarding */}}
}

const DAY=864e5,CACHE_MS=5*6e4,BACKFILL_BURST=3;
const parse=(raw:string)=>{try{const t=JSON.parse(raw);return {duration:Number(t?.duration)||0,artist:String(t?.artist?.name||'')};}catch{return {duration:0,artist:''};}};

/** All numbers achievements and medal rules need, from aggregate queries plus one pass over the user's history. */
export async function computeStats(userId:string,now=Date.now()):Promise<RewardStats>{
 const [user,history,liked,playlistTracks,lyrics,playlists,reports,validReports,acceptedTimings]=await Promise.all([
  prisma.user.findUnique({where:{id:userId},select:{createdAt:true}}),
  prisma.historyItem.findMany({where:{userId},select:{trackId:true,playedAt:true,trackData:true}}),
  prisma.likedTrack.findMany({where:{userId},select:{trackId:true}}),
  prisma.playlistTrack.findMany({where:{playlist:{userId}},select:{trackId:true}}),
  prisma.lyricContribution.count({where:{userId}}),
  prisma.playlist.count({where:{userId}}),
  prisma.userReport.count({where:{userId}}),
  prisma.userReport.count({where:{userId,status:{in:['approved','resolved']}}}),
  prisma.userReport.count({where:{userId,kind:'timing',status:'approved'}}),
 ]);
 let seconds=0,nightPlays=0;const artists=new Set<string>(),sources=new Set<string>(),perTrack=new Map<string,number>(),times:number[]=[];
 for(const h of history){
  const t=parse(h.trackData),at=h.playedAt.getTime();
  // Cap a single play at 20 min so a broken duration can't inflate listening time.
  seconds+=Math.min(Math.max(0,t.duration),1200);times.push(at);
  if(localHour(at)<5)nightPlays++;
  const artist=primaryArtist(t.artist);if(artist)artists.add(artist);
  const src=trackSource(h.trackId);if(src!=='other')sources.add(src);
  perTrack.set(h.trackId,(perTrack.get(h.trackId)||0)+1);
 }
 const streak=streaks(times,now);
 const joinRank=user&&userId.startsWith('telegram:')?await prisma.user.count({where:{id:{startsWith:'telegram:'},createdAt:{lt:user.createdAt}}})+1:0;
 return {
  collection:new Set([...liked.map(l=>l.trackId),...playlistTracks.map(p=>p.trackId)]).size,
  listeningMinutes:Math.floor(seconds/60),bestStreak:streak.best,currentStreak:streak.current,distinctArtists:artists.size,lyrics,likes:liked.length,
  nightPlays,sources:sources.size,playlists,reports,plays:history.length,daysSinceJoin:user?Math.max(0,Math.floor((now-user.createdAt.getTime())/DAY)):0,
  topTrackPlays:[...perTrack.values()].reduce((a,b)=>a>b?a:b,0),validReports,acceptedTimings,joinRank,
 };
}

const isUnique=(e:any)=>e?.code==='P2002';
const cache=new Map<string,{at:number;value:Awaited<ReturnType<typeof evaluate>>}>();
const inflight=new Map<string,Promise<Awaited<ReturnType<typeof evaluate>>>>();
export const invalidateRewards=(userId:string)=>{cache.delete(userId);};

async function evaluate(userId:string){
 const stats=await computeStats(userId);
 const progress=evaluateAchievements(stats);
 const [unlocked,medalRows]=await Promise.all([
  prisma.userAchievement.findMany({where:{userId}}),
  prisma.userMedal.findMany({where:{userId}}),
 ]);
 const have=new Set(unlocked.map(u=>`${u.achievementId}:${u.tier}`));
 const pending:Array<{achievementId:string;tier:number}>=[];
 for(const p of progress)for(let tier=1;tier<=p.tiersReached;tier++)if(!have.has(`${p.id}:${tier}`))pending.push({achievementId:p.id,tier});
 const medalIds=new Set(medalRows.map(m=>m.medalId));// revoked rows count too: an admin revoke beats the rule
 const autoMedals=MEDALS.filter(m=>!medalIds.has(m.id)&&medalQualifies(m,stats));
 // A first evaluation of a long-time listener unlocks a lot at once: store it silently instead of a toast flood.
 const backfill=pending.length+autoMedals.length>BACKFILL_BURST&&unlocked.length===0;
 const now=new Date(),seenAt=backfill?now:null;
 for(const u of pending){
  try{
   await prisma.userAchievement.create({data:{userId,achievementId:u.achievementId,tier:u.tier,unlockedAt:now,seenAt}});
   unlocked.push({userId,achievementId:u.achievementId,tier:u.tier,unlockedAt:now,seenAt});
   const def=achievementById.get(u.achievementId)!;
   emit({kind:'achievement',userId,id:def.id,tier:tierName(def.thresholds,u.tier)!,tierIndex:u.tier,title:def.title,icon:def.icon,at:now.toISOString(),backfill});
  }catch(e){if(!isUnique(e))throw e;}
 }
 for(const m of autoMedals){
  try{
   const row=await prisma.userMedal.create({data:{userId,medalId:m.id,note:'',awardedBy:'auto',awardedAt:now,seenAt}});
   medalRows.push(row);
   emit({kind:'medal',userId,id:m.id,title:m.title,icon:m.icon,color:m.color,note:'',awardedBy:'auto',at:now.toISOString(),backfill});
  }catch(e){if(!isUnique(e))throw e;}
 }
 return {stats,progress,unlocked,medalRows};
}

/** Cached (~5 min) evaluation; concurrent callers share one computation. `force` bypasses the cache. */
export async function evaluateRewards(userId:string,force=false){
 const hit=cache.get(userId);
 if(!force&&hit&&Date.now()-hit.at<CACHE_MS)return hit.value;
 const running=inflight.get(userId);if(running)return running;
 const job=evaluate(userId).then(value=>{cache.set(userId,{at:Date.now(),value});if(cache.size>5000)cache.delete(cache.keys().next().value!);return value;}).finally(()=>inflight.delete(userId));
 inflight.set(userId,job);return job;
}

const medalView=(row:{medalId:string;note:string;awardedBy:string;awardedAt:Date})=>{
 const def=medalById.get(row.medalId);
 return def?{id:def.id,title:def.title,description:def.description,icon:def.icon,color:def.color,note:row.note,awardedBy:row.awardedBy==='auto'?'auto' as const:'admin' as const,awardedAt:row.awardedAt.toISOString()}:null;
};
const MEDAL_ORDER=new Map(MEDALS.map((m,i)=>[m.id,i]));
const activeMedals=(rows:Array<{medalId:string;note:string;awardedBy:string;awardedAt:Date;revokedAt:Date|null}>)=>rows.filter(r=>!r.revokedAt).sort((a,b)=>(MEDAL_ORDER.get(a.medalId)??99)-(MEDAL_ORDER.get(b.medalId)??99)).flatMap(r=>{const v=medalView(r);return v?[v]:[];});

/** Highest tier per achievement, best first (gold → recent), as shown on profiles. */
function topAchievements(rows:Array<{achievementId:string;tier:number;unlockedAt:Date}>,limit=6){
 const best=new Map<string,{tier:number;unlockedAt:Date}>();
 for(const r of rows){const b=best.get(r.achievementId);if(!b||r.tier>b.tier)best.set(r.achievementId,{tier:r.tier,unlockedAt:r.unlockedAt});}
 return [...best.entries()].flatMap(([id,b])=>{const def=achievementById.get(id);if(!def)return [];const tier=tierName(def.thresholds,b.tier)!;return [{id,title:def.title,icon:def.icon,tier,rank:tier==='gold'?3:tier==='silver'?2:1,unlockedAt:b.unlockedAt.toISOString()}];})
  .sort((a,b)=>b.rank-a.rank||b.unlockedAt.localeCompare(a.unlockedAt)).slice(0,limit).map(({rank:_rank,...rest})=>rest);
}

/** The owner's full view: every achievement with progress and per-tier unlock dates, medals, and unseen unlocks. */
export async function ownRewards(userId:string,force=false){
 const {progress,unlocked,medalRows,stats}=await evaluateRewards(userId,force);
 const when=new Map(unlocked.map(u=>[`${u.achievementId}:${u.tier}`,u.unlockedAt.toISOString()]));
 const achievements=progress.map(p=>({...p,tiers:p.tiers.map((t,i)=>({...t,unlockedAt:when.get(`${p.id}:${i+1}`)||null}))}));
 const unseen=[
  ...unlocked.filter(u=>!u.seenAt).flatMap(u=>{const def=achievementById.get(u.achievementId);return def?[{kind:'achievement' as const,id:def.id,tier:tierName(def.thresholds,u.tier),tierIndex:u.tier,title:def.title,icon:def.icon}]:[];}),
  ...medalRows.filter(m=>!m.seenAt&&!m.revokedAt).flatMap(m=>{const v=medalView(m);return v?[{kind:'medal' as const,id:v.id,title:v.title,icon:v.icon,color:v.color}]:[];}),
 ];
 return {
  achievements,medals:activeMedals(medalRows),
  medalCatalog:MEDALS.map(m=>({id:m.id,title:m.title,description:m.description,icon:m.icon,color:m.color,hint:m.auto?.hint??null})),
  summary:{unlocked:new Set(unlocked.map(u=>u.achievementId)).size,total:ACHIEVEMENTS.length,gold:achievements.filter(a=>a.tier==='gold').length,listeningMinutes:stats.listeningMinutes,currentStreak:stats.currentStreak},
  unseen,
 };
}
/** Marks unlock notifications as shown. */
export async function markRewardsSeen(userId:string){
 const now=new Date();
 await Promise.all([prisma.userAchievement.updateMany({where:{userId,seenAt:null},data:{seenAt:now}}),prisma.userMedal.updateMany({where:{userId,seenAt:null},data:{seenAt:now}})]);
 const hit=cache.get(userId);
 if(hit){for(const u of hit.value.unlocked)u.seenAt??=now;for(const m of hit.value.medalRows)m.seenAt??=now;}
}

/** Public view from persisted data only (cheap): active medals and the best few achievements. */
export async function publicRewards(userId:string){
 const [medals,achievements]=await Promise.all([prisma.userMedal.findMany({where:{userId,revokedAt:null}}),prisma.userAchievement.findMany({where:{userId}})]);
 return {medals:activeMedals(medals),achievements:topAchievements(achievements),achievementsUnlocked:new Set(achievements.map(a=>a.achievementId)).size};
}

/* ---------- admin ---------- */
export async function awardMedal(userId:string,input:{medalId?:unknown;note?:unknown}){
 const {medalId,note}=validateMedalAward(input);
 const user=await prisma.user.findUnique({where:{id:userId},select:{id:true}});
 if(!user)throw new RewardValidationError('Пользователь не найден.');
 const now=new Date();
 const row=await prisma.userMedal.upsert({where:{userId_medalId:{userId,medalId}},create:{userId,medalId,note,awardedBy:'admin',awardedAt:now},update:{note,awardedBy:'admin',awardedAt:now,revokedAt:null,seenAt:null}});
 invalidateRewards(userId);
 const def=medalById.get(medalId)!;
 emit({kind:'medal',userId,id:def.id,title:def.title,icon:def.icon,color:def.color,note,awardedBy:'admin',at:now.toISOString(),backfill:false});
 return row;
}
export async function revokeMedal(userId:string,medalId:string){
 if(!medalById.has(medalId))throw new RewardValidationError('Неизвестная медаль.');
 const {count}=await prisma.userMedal.updateMany({where:{userId,medalId,revokedAt:null},data:{revokedAt:new Date()}});
 if(!count)throw new RewardValidationError('У пользователя нет этой медали.');
 invalidateRewards(userId);
}
export async function userRewardsForAdmin(userId:string){
 const [medals,achievements]=await Promise.all([prisma.userMedal.findMany({where:{userId},orderBy:{awardedAt:'desc'}}),prisma.userAchievement.findMany({where:{userId}})]);
 return {
  medals:medals.map(m=>({medalId:m.medalId,note:m.note,awardedBy:m.awardedBy,awardedAt:m.awardedAt.toISOString(),revokedAt:m.revokedAt?.toISOString()??null})),
  achievements:topAchievements(achievements,ACHIEVEMENTS.length),
 };
}
export async function medalCatalogForAdmin(){
 const counts=await prisma.userMedal.groupBy({by:['medalId'],where:{revokedAt:null},_count:{_all:true}});
 const count=new Map(counts.map(c=>[c.medalId,c._count._all]));
 return {
  medals:MEDALS.map(m=>({id:m.id,title:m.title,description:m.description,icon:m.icon,color:m.color,auto:m.auto?{hint:m.auto.hint}:null,holders:count.get(m.id)||0})),
  achievements:ACHIEVEMENTS.map(a=>({id:a.id,title:a.title,description:a.description,icon:a.icon,unit:a.unit,thresholds:a.thresholds})),
 };
}
export async function medalHolders(medalId:string){
 if(!medalById.has(medalId))throw new RewardValidationError('Неизвестная медаль.');
 const rows=await prisma.userMedal.findMany({where:{medalId,revokedAt:null},orderBy:{awardedAt:'desc'},take:200});
 const users=await prisma.user.findMany({where:{id:{in:rows.map(r=>r.userId)}},select:{id:true,name:true,username:true,avatarUrl:true}});
 const byId=new Map(users.map(u=>[u.id,u]));
 return rows.flatMap(r=>{const u=byId.get(r.userId);return u?[{...u,note:r.note,awardedBy:r.awardedBy,awardedAt:r.awardedAt.toISOString()}]:[];});
}
