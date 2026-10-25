import {spawn} from 'node:child_process';
import {prisma} from '../database/client.js';
import {ffmpegBinary} from './audioFileCache.js';

/**
 * Beat analysis for «ИИ-микс» (Spotify Playlist Mixing, done in Осколок for any queue): tempo, beat grid,
 * downbeats, where the intro ends and the outro starts, and energy per bar. Spotify computes this on its
 * backend and stores a recipe per track pair; here the server reads the cached audio once per track.
 */
export interface MixAnalysis{v:1;duration:number;bpm:number;beat:number;firstBeat:number;downbeat:number;confidence:number;introEnd:number;outroStart:number;energy:number[]}

export const MIX_SAMPLE_RATE=11025;
const HOP=256;
const fps=MIX_SAMPLE_RATE/HOP;

/** Onset strength: the rise of frame energy (log RMS), the part a drum hit or a new note adds. */
function onsetEnvelope(samples:Float32Array){
 const frames=Math.floor(samples.length/HOP),rms=new Float32Array(frames),onset=new Float32Array(frames);
 for(let f=0;f<frames;f++){let sum=0;for(let i=f*HOP,end=i+HOP;i<end;i++)sum+=samples[i]*samples[i];rms[f]=Math.sqrt(sum/HOP);}
 for(let f=1;f<frames;f++){const d=Math.log1p(100*rms[f])-Math.log1p(100*rms[f-1]);onset[f]=d>0?d:0;}
 return {rms,onset};
}

/** Tempo by autocorrelation of the onset envelope (60–190 BPM), weighted toward ~120 as people tap it. */
function tempo(onset:Float32Array){
 const minLag=Math.floor(fps*60/190),maxLag=Math.ceil(fps*60/60);let best=0,bestLag=0,total=0;
 for(let i=0;i<onset.length;i++)total+=onset[i]*onset[i];
 const at=(lag:number)=>{let s=0;for(let i=lag;i<onset.length;i++)s+=onset[i]*onset[i-lag];return s;};
 for(let lag=minLag;lag<=maxLag;lag++){
  const bpm=60*fps/lag,weight=Math.exp(-.5*(Math.log2(bpm/120)/.9)**2),score=at(lag)*weight;
  if(score>best){best=score;bestLag=lag;}
 }
 // Refine the lag between frames with a parabola through the neighbours.
 const y0=at(bestLag-1),y1=at(bestLag),y2=at(bestLag+1),shift=(y0-y2)/(2*(y0-2*y1+y2)||1);
 const lag=bestLag+(Number.isFinite(shift)&&Math.abs(shift)<1?shift:0);
 return {lag,confidence:total?Math.min(1,y1/total):0};
}

