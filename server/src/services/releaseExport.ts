import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {prisma} from '../database/client.js';
import {contentDirectory,makeZip} from './userContent.js';
import {trackController} from '../controllers/trackController.js';
import {studioMasterService} from './StudioMasterService.js';
import {env} from '../config/env.js';
import type {ReleaseExport} from '@prisma/client';
const running=new Map<string,Promise<ReleaseExport>>();
export const exportView=(job:ReleaseExport)=>({id:job.id,status:job.status,...JSON.parse(job.result),downloadUrl:job.filePath?`/api/content/exports/${job.id}/download`:null});
export async function startReleaseExport(userId:string,releaseId:string,data:{requestId:string;trackIds:string[];title:string;sendTelegram:boolean}){
 const key=`${userId}:${releaseId}`;if(running.has(key))return running.get(key)!;
 const creation=(async()=>{
  const same=await prisma.releaseExport.findUnique({where:{userId_requestId:{userId,requestId:data.requestId}}});if(same)return same;
  const active=await prisma.releaseExport.findFirst({where:{userId,releaseId,OR:[{status:'preparing'},{status:{in:['uncertain','interrupted']}},{createdAt:{gte:new Date(Date.now()-300000)},status:{in:['completed','partial']}}]}});if(active)return active;
  const job=await prisma.releaseExport.create({data:{userId,releaseId,title:data.title,requestId:data.requestId}});
  void prepare(job,data).catch(async()=>{await prisma.releaseExport.update({where:{id:job.id},data:{status:'uncertain',result:JSON.stringify({message:'Не удалось подготовить релиз. Проверьте чат перед повторной отправкой.',delivery:'unknown',unavailable:[]})}}).catch(()=>{});});return job;
 })();running.set(key,creation);try{return await creation;}finally{running.delete(key);}
}
async function prepare(job:ReleaseExport,data:{trackIds:string[];sendTelegram:boolean}){
 const entries:Array<{name:string,data:Buffer}>=[],unavailable:Array<{trackId:string,reason:string}>=[],sent:string[]=[];let delivery=data.sendTelegram?'pending':'not_requested',total=0,uncertain=false;
 for(const [index,trackId] of [...new Set(data.trackIds)].entries()){
  try{
   const track=await trackController.resolveTrack(trackId);if(!track)throw new Error('Трек не найден.');
   const personal=await prisma.personalTrack.findUnique({where:{userId_trackId:{userId:job.userId,trackId}}}),own=personal?.audioFileId?await prisma.userFile.findFirst({where:{id:personal.audioFileId,userId:job.userId}}):null;
   if(!own&&track.source==='spotify')throw new Error('Spotify API не предоставляет аудиофайлы для экспорта.');
   const file=own?{path:own.path,mime:own.mime,extension:path.extname(own.fileName).slice(1)}:await studioMasterService.prepareExportAudio(track),bytes=await readFile(file.path);
   if(total+bytes.length>256*1024*1024)throw new Error('Достигнут размер архива 256 МБ; экспортируйте оставшиеся треки отдельно.');
   total+=bytes.length;const name=`${String(index+1).padStart(2,'0')} ${track.artist.name} - ${track.title}.${file.extension}`;entries.push({name,data:bytes});
   if(data.sendTelegram&&!uncertain){
    if(!env.TELEGRAM_BOT_TOKEN){delivery='unavailable';continue;}
    if(bytes.length>49*1024*1024){unavailable.push({trackId,reason:'Есть в ZIP; файл превышает лимит отправки бота (49 МБ).'});continue;}
    const form=new FormData();form.set('chat_id',job.userId.replace(/^telegram:/,''));form.set('title',track.title.slice(0,128));form.set('performer',track.artist.name.slice(0,128));form.set('audio',new Blob([new Uint8Array(bytes)],{type:file.mime}),name.replace(/[\\/\r\n]/g,'_'));
    try{const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)}),result=await response.json() as any;if(!result.ok){unavailable.push({trackId,reason:'Есть в ZIP; Telegram не принял файл. Откройте чат бота и нажмите Start.'});delivery='failed';}else sent.push(trackId);}catch{uncertain=true;delivery='unknown';unavailable.push({trackId,reason:'Есть в ZIP; доставка не подтверждена. Проверьте чат бота перед повторной отправкой.'});}
   }
  }catch(e){unavailable.push({trackId,reason:e instanceof Error?e.message:'Файл недоступен.'});}
  await prisma.releaseExport.update({where:{id:job.id},data:{result:JSON.stringify({unavailable,sent,delivery,prepared:entries.length,total:data.trackIds.length})}});
 }
 let filePath:string|undefined;if(entries.length){await mkdir(contentDirectory,{recursive:true});filePath=path.join(contentDirectory,`${job.id}.zip`);await writeFile(filePath,makeZip(entries),{mode:0o600});}
 if(delivery==='pending')delivery=sent.length===entries.length?'sent':'partial';
 await prisma.releaseExport.update({where:{id:job.id},data:{status:uncertain?'uncertain':entries.length?(unavailable.length?'partial':'completed'):'failed',filePath,result:JSON.stringify({unavailable,sent,delivery,prepared:entries.length,total:data.trackIds.length})}});
}
