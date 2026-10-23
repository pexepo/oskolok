import type {Router} from 'express';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import {awardMedal,revokeMedal,userRewardsForAdmin,medalCatalogForAdmin,medalHolders,evaluateRewards,RewardValidationError} from '../services/rewards.js';

/* Developer panel: medals catalogue, holders, award/revoke per user. Mounted inside registerAdminDashboard (behind the admin key). */

const route=(fn:(req:any,res:any)=>Promise<void>)=>async(req:any,res:any,next:any)=>{
 try{await fn(req,res);}
 catch(e:any){
  if(e instanceof RewardValidationError||e?.name==='ZodError'){res.status(400).json({error:{message:e instanceof RewardValidationError?e.message:e.issues?.[0]?.message||'Неверные данные.'}});return;}
  next(e);
 }
};
const audit=(action:string,target:string,details:unknown)=>prisma.adminAuditLog.create({data:{action,target,details:JSON.stringify(details).slice(0,2000)}}).catch(()=>{});

export function registerAdminRewards(router:Router){
 router.get('/rewards',route(async(_req,res)=>{res.json({data:await medalCatalogForAdmin()});}));
 router.get('/rewards/medals/:medalId/holders',route(async(req,res)=>{res.json({data:await medalHolders(String(req.params.medalId))});}));
 router.get('/users/:id/rewards',route(async(req,res)=>{res.json({data:await userRewardsForAdmin(String(req.params.id))});}));
 router.post('/users/:id/medals',route(async(req,res)=>{
  const userId=String(req.params.id),body=z.object({medalId:z.string().max(60),note:z.string().max(1000).optional()}).parse(req.body);
  const row=await awardMedal(userId,body);
  await audit('medal.award',userId,{medalId:row.medalId,note:row.note});
  res.json({data:await userRewardsForAdmin(userId)});
 }));
 router.delete('/users/:id/medals/:medalId',route(async(req,res)=>{
  const userId=String(req.params.id),medalId=String(req.params.medalId);
  await revokeMedal(userId,medalId);
  await audit('medal.revoke',userId,{medalId});
  res.json({data:await userRewardsForAdmin(userId)});
 }));
 router.post('/users/:id/rewards/recompute',route(async(req,res)=>{
  const userId=String(req.params.id);
  if(!await prisma.user.findUnique({where:{id:userId},select:{id:true}}))throw new RewardValidationError('Пользователь не найден.');
  await evaluateRewards(userId,true);
  res.json({data:await userRewardsForAdmin(userId)});
 }));
}
