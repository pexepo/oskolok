import {Router} from 'express';
import {z} from 'zod';
import {attachDevice,listDevices,publishState,relayTakeover,sendCommand,addToJam,controlJam,createJam,inviteToJam,isJamMember,jamFor,jamOwner,jamsHostedBy,joinJam,leaveJam,removeFromJam,type JamPerson,type JamTrack} from '../services/connectHub.js';
import {prisma} from '../database/client.js';
import {addNotification} from '../services/artistFollow.js';
import {acceptedFriend,friendCards,relations} from './friendsController.js';

const route=(fn:(req:any,res:any)=>Promise<void>|void)=>(req:any,res:any,next:any)=>{Promise.resolve(fn(req,res)).catch(next);};
const deviceId=z.string().regex(/^[A-Za-z0-9:_-]{6,80}$/);
const kind=z.enum(['desktop','phone','tablet','telegram','web']);
const track=z.object({id:z.string().min(1).max(200),title:z.string().max(300),artist:z.string().max(300),artworkUrl:z.string().max(1000).optional(),duration:z.number().min(0).max(86400)});
const state=z.object({track:track.nullable(),isPlaying:z.boolean(),position:z.number().min(0).max(86400),duration:z.number().min(0).max(86400),volume:z.number().min(0).max(1)});
const queueTrack=z.object({id:z.string().min(1).max(200),title:z.string().max(500)}).passthrough();

/** Осколок Connect: присутствие устройств слушателя, управление и передача воспроизведения. */
export const connectRoutes=Router();

// Server-sent events over a plain GET: the client reads it with fetch, so Telegram's Authorization header works too.
connectRoutes.get('/stream',route((req,res)=>{
  const userId=String(res.locals.userId);
  const q=z.object({id:deviceId,name:z.string().min(1).max(60),kind}).safeParse(req.query);
  if(!q.success){res.status(400).json({error:{code:'BAD_DEVICE',message:'Неизвестное устройство.'}});return;}
  res.status(200);
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-store, no-transform');
  res.setHeader('X-Accel-Buffering','no');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  res.write('retry: 4000\n\n');
  const detach=attachDevice(userId,q.data,{send:(event,data)=>{res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}});
  const ping=setInterval(()=>{res.write(': ping\n\n');},20000);
  req.on('close',()=>{clearInterval(ping);detach();});
}));

connectRoutes.get('/devices',route((_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({data:listDevices(String(res.locals.userId))});}));

connectRoutes.post('/state',route((req,res)=>{
  const body=z.object({id:deviceId,state}).parse(req.body);
  res.json({data:{ok:publishState(String(res.locals.userId),body.id,body.state)}});
}));

connectRoutes.post('/command',route((req,res)=>{
  const body=z.object({from:deviceId,target:deviceId,action:z.enum(['play','pause','toggle','next','previous','seek','volume','handoff']),value:z.number().min(0).max(86400).optional()}).parse(req.body);
  const ok=sendCommand(String(res.locals.userId),body.from,body.target,body.action,body.value);
  if(!ok){res.status(404).json({error:{code:'DEVICE_OFFLINE',message:'Устройство больше не в сети.'}});return;}
  res.json({data:{ok}});
}));

connectRoutes.post('/takeover',route((req,res)=>{
  const body=z.object({from:deviceId,to:deviceId,queue:z.array(queueTrack).min(1).max(200),index:z.number().int().min(0).max(199),position:z.number().min(0).max(86400),isPlaying:z.boolean()}).parse(req.body);
  const ok=relayTakeover(String(res.locals.userId),body.from,body.to,{queue:body.queue,index:Math.min(body.index,body.queue.length-1),position:body.position,isPlaying:body.isPlaying});
  if(!ok){res.status(404).json({error:{code:'DEVICE_OFFLINE',message:'Устройство больше не в сети.'}});return;}
  res.json({data:{ok}});
}));

/* ---------- Jam: friends share one queue, each plays it on their own device ---------- */
const jamId=z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);
// A track is stored as the client sent it (it plays from it), within a sane size.
const jamTrack=queueTrack.refine(t=>JSON.stringify(t).length<=12000,{message:'Слишком большой трек.'});
const jamError=(res:any,status:number,code:string,message:string)=>{res.status(status).json({error:{code,message}});};
async function person(userId:string):Promise<JamPerson>{
  const [card]=await friendCards([userId]);
  return {userId,publicId:card?.publicId||userId.replace(/^telegram:/,''),name:card?.displayName||'Слушатель',avatarUrl:card?.avatarUrl||''};
}
async function friendIds(me:string){
  const rows=await prisma.friendship.findMany({where:{status:'accepted',OR:[{requesterId:me},{addresseeId:me}]},select:{requesterId:true,addresseeId:true}});
  return rows.map(r=>r.requesterId===me?r.addresseeId:r.requesterId);
}

