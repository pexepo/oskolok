import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prisma} from '../database/client.js';
import {z} from 'zod';
import {lyricSubmissionSchema} from '../validation/lyrics.js';
export const contentDirectory=path.resolve(process.env.USER_CONTENT_DIR||path.join(process.cwd(),'data','user-content'));
/** A listener-chosen playback source, optionally with the exact recording: «youtube», «soundcloud:soundcloud:123», «personal». */
export const timingSourceSchema=z.string().regex(/^(?:youtube|soundcloud|personal)(?::[\w:.-]{1,160})?$/);
/** Each source (and recording) starts the song at its own moment, so its timing offset is kept apart; «auto» uses the track-wide one. */
export function timingOffsetFor(personal:{hasTimingOffset:boolean;offset:number;sourceOffsets?:string|null}|null|undefined,shared:{offset:number}|null|undefined,source?:unknown):number{
 if(typeof source==='string'&&personal?.sourceOffsets&&timingSourceSchema.safeParse(source).success){try{const value=(JSON.parse(personal.sourceOffsets) as Record<string,unknown>)[source];if(typeof value==='number'&&Number.isFinite(value))return value;}catch{}}
 return personal?.hasTimingOffset?personal.offset:shared?.offset??0;
}
export const personalSchema=z.object({offset:z.number().finite().min(-60).max(60).optional(),source:timingSourceSchema.optional(),lines:lyricSubmissionSchema.shape.lines.nullable().optional(),trackTitle:z.string().max(300).optional(),artistName:z.string().max(200).optional()}).strict();
export const reportSchema=z.object({requestId:z.string().uuid(),kind:z.enum(['bug','playback','source','lyrics','timing','other']),reason:z.string().trim().min(3).max(200),description:z.string().trim().max(8000).default(''),trackId:z.string().min(1).max(200).optional(),trackTitle:z.string().max(300).optional(),artistName:z.string().max(200).optional(),page:z.string().max(500).optional(),attachmentIds:z.array(z.string().uuid()).max(4).default([]),platform:z.enum(['soundcloud','youtube']).optional(),proposedUrl:z.string().url().max(2000).refine(v=>/^https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|soundcloud\.com)\//i.test(v),'Нужна ссылка SoundCloud или YouTube.').optional(),offset:z.number().finite().min(-60).max(60).optional(),lines:lyricSubmissionSchema.shape.lines.optional(),diagnostics:z.object({pageName:z.string().max(200).optional(),route:z.string().max(500).transform(v=>v.split('?')[0]).optional(),errors:z.array(z.string().max(1000).transform(v=>sanitizeReportText(v))).max(20).default([]),userAgent:z.string().max(400).optional(),viewport:z.string().max(40).optional(),nowPlaying:z.string().max(400).optional()}).strict().optional()}).strict().superRefine((v,c)=>{
 // Lyrics, timing, source and playback reports carry their own data; only free-form reports need words.
 if(['bug','other'].includes(v.kind)&&v.description.length<5)c.addIssue({code:'custom',path:['description'],message:'Опишите проблему (от 5 символов).'});
 if(['source','lyrics','timing'].includes(v.kind)&&!v.trackId)c.addIssue({code:'custom',message:'Выберите трек.'});
 if(v.kind==='timing'&&v.offset===undefined)c.addIssue({code:'custom',message:'Укажите смещение.'});
 if(v.kind==='lyrics'&&!v.lines)c.addIssue({code:'custom',message:'Прикрепите разобранный текст.'});
 if(v.kind==='source'&&(!v.platform||(!v.proposedUrl&&!v.attachmentIds.length)))c.addIssue({code:'custom',message:'Укажите площадку и предложенный источник.'});
});
const audioTypes:Record<string,string>={mp3:'audio/mpeg',wav:'audio/wav',flac:'audio/flac',ogg:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',opus:'audio/ogg'};
export function inspectUpload(fileName:string,kind:string,body:Buffer){
 const extension=path.extname(fileName).slice(1).toLowerCase();
 if(!body.length||body.length>(kind==='audio'?80:8)*1024*1024)throw new Error(kind==='audio'?'Аудио: максимум 80 МБ.':'Вложение: максимум 8 МБ.');
 if(kind==='audio'){
  const valid=extension==='mp3'&&(body.subarray(0,3).toString()==='ID3'||body[0]===255&&(body[1]&224)===224)||extension==='wav'&&body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WAVE'||extension==='flac'&&body.subarray(0,4).toString()==='fLaC'||['ogg','opus'].includes(extension)&&body.subarray(0,4).toString()==='OggS'||extension==='m4a'&&body.subarray(4,8).toString()==='ftyp'||extension==='aac'&&body[0]===255&&(body[1]&240)===240;
  if(!valid)throw new Error('Формат аудио не соответствует файлу. Поддерживаются MP3, WAV, FLAC, OGG, OPUS, M4A, AAC.');return audioTypes[extension];
 }
 if(extension==='png'&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(['jpg','jpeg'].includes(extension)&&body[0]===255&&body[1]===216&&body[2]===255)return 'image/jpeg';
 if(extension==='webp'&&body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP')return 'image/webp';
 if(extension==='gif'&&/^GIF8[79]a$/.test(body.subarray(0,6).toString('latin1')))return 'image/gif';
 if(['txt','log','json','lrc','ttml'].includes(extension)&&!body.includes(0))return 'text/plain';
 throw new Error('Вложите PNG, JPEG, WebP, TXT, LOG, JSON, LRC или TTML.');
}
export async function saveUserFile(userId:string,trackId:string|undefined,kind:string,fileName:string,body:Buffer){
 const mime=inspectUpload(fileName,kind,body),id=randomUUID(),target=path.join(contentDirectory,id);
 const quota=await prisma.userFile.aggregate({where:{userId},_sum:{size:true}});if((quota._sum.size||0)+body.length>1024*1024*1024)throw new Error('Личное хранилище заполнено (1 ГБ).');
 await mkdir(contentDirectory,{recursive:true});await writeFile(target,body,{flag:'wx',mode:0o600});
 try{return await prisma.$transaction(async tx=>{const file=await tx.userFile.create({data:{id,userId,trackId,kind,fileName:path.basename(fileName).slice(0,240),mime,size:body.length,path:target}});if(kind==='audio'&&trackId)await tx.personalTrack.upsert({where:{userId_trackId:{userId,trackId}},create:{userId,trackId,audioFileId:id},update:{audioFileId:id}});return file;});}catch(e){await unlink(target).catch(()=>{});throw e;}
}
export const publicFile=(f:{id:string,fileName:string,size:number,mime:string})=>({id:f.id,fileName:f.fileName,size:f.size,mime:f.mime,url:`/api/content/files/${encodeURIComponent(f.id)}`});
export function sanitizeReportText(value:string){return value.replace(/((?:authorization|token|api[_-]?key|password|secret|initData|cookie)\s*[=:]\s*)(?:Bearer\s+)?[^\s&,;]+/gi,'$1[redacted]').replace(/bot\d{6,}:[A-Za-z0-9_-]+/g,'bot[redacted]');}
/** Small standards-compliant ZIP writer, stored files; no executable subprocess or shell paths. */
export function makeZip(entries:Array<{name:string,data:Buffer}>){
 const parts:Buffer[]=[],directory:Buffer[]=[];let offset=0;
 const crc=(b:Buffer)=>{let c=0xffffffff;for(const byte of b){c^=byte;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 for(const entry of entries){const name=Buffer.from(entry.name.replace(/[\\/\r\n]/g,'_')),sum=crc(entry.data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(sum,14);header.writeUInt32LE(entry.data.length,18);header.writeUInt32LE(entry.data.length,22);header.writeUInt16LE(name.length,26);parts.push(header,name,entry.data);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(sum,16);central.writeUInt32LE(entry.data.length,20);central.writeUInt32LE(entry.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);directory.push(central,name);offset+=header.length+name.length+entry.data.length;}
 const dir=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,dir,end]);
}
