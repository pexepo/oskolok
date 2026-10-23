import {reportSchema,sanitizeReportText} from '../services/userContent.js';
import {notifyUser} from '../services/telegramBot.js';
import {saveUserFile,publicFile} from '../services/userContent.js';
import { Router,raw } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { lyricSubmissionSchema } from '../validation/lyrics.js';
import { registerAdminDashboard } from './adminDashboard.js';
import { registerAdminUnreleased } from './communityController.js';
import {grantBetaAccess,notifyBetaApproval} from '../services/telegramBetaNotifications.js';

export const adminRoutes=Router();
const hash=(s:string)=>createHash('sha256').update(s).digest();
adminRoutes.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  const token=req.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(!env.ADMIN_API_KEY || !timingSafeEqual(hash(token),hash(env.ADMIN_API_KEY))){
    res.status(401).json({error:{message:'Нет доступа к панели разработчика.'}});return;
  }
  next();
});
const route=(fn:any)=>async(req:any,res:any,next:any)=>{try{await fn(req,res);}catch(e){next(e);}};
registerAdminDashboard(adminRoutes);
registerAdminUnreleased(adminRoutes);
adminRoutes.get('/submissions',route(async(req:any,res:any)=>{
  const status=z.enum(['pending','approved','rejected','all']).default('pending').parse(req.query.status);
  const items=await prisma.lyricSubmission.findMany({where:status==='all'?{}:{status},orderBy:{createdAt:'desc'},take:200});
  const users=await prisma.user.findMany({where:{id:{in:[...new Set(items.map(s=>s.userId))]}},select:{id:true,name:true,username:true}});
  res.json({data:items.map(item=>({...item,author:users.find(u=>u.id===item.userId)}))});
}));
adminRoutes.get('/lyrics',route(async(_req:any,res:any)=>{
  res.json({data:await prisma.lyricContribution.findMany({orderBy:{updatedAt:'desc'},take:200})});
}));
adminRoutes.post('/submissions/:id/review',route(async(req:any,res:any)=>{
  const {decision,reviewNote}=z.object({decision:z.enum(['approved','rejected']),reviewNote:z.string().max(1000).default('')}).parse(req.body);
  const result=await prisma.$transaction(async tx=>{
    const changed=await tx.lyricSubmission.updateMany({where:{id:req.params.id,status:'pending'},data:{status:decision,reviewNote,reviewedAt:new Date()}});
    if(!changed.count)return false;
    const s=await tx.lyricSubmission.findUniqueOrThrow({where:{id:req.params.id}});
    if(decision==='approved'){
      // One published version per track, including when its contributor changes.
      await tx.lyricContribution.deleteMany({where:{trackId:s.trackId}});
      await tx.lyricContribution.create({data:{userId:s.userId,trackId:s.trackId,trackTitle:s.trackTitle,artistName:s.artistName,credit:s.credit,lyricsData:s.lyricsData}});
      await tx.lyricsCache.deleteMany({where:{id:s.trackId}});
    }
    return {userId:s.userId,trackTitle:s.trackTitle};
  });
  if(!result){res.status(409).json({error:{message:'Заявка уже рассмотрена или отозвана.'}});return;}
  void notifyUser(result.userId,`Текст «${result.trackTitle}»: ${decision==='approved'?'одобрен и опубликован':'отклонён'}.${reviewNote?' '+reviewNote:''}`).catch(()=>{});
  res.json({data:{ok:true}});
}));
adminRoutes.post('/lyrics',route(async(req:any,res:any)=>{
  const {lines,fileName,...meta}=lyricSubmissionSchema.parse(req.body);
  const published=await prisma.$transaction(async tx=>{
    await tx.lyricContribution.deleteMany({where:{trackId:meta.trackId}});
    await tx.lyricsCache.deleteMany({where:{id:meta.trackId}});
    return tx.lyricContribution.create({data:{...meta,userId:'developer',lyricsData:JSON.stringify(lines)}});
  });
  res.status(201).json({data:{id:published.id}});
}));
adminRoutes.delete('/lyrics/:id',route(async(req:any,res:any)=>{
  await prisma.lyricContribution.deleteMany({where:{id:req.params.id}});
  res.json({data:{ok:true}});
}));

