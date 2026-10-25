import {unlink} from 'node:fs/promises';
import {z} from 'zod';
import {prisma} from '../database/client.js';
import {ARTWORK_HOSTS} from './ArtworkService.js';
import {profileTrackWithArtwork} from './profileArtwork.js';
import {saveUserFile} from './userContent.js';
import type {Track} from '../types/index.js';

/**
 * The profile showcase: tiles the listener arranges by hand — tracks, albums,
 * playlists, their own pictures and GIFs, and notes — each with a size and a caption.
 * It only holds what was added inside Oskolok; the Telegram profile music has its own list.
 */
export const SHOWCASE_SIZES=['s','m','l','wide','tall'] as const;
export const SHOWCASE_LIMIT=60;
export class ShowcaseError extends Error{constructor(message:string,public status=400){super(message);}}

const size=z.enum(SHOWCASE_SIZES).default('m');
const caption=z.string().trim().max(200).default('');
const artwork=z.string().url().max(1000).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&ARTWORK_HOSTS.has(url.hostname);}catch{return false;}},'Обложка должна быть из каталога.');
export const showcaseAddSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('track'),trackId:z.string().min(1).max(200),size,caption}),
 z.object({kind:z.literal('album'),album:z.object({id:z.string().min(1).max(200),title:z.string().trim().min(1).max(300),artistName:z.string().trim().max(300).default(''),artworkUrl:artwork.optional(),date:z.string().max(40).optional()}),size,caption}),
 z.object({kind:z.literal('playlist'),playlistId:z.string().min(1).max(200),size,caption}),
 z.object({kind:z.literal('image'),fileId:z.string().uuid(),size,caption}),
 z.object({kind:z.literal('note'),text:z.string().trim().min(1).max(600),size,caption}),
]);
export const showcasePatchSchema=z.object({size:z.enum(SHOWCASE_SIZES).optional(),caption:z.string().trim().max(200).optional(),text:z.string().trim().min(1).max(600).optional()}).strict();
export const showcaseOrderSchema=z.object({ids:z.array(z.string().uuid()).max(SHOWCASE_LIMIT)});

type Row={id:string;userId:string;kind:string;refId:string|null;data:string;caption:string;size:string;position:number;fileId:string|null};
export type ShowcaseItem={id:string;kind:string;size:string;caption:string;track?:Track;album?:{id:string;title:string;artistName:string;artworkUrl?:string;date?:string};playlist?:{playlistId:string;title:string;artworkUrl?:string;tracks:Track[]};image?:{url:string;mime:string};text?:string};

const mediaUrl=(userId:string,itemId:string)=>`/api/users/${encodeURIComponent(userId.replace(/^telegram:/,''))}/showcase/${itemId}/media`;
async function present(row:Row):Promise<ShowcaseItem|null>{
 const base={id:row.id,kind:row.kind,size:row.size,caption:row.caption};
 try{
  const data=JSON.parse(row.data);
  if(row.kind==='track')return {...base,track:await profileTrackWithArtwork(row.data)};
  if(row.kind==='album')return {...base,album:data};
  if(row.kind==='playlist')return {...base,playlist:data};
  if(row.kind==='image')return {...base,image:{url:mediaUrl(row.userId,row.id),mime:data.mime}};
  if(row.kind==='note')return {...base,text:data.text};
 }catch{}
 return null;
}

/** Earlier builds kept the showcase in ProfileMusic/ProfilePlaylist; copy them once so nothing chosen in Oskolok is lost. */
async function importLegacy(userId:string){
 const profile=await prisma.creatorProfile.findUnique({where:{userId},select:{showcaseImported:true}});
 if(profile?.showcaseImported)return;
 const [music,playlists]=await Promise.all([prisma.profileMusic.findMany({where:{userId},orderBy:{addedAt:'desc'}}),prisma.profilePlaylist.findMany({where:{userId},orderBy:{addedAt:'desc'}})]);
 const rows=[
  ...playlists.map(p=>({kind:'playlist',refId:p.playlistId,data:JSON.stringify({playlistId:p.playlistId,title:p.title,artworkUrl:p.artworkUrl||undefined,tracks:JSON.parse(p.tracksData)})})),
  ...music.map(m=>({kind:'track',refId:m.trackId,data:m.trackData})),
 ].slice(0,SHOWCASE_LIMIT);
 await prisma.$transaction(async tx=>{
  if(!await tx.profileShowcaseItem.count({where:{userId}}))for(const [position,row] of rows.entries())await tx.profileShowcaseItem.create({data:{userId,...row,size:'m',position}});
  const user=await tx.user.findUnique({where:{id:userId},select:{name:true}});
  await tx.creatorProfile.upsert({where:{userId},create:{userId,displayName:user?.name||'Слушатель',showcaseImported:true},update:{showcaseImported:true}});
 });
}

export async function listShowcase(userId:string):Promise<ShowcaseItem[]>{
 await importLegacy(userId);
 const rows=await prisma.profileShowcaseItem.findMany({where:{userId},orderBy:[{position:'asc'},{addedAt:'asc'}]});
 return (await Promise.all(rows.map(present))).filter((item):item is ShowcaseItem=>!!item);
}
export const showcaseCount=(userId:string)=>prisma.profileShowcaseItem.count({where:{userId}});

