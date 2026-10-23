import {Router,raw,type Request,type Response,type NextFunction} from 'express';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {prisma} from '../database/client.js';
import {env} from '../config/env.js';
import {notifyUser} from '../services/telegramBot.js';
import {spotifyService} from '../services/SpotifyService.js';
import {soundCloudService} from '../services/SoundCloudService.js';
import {unreleasedSchema,unreleasedEditSchema,saveUnreleasedFile,removeUnreleased,unreleasedTrack,ownView,unreleasedId,approvedForArtist,searchApproved,titleKey} from '../services/unreleased.js';
import {artistKey,followArtist,unfollowArtist,followStatus,listFollows,checkFollowedReleases,listNotifications,markNotificationsRead,notifyFollowers,addNotification} from '../services/artistFollow.js';
import {geniusUpcoming} from '../services/geniusUpcoming.js';

const route=(fn:(req:Request,res:Response,next:NextFunction)=>Promise<void>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await fn(req,res,next);}catch(e){next(e);}};
const bad=(res:Response,message:string,status=400)=>{res.status(status).json({error:{message}});};
const zodMessage=(e:unknown)=>e instanceof z.ZodError?e.issues.map(i=>i.message).join(' '):(e as Error).message;

/** Public (pre-auth) cover so <img> works without auth headers; approved uploads only. */
export const unreleasedCover=route(async(req,res)=>{
 const row=await prisma.unreleasedTrack.findUnique({where:{id:String(req.params.id)}});
 const file=row?.status==='approved'&&row.coverFileId?await prisma.userFile.findUnique({where:{id:row.coverFileId}}):null;
 if(!file||!existsSync(file.path)){res.sendStatus(404);return;}
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=86400');res.type(file.mime).sendFile(file.path);
});

async function resolveArtistId(name:string){
 const key=artistKey(name);
 const spotify=spotifyService.isConfigured()?await spotifyService.search(name,{limit:5}).catch(()=>null):null;
 const hit=spotify?.artists.find(a=>artistKey(a.name)===key);if(hit)return hit.id;
 const sc=await soundCloudService.search(name,{limit:5}).catch(()=>null);
 return sc?.artists.find(a=>artistKey(a.name)===key)?.id;
}

export const communityRoutes=Router();
// ---- Unreleased tracks as regular playable tracks ----
communityRoutes.get('/tracks/:id/stream',route(async(req,res,next)=>{
 const id=unreleasedId(String(req.params.id));if(!id){next();return;}
 const row=await prisma.unreleasedTrack.findUnique({where:{id}});
 if(!row||(row.status!=='approved'&&row.userId!==res.locals.userId)){res.status(404).json({error:{code:'TRACK_NOT_FOUND',message:'Анрелиз не найден.'}});return;}
 const file=await prisma.userFile.findUnique({where:{id:row.audioFileId}});
 if(!file||!existsSync(file.path)){res.status(404).json({error:{code:'TRACK_NOT_FOUND',message:'Файл анрелиза недоступен.'}});return;}
 // sendFile answers Range requests with 206, which the player needs for seeking.
 res.setHeader('X-Audio-Source','unreleased');res.setHeader('Cache-Control','private, max-age=3600');res.setHeader('X-Content-Type-Options','nosniff');res.type(file.mime).sendFile(file.path,{acceptRanges:true});
}));
communityRoutes.get('/tracks/:id/playback',route(async(req,res,next)=>{
 const id=unreleasedId(String(req.params.id));if(!id){next();return;}
 const row=await prisma.unreleasedTrack.findUnique({where:{id}});
 res.json({data:row&&(row.status==='approved'||row.userId===res.locals.userId)?{available:true,type:'progressive',url:`/api/tracks/${encodeURIComponent(String(req.params.id))}/stream`}:{available:false,type:'none'}});
}));
communityRoutes.get('/tracks/:id',route(async(req,res,next)=>{
 const id=unreleasedId(String(req.params.id));if(!id){next();return;}
 const row=await prisma.unreleasedTrack.findUnique({where:{id}});
 if(!row||(row.status!=='approved'&&row.userId!==res.locals.userId)){res.status(404).json({error:{code:'TRACK_NOT_FOUND',message:'Анрелиз не найден.'}});return;}
 res.json({data:unreleasedTrack(row)});
}));

