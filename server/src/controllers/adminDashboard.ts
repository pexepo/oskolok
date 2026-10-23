import type {Router} from 'express';
import {statSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import {spotifyService} from '../services/SpotifyService.js';
import {listRoles,createRole,updateRole,deleteRole,reorderRoles,assignRole,revokeRole,roleMembers,rolesForUsers,RoleValidationError} from '../services/roles.js';
import {registerAdminRewards} from './adminRewards.js';

/* Developer panel: analytics dashboard, users, roles, caches, health and an audit log.
   Mounted behind the admin key check in adminController. */

const route=(fn:any)=>async(req:any,res:any,next:any)=>{
 try{await fn(req,res);}
 catch(e:any){
  if(e instanceof RoleValidationError||e?.name==='ZodError'){res.status(400).json({error:{message:e instanceof RoleValidationError?e.message:e.issues?.[0]?.message||'Неверные данные.'}});return;}
  if(e?.code==='P2025'){res.status(404).json({error:{message:'Не найдено.'}});return;}
  next(e);
 }
};
/** Real accounts only: local/dev placeholders are not people. */
const REAL_USER={id:{startsWith:'telegram:'}};
const DAY=864e5;
const PERIODS={'24h':DAY,'7d':7*DAY,'30d':30*DAY,'90d':90*DAY} as const;
type Period=keyof typeof PERIODS;

async function audit(action:string,target:string,details:unknown=null){
 await prisma.adminAuditLog.create({data:{action,target,details:details==null?'':JSON.stringify(details).slice(0,2000)}}).catch(()=>{});
}
const parseTrack=(raw:string)=>{try{const t=JSON.parse(raw);return {title:String(t?.title||''),artist:String(t?.artist?.name||''),artworkUrl:t?.artworkUrl as string|undefined,duration:Number(t?.duration)||0,source:String(t?.source||'')};}catch{return null;}};
const sourceOf=(trackId:string)=>{const p=trackId.split(':')[0];return ['spotify','deezer','soundcloud','youtube','licensed','personal','yandex','tidal'].includes(p)?(p==='licensed'?'youtube':p):'other';};
const pct=(now:number,prev:number)=>prev?Math.round((now-prev)/prev*1000)/10:now?100:0;

const cache=new Map<string,{at:number;value:unknown}>();
async function cached<T>(key:string,ttl:number,fn:()=>Promise<T>):Promise<T>{const hit=cache.get(key);if(hit&&Date.now()-hit.at<ttl)return hit.value as T;const value=await fn();cache.set(key,{at:Date.now(),value});return value;}

async function dashboard(period:Period){
 const span=PERIODS[period],now=Date.now(),from=new Date(now-span),prevFrom=new Date(now-2*span);
 const hourly=period==='24h',bucketMs=hourly?36e5:DAY,buckets=Math.round(span/bucketMs);
 const bucketStart=(t:number)=>hourly?Math.floor(t/36e5)*36e5:Date.UTC(new Date(t).getUTCFullYear(),new Date(t).getUTCMonth(),new Date(t).getUTCDate());
 const first=bucketStart(now-span+bucketMs);
 const [history,prevHistory,users,prevNewUsers,totalUsers,likes,prevLikes,lyrics,prevLyrics,openReports,activeProfiles]=await Promise.all([
  prisma.historyItem.findMany({where:{playedAt:{gte:from},user:REAL_USER},select:{userId:true,trackId:true,playedAt:true,trackData:true}}),
  prisma.historyItem.findMany({where:{playedAt:{gte:prevFrom,lt:from},user:REAL_USER},select:{userId:true,trackData:true}}),
  prisma.user.findMany({where:{...REAL_USER,OR:[{createdAt:{gte:from}},{lastActiveAt:{gte:prevFrom}}]},select:{id:true,createdAt:true,lastActiveAt:true}}),
  prisma.user.count({where:{...REAL_USER,createdAt:{gte:prevFrom,lt:from}}}),
  prisma.user.count({where:REAL_USER}),
  prisma.likedTrack.count({where:{addedAt:{gte:from},user:REAL_USER}}),
  prisma.likedTrack.count({where:{addedAt:{gte:prevFrom,lt:from},user:REAL_USER}}),
  prisma.lyricContribution.count({where:{createdAt:{gte:from}}}),
  prisma.lyricContribution.count({where:{createdAt:{gte:prevFrom,lt:from}}}),
  prisma.userReport.count({where:{status:'pending'}}),
  prisma.creatorProfile.findMany({where:{playbackSeenAt:{gte:new Date(now-9e4)}},select:{userId:true,currentTrackData:true,displayName:true,avatarUrl:true}}),
 ]);
 // Active = listened or made an authenticated request in the window (lastActiveAt is refreshed every 5 min).
 const active=new Set(history.map(h=>h.userId));
 for(const u of users)if(u.lastActiveAt&&u.lastActiveAt>=from)active.add(u.id);
 const prevActive=new Set(prevHistory.map(h=>h.userId));
 for(const u of users)if(u.lastActiveAt&&u.lastActiveAt>=prevFrom&&u.lastActiveAt<from)prevActive.add(u.id);
 const parsed=history.map(h=>({...h,track:parseTrack(h.trackData)}));
 const hours=(rows:Array<{track:{duration:number}|null}>)=>Math.round(rows.reduce((s,r)=>s+(r.track?.duration||0),0)/360)/10;
 const listeningHours=hours(parsed),prevHours=hours(prevHistory.map(h=>({track:parseTrack(h.trackData)})));
 const newUsers=users.filter(u=>u.createdAt>=from).length;

 const series=Array.from({length:buckets},(_,i)=>({t:first+i*bucketMs,active:new Set<string>(),plays:0,newUsers:0}));
 const at=(time:number)=>series[Math.floor((bucketStart(time)-first)/bucketMs)];
 for(const h of history){const b=at(h.playedAt.getTime());if(b){b.plays++;b.active.add(h.userId);}}
 for(const u of users){const b=u.createdAt>=from?at(u.createdAt.getTime()):undefined;if(b)b.newUsers++;}

 const topTrack=new Map<string,{plays:number;listeners:Set<string>;track:NonNullable<ReturnType<typeof parseTrack>>}>(),topArtist=new Map<string,{plays:number;listeners:Set<string>}>(),sources=new Map<string,number>();
 for(const h of parsed){
  if(!h.track)continue;
  const t=topTrack.get(h.trackId)||{plays:0,listeners:new Set<string>(),track:h.track};t.plays++;t.listeners.add(h.userId);topTrack.set(h.trackId,t);
  const name=h.track.artist.split(/,|&| feat\.? /i)[0].trim();
  if(name){const a=topArtist.get(name)||{plays:0,listeners:new Set<string>()};a.plays++;a.listeners.add(h.userId);topArtist.set(name,a);}
  const src=sourceOf(h.trackId);sources.set(src,(sources.get(src)||0)+1);
 }
 const authors=await prisma.lyricContribution.groupBy({by:['userId'],_count:{_all:true},orderBy:{_count:{userId:'desc'}},take:8});
 const authorUsers=await prisma.user.findMany({where:{id:{in:authors.map(a=>a.userId)}},select:{id:true,name:true,username:true,avatarUrl:true}});
 const nowUsers=await prisma.user.findMany({where:{id:{in:activeProfiles.map(p=>p.userId)}},select:{id:true,name:true,username:true}});

 // Weekly retention: of the users who joined in week N, the share who listened in each later week.
 const WEEK=7*DAY,weeks=8,cohortStart=now-weeks*WEEK;
 const [cohortUsers,cohortHistory]=await Promise.all([
  prisma.user.findMany({where:{...REAL_USER,createdAt:{gte:new Date(cohortStart)}},select:{id:true,createdAt:true}}),
  prisma.historyItem.findMany({where:{playedAt:{gte:new Date(cohortStart)},user:REAL_USER},select:{userId:true,playedAt:true}}),
 ]);
 const weekOf=(t:number)=>Math.floor((t-cohortStart)/WEEK);
 const activeWeeks=new Map<string,Set<number>>();
 for(const h of cohortHistory){const set=activeWeeks.get(h.userId)||new Set<number>();set.add(weekOf(h.playedAt.getTime()));activeWeeks.set(h.userId,set);}
 const retention=Array.from({length:weeks},(_,w)=>{
  const members=cohortUsers.filter(u=>weekOf(u.createdAt.getTime())===w);
  return {week:new Date(cohortStart+w*WEEK).toISOString(),size:members.length,cells:Array.from({length:weeks-w},(_,k)=>members.length?Math.round(members.filter(u=>activeWeeks.get(u.id)?.has(w+k)).length/members.length*100):null)};
 });

 return {
  period,generatedAt:new Date(now).toISOString(),
  kpis:{
   activeUsers:{value:active.size,delta:pct(active.size,prevActive.size)},
   newUsers:{value:newUsers,delta:pct(newUsers,prevNewUsers)},
   plays:{value:history.length,delta:pct(history.length,prevHistory.length)},
   listeningHours:{value:listeningHours,delta:pct(listeningHours,prevHours)},
   likes:{value:likes,delta:pct(likes,prevLikes)},
   lyrics:{value:lyrics,delta:pct(lyrics,prevLyrics)},
   totalUsers:{value:totalUsers,delta:null},
   openReports:{value:openReports,delta:null},
  },
  series:series.map(b=>({t:new Date(b.t).toISOString(),active:b.active.size,plays:b.plays,newUsers:b.newUsers})),
  topTracks:[...topTrack.entries()].sort((a,b)=>b[1].plays-a[1].plays).slice(0,10).map(([id,v])=>({id,title:v.track.title,artist:v.track.artist,artworkUrl:v.track.artworkUrl,plays:v.plays,listeners:v.listeners.size})),
  topArtists:[...topArtist.entries()].sort((a,b)=>b[1].plays-a[1].plays).slice(0,10).map(([name,v])=>({name,plays:v.plays,listeners:v.listeners.size})),
  topAuthors:authors.map(a=>{const u=authorUsers.find(x=>x.id===a.userId);return {id:a.userId,name:u?.name||a.userId,username:u?.username||null,avatarUrl:u?.avatarUrl||'',lyrics:a._count._all};}),
  sources:[...sources.entries()].sort((a,b)=>b[1]-a[1]).map(([source,plays])=>({source,plays})),
  retention,
  nowListening:activeProfiles.flatMap(p=>{const t=p.currentTrackData?parseTrack(p.currentTrackData):null;const u=nowUsers.find(x=>x.id===p.userId);return t?[{userId:p.userId,name:p.displayName||u?.name||'',username:u?.username||null,avatarUrl:p.avatarUrl||'',title:t.title,artist:t.artist,artworkUrl:t.artworkUrl}]:[];}),
 };
}

function health(){
 const url=String(process.env.DATABASE_URL||'');
 let dbBytes:number|null=null;
 if(url.startsWith('file:')){for(const base of [path.resolve(process.cwd(),'prisma'),process.cwd()]){try{dbBytes=statSync(path.resolve(base,url.slice(5))).size;break;}catch{/* try next */}}}
 const mem=process.memoryUsage();
 return {uptimeSec:Math.round(process.uptime()),node:process.version,platform:process.platform,database:url.startsWith('postgres')?'postgres':'sqlite',dbBytes,rssMb:Math.round(mem.rss/1048576),heapMb:Math.round(mem.heapUsed/1048576)};
}

const CACHE_PREFIXES:Record<string,string[]>={genius:['genius2:','geniusalbum:','geniusrefs:','geniusrefs2:'],popularity:['popularity:'],translations:['tr:'],soundcloud:['soundcloud:']};

export function registerAdminDashboard(router:Router){
 router.get('/dashboard',route(async(req:any,res:any)=>{
  const period=z.enum(['24h','7d','30d','90d']).default('7d').parse(req.query.period);
  res.json({data:await cached(`dash:${period}`,60_000,()=>dashboard(period))});
 }));
 router.get('/health',route(async(_req:any,res:any)=>{
  const caches=await Promise.all(Object.entries(CACHE_PREFIXES).map(async([kind,prefixes])=>({kind,rows:await prisma.artistEnrichment.count({where:{OR:prefixes.map(p=>({id:{startsWith:p}}))}})})));
  res.json({data:{...health(),caches,spotify:spotifyService.status()}});
 }));
 router.post('/cache/clear',route(async(req:any,res:any)=>{
  const {kind}=z.object({kind:z.enum(['genius','popularity','translations','soundcloud','dashboard'])}).parse(req.body);
  let removed=0;
  if(kind==='dashboard'){removed=cache.size;cache.clear();}
  else removed=(await prisma.artistEnrichment.deleteMany({where:{OR:CACHE_PREFIXES[kind].map(p=>({id:{startsWith:p}}))}})).count;
  await audit('cache.clear',kind,{removed});
  res.json({data:{removed}});
 }));

 /* ---------- users ---------- */
 router.get('/users',route(async(req:any,res:any)=>{
  const q=z.string().max(80).default('').parse(req.query.q).trim();
  const where=q?{...REAL_USER,OR:[{name:{contains:q}},{username:{contains:q.replace(/^@/,'')}},{id:{contains:q}}]}:REAL_USER;
  const users=await prisma.user.findMany({where,orderBy:[{lastActiveAt:{sort:'desc',nulls:'last'}},{createdAt:'desc'}],take:60,select:{id:true,name:true,username:true,avatarUrl:true,createdAt:true,lastActiveAt:true}});
  const [roles,plays,beta]=await Promise.all([
   rolesForUsers(users.map(u=>u.id)),
   prisma.historyItem.groupBy({by:['userId'],where:{userId:{in:users.map(u=>u.id)}},_count:{_all:true}}),
   prisma.betaAccess.findMany({where:{telegramUserId:{in:users.map(u=>u.id)}},select:{telegramUserId:true,enabled:true}}),
  ]);
  res.json({data:users.map(u=>({...u,roles:roles.get(u.id)||[],plays:plays.find(p=>p.userId===u.id)?._count._all||0,beta:beta.find(b=>b.telegramUserId===u.id)?.enabled??null}))});
 }));
 router.get('/users/:id',route(async(req:any,res:any)=>{
  const id=String(req.params.id);
  const user=await prisma.user.findUnique({where:{id},select:{id:true,name:true,username:true,avatarUrl:true,createdAt:true,lastActiveAt:true}});
  if(!user){res.status(404).json({error:{message:'Пользователь не найден.'}});return;}
  const [recent,plays,likes,lyrics,sessions,reports,roles]=await Promise.all([
   prisma.historyItem.findMany({where:{userId:id},orderBy:{playedAt:'desc'},take:15,select:{trackId:true,trackData:true,playedAt:true}}),
   prisma.historyItem.count({where:{userId:id}}),prisma.likedTrack.count({where:{userId:id}}),prisma.lyricContribution.count({where:{userId:id}}),
   prisma.webSession.count({where:{userId:id,expiresAt:{gt:new Date()}}}),prisma.userReport.count({where:{userId:id}}),rolesForUsers([id]),
  ]);
  res.json({data:{...user,roles:roles.get(id)||[],counts:{plays,likes,lyrics,sessions,reports},recent:recent.map(r=>({...parseTrack(r.trackData),trackId:r.trackId,playedAt:r.playedAt.toISOString()}))}});
 }));
 router.post('/users/:id/sessions/revoke',route(async(req:any,res:any)=>{
  const id=String(req.params.id),{count}=await prisma.webSession.deleteMany({where:{userId:id}});
  await audit('user.sessions.revoke',id,{count});
  res.json({data:{revoked:count}});
 }));

 /* ---------- roles ---------- */
 router.get('/roles',route(async(_req:any,res:any)=>{res.json({data:await listRoles()});}));
 router.post('/roles',route(async(req:any,res:any)=>{const role=await createRole(req.body);await audit('role.create',role.id,{name:role.name});res.json({data:role});}));
 router.post('/roles/reorder',route(async(req:any,res:any)=>{const {order}=z.object({order:z.array(z.string()).max(200)}).parse(req.body);await audit('role.reorder','',{order});res.json({data:await reorderRoles(order)});}));
 router.patch('/roles/:id',route(async(req:any,res:any)=>{const role=await updateRole(String(req.params.id),req.body);await audit('role.update',role.id,req.body);res.json({data:role});}));
 router.delete('/roles/:id',route(async(req:any,res:any)=>{await deleteRole(String(req.params.id));await audit('role.delete',String(req.params.id));res.json({data:{ok:true}});}));
 router.get('/roles/:id/members',route(async(req:any,res:any)=>{res.json({data:await roleMembers(String(req.params.id))});}));
 router.post('/roles/:id/members',route(async(req:any,res:any)=>{const {userId}=z.object({userId:z.string().min(1).max(120)}).parse(req.body);await assignRole(String(req.params.id),userId);await audit('role.assign',String(req.params.id),{userId});res.json({data:await roleMembers(String(req.params.id))});}));
 router.delete('/roles/:id/members/:userId',route(async(req:any,res:any)=>{await revokeRole(String(req.params.id),String(req.params.userId));await audit('role.revoke',String(req.params.id),{userId:req.params.userId});res.json({data:await roleMembers(String(req.params.id))});}));

 /* ---------- rewards: medals ---------- */
 registerAdminRewards(router);

 /* ---------- audit ---------- */
 router.get('/audit',route(async(_req:any,res:any)=>{res.json({data:await prisma.adminAuditLog.findMany({orderBy:{createdAt:'desc'},take:100})});}));
}