export async function addShowcaseItem(userId:string,input:z.infer<typeof showcaseAddSchema>,resolveTrack:(id:string)=>Promise<Track|null>){
 await importLegacy(userId);
 if(await showcaseCount(userId)>=SHOWCASE_LIMIT)throw new ShowcaseError(`В витрине помещается ${SHOWCASE_LIMIT} плиток.`,409);
 let refId:string|null=null,data:unknown,fileId:string|null=null;
 if(input.kind==='track'){const track=await resolveTrack(input.trackId);if(!track)throw new ShowcaseError('Трек не найден.',404);refId=track.id;data=track;}
 else if(input.kind==='album'){refId=input.album.id;data=input.album;}
 else if(input.kind==='playlist'){
  const playlist=await prisma.playlist.findFirst({where:{id:input.playlistId,userId},include:{tracks:{orderBy:{position:'asc'}}}});
  if(!playlist)throw new ShowcaseError('Плейлист не найден.',404);
  // A playlist on a public profile is public: the same rule the old showcase followed.
  await prisma.playlist.update({where:{id:playlist.id},data:{isPublic:true}});
  const tracks=playlist.tracks.map(t=>JSON.parse(t.trackData));
  refId=playlist.id;data={playlistId:playlist.id,title:playlist.title,artworkUrl:playlist.artworkUrl||tracks.find((t:Track)=>t.artworkUrl)?.artworkUrl,tracks};
 }
 else if(input.kind==='image'){
  const file=await prisma.userFile.findFirst({where:{id:input.fileId,userId,kind:'showcase'}});
  if(!file)throw new ShowcaseError('Картинка не найдена. Загрузите её снова.',404);
  if(await prisma.profileShowcaseItem.findFirst({where:{fileId:file.id}}))throw new ShowcaseError('Эта картинка уже в витрине.',409);
  fileId=file.id;data={mime:file.mime};
 }
 else data={text:input.text};
 if(refId&&await prisma.profileShowcaseItem.findFirst({where:{userId,kind:input.kind,refId}}))throw new ShowcaseError('Это уже есть в витрине.',409);
 const last=await prisma.profileShowcaseItem.findFirst({where:{userId},orderBy:{position:'desc'},select:{position:true}});
 const row=await prisma.profileShowcaseItem.create({data:{userId,kind:input.kind,refId,fileId,data:JSON.stringify(data),size:input.size,caption:input.caption,position:(last?.position??-1)+1}});
 return present(row);
}

export async function updateShowcaseItem(userId:string,id:string,patch:z.infer<typeof showcasePatchSchema>){
 const row=await prisma.profileShowcaseItem.findFirst({where:{id,userId}});
 if(!row)throw new ShowcaseError('Плитка не найдена.',404);
 const data=patch.text!==undefined&&row.kind==='note'?JSON.stringify({text:patch.text}):undefined;
 return present(await prisma.profileShowcaseItem.update({where:{id},data:{...(patch.size?{size:patch.size}:{}),...(patch.caption!==undefined?{caption:patch.caption}:{}),...(data?{data}:{})}}));
}

/** Positions follow the given order; ids that are not the listener's are ignored, missing ones keep their place after. */
export async function reorderShowcase(userId:string,ids:string[]){
 const rows=await prisma.profileShowcaseItem.findMany({where:{userId},orderBy:[{position:'asc'},{addedAt:'asc'}],select:{id:true}});
 const own=new Set(rows.map(r=>r.id)),order=[...new Set(ids.filter(id=>own.has(id)))];
 for(const r of rows)if(!order.includes(r.id))order.push(r.id);
 await prisma.$transaction(order.map((id,position)=>prisma.profileShowcaseItem.update({where:{id},data:{position}})));
}

export async function removeShowcaseItem(userId:string,id:string){
 const row=await prisma.profileShowcaseItem.findFirst({where:{id,userId}});
 if(!row)return;
 await prisma.profileShowcaseItem.delete({where:{id}});
 if(row.fileId){const file=await prisma.userFile.findFirst({where:{id:row.fileId,userId}});if(file){await prisma.userFile.delete({where:{id:file.id}});await unlink(file.path).catch(()=>{});}}
}

/** Pictures and GIFs for tiles: PNG, JPEG, WebP or GIF up to 8 MB, checked by their bytes. */
export function showcaseImageType(body:Buffer){
 if(body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(body[0]===255&&body[1]===216&&body[2]===255)return 'jpg';
 if(body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP')return 'webp';
 if(/^GIF8[79]a$/.test(body.subarray(0,6).toString('latin1')))return 'gif';
 return null;
}
export async function uploadShowcaseImage(userId:string,body:Buffer){
 if(!body.length||body.length>8*1024*1024)throw new ShowcaseError('Картинка или GIF — до 8 МБ.');
 const type=showcaseImageType(body);
 if(!type)throw new ShowcaseError('Поддерживаются PNG, JPEG, WebP и GIF.');
 // Unused uploads (a closed dialog) are swept: only files on a tile stay.
 const stale=await prisma.userFile.findMany({where:{userId,kind:'showcase',createdAt:{lt:new Date(Date.now()-3600000)}},select:{id:true,path:true}});
 const used=new Set((await prisma.profileShowcaseItem.findMany({where:{userId,fileId:{in:stale.map(f=>f.id)}},select:{fileId:true}})).map(r=>r.fileId));
 for(const file of stale.filter(f=>!used.has(f.id))){await prisma.userFile.delete({where:{id:file.id}}).catch(()=>{});await unlink(file.path).catch(()=>{});}
 const file=await saveUserFile(userId,undefined,'showcase',`showcase.${type}`,body);
 return {id:file.id,mime:file.mime};
}

/** A tile picture is as public as the profile showing it. */
export async function showcaseMedia(userId:string,itemId:string){
 const row=await prisma.profileShowcaseItem.findFirst({where:{id:itemId,userId,kind:'image'}});
 if(!row?.fileId)return null;
 const file=await prisma.userFile.findFirst({where:{id:row.fileId,userId,kind:'showcase'}});
 return file?{path:file.path,mime:file.mime}:null;
}
