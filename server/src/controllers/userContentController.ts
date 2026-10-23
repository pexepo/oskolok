import {Router,raw} from 'express';
import {geniusSongInfo} from '../services/GeniusSongService.js';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {prisma} from '../database/client.js';
import {personalSchema,reportSchema,saveUserFile,publicFile,sanitizeReportText} from '../services/userContent.js';
import {notifyUser} from '../services/telegramBot.js';
import {sendReportToSheet} from '../services/reportSheet.js';
import {trackController} from './trackController.js';
import {env} from '../config/env.js';
import {startReleaseExport,exportView} from '../services/releaseExport.js';
export const userContentRoutes=Router();
const route=(fn:any)=>async(req:any,res:any,next:any)=>{try{await fn(req,res);}catch(e){next(e);}};
userContentRoutes.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(!res.locals.userId){res.status(401).json({error:{code:'TELEGRAM_AUTH_REQUIRED',message:'Войдите через Telegram.'}});return;}next();});
userContentRoutes.get('/tracks/:trackId/personal',route(async(req:any,res:any)=>{
 const item=await prisma.personalTrack.findUnique({where:{userId_trackId:{userId:res.locals.userId,trackId:req.params.trackId}}}),audio=item?.audioFileId?await prisma.userFile.findUnique({where:{id:item.audioFileId}}):null;
 const shared=await prisma.sharedTrackOverride.findUnique({where:{trackId:req.params.trackId}});
 res.json({data:{trackId:req.params.trackId,offset:item?.hasTimingOffset?item.offset:shared?.offset??0,lines:item?.lyricsData?JSON.parse(item.lyricsData):null,audio:audio?publicFile(audio):null}});
}));
userContentRoutes.put('/tracks/:trackId/personal',route(async(req:any,res:any)=>{
 const body=personalSchema.parse(req.body),trackId=z.string().min(1).max(200).parse(req.params.trackId),userId=res.locals.userId;
 const data={...(body.offset!==undefined?{offset:body.offset,hasTimingOffset:true}:{}),...(body.lines!==undefined?{lyricsData:body.lines?JSON.stringify(body.lines):null}:{})};
 await prisma.personalTrack.upsert({where:{userId_trackId:{userId,trackId}},create:{userId,trackId,...data},update:data});res.json({data:{ok:true}});
}));
userContentRoutes.post('/files',rateLimit({windowMs:60000,limit:10,keyGenerator:(_req,res)=>res.locals.userId}),raw({type:()=>true,limit:'80mb'}),route(async(req:any,res:any)=>{
 const query=z.object({kind:z.enum(['audio','attachment']),fileName:z.string().min(1).max(240),trackId:z.string().min(1).max(200).optional()}).parse(req.query);
 if(query.kind==='audio'&&!query.trackId){res.status(400).json({error:{message:'Выберите трек для аудиофайла.'}});return;}
 if(!Buffer.isBuffer(req.body)){res.status(400).json({error:{message:'Передайте файл как application/octet-stream.'}});return;}
 try{const file=await saveUserFile(res.locals.userId,query.trackId,query.kind,query.fileName,req.body);res.status(201).json({data:publicFile(file)});}catch(e){res.status(400).json({error:{message:(e as Error).message}});}
}));
userContentRoutes.get('/files/:id',route(async(req:any,res:any)=>{
 const file=await prisma.userFile.findFirst({where:{id:req.params.id,userId:res.locals.userId}});if(!file){res.sendStatus(404);return;}
 res.setHeader('X-Content-Type-Options','nosniff');res.type(file.mime);if(file.kind!=='audio')res.attachment(file.fileName);res.sendFile(file.path);
}));
userContentRoutes.get('/reports',route(async(_req:any,res:any)=>{const rows=await prisma.userReport.findMany({where:{userId:res.locals.userId},orderBy:{createdAt:'desc'},take:100});res.json({data:rows.map(r=>({...r,payload:JSON.parse(r.payload)}))});}));
userContentRoutes.post('/reports',rateLimit({windowMs:3600000,limit:20,keyGenerator:(_req,res)=>res.locals.userId}),route(async(req:any,res:any)=>{
 const body=reportSchema.parse(req.body),userId=res.locals.userId,existing=await prisma.userReport.findUnique({where:{userId_requestId:{userId,requestId:body.requestId}}});if(existing){res.json({data:{id:existing.id,status:existing.status}});return;}
 const files=await prisma.userFile.findMany({where:{id:{in:body.attachmentIds},userId}});if(files.length!==new Set(body.attachmentIds).size){res.status(400).json({error:{message:'Вложение не найдено или принадлежит другому пользователю.'}});return;}
 if(body.kind==='source'&&!body.proposedUrl&&!files.some(f=>f.kind==='audio'&&f.trackId===body.trackId)){res.status(400).json({error:{message:'Предложите аудиофайл этого трека.'}});return;}
 const {reason,description,page,...payload}=body;
 let created=true;
 const saved=await prisma.userReport.create({data:{userId,requestId:body.requestId,kind:body.kind,reason:sanitizeReportText(reason),description:sanitizeReportText(description),page:page?sanitizeReportText(page.split('?')[0]):undefined,trackId:body.trackId,payload:JSON.stringify(payload)}}).catch(async error=>{if(error.code!=='P2002')throw error;created=false;return prisma.userReport.findUniqueOrThrow({where:{userId_requestId:{userId,requestId:body.requestId}}});});
 if(created&&env.TELEGRAM_ADMIN_CHAT_ID)void notifyUser(`telegram:${env.TELEGRAM_ADMIN_CHAT_ID}`,`Новое обращение №${saved.id.slice(0,8)} · ${saved.kind}. Откройте админку для проверки.`).catch(()=>{});

 if(created){
  const user=await prisma.user.findUnique({where:{id:userId},select:{name:true,username:true}}).catch(()=>null);
  const d=body.diagnostics;
  sendReportToSheet({id:saved.id,createdAt:saved.createdAt.toISOString(),kind:saved.kind,reason:saved.reason,description:saved.description,user:[user?.name,user?.username?`@${user.username}`:'',userId].filter(Boolean).join(' · '),page:saved.page||undefined,track:body.trackId?`${body.artistName||''} — ${body.trackTitle||''} (${body.trackId})`:undefined,attachments:body.attachmentIds.length,diagnostics:d?[d.pageName,d.viewport,d.nowPlaying,...(d.errors||[]).slice(0,5)].filter(Boolean).join(' | ').slice(0,2000):undefined});
 }
 if(created)void notifyUser(userId,`Обращение №${saved.id.slice(0,8)} принято. Статус доступен в профиле.`).catch(()=>{});res.status(201).json({data:{id:saved.id,status:saved.status}});
}));
userContentRoutes.get('/tracks/:trackId/info',route(async(req:any,res:any)=>{
 const track=await trackController.resolveTrack(req.params.trackId);if(!track){res.sendStatus(404);return;}
 // Song bio and credits from Genius; popularity figures are deliberately not part of track info.
 const genius=await geniusSongInfo(track.artist.name,track.title).catch(()=>null);
 res.json({data:{trackId:track.id,genius,releaseDate:genius?.releaseDate||null,description:genius?.description||null,descriptionSource:genius?.description?'Genius':undefined,descriptionUrl:genius?.url}});
}));
userContentRoutes.post('/releases/:id/export',rateLimit({windowMs:3600000,limit:6,keyGenerator:(_req,res)=>res.locals.userId}),route(async(req:any,res:any)=>{
 const data=z.object({requestId:z.string().uuid(),trackIds:z.array(z.string().min(1).max(200)).min(1).max(100),title:z.string().min(1).max(200),sendTelegram:z.boolean().default(true)}).parse(req.body);
 res.status(202).json({data:exportView(await startReleaseExport(res.locals.userId,req.params.id,data))});
}));
userContentRoutes.get('/exports/:id',route(async(req:any,res:any)=>{const job=await prisma.releaseExport.findFirst({where:{id:req.params.id,userId:res.locals.userId}});if(!job){res.sendStatus(404);return;}res.json({data:exportView(job)});}));
userContentRoutes.get('/exports/:id/download',route(async(req:any,res:any)=>{const job=await prisma.releaseExport.findFirst({where:{id:req.params.id,userId:res.locals.userId}});if(!job?.filePath){res.sendStatus(404);return;}res.download(job.filePath,`${job.title.replace(/[\\/\r\n]/g,'_')}.zip`);}));

userContentRoutes.get('/shared/:trackId/audio',route(async(req:any,res:any)=>{const shared=await prisma.sharedTrackOverride.findUnique({where:{trackId:req.params.trackId}}),file=shared?.audioFileId?await prisma.userFile.findUnique({where:{id:shared.audioFileId}}):null;if(!file){res.sendStatus(404);return;}res.type(file.mime).sendFile(file.path);}));
