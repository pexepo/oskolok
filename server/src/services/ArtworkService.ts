import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import path from 'node:path';

export const ARTWORK_HOSTS = new Set(['i.scdn.co','image-cdn-ak.spotifycdn.com','image-cdn-fa.spotifycdn.com','images.genius.com','t2.genius.com','cdn-images.dzcdn.net','e-cdns-images.dzcdn.net','i1.sndcdn.com','i.ytimg.com','is1-ssl.mzstatic.com','is2-ssl.mzstatic.com','is3-ssl.mzstatic.com','is4-ssl.mzstatic.com','is5-ssl.mzstatic.com','avatars.yandex.net','avatars.mds.yandex.net','resources.tidal.com']);
const MAX_BYTES=4*1024*1024,TTL=30*86400000,MAX_CACHE_FILES=6000;
export class ArtworkError extends Error {constructor(public status:number,message:string){super(message);}}
export function validateArtworkUrl(input:string):URL {
  let url:URL;
  try {url=new URL(input);}catch {throw new ArtworkError(400,'Invalid artwork URL');}
  if(input.length>2048||url.protocol!=='https:'||url.username||url.password||url.port||!ARTWORK_HOSTS.has(url.hostname))throw new ArtworkError(400,'Unsupported artwork host');
  return url;
}
export async function fetchArtwork(input:string, fetcher:typeof fetch=fetch):Promise<{data:Buffer;type:string}> {
  let url=validateArtworkUrl(input);
  const signal=AbortSignal.timeout(12000);
  for(let redirects=0;redirects<4;redirects++){
    const response=await fetcher(url,{redirect:'manual',signal,headers:{Accept:'image/avif,image/webp,image/*','User-Agent':'Oskolok-Artwork/1.0'}});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(!location)throw new ArtworkError(502,'Missing artwork redirect');
      url=validateArtworkUrl(new URL(location,url).href);continue;
    }
    const type=(response.headers.get('content-type')||'').split(';')[0].trim();
    if(!response.ok||!/^image\/(jpeg|png|webp|avif|gif)$/.test(type)||Number(response.headers.get('content-length')||0)>MAX_BYTES){await response.body?.cancel();throw new ArtworkError(502,'Invalid artwork response');}
    if(!response.body)throw new ArtworkError(502,'Missing artwork body');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
    try {while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>MAX_BYTES)throw new ArtworkError(502,'Artwork too large');chunks.push(part.value);}}
    finally {await reader.cancel();}
    if(!bytes)throw new ArtworkError(502,'Empty artwork');
    return {data:Buffer.concat(chunks),type};
  }
  throw new ArtworkError(502,'Too many artwork redirects');
}
const directory=path.resolve(process.env.ARTWORK_CACHE_DIR||'server/data/artwork_cache');
const pending=new Map<string,Promise<{data:Buffer;type:string}>>();
let pruning=false;
const MAX_FETCHES=12;let active=0;const waiting:Array<()=>void>=[];
const slot=()=>active<MAX_FETCHES?(active++,Promise.resolve()):new Promise<void>(resolve=>waiting.push(()=>{active++;resolve();}));
const release=()=>{active--;waiting.shift()?.();};
async function prune(){
  if(pruning)return;pruning=true;
  try{
    const names=(await readdir(directory)).filter(name=>name.endsWith('.json'));
    if(names.length<=MAX_CACHE_FILES)return;
    const entries=await Promise.all(names.map(async name=>({name,time:(await stat(path.join(directory,name))).mtimeMs})));
    entries.sort((a,b)=>b.time-a.time);
    await Promise.all(entries.slice(MAX_CACHE_FILES).flatMap(entry=>[entry.name,entry.name.replace(/\.json$/,'.bin')].map(name=>unlink(path.join(directory,name)).catch(()=>{}))));
  }catch{/* Cache failure must not affect playback. */}finally{pruning=false;}
}
export async function cachedArtwork(input:string){
  const url=validateArtworkUrl(input).href,key=createHash('sha256').update(url).digest('hex');
  try{
    const meta=JSON.parse(await readFile(path.join(directory,key+'.json'),'utf8'));
    if(meta.time>Date.now()-TTL){const data=await readFile(path.join(directory,key+'.bin'));if(data.length&&data.length<=MAX_BYTES)return {data,type:meta.type as string};}
  }catch{/* First request or evicted entry. */}
  const existing=pending.get(key);if(existing)return existing;
  // A fast scroll asks for dozens of covers at once: they wait their turn instead of failing with 503 (which left blank tiles).
  if(waiting.length>=400)throw new ArtworkError(503,'Artwork temporarily busy');
  const job=(async()=>{
    await slot();
    let result:{data:Buffer;type:string};
    try{result=await fetchArtwork(url);}finally{release();}
    try{
      await mkdir(directory,{recursive:true});
      await writeFile(path.join(directory,key+'.tmp'),result.data);
      await rename(path.join(directory,key+'.tmp'),path.join(directory,key+'.bin'));
      await writeFile(path.join(directory,key+'.json'),JSON.stringify({time:Date.now(),type:result.type}));
      void prune();
    }catch{/* Still serve the fetched cover when the cache is unavailable. */}
    return result;
  })();
  pending.set(key,job);
  try{return await job;}finally{pending.delete(key);}
}
