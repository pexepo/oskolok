import {Router} from 'express';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import {trackController} from './trackController.js';
import {soundCloudService} from '../services/SoundCloudService.js';
import {studioMasterService} from '../services/StudioMasterService.js';
import {trackCacheRepository} from '../repositories/trackCacheRepository.js';
import {recordingMetadata,selectRecordingCandidates} from '../services/recordingCandidates.js';
import type {Track} from '../types/index.js';

export const recordingRoutes=Router();
export const recordingKey=(id:string,source:string)=>`recordings:v1:${source}:${id}`;
recordingRoutes.get('/tracks/:id/recordings',async(req,res,next)=>{try{
 const source=z.enum(['youtube','soundcloud']).parse(req.query.source);
 const track=await trackController.resolveTrack(req.params.id);
 if(!track){res.status(404).json({error:{message:'Трек не найден'}});return;}
 const key=recordingKey(track.id,source),cached=await prisma.artistEnrichment.findUnique({where:{id:key}});
 let candidates:Track[];
 if(cached&&Date.now()-cached.updatedAt.getTime()<15*60000)candidates=JSON.parse(cached.data);
 else{
  const metadata=recordingMetadata(track),query=`${metadata.artist} ${metadata.title}`;
  const found=source==='youtube'?await studioMasterService.searchTracks(query,12):(await soundCloudService.search(query,{limit:12,type:'tracks'})).tracks;
  candidates=selectRecordingCandidates(track,found);
  await Promise.all(candidates.map(t=>trackCacheRepository.setCachedTrack(t)));
  await prisma.artistEnrichment.upsert({where:{id:key},create:{id:key,data:JSON.stringify(candidates)},update:{data:JSON.stringify(candidates)}});
 }
 const votes=await prisma.artistEnrichment.findMany({where:{id:{in:candidates.map(t=>`recording-vote:${res.locals.userId}:${t.id}`)}},select:{data:true}});
 const mine=new Map<string,boolean>();for(const vote of votes){try{const value=JSON.parse(vote.data);mine.set(value.recordingId,value.censored);}catch{}}
 res.json({data:candidates.map(t=>({...t,censored:mine.get(t.id)}))});
 }catch(e){next(e);}});
recordingRoutes.post('/tracks/:id/recordings/vote',async(req,res,next)=>{try{
 const body=z.object({source:z.enum(['youtube','soundcloud']),recordingId:z.string().max(200),censored:z.boolean()}).parse(req.body);
 const resolved=await trackController.resolveTrack(req.params.id);
 const cached=await prisma.artistEnrichment.findUnique({where:{id:recordingKey(resolved?.id||req.params.id,body.source)}});
 if(!cached||!(JSON.parse(cached.data) as Track[]).some(t=>t.id===body.recordingId)){res.status(400).json({error:{message:'Выберите запись из списка'}});return;}
 const id=`recording-vote:${res.locals.userId}:${body.recordingId}`;
 const data=JSON.stringify({...body,trackId:req.params.id});
 await prisma.artistEnrichment.upsert({where:{id},create:{id,data},update:{data}});
 res.json({data:{saved:true}});
 }catch(e){next(e);}});
