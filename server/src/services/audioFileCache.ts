import fs from 'node:fs';
import {open,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export class AudioFileError extends Error {}
export type CachedAudio={path:string;size:number;extension:string;mime:string};
const MAX_CACHE_BYTES=512*1024*1024;
const YOUTUBE_CHUNK_BYTES=1024*1024;
const USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const incomplete=()=>new AudioFileError('Источник аудио не отдал полный файл. Попробуйте позже.');

function youtubeAudio(url:string):boolean {
  try {const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname.endsWith('.googlevideo.com');}
  catch{return false;}
}

/** Only completed MP3/MP4 files may be exported or reused as local streams. */
export function completedAudioFile(file:string,maxBytes=MAX_CACHE_BYTES):CachedAudio|null {
  try {
    const stat=fs.statSync(file);
    // A complete short/low-bitrate song can be well below 500 KB. Full-response
    // and format checks decide validity; file size is not a preview detector.
    if(!stat.isFile()||stat.size<8192||stat.size>maxBytes)return null;
    const header=Buffer.alloc(16),fd=fs.openSync(file,'r');
    try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}
    if(header.toString('ascii',4,8)==='ftyp')return {path:file,size:stat.size,extension:'m4a',mime:'audio/mp4'};
    if(header.toString('ascii',0,3)==='ID3'||(header[0]===255&&(header[1]&224)===224&&(header[1]&6)!==0))return {path:file,size:stat.size,extension:'mp3',mime:'audio/mpeg'};
  }catch{/* A cache miss or a file being removed is harmless. */}
  return null;
}

/** One atomic file, with backpressure and a deadline covering the entire body. */
export async function downloadAudioFile(url:string,file:string,timeoutMs=60000):Promise<CachedAudio> {
  const existing=completedAudioFile(file);if(existing)return existing;
  const temporary=`${file}.${randomUUID()}.tmp`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new AudioFileError('Загрузка аудио заняла слишком долго. Попробуйте позже.')),{once:true}));
  const bounded=<T>(operation:Promise<T>)=>Promise.race([operation,expired]);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
    const output=await open(temporary,'wx');
    let size=0,total:number|undefined;
    const chunked=youtubeAudio(url);
    try {
      for(;;){
        // YouTube throttles an unbounded GET to approximately playback speed.
        // Fetch finite ranges, as yt-dlp's HTTP downloader does, and publish
        // only after all contiguous bytes of the declared file have arrived.
        const end=size+YOUTUBE_CHUNK_BYTES-1;
        const headers:Record<string,string>={'User-Agent':USER_AGENT};
        if(chunked){headers.Range=`bytes=${size}-${end}`;headers['Accept-Encoding']='identity';}
        const response=await bounded(fetch(url,{headers,signal:controller.signal}));
        if(!response.body)throw incomplete();
        reader=response.body.getReader();
        const length=Number(response.headers.get('content-length'));
        let expected:number|undefined;
        if(chunked&&response.status===206){
          const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
          if(!match||response.headers.get('content-encoding'))throw incomplete();
          const start=Number(match[1]),last=Number(match[2]),declared=Number(match[3]);
          if(![start,last,declared].every(Number.isSafeInteger)||start!==size||last<start||last>end||last>=declared||total!==undefined&&declared!==total)throw incomplete();
          total=declared;expected=last-start+1;
          if(length>0&&length!==expected)throw incomplete();
        }else if(response.status===200&&size===0){
          // A server may ignore Range and return the whole file instead.
          if(length>0&&!response.headers.get('content-encoding'))expected=length;
        }else throw incomplete();
        if((total??length)>MAX_CACHE_BYTES)throw new AudioFileError('Аудиофайл слишком большой для загрузки.');
        let received=0;
        for(;;){
          const {done,value}=await bounded(reader.read());if(done)break;
          size+=value.byteLength;received+=value.byteLength;
          if(size>MAX_CACHE_BYTES)throw new AudioFileError('Аудиофайл слишком большой для загрузки.');
          if(expected!==undefined&&received>expected)throw incomplete();
          await output.writeFile(value);
        }
        reader.releaseLock();reader=undefined;
        if(expected!==undefined&&received!==expected)throw new AudioFileError('Загрузка аудио прервалась. Попробуйте ещё раз.');
        if(total===undefined||size===total)break;
      }
    }finally{await output.close();}
    const audio=completedAudioFile(temporary);
    if(!audio)throw new AudioFileError('Источник не предоставил полный MP3 или M4A для Telegram.');
    await rename(temporary,file);
    return {...audio,path:file};
  }catch(error){
    if(controller.signal.aborted)throw new AudioFileError('Загрузка аудио заняла слишком долго. Попробуйте позже.');
    throw error;
  }finally{
    clearTimeout(timer);
    // Cancellation can itself wait for a broken upstream. It must never keep
    // the HTTP request or the shared in-flight download locked indefinitely.
    if(reader){controller.abort();void reader.cancel().catch(()=>{});}
    await rm(temporary,{force:true});
  }
}

/** A bounded wait also releases its timer when an operation completes early. */
export async function audioDeadline<T>(operation:Promise<T>,ms:number,message:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AudioFileError(message)),ms);})]);}
  finally{clearTimeout(timer);}
}

/** ffmpeg binary: FFMPEG_PATH may name the program itself or the folder holding it. */
export function ffmpegBinary():string {
  const configured=process.env.FFMPEG_PATH;
  try{if(configured&&fs.statSync(configured).isDirectory())return `${configured.replace(/[\\/]+$/,'')}/ffmpeg`;}catch{/* Not a folder. */}
  return configured||'ffmpeg';
}

/** SoundCloud serves HLS only: its segments are copied (not re-encoded) into one seekable .m4a, written atomically. */
export async function remuxHlsToFile(url:string,file:string,timeoutMs=60000):Promise<CachedAudio> {
  const existing=completedAudioFile(file);if(existing)return existing;
  const temporary=`${file}.${randomUUID()}.tmp`;
  const {spawn}=await import('node:child_process');
  try{
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(ffmpegBinary(),['-hide_banner','-loglevel','error','-nostdin','-user_agent',USER_AGENT,'-i',url,'-vn','-c','copy','-movflags','+faststart','-f','mp4',temporary],{stdio:['ignore','ignore','pipe']});
      let stderr='';
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new AudioFileError('Загрузка аудио заняла слишком долго. Попробуйте позже.'));},timeoutMs);
      child.stderr?.on('data',chunk=>{if(stderr.length<2000)stderr+=String(chunk);});
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new AudioFileError(`ffmpeg HLS remux failed (${code}): ${stderr.trim().slice(0,300)}`));});
    });
    const audio=completedAudioFile(temporary);
    if(!audio)throw incomplete();
    await rename(temporary,file);
    return {...audio,path:file};
  }finally{await rm(temporary,{force:true});}
}
