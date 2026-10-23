import {Router,type Request,type Response,type NextFunction} from 'express';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import {addNotification} from '../services/artistFollow.js';
import {contactTelegramIds} from '../services/telegramSession.js';
import {parseVisibility} from '../services/profileCustomization.js';

const route=(fn:(req:Request,res:Response)=>Promise<void>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await fn(req,res);}catch(e){next(e);}};
const LISTENING_WINDOW=90_000;
export type Relation='none'|'friends'|'outgoing'|'incoming'|'self';
/** /users/123 for Telegram accounts, the raw id otherwise (the public profile route accepts both). */
const publicId=(userId:string)=>userId.replace(/^telegram:/,'');
const targetId=(raw:string)=>/^\d{5,30}$/.test(raw)?`telegram:${raw}`:raw;

/** Profile cards for a set of users: name, @username, avatar and — if they let others see it — what plays now. */
export async function friendCards(userIds:string[]){
 if(!userIds.length)return [];
 const [users,profiles]=await Promise.all([
  prisma.user.findMany({where:{id:{in:userIds}},select:{id:true,name:true,username:true,avatarUrl:true}}),
  prisma.creatorProfile.findMany({where:{userId:{in:userIds}},select:{userId:true,displayName:true,avatarUrl:true,currentTrackData:true,playbackSeenAt:true,profileVisibility:true}}),
 ]);
 const byUser=new Map(profiles.map(p=>[p.userId,p]));
 return users.map(u=>{
  const p=byUser.get(u.id);
  let listening:{id:string;title:string;artist?:string;artworkUrl?:string}|null=null;
  if(p?.playbackSeenAt&&p.currentTrackData&&Date.now()-p.playbackSeenAt.getTime()<LISTENING_WINDOW&&parseVisibility(p.profileVisibility).nowPlaying){
   try{const t=JSON.parse(p.currentTrackData);listening={id:String(t.id),title:String(t.title),artist:t.artist?.name,artworkUrl:t.artworkUrl};}catch{/* stale row */}
  }
  return {userId:u.id,publicId:publicId(u.id),displayName:p?.displayName||u.name||'Слушатель',username:u.username||null,avatarUrl:p?.avatarUrl||u.avatarUrl||'',listening};
 });
}

/** How `me` relates to every user in `ids`. */
export async function relations(me:string,ids:string[]):Promise<Map<string,Relation>>{
 const rows=ids.length?await prisma.friendship.findMany({where:{OR:[{requesterId:me,addresseeId:{in:ids}},{addresseeId:me,requesterId:{in:ids}}]}}):[];
 const out=new Map<string,Relation>(ids.map(id=>[id,id===me?'self':'none']));
 for(const r of rows){const other=r.requesterId===me?r.addresseeId:r.requesterId;out.set(other,r.status==='accepted'?'friends':r.requesterId===me?'outgoing':'incoming');}
 return out;
}
/** The friend behind a public id (or user id) if the friendship is accepted, with their card; null otherwise. */
export async function acceptedFriend(me:string,raw:string){
 const other=targetId(String(raw||'').trim());
 if(!other||other===me)return null;
 if((await relations(me,[other])).get(other)!=='friends')return null;
 const [card]=await friendCards([other]);
 return card||null;
}
const withRelation=async(me:string,cards:Awaited<ReturnType<typeof friendCards>>)=>{const rel=await relations(me,cards.map(c=>c.userId));return cards.map(c=>({...c,relation:rel.get(c.userId)||'none'}));};

const perUser=(req:Request)=>String(req.res?.locals.userId||req.ip);
const searchLimiter=rateLimit({windowMs:60_000,limit:40,standardHeaders:true,legacyHeaders:false,keyGenerator:perUser});
const contactsLimiter=rateLimit({windowMs:10*60_000,limit:6,standardHeaders:true,legacyHeaders:false,keyGenerator:perUser});
const requestLimiter=rateLimit({windowMs:60*60_000,limit:60,standardHeaders:true,legacyHeaders:false,keyGenerator:perUser});

export const friendsRoutes=Router();

/** Friends, incoming and outgoing requests. */
friendsRoutes.get('/friends',route(async(_req,res)=>{
 const me=String(res.locals.userId);
 const rows=await prisma.friendship.findMany({where:{OR:[{requesterId:me},{addresseeId:me}]},orderBy:{updatedAt:'desc'}});
 const other=(r:typeof rows[number])=>r.requesterId===me?r.addresseeId:r.requesterId;
 const cards=new Map((await friendCards([...new Set(rows.map(other))])).map(c=>[c.userId,c]));
 const pick=(filter:(r:typeof rows[number])=>boolean,relation:Relation)=>rows.filter(filter).flatMap(r=>{const c=cards.get(other(r));return c?[{...c,relation}]:[];});
 res.json({data:{
  friends:pick(r=>r.status==='accepted','friends'),
  incoming:pick(r=>r.status==='pending'&&r.addresseeId===me,'incoming'),
  outgoing:pick(r=>r.status==='pending'&&r.requesterId===me,'outgoing'),
 }});
}));

