import {prisma} from '../database/client.js';
import {logger} from '../utils/logger.js';
import {catalogController} from '../controllers/catalogController.js';

/** One key per artist across platforms: lowercase letters/digits, bracketed aliases dropped. */
export const artistKey=(name:string)=>{const strip=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');return strip(name.replace(/\s*\([^)]*\)\s*/g,' '))||strip(name);};
/** Every key a Genius-style "Имя (Name)" may be stored under. */
export const artistKeys=(name:string)=>[...new Set([artistKey(name),...[...name.matchAll(/\(([^)]+)\)/g)].map(m=>artistKey(m[1]))].filter(Boolean))];

export async function followArtist(userId:string,input:{artistId?:string;name:string;avatar?:string}){
 const key=artistKey(input.name);if(!key)throw new Error('Пустое имя артиста.');
 const data={artistId:input.artistId||null,name:input.name.slice(0,200),avatar:input.avatar?.slice(0,1000)||null};
 await prisma.artistFollow.upsert({where:{userId_artistKey:{userId,artistKey:key}},create:{userId,artistKey:key,...data},update:data});
 // Seed the watch so the first check records a baseline instead of announcing the whole back catalogue.
 await prisma.artistReleaseWatch.upsert({where:{artistKey:key},create:{artistKey:key,artistId:data.artistId,name:data.name,checkedAt:new Date(0)},update:data.artistId?{artistId:data.artistId}:{}}).catch(()=>{});
 return followStatus(userId,input.name);
}
export async function unfollowArtist(userId:string,name:string){await prisma.artistFollow.deleteMany({where:{userId,artistKey:artistKey(name)}});return followStatus(userId,name);}
export async function followStatus(userId:string,name:string){
 const key=artistKey(name),[mine,followers]=await Promise.all([prisma.artistFollow.findUnique({where:{userId_artistKey:{userId,artistKey:key}}}),prisma.artistFollow.count({where:{artistKey:key}})]);
 return {following:!!mine,followers,artistKey:key};
}
export const listFollows=(userId:string)=>prisma.artistFollow.findMany({where:{userId},orderBy:{createdAt:'desc'},take:200});

/** Idempotent per user+dedupeKey; returns true when a new row was written. */
export async function addNotification(userId:string,n:{kind:string;title:string;body?:string;url?:string;artworkUrl?:string;dedupeKey:string}){
 try{await prisma.userNotification.create({data:{userId,kind:n.kind,title:n.title.slice(0,300),body:(n.body||'').slice(0,1000),url:n.url,artworkUrl:n.artworkUrl,dedupeKey:n.dedupeKey.slice(0,300)}});return true;}
 catch(e:any){if(e?.code==='P2002')return false;throw e;}
}
export async function notifyFollowers(name:string,n:Omit<Parameters<typeof addNotification>[1],'dedupeKey'>&{dedupeKey:string}){
 const followers=await prisma.artistFollow.findMany({where:{artistKey:{in:artistKeys(name)}},select:{userId:true}});
 let created=0;for(const {userId} of followers)if(await addNotification(userId,n))created++;return created;
}

type ReleaseRow={id:string;title:string;artworkUrl?:string;date?:string;type?:string};
/** Runs the existing artistDetails handler in-process so release lists stay identical to the artist page. */
async function artistReleases(artistId:string):Promise<{name:string;releases:ReleaseRow[]}|null>{
 return new Promise(resolve=>{
  let status=200;const res:any={setHeader(){return res;},status(code:number){status=code;return res;},json(body:any){resolve(status<400&&body?.data?{name:body.data.artist?.name,releases:body.data.releases||[]}:null);return res;},locals:{}};
  void catalogController.artistDetails({params:{id:artistId},query:{},headers:{}} as any,res,()=>resolve(null));
 });
}