/** My jam (if any) and the open jams of my friends. */
connectRoutes.get('/jam',route(async(_req,res)=>{
  const me=String(res.locals.userId);
  res.setHeader('Cache-Control','no-store');
  const mine=jamFor(me);
  res.json({data:{jam:mine,friends:jamsHostedBy(await friendIds(me)).filter(j=>j.id!==mine?.id)}});
}));

connectRoutes.post('/jam',route(async(req,res)=>{
  const me=String(res.locals.userId);
  const body=z.object({deviceId,queue:z.array(jamTrack).max(200).default([]),index:z.number().int().min(0).max(199).default(0),position:z.number().min(0).max(86400).default(0),isPlaying:z.boolean().default(false)}).parse(req.body);
  res.json({data:createJam(await person(me),body.deviceId,{queue:body.queue as JamTrack[],index:body.index,position:body.position,isPlaying:body.isPlaying})});
}));

/** Only the owner's friends get in (the owner, of course, too). */
connectRoutes.post('/jam/:id/join',route(async(req,res)=>{
  const me=String(res.locals.userId),id=jamId.safeParse(req.params.id),body=z.object({deviceId}).parse(req.body);
  const owner=id.success?jamOwner(id.data):null;
  if(!id.success||!owner){jamError(res,404,'JAM_NOT_FOUND','Jam уже закончился.');return;}
  if(owner!==me&&(await relations(owner,[me])).get(me)!=='friends'){jamError(res,403,'JAM_FRIENDS_ONLY','Подключиться могут только друзья владельца Jam.');return;}
  const view=joinJam(id.data,await person(me),body.deviceId);
  if(view==='not-found'){jamError(res,404,'JAM_NOT_FOUND','Jam уже закончился.');return;}
  if(view==='full'){jamError(res,409,'JAM_FULL','В этом Jam уже нет мест.');return;}
  res.json({data:view});
}));

const member=(req:any,res:any)=>{
  const me=String(res.locals.userId),id=jamId.safeParse(req.params.id);
  if(!id.success||!isJamMember(id.data,me)){jamError(res,403,'JAM_NOT_MEMBER','Вы не в этом Jam.');return null;}
  return me;
};

connectRoutes.post('/jam/:id/leave',route((req,res)=>{
  const me=member(req,res);if(!me)return;
  leaveJam(me);res.json({data:{ok:true}});
}));

connectRoutes.post('/jam/:id/add',route((req,res)=>{
  const me=member(req,res);if(!me)return;
  const body=z.object({track:jamTrack,mode:z.enum(['end','next','now']).default('end')}).parse(req.body);
  res.json({data:addToJam(me,body.track as JamTrack,body.mode)});
}));

connectRoutes.post('/jam/:id/remove',route((req,res)=>{
  const me=member(req,res);if(!me)return;
  const view=removeFromJam(me,z.object({key:z.string().min(1).max(40)}).parse(req.body).key);
  if(view==='forbidden'){jamError(res,403,'JAM_NOT_YOURS','Убрать можно только свои треки.');return;}
  res.json({data:view});
}));

connectRoutes.post('/jam/:id/control',route((req,res)=>{
  const me=member(req,res);if(!me)return;
  const body=z.object({action:z.enum(['play','pause','seek','jump','ended']),position:z.number().min(0).max(86400).optional(),index:z.number().int().min(0).max(1000).optional(),fromIndex:z.number().int().min(0).max(1000).optional()}).parse(req.body);
  res.json({data:controlJam(me,body)});
}));

/** Invite a friend: a live prompt on their open devices and a notification in the bell. */
connectRoutes.post('/jam/:id/invite',route(async(req,res)=>{
  const me=member(req,res);if(!me)return;
  const friend=await acceptedFriend(me,z.object({user:z.string().min(1).max(64)}).parse(req.body).user);
  if(!friend){jamError(res,403,'JAM_FRIENDS_ONLY','Позвать можно только друзей.');return;}
  const id=String(req.params.id),host=jamOwner(id);
  // A guest can only bring in friends of the owner: everyone else would be turned away at the door.
  if(host&&host!==friend.userId&&(await relations(host,[friend.userId])).get(friend.userId)!=='friends'){jamError(res,403,'JAM_FRIENDS_ONLY','Подключиться могут только друзья владельца Jam.');return;}
  const from=await person(me);
  inviteToJam(me,friend.userId);
  await addNotification(friend.userId,{kind:'friend',title:`${from.name} зовёт вас в Jam`,body:'Общая очередь: слушайте вместе, каждый на своём устройстве',url:`/jam/${id}`,artworkUrl:from.avatarUrl||undefined,dedupeKey:`jam-invite:${id}:${me}`}).catch(()=>false);
  res.json({data:{ok:true}});
}));