// ---- User panel «Анрелизы» ----
communityRoutes.post('/unreleased/files',rateLimit({windowMs:60000,limit:10,keyGenerator:(_req,res)=>res.locals.userId}),raw({type:()=>true,limit:'31mb'}),route(async(req,res)=>{
 const query=z.object({kind:z.enum(['audio','cover']),fileName:z.string().min(1).max(240)}).safeParse(req.query);
 if(!query.success){bad(res,zodMessage(query.error));return;}
 if(!Buffer.isBuffer(req.body)||!req.body.length){bad(res,'Передайте файл как application/octet-stream.');return;}
 try{const file=await saveUnreleasedFile(res.locals.userId,query.data.kind,query.data.fileName,req.body);res.status(201).json({data:{id:file.id,fileName:file.fileName,size:file.size,mime:file.mime}});}
 catch(e){bad(res,(e as Error).message);}
}));
communityRoutes.post('/unreleased',rateLimit({windowMs:3600000,limit:20,keyGenerator:(_req,res)=>res.locals.userId}),route(async(req,res)=>{
 const parsed=unreleasedSchema.safeParse(req.body);if(!parsed.success){bad(res,zodMessage(parsed.error));return;}
 const body=parsed.data,userId=res.locals.userId;
 const files=await prisma.userFile.findMany({where:{userId,id:{in:[body.audioFileId,body.coverFileId].filter(Boolean) as string[]}}});
 if(!files.some(f=>f.id===body.audioFileId&&f.kind==='unreleased-audio')){bad(res,'Сначала загрузите аудиофайл.');return;}
 if(body.coverFileId&&!files.some(f=>f.id===body.coverFileId&&f.kind==='unreleased-cover')){bad(res,'Обложка не найдена.');return;}
 if(await prisma.unreleasedTrack.findFirst({where:{audioFileId:body.audioFileId}})){bad(res,'Этот файл уже отправлен.',409);return;}
 const artistId=body.artistId||await resolveArtistId(body.artistName);
 const row=await prisma.unreleasedTrack.create({data:{...body,artistId,artistKey:artistKey(body.artistName),userId}});
 if(env.TELEGRAM_ADMIN_CHAT_ID)void notifyUser(`telegram:${env.TELEGRAM_ADMIN_CHAT_ID}`,`Новый анрелиз на проверке: ${row.artistName} — ${row.title}.`).catch(()=>{});
 res.status(201).json({data:ownView(row)});
}));
communityRoutes.get('/unreleased/mine',route(async(_req,res)=>{
 const rows=await prisma.unreleasedTrack.findMany({where:{userId:res.locals.userId},orderBy:{createdAt:'desc'},take:200});
 res.setHeader('Cache-Control','private, no-store');res.json({data:rows.map(ownView)});
}));
communityRoutes.delete('/unreleased/:id',route(async(req,res)=>{
 const row=await prisma.unreleasedTrack.findFirst({where:{id:String(req.params.id),userId:res.locals.userId}});
 if(!row){res.sendStatus(404);return;}
 if(row.status==='approved'){bad(res,'Одобренный анрелиз может снять только модератор.',409);return;}
 await removeUnreleased(row.id);res.json({data:{ok:true}});
}));
communityRoutes.get('/unreleased/artist',route(async(req,res)=>{
 const q=z.object({name:z.string().min(1).max(200),ids:z.string().max(1000).optional()}).parse(req.query);
 const rows=await approvedForArtist(q.name,(q.ids||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,6));
 res.json({data:rows.map(unreleasedTrack)});
}));
communityRoutes.get('/unreleased/search',route(async(req,res)=>{
 const q=z.string().max(200).parse(req.query.q||'');res.json({data:await searchApproved(q,Number(req.query.limit)||20)});
}));

// ---- Genius: albums in development and unreleased songs ----
communityRoutes.get('/genius/upcoming',route(async(req,res)=>{
 const name=z.string().min(1).max(200).parse(req.query.name);
 const [data,uploads]=await Promise.all([geniusUpcoming(name),approvedForArtist(name)]);
 const byTitle=new Map(uploads.map(r=>[titleKey(r.title),r]));
 res.setHeader('Cache-Control','private, max-age=600');
 res.json({data:{...data,unreleased:data.unreleased.map(s=>{const match=byTitle.get(titleKey(s.title));return {...s,track:match?unreleasedTrack(match):undefined};})}});
}));