const WATCH_TTL=6*3600000,USER_TTL=10*60000,userChecks=new Map<string,number>(),artistLocks=new Map<string,Promise<void>>();
async function checkArtist(watch:{artistKey:string;artistId:string|null;name:string;knownIds:string;checkedAt:Date}){
 if(!watch.artistId||Date.now()-watch.checkedAt.getTime()<WATCH_TTL)return;
 const result=await artistReleases(watch.artistId).catch(()=>null);
 const baseline=watch.checkedAt.getTime()===0;
 // A failed first lookup keeps the baseline pending; later failures just wait for the next window.
 if(!result){if(!baseline)await prisma.artistReleaseWatch.update({where:{artistKey:watch.artistKey},data:{checkedAt:new Date()}});return;}
 const known=new Set<string>(JSON.parse(watch.knownIds||'[]'));
 // Catalogues sometimes surface old releases late: only announce recent ones.
 const recent=Date.now()-45*86400000;
 const fresh=baseline?[]:result.releases.filter(r=>!known.has(r.id)&&(!r.date||Date.parse(r.date)>=recent));
 for(const r of fresh.slice(0,5))await notifyFollowers(watch.name,{kind:'release',title:`${result.name||watch.name}: ${r.title}`,body:`Новый ${r.type==='album'?'альбом':r.type==='ep'?'EP':r.type==='single'?'сингл':'релиз'}${r.date?` · ${r.date}`:''}`,url:`/release/${encodeURIComponent(r.id)}`,artworkUrl:r.artworkUrl,dedupeKey:`release:${r.id}`});
 const ids=[...new Set([...result.releases.map(r=>r.id),...known])].slice(0,800);
 await prisma.artistReleaseWatch.update({where:{artistKey:watch.artistKey},data:{knownIds:JSON.stringify(ids),checkedAt:new Date()}});
}
/** On-request release check for one user's follows: throttled per user (10 min) and per artist (6 h). */
export async function checkFollowedReleases(userId:string,force=false){
 if(!force&&Date.now()-(userChecks.get(userId)||0)<USER_TTL)return;userChecks.set(userId,Date.now());
 const follows=await prisma.artistFollow.findMany({where:{userId},select:{artistKey:true,artistId:true,name:true},take:50});
 for(const f of follows){
  if(artistLocks.has(f.artistKey)){await artistLocks.get(f.artistKey);continue;}
  const job=(async()=>{
   const watch=await prisma.artistReleaseWatch.findUnique({where:{artistKey:f.artistKey}})||await prisma.artistReleaseWatch.create({data:{artistKey:f.artistKey,artistId:f.artistId,name:f.name,checkedAt:new Date(0)}});
   await checkArtist(watch.artistId?watch:{...watch,artistId:f.artistId});
  })().catch(err=>logger.debug({err,artist:f.name},'Follow release check failed')).finally(()=>artistLocks.delete(f.artistKey));
  artistLocks.set(f.artistKey,job);await job;
 }
}
export async function listNotifications(userId:string){
 const [items,unread]=await Promise.all([prisma.userNotification.findMany({where:{userId},orderBy:{createdAt:'desc'},take:50}),prisma.userNotification.count({where:{userId,readAt:null}})]);
 return {items,unread};
}
export const markNotificationsRead=(userId:string,ids?:string[])=>prisma.userNotification.updateMany({where:{userId,readAt:null,...(ids?.length?{id:{in:ids}}:{})},data:{readAt:new Date()}});

/**
 * For the Telegram bot: pushes undelivered notifications (last 7 days) through `send`
 * and marks each delivered after a successful send. Safe to call repeatedly.
 */
export async function deliverPendingNotifications(send:(userId:string,text:string,n:{id:string;kind:string;title:string;body:string;url:string|null})=>Promise<void>,limit=50){
 const rows=await prisma.userNotification.findMany({where:{deliveredAt:null,createdAt:{gte:new Date(Date.now()-7*86400000)}},orderBy:{createdAt:'asc'},take:limit});
 let delivered=0;
 for(const n of rows){try{await send(n.userId,[n.title,n.body].filter(Boolean).join('\n'),n);await prisma.userNotification.update({where:{id:n.id},data:{deliveredAt:new Date()}});delivered++;}catch(err){logger.debug({err,id:n.id},'Notification delivery failed');}}
 return delivered;
}
