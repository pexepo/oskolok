import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
vi.mock('../server/src/database/client.js',()=>({prisma:{}}));
vi.mock('../server/src/services/SoundCloudService.js',()=>({soundCloudService:{}}));
vi.mock('../server/src/services/StreamResolverService.js',()=>({streamResolverService:{}}));
vi.mock('../server/src/repositories/trackCacheRepository.js',()=>({trackCacheRepository:{}}));
import {downloadAudioFile,completedAudioFile,audioDeadline} from '../server/src/services/audioFileCache.js';
import {StudioMasterService} from '../server/src/services/StudioMasterService.js';

let dir:string,file:string;
const bytes=Buffer.alloc(600000);bytes.write('ID3');
const track={id:'spotify:test',title:'Song',artist:{name:'Artist'},duration:180} as any;
beforeEach(async()=>{dir=await mkdtemp(path.join(tmpdir(),'oskolok-cache-test-'));file=path.join(dir,'audio.m4a');});
afterEach(async()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();await rm(dir,{recursive:true,force:true});});
const service=()=>{vi.spyOn(StudioMasterService.prototype as any,'ensureWorker').mockImplementation(()=>{});const s=new StudioMasterService();(s as any).cacheDir=dir;return s;};
const resolved={streamUrl:'https://audio.test/song',audioSource:'soundcloud'};