// ---- Follows & notifications ----
const followBody=z.object({name:z.string().trim().min(1).max(200),artistId:z.string().max(200).optional(),avatar:z.string().url().max(1000).optional()}).strict();
communityRoutes.get('/follows',route(async(_req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json({data:await listFollows(res.locals.userId)});}));
communityRoutes.get('/follows/status',route(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json({data:await followStatus(res.locals.userId,z.string().min(1).max(200).parse(req.query.name))});}));
communityRoutes.post('/follows',route(async(req,res)=>{const body=followBody.parse(req.body);const status=await followArtist(res.locals.userId,body);void checkFollowedReleases(res.locals.userId,true).catch(()=>{});res.json({data:status});}));
communityRoutes.delete('/follows',route(async(req,res)=>{res.json({data:await unfollowArtist(res.locals.userId,z.string().min(1).max(200).parse(req.query.name))});}));
communityRoutes.get('/notifications',route(async(_req,res)=>{
 const userId=res.locals.userId;
 // On-request check, throttled inside; never blocks the response.
 void checkFollowedReleases(userId).catch(()=>{});
 res.setHeader('Cache-Control','private, no-store');res.json({data:await listNotifications(userId)});
}));
communityRoutes.post('/notifications/read',route(async(req,res)=>{const {ids}=z.object({ids:z.array(z.string().uuid()).max(100).optional()}).parse(req.body||{});await markNotificationsRead(res.locals.userId,ids);res.json({data:{ok:true}});}));

// ---- Developer panel ----
export function registerAdminUnreleased(admin:Router){
 admin.get('/unreleased',route(async(req,res)=>{
  const status=z.enum(['pending','approved','rejected','all']).default('pending').parse(req.query.status);
  const rows=await prisma.unreleasedTrack.findMany({where:status==='all'?{}:{status},orderBy:{createdAt:'desc'},take:300});
  const [users,files]=await Promise.all([prisma.user.findMany({where:{id:{in:[...new Set(rows.map(r=>r.userId))]}},select:{id:true,name:true,username:true}}),prisma.userFile.findMany({where:{id:{in:rows.flatMap(r=>[r.audioFileId,r.coverFileId]).filter(Boolean) as string[]}},select:{id:true,fileName:true,size:true,mime:true}})]);
  res.json({data:rows.map(r=>({...r,author:users.find(u=>u.id===r.userId),audio:files.find(f=>f.id===r.audioFileId),cover:files.find(f=>f.id===r.coverFileId)}))});
 }));
 const sendFile=(field:'audioFileId'|'coverFileId')=>route(async(req,res)=>{
  const row=await prisma.unreleasedTrack.findUnique({where:{id:String(req.params.id)}}),fileId=row?.[field];
  const file=fileId?await prisma.userFile.findUnique({where:{id:fileId}}):null;
  if(!file||!existsSync(file.path)){res.sendStatus(404);return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.type(file.mime).sendFile(file.path,{acceptRanges:true});
 });
 admin.get('/unreleased/:id/audio',sendFile('audioFileId'));
 admin.get('/unreleased/:id/cover',sendFile('coverFileId'));
 admin.post('/unreleased/:id/review',route(async(req,res)=>{
  const {decision,reviewNote}=z.object({decision:z.enum(['approved','rejected','pending']),reviewNote:z.string().max(1000).default('')}).parse(req.body);
  const row=await prisma.unreleasedTrack.findUnique({where:{id:String(req.params.id)}});if(!row){res.sendStatus(404);return;}
  const updated=await prisma.unreleasedTrack.update({where:{id:row.id},data:{status:decision,reviewNote,reviewedAt:new Date()}});
  if(decision!==row.status&&decision!=='pending'){
   const label=decision==='approved'?'одобрен':'отклонён';
   await addNotification(row.userId,{kind:'unreleased-review',title:`Анрелиз ${label}: ${row.artistName} — ${row.title}`,body:reviewNote,url:decision==='approved'&&row.artistId?`/artist/${encodeURIComponent(row.artistId)}`:'/unreleased',dedupeKey:`unreleased-review:${row.id}:${decision}`});
   void notifyUser(row.userId,`Ваш анрелиз «${row.title}» ${label}.${reviewNote?`\n${reviewNote}`:''}`).catch(()=>{});
   if(decision==='approved')await notifyFollowers(row.artistName,{kind:'unreleased',title:`${row.artistName}: анрелиз «${row.title}»`,body:'Появился на странице артиста',url:row.artistId?`/artist/${encodeURIComponent(row.artistId)}`:undefined,dedupeKey:`unreleased:${row.id}`});
  }
  res.json({data:updated});
 }));
 admin.post('/unreleased/:id/update',route(async(req,res)=>{
  const parsed=unreleasedEditSchema.safeParse(req.body);if(!parsed.success){bad(res,zodMessage(parsed.error));return;}
  const data=parsed.data;
  const updated=await prisma.unreleasedTrack.update({where:{id:String(req.params.id)},data:{...data,...(data.artistName?{artistKey:artistKey(data.artistName)}:{})}}).catch(()=>null);
  if(!updated){res.sendStatus(404);return;}res.json({data:updated});
 }));
 admin.delete('/unreleased/:id',route(async(req,res)=>{if(!await removeUnreleased(String(req.params.id))){res.sendStatus(404);return;}res.json({data:{ok:true}});}));
}