/** Find Oskolok listeners by @username or nickname. */
friendsRoutes.get('/people/search',searchLimiter,route(async(req,res)=>{
 const me=String(res.locals.userId);
 const parsed=z.string().trim().min(2).max(64).safeParse(req.query.q);
 if(!parsed.success){res.json({data:[]});return;}
 const q=parsed.data.replace(/^@/,'');
 if(q.length<2){res.json({data:[]});return;}
 const variants=[...new Set([q,q.toLocaleLowerCase(),q[0].toLocaleUpperCase()+q.slice(1).toLocaleLowerCase()])];
 const [byUser,byProfile]=await Promise.all([
  prisma.user.findMany({where:{OR:variants.flatMap(v=>[{username:{contains:v}},{name:{contains:v}}]),NOT:{id:me}},select:{id:true},take:60}),
  prisma.creatorProfile.findMany({where:{OR:variants.map(v=>({displayName:{contains:v}})),NOT:{userId:me}},select:{userId:true},take:60}),
 ]);
 // SQLite compares Cyrillic case-sensitively; the case variants above widen the net, ranking happens here.
 const fold=(s:string)=>s.toLocaleLowerCase(),f=fold(q);
 const ids=[...new Set([...byUser.map(u=>u.id),...byProfile.map(p=>p.userId)])];
 const scored=(await friendCards(ids)).map(c=>({c,score:c.username&&fold(c.username)===f?4:c.username&&fold(c.username).startsWith(f)?3:fold(c.displayName).startsWith(f)?2:fold(c.displayName).includes(f)||(c.username&&fold(c.username).includes(f))?1:0})).filter(x=>x.score>0);
 res.json({data:await withRelation(me,scored.sort((a,b)=>b.score-a.score).slice(0,20).map(x=>x.c))});
}));

/** Telegram contacts who already use Oskolok (read live through the user's own Telegram session, never stored). */
friendsRoutes.get('/people/contacts',contactsLimiter,route(async(_req,res)=>{
 const me=String(res.locals.userId);
 const connected=await prisma.telegramConnection.findUnique({where:{userId:me},select:{userId:true}});
 if(!connected){res.json({data:{connected:false,people:[]}});return;}
 const ids=(await contactTelegramIds(me)).map(id=>`telegram:${id}`);
 const known=ids.length?(await prisma.user.findMany({where:{id:{in:ids}},select:{id:true}})).map(u=>u.id):[];
 res.json({data:{connected:true,people:await withRelation(me,await friendCards(known))}});
}));

friendsRoutes.get('/friends/status/:id',route(async(req,res)=>{
 const me=String(res.locals.userId),other=targetId(String(req.params.id));
 res.json({data:{relation:(await relations(me,[other])).get(other)||'none'}});
}));

/** Send a request, or accept theirs if they asked first. */
friendsRoutes.post('/friends/:id',requestLimiter,route(async(req,res)=>{
 const me=String(res.locals.userId),other=targetId(String(req.params.id));
 if(other===me){res.status(400).json({error:{message:'Это вы.'}});return;}
 if(!await prisma.user.findUnique({where:{id:other},select:{id:true}})){res.status(404).json({error:{message:'Пользователь не найден.'}});return;}
 const [card]=await friendCards([me]);
 const name=card?.displayName||'Слушатель';
 const theirs=await prisma.friendship.findUnique({where:{requesterId_addresseeId:{requesterId:other,addresseeId:me}}});
 if(theirs){
  if(theirs.status!=='accepted'){
   await prisma.friendship.update({where:{id:theirs.id},data:{status:'accepted'}});
   await prisma.userNotification.deleteMany({where:{userId:me,dedupeKey:`friend-request:${other}`}}).catch(()=>{});
   await addNotification(other,{kind:'friend',title:`${name} теперь ваш друг`,url:`/users/${publicId(me)}`,artworkUrl:card?.avatarUrl||undefined,dedupeKey:`friend-accepted:${me}`}).catch(()=>false);
  }
  res.json({data:{relation:'friends'}});return;
 }
 const existing=await prisma.friendship.findUnique({where:{requesterId_addresseeId:{requesterId:me,addresseeId:other}}});
 if(!existing){
  await prisma.friendship.create({data:{requesterId:me,addresseeId:other}});
  await addNotification(other,{kind:'friend',title:`${name} хочет добавить вас в друзья`,body:card?.username?`@${card.username}`:'',url:'/friends',artworkUrl:card?.avatarUrl||undefined,dedupeKey:`friend-request:${me}`}).catch(()=>false);
 }
 res.json({data:{relation:existing?.status==='accepted'?'friends':'outgoing'}});
}));

/** Remove a friend, cancel my request or decline theirs. */
friendsRoutes.delete('/friends/:id',route(async(req,res)=>{
 const me=String(res.locals.userId),other=targetId(String(req.params.id));
 await prisma.friendship.deleteMany({where:{OR:[{requesterId:me,addresseeId:other},{requesterId:other,addresseeId:me}]}});
 // A cancelled request disappears from their bell; a later request notifies again.
 await prisma.userNotification.deleteMany({where:{OR:[{userId:other,dedupeKey:`friend-request:${me}`},{userId:me,dedupeKey:`friend-request:${other}`}]}}).catch(()=>{});
 res.json({data:{relation:'none'}});
}));
