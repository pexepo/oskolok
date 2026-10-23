import {mkdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import {contentDirectory,inspectUpload} from './userContent.js';
import {artistKey,artistKeys} from './artistFollow.js';
import type {Track} from '../types/index.js';

export const UNRELEASED_KINDS=['leak','snippet','demo','other'] as const;
const AUDIO_MAX=30*1024*1024,COVER_MAX=8*1024*1024;
export const unreleasedSchema=z.object({
 title:z.string().trim().min(1).max(200),artistName:z.string().trim().min(1).max(200),artistId:z.string().trim().max(200).optional(),
 audioFileId:z.string().uuid(),coverFileId:z.string().uuid().optional(),kind:z.enum(UNRELEASED_KINDS).default('leak'),
 source:z.string().trim().max(500).default(''),description:z.string().trim().max(4000).default(''),duration:z.number().int().min(0).max(4*3600).default(0),
}).strict();
export const unreleasedEditSchema=unreleasedSchema.pick({title:true,artistName:true,artistId:true,kind:true,source:true,description:true,duration:true}).partial().extend({artistId:z.string().trim().max(200).nullable().optional()}).strict();

/** Accepts MP3/M4A/OGG/FLAC up to 30 MB, or a PNG/JPEG/WebP cover up to 8 MB; stored like other user files. */
export async function saveUnreleasedFile(userId:string,kind:'audio'|'cover',fileName:string,body:Buffer){
 const extension=path.extname(fileName).slice(1).toLowerCase();
 if(kind==='audio'){
  if(!['mp3','m4a','ogg','flac'].includes(extension))throw new Error('Поддерживаются MP3, M4A, OGG и FLAC.');
  if(body.length>AUDIO_MAX)throw new Error('Аудио: максимум 30 МБ.');
 }else{
  if(!['png','jpg','jpeg','webp'].includes(extension))throw new Error('Обложка: PNG, JPEG или WebP.');
  if(body.length>COVER_MAX)throw new Error('Обложка: максимум 8 МБ.');
 }
 const mime=inspectUpload(fileName,kind==='audio'?'audio':'attachment',body),id=randomUUID(),target=path.join(contentDirectory,id);
 const quota=await prisma.userFile.aggregate({where:{userId},_sum:{size:true}});if((quota._sum.size||0)+body.length>1024*1024*1024)throw new Error('Личное хранилище заполнено (1 ГБ).');
 await mkdir(contentDirectory,{recursive:true});await writeFile(target,body,{flag:'wx',mode:0o600});
 try{return await prisma.userFile.create({data:{id,userId,kind:`unreleased-${kind}`,fileName:path.basename(fileName).slice(0,240),mime,size:body.length,path:target}});}
 catch(e){await unlink(target).catch(()=>{});throw e;}
}

export async function removeUnreleased(id:string){
 const row=await prisma.unreleasedTrack.findUnique({where:{id}});if(!row)return false;
 const files=await prisma.userFile.findMany({where:{id:{in:[row.audioFileId,row.coverFileId].filter(Boolean) as string[]}}});
 await prisma.$transaction([prisma.unreleasedTrack.delete({where:{id}}),prisma.userFile.deleteMany({where:{id:{in:files.map(f=>f.id)}}})]);
 for(const f of files)await unlink(f.path).catch(()=>{});
 return true;
}

type Row=Awaited<ReturnType<typeof prisma.unreleasedTrack.findUniqueOrThrow>>;
const KIND_LABEL:Record<string,string>={leak:'Слив',snippet:'Сниппет',demo:'Демо',other:'Анрелиз'};
/** Approved rows play through the normal player as source 'unreleased'. */
export function unreleasedTrack(row:Row):Track{
 return {id:`unreleased:${row.id}`,source:'unreleased',sourceId:row.id,title:row.title,
  artist:{id:row.artistId||`unreleased-artist:${row.artistKey}`,source:row.artistId?.startsWith('soundcloud:')?'soundcloud':row.artistId?.startsWith('deezer:')?'deezer':'spotify',sourceId:row.artistId||row.artistKey,name:row.artistName},
  artworkUrl:row.coverFileId?`/api/unreleased/${encodeURIComponent(row.id)}/cover`:undefined,duration:row.duration,access:'playable',
  genre:KIND_LABEL[row.kind]||'Анрелиз',createdAt:row.createdAt.toISOString()};
}
export const ownView=(row:Row)=>({...row,track:unreleasedTrack(row)});

export const unreleasedId=(trackId:string)=>trackId.startsWith('unreleased:')?trackId.slice(11):null;
export const titleKey=(title:string)=>title.normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е').replace(/\((?:feat|ft|prod)[^)]*\)|\[(?:feat|ft|prod)[^\]]*\]|\[(?:snippet|unreleased|demo|leak|v\d)[^\]]*\]|\((?:snippet|unreleased|demo|leak)[^)]*\)|\*/gi,' ').replace(/[^\p{L}\p{N}]+/gu,'');

export async function approvedForArtist(name:string,ids:string[]=[]){
 const rows=await prisma.unreleasedTrack.findMany({where:{status:'approved',OR:[{artistKey:{in:artistKeys(name)}},...(ids.length?[{artistId:{in:ids}}]:[])]},orderBy:{createdAt:'desc'},take:200});
 return rows;
}
export async function searchApproved(query:string,limit=20){
 const q=artistKey(query);if(q.length<2)return [];
 const rows=await prisma.unreleasedTrack.findMany({where:{status:'approved'},orderBy:{createdAt:'desc'},take:2000});
 return rows.map(r=>{const t=titleKey(r.title),a=r.artistKey,score=t===q?4:t.startsWith(q)?3:t.includes(q)?2:a===q||(a+t).includes(q)||(t+a).includes(q)?1:0;return {r,score};}).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>unreleasedTrack(x.r));
}
