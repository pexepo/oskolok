import type {ReleaseExport} from '@prisma/client';
import {prisma} from '../database/client.js';
import {createHash} from 'node:crypto';

/** A durable claim is written before sendAudio; sending/unknown jobs are never replayed. */
export async function claimTrackDelivery(userId:string,trackId:string,revision=''):Promise<{job:ReleaseExport;claimed:boolean}>{
  const requestId=`telegram-track:${createHash('sha256').update(`${trackId}\n${revision}`).digest('hex')}`;
  const where={userId_requestId:{userId,requestId}};
  let job=await prisma.releaseExport.findUnique({where});
  if(!job){
    try{
      job=await prisma.releaseExport.create({data:{userId,requestId,releaseId:`telegram-track:${trackId}`,title:trackId,status:'track_preparing'}});
      return {job,claimed:true};
    }catch(error){
      if((error as {code?:string}).code!=='P2002')throw error;
      job=await prisma.releaseExport.findUnique({where});
      if(!job)throw error;
    }
  }
  if(job.status==='track_failed'){
    const claimed=await prisma.releaseExport.updateMany({where:{id:job.id,status:'track_failed'},data:{status:'track_preparing',result:'{}'}});
    if(claimed.count)return {job:{...job,status:'track_preparing',result:'{}'},claimed:true};
    job=(await prisma.releaseExport.findUnique({where}))!;
  }
  return {job,claimed:false};
}
export async function markTrackDelivery(id:string,status:'track_sending'|'track_sent'|'track_uncertain'|'track_failed',result:Record<string,unknown>={}){
  return prisma.releaseExport.update({where:{id},data:{status,result:JSON.stringify(result)}});
}
