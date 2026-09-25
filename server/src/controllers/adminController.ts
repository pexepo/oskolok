import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { lyricSubmissionSchema } from '../validation/lyrics.js';

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
    return true;
  });
  if(!result){res.status(409).json({error:{message:'Заявка уже рассмотрена или отозвана.'}});return;}
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