adminRoutes.get('/beta',route(async(_req:any,res:any)=>{res.json({data:await prisma.betaAccess.findMany({orderBy:{createdAt:'desc'}})});}));
adminRoutes.post('/beta',route(async(req:any,res:any)=>{
 const username=z.string().trim().transform(s=>s.replace(/^@/,'').toLowerCase()).pipe(z.string().regex(/^[a-z0-9_]{5,32}$/)).parse(req.body.username);
 const item=await grantBetaAccess(username);
 void notifyBetaApproval(item.id);
 res.json({data:item});
}));
adminRoutes.delete('/beta/:username',route(async(req:any,res:any)=>{
 const username=String(req.params.username).replace(/^@/,'').toLowerCase();
 const item=await prisma.betaAccess.findUnique({where:{username}});
 if(item){await prisma.$transaction(async tx=>{await tx.betaAccess.update({where:{username},data:{enabled:false}});if(item.telegramUserId)await tx.webSession.deleteMany({where:{userId:item.telegramUserId}});});}
 res.json({data:{ok:true}});
}));
adminRoutes.get('/stats',route(async(req:any,res:any)=>{
 const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(new Date().toISOString().slice(0,7)).parse(req.query.month),from=new Date(`${month}-01T00:00:00Z`),to=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,1));
 const [total,newUsers,history,sessionUsers]=await Promise.all([prisma.user.count(),prisma.user.count({where:{createdAt:{gte:from,lt:to}}}),prisma.historyItem.findMany({where:{playedAt:{gte:from,lt:to}},distinct:['userId'],select:{userId:true}}),prisma.monthlyActivity.findMany({where:{month},select:{userId:true}})]);
 res.json({data:{month,total,newUsers,activeUsers:new Set([...history.map(x=>x.userId),...sessionUsers.map(x=>x.userId)]).size,activeDefinition:'Уникальные пользователи с подтверждённой активностью или прослушиванием в выбранном месяце (UTC). Для месяцев до обновления учитывается сохранённая история.'}});
}));
adminRoutes.get('/reports',route(async(req:any,res:any)=>{
 const status=z.enum(['pending','approved','rejected','resolved','all']).default('pending').parse(req.query.status),rows=await prisma.userReport.findMany({where:status==='all'?{}:{status},orderBy:{createdAt:'desc'},take:200});
 const users=await prisma.user.findMany({where:{id:{in:[...new Set(rows.map(x=>x.userId))]}},select:{id:true,name:true,username:true}});
 res.json({data:await Promise.all(rows.map(async item=>{const payload=JSON.parse(item.payload),files=await prisma.userFile.findMany({where:{id:{in:payload.attachmentIds||[]},userId:item.userId},select:{id:true,fileName:true,mime:true,size:true}});return {...item,payload,attachments:files,author:users.find(u=>u.id===item.userId)};}))});
}));
adminRoutes.get('/files/:id',route(async(req:any,res:any)=>{const file=await prisma.userFile.findUnique({where:{id:req.params.id}});if(!file){res.sendStatus(404);return;}res.setHeader('X-Content-Type-Options','nosniff');res.type(file.mime).download(file.path,file.fileName);}));
adminRoutes.post('/files',raw({type:()=>true,limit:'8mb'}),route(async(req:any,res:any)=>{if(!Buffer.isBuffer(req.body)){res.status(400).json({error:{message:'Передайте файл как application/octet-stream.'}});return;}const name=z.string().min(1).max(240).parse(req.query.fileName);res.status(201).json({data:publicFile(await saveUserFile('developer',undefined,'attachment',name,req.body))});}));
adminRoutes.post('/reports',route(async(req:any,res:any)=>{
 const data=reportSchema.parse(req.body);const files=await prisma.userFile.count({where:{id:{in:data.attachmentIds},userId:'developer'}});if(files!==new Set(data.attachmentIds).size){res.status(400).json({error:{message:'Вложения не найдены.'}});return;}
 const report=await prisma.userReport.upsert({where:{userId_requestId:{userId:'developer',requestId:data.requestId}},create:{userId:'developer',requestId:data.requestId,kind:data.kind,reason:sanitizeReportText(data.reason),description:sanitizeReportText(data.description),trackId:data.trackId,page:data.page?.split('?')[0],payload:JSON.stringify(data)},update:{}});res.status(201).json({data:{id:report.id,status:report.status}});
}));
adminRoutes.post('/reports/:id/review',route(async(req:any,res:any)=>{
 const {decision,reviewNote}=z.object({decision:z.enum(['approved','rejected','resolved']),reviewNote:z.string().max(1000).default('')}).parse(req.body);
 let userId='';
 const changed=await prisma.$transaction(async tx=>{
  const report=await tx.userReport.findUnique({where:{id:req.params.id}});if(!report||report.status!=='pending')return false;
  const claim=await tx.userReport.updateMany({where:{id:report.id,status:'pending'},data:{status:decision,reviewNote,reviewedAt:new Date()}});if(!claim.count)return false;
  userId=report.userId;const p=JSON.parse(report.payload);
  if(decision==='approved'&&report.trackId){
   if(report.kind==='lyrics'){
    const lines=lyricSubmissionSchema.shape.lines.parse(p.lines);await tx.lyricContribution.deleteMany({where:{trackId:report.trackId}});
    await tx.lyricContribution.create({data:{userId:report.userId,trackId:report.trackId,trackTitle:p.trackTitle||report.trackId,artistName:p.artistName||'',credit:'Сообщество Осколка',lyricsData:JSON.stringify(lines)}});await tx.lyricsCache.deleteMany({where:{id:report.trackId}});
   }
   if(report.kind==='timing'){const offset=z.number().finite().min(-60).max(60).parse(p.offset);await tx.sharedTrackOverride.upsert({where:{trackId:report.trackId},create:{trackId:report.trackId,offset},update:{offset}});}
   if(report.kind==='source'){
    const file=await tx.userFile.findFirst({where:{id:{in:p.attachmentIds||[]},userId:report.userId,trackId:report.trackId,kind:'audio'}});
    if(!file&&!p.proposedUrl)throw new Error('Предложенный источник больше не доступен.');
    const data={audioFileId:file?.id||null,sourceUrl:p.proposedUrl||null,platform:p.platform};await tx.sharedTrackOverride.upsert({where:{trackId:report.trackId},create:{trackId:report.trackId,...data},update:data});
   }
  }
  return true;
 });
 if(!changed){res.status(409).json({error:{message:'Обращение уже рассмотрено или не найдено.'}});return;}
 void notifyUser(userId,`Обращение №${String(req.params.id).slice(0,8)}: ${decision==='approved'?'одобрено':decision==='resolved'?'решено':'отклонено'}.${reviewNote?' '+reviewNote:''}`).catch(()=>{});
 res.json({data:{ok:true}});
}));
