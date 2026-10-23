import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
const run=promisify(execFile);
const directory=path.resolve(process.env.LOUDNESS_CACHE_DIR||'server/data/audio_loudness');
type Loudness={gainDb:number;lufs:number;truePeak:number};
export function loudnessGain(lufs:number,truePeak:number,target=-14):number {
  if(!Number.isFinite(lufs)||!Number.isFinite(truePeak)||lufs<-70||lufs>5)return -6;
  // Attenuate loud masters; never boost quiet recordings or their noise floor.
  return Math.max(-24,Math.min(0,target-lufs,-1-truePeak));
}
export function parseLoudness(stderr:string):Loudness {
  const json=stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if(!json)throw new Error('Missing loudness measurement');
  const measurement=JSON.parse(json),lufs=Number(measurement.input_i),truePeak=Number(measurement.input_tp);
  if(!Number.isFinite(lufs)||!Number.isFinite(truePeak))throw new Error('Invalid loudness measurement');
  return {lufs,truePeak,gainDb:loudnessGain(lufs,truePeak)};
}
const pending=new Map<string,Promise<void>>(),retryAt=new Map<string,number>();
let queue=Promise.resolve();
export async function cachedLoudness(file:string):Promise<Loudness|null> {
  file=await realpath(file);
  const information=await stat(file);
  const key=createHash('sha256').update(`${file}:${information.size}:${information.mtimeMs}:v1`).digest('hex');
  const destination=path.join(directory,key+'.json');
  try {const value=JSON.parse(await readFile(destination,'utf8'));if(Number.isFinite(value.gainDb)&&Number.isFinite(value.lufs)&&Number.isFinite(value.truePeak))return value;}catch{}
  if(!pending.has(key)&&pending.size<16&&(retryAt.get(key)||0)<Date.now()) {
    const task=queue.catch(()=>{}).then(async()=>{
      try {
        const result=await run(process.env.FFMPEG_PATH||'ffmpeg',['-nostdin','-hide_banner','-nostats','-threads','1','-filter_threads','1','-i',file,'-af','loudnorm=I=-14:TP=-1:LRA=11:print_format=json','-f','null','-'],{timeout:30000,maxBuffer:128*1024});
        const measurement=parseLoudness(result.stderr);
        await mkdir(directory,{recursive:true});await writeFile(destination+'.tmp',JSON.stringify(measurement));await rename(destination+'.tmp',destination);
      }catch{retryAt.set(key,Date.now()+60000);}finally{pending.delete(key);if(retryAt.size>500)retryAt.delete(retryAt.keys().next().value!);}
    });
    pending.set(key,task);queue=task;
  }
  return null;
}