export function analyzeMix(samples:Float32Array):MixAnalysis{
 const duration=samples.length/MIX_SAMPLE_RATE,{rms,onset}=onsetEnvelope(samples);
 const coarse=tempo(onset),confidence=coarse.confidence;
 // Period and phase together: the grid (±2 % around the coarse tempo) that lands on the most onset energy
 // over the whole song. A frame-quantised period drifts by half a beat within a few minutes.
 const value=(x:number)=>{const i=Math.floor(x),k=x-i;return (onset[i]||0)*(1-k)+(onset[i+1]||0)*k;};
 let lag=coarse.lag,bestPhase=0,bestScore=-1;
 for(let l=coarse.lag*.98;l<=coarse.lag*1.02;l+=.02)for(let p=0;p<l;p+=.5){let s=0;for(let t=p;t<onset.length;t+=l)s+=value(t);if(s>bestScore){bestScore=s;bestPhase=p;lag=l;}}
 const beat=lag/fps,firstBeat=bestPhase/fps;
 // Downbeat (4/4): of the four beat positions, the one that starts the loudest bars.
 let downbeat=firstBeat,loudest=-1;
 for(let k=0;k<4;k++){let s=0;for(let t=firstBeat+k*beat;t<duration;t+=4*beat){const f=Math.round(t*fps);s+=(rms[f]||0)+(onset[f]||0);}if(s>loudest){loudest=s;downbeat=firstBeat+k*beat;}}
 // Energy per bar, normalised to the loudest bar.
 const bar=4*beat,energy:number[]=[];
 for(let t=downbeat;t+bar<=duration+1e-6;t+=bar){let s=0,n=0;for(let f=Math.round(t*fps),end=Math.round((t+bar)*fps);f<end&&f<rms.length;f++){s+=rms[f];n++;}energy.push(n?s/n:0);}
 const peak=Math.max(1e-9,...energy),norm=energy.map(e=>Math.round(e/peak*1000)/1000);
 const sorted=[...norm].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]||0,loud=median*.7;
 const first=norm.findIndex(e=>e>=loud),last=norm.length-1-[...norm].reverse().findIndex(e=>e>=loud);
 const bpm=Math.round(6000/beat)/100;
 return {v:1,duration:Math.round(duration*1000)/1000,bpm,beat:Math.round(beat*10000)/10000,firstBeat:Math.round(firstBeat*1000)/1000,downbeat:Math.round(downbeat*1000)/1000,confidence:Math.round(confidence*1000)/1000,
  introEnd:Math.round((downbeat+Math.max(0,first)*bar)*1000)/1000,outroStart:Math.round((downbeat+(last>=0?last+1:norm.length)*bar)*1000)/1000,energy:norm};
}

/** Decodes a cached audio file to mono 11 kHz float PCM; long uploads are cut at 12 minutes. */
function decode(file:string):Promise<Float32Array>{
 return new Promise((resolve,reject)=>{
  const child=spawn(ffmpegBinary(),['-hide_banner','-loglevel','error','-nostdin','-i',file,'-t','720','-ac','1','-ar',String(MIX_SAMPLE_RATE),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','pipe']});
  const chunks:Buffer[]=[];let err='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>{err+=c;});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error(`ffmpeg decode failed (${code}): ${err.trim().slice(0,200)}`));return;}const b=Buffer.concat(chunks);resolve(new Float32Array(b.buffer,b.byteOffset,Math.floor(b.length/4)));});
 });
}

const key=(trackId:string)=>`mix:v1:${trackId}`;
const running=new Map<string,Promise<MixAnalysis>>();
/** Stored analysis, or one computed from the cached audio file (null while the audio is not cached yet). */
export async function mixAnalysisFor(trackId:string,audioFile:()=>string|null):Promise<MixAnalysis|null>{
 const stored=await prisma.artistEnrichment.findUnique({where:{id:key(trackId)}});
 if(stored)return JSON.parse(stored.data) as MixAnalysis;
 const file=audioFile();if(!file)return null;
 let job=running.get(trackId);
 if(!job){
  job=decode(file).then(analyzeMix).then(async result=>{await prisma.artistEnrichment.upsert({where:{id:key(trackId)},create:{id:key(trackId),data:JSON.stringify(result)},update:{data:JSON.stringify(result)}});return result;}).finally(()=>running.delete(trackId));
  running.set(trackId,job);
 }
 return job;
}

/** «ИИ-микс» warm-up for a queued track: download its audio (shared with playback, so it is not fetched twice)
 * and analyse it minutes before the transition needs it. At most two at a time; failures stay quiet. */
let warming=0;
export function warmMixAnalysis(trackId:string,audioFile:()=>string|null,download:()=>Promise<unknown>):void{
 if(running.has(trackId)||warming>=2)return;
 warming++;
 void prisma.artistEnrichment.findUnique({where:{id:key(trackId)}})
  .then(async stored=>{if(stored)return;if(!audioFile())await download();await mixAnalysisFor(trackId,audioFile);})
  .catch(()=>{})
  .finally(()=>{warming--;});
}