describe('Telegram export audio cache',()=>{
 it('accepts a complete short audio file instead of rejecting everything below 500 KB',async()=>{
  const short=Buffer.alloc(100000);short.write('ID3');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(short,{headers:{'Content-Length':String(short.length)}})));
  expect(await downloadAudioFile('https://audio.test/short',file)).toMatchObject({extension:'mp3',size:100000});
  expect(completedAudioFile(file)).toMatchObject({size:100000});
 });
 it('shares the background download with concurrent exports and publishes only a completed file',async()=>{
  const s=service();let finish!:(value:Response)=>void;
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  vi.spyOn(s,'resolveStudioStream').mockImplementation(async()=>{(s as any).cacheStreamToDisk(track.id,resolved.streamUrl);return resolved as any;});
  const first=s.prepareExportAudio(track),second=s.prepareExportAudio(track);
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  expect(s.getExportAudio(track.id)).toBeNull();
  finish(new Response(bytes,{headers:{'Content-Length':String(bytes.length)}}));
  const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);expect(a.extension).toBe('mp3');
  expect(await readFile(a.path)).toEqual(bytes);expect((await readdir(dir)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
 });
 it('replaces an invalid old cache instead of waiting forever on it',async()=>{
  const s=service(),destination=(s as any).getDiskCachePath(track.id);
  await writeFile(destination,Buffer.alloc(600000));vi.spyOn(s,'resolveStudioStream').mockResolvedValue(resolved as any);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)));
  expect(await s.prepareExportAudio(track)).toMatchObject({extension:'mp3',size:600000});
 });
 it('reuses a valid local file without downloading again',async()=>{
  const s=service();await writeFile((s as any).getDiskCachePath(track.id),bytes);
  const resolver=vi.spyOn(s,'resolveStudioStream'),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(await s.prepareExportAudio(track)).toMatchObject({extension:'mp3'});expect(resolver).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('reports an upstream HTTP error immediately and allows a later retry',async()=>{
  const s=service();vi.spyOn(s,'resolveStudioStream').mockResolvedValue(resolved as any);
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('expired',{status:403})).mockResolvedValueOnce(new Response(bytes));vi.stubGlobal('fetch',fetcher);
  await expect(s.prepareExportAudio(track)).rejects.toThrow('не отдал полный файл');
  expect(await s.prepareExportAudio(track)).toMatchObject({extension:'mp3'});expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('rejects a truncated response and removes its temporary file',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{headers:{'Content-Length':'900000'}})));
  await expect(downloadAudioFile('https://audio.test/song',file)).rejects.toThrow('прервалась');
  expect(await readdir(dir)).toEqual([]);expect(completedAudioFile(file)).toBeNull();
 });
 it('never caches a partial HTTP 206 response as a complete track',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{status:206,headers:{'Content-Range':'bytes 0-599999/900000'}})));
  await expect(downloadAudioFile('https://audio.test/song',file)).rejects.toThrow('не отдал полный файл');expect(await readdir(dir)).toEqual([]);
 });
 it('rejects a large HTML response instead of exporting it as audio',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>'+'.'.repeat(600000))));
  await expect(downloadAudioFile('https://audio.test/song',file)).rejects.toThrow('MP3 или M4A');expect(await readdir(dir)).toEqual([]);
 });
 it('aborts a stalled download and releases the temporary path',async()=>{
  vi.stubGlobal('fetch',vi.fn((_url:any,{signal}:any)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));}))); 
  await expect(downloadAudioFile('https://audio.test/song',file,20)).rejects.toThrow('слишком долго');expect(await readdir(dir)).toEqual([]);
 });
 it('downloads YouTube audio in bounded ranges instead of a throttled full request',async()=>{
  const song=Buffer.alloc(2*1024*1024+8192);song.write('ID3');
  const fetcher=vi.fn(async(_url:string,{headers}:any)=>{
   const match=/^bytes=(\d+)-(\d+)$/.exec(headers.Range||'');
   if(!match)throw new Error('Unbounded YouTube downloads are throttled');
   const start=Number(match[1]),end=Math.min(Number(match[2]),song.length-1);
   return new Response(song.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${song.length}`,'Content-Length':String(end-start+1)}});
  });vi.stubGlobal('fetch',fetcher);
  const audio=await downloadAudioFile('https://rr1.googlevideo.com/videoplayback?token=synthetic',file);
  expect(await readFile(audio.path)).toEqual(song);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('rejects a gap or a changing total in a YouTube range without publishing partial audio',async()=>{
  const first=Buffer.alloc(1024*1024);first.write('ID3');
  for(const range of ['bytes 1048577-1048585/1048586','bytes 1048576-1048584/1048586']){
   vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(first,{status:206,headers:{'Content-Range':'bytes 0-1048575/1048585'}})).mockResolvedValueOnce(new Response(Buffer.alloc(9),{status:206,headers:{'Content-Range':range}})));
   await expect(downloadAudioFile('https://rr1.googlevideo.com/videoplayback',file)).rejects.toThrow('не отдал полный файл');
   expect(await readdir(dir)).toEqual([]);
  }
 });
 it('rejects a truncated YouTube range without publishing a header-valid partial file',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{status:206,headers:{'Content-Range':'bytes 0-1048575/2944401'}})));
  await expect(downloadAudioFile('https://rr1.googlevideo.com/videoplayback',file)).rejects.toThrow('прервалась');
  expect(await readdir(dir)).toEqual([]);
 });
 it('enforces its deadline even when an upstream body ignores abort',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes);}}))));
  await expect(audioDeadline(downloadAudioFile('https://audio.test/song',file,20),200,'download never settled')).rejects.toThrow('слишком долго');
  expect(await readdir(dir)).toEqual([]);
 });
 it('releases a failed export even when upstream cancellation never settles',async()=>{
  const reader={read:vi.fn().mockRejectedValue(new Error('upstream disconnected')),cancel:vi.fn(()=>new Promise(()=>{}))};
  vi.stubGlobal('fetch',vi.fn(async()=>({status:200,headers:new Headers(),body:{getReader:()=>reader}})));
  await expect(audioDeadline(downloadAudioFile('https://audio.test/song',file,20),200,'cancellation never settled')).rejects.toThrow('upstream disconnected');
  expect(await readdir(dir)).toEqual([]);
 });
 it('bounds a stalled resolver rather than polling a missing file indefinitely',async()=>{
  await expect(audioDeadline(new Promise(()=>{}),20,'deadline')).rejects.toThrow('deadline');
 });
});
