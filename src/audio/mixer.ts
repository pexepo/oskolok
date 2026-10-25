import {apiClient} from '../api/apiClient.js';
import {curveAt,type Curve,type MixAnalysis,type MixPlan,type TrackCurves} from './mixPlanner.js';

/** Per-track effect chain of «ИИ-микс»: bass shelf → high-pass → low-pass → (track gain), plus an echo send
 * that bypasses the track gain so a cut track can still ring out. Neutral settings leave the sound untouched. */
export interface MixChain{bass:BiquadFilterNode;highpass:BiquadFilterNode;lowpass:BiquadFilterNode;echo:GainNode;delay:DelayNode;reverb:GainNode}

export function buildMixChain(ctx:AudioContext,source:AudioNode,trackGain:GainNode,bus:AudioNode,reverbIn:AudioNode):MixChain{
  const bass=ctx.createBiquadFilter();bass.type='lowshelf';bass.frequency.value=180;bass.gain.value=0;
  const highpass=ctx.createBiquadFilter();highpass.type='highpass';highpass.frequency.value=20;highpass.Q.value=.7;
  const lowpass=ctx.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=20000;lowpass.Q.value=.7;
  source.connect(bass);bass.connect(highpass);highpass.connect(lowpass);lowpass.connect(trackGain);
  const echo=ctx.createGain();echo.gain.value=0;
  const delay=ctx.createDelay(4);delay.delayTime.value=.375;
  const feedback=ctx.createGain();feedback.gain.value=.45;
  lowpass.connect(echo);echo.connect(delay);delay.connect(feedback);feedback.connect(delay);delay.connect(bus);
  // Reverb send, also past the track gain: a faded track can still wash out into the room.
  const reverb=ctx.createGain();reverb.gain.value=0;lowpass.connect(reverb);reverb.connect(reverbIn);
  return {bass,highpass,lowpass,echo,delay,reverb};
}

const NEUTRAL:Record<keyof Omit<TrackCurves,'gain'>,number>={bass:0,highpass:20,lowpass:20000,echo:0,reverb:0};
const param=(chain:MixChain,name:keyof typeof NEUTRAL)=>name==='bass'?chain.bass.gain:name==='highpass'?chain.highpass.frequency:name==='lowpass'?chain.lowpass.frequency:name==='reverb'?chain.reverb.gain:chain.echo.gain;

/** Writes a curve from progress p0 onwards as AudioParam automation over `seconds` of real time. */
function schedule(target:AudioParam,curve:Curve,p0:number,start:number,seconds:number,exponential=false){
  target.cancelScheduledValues(start);
  target.setValueAtTime(curveAt(curve,p0),start);
  for(const [t,v] of curve)if(t>p0){const at=start+(t-p0)*seconds;if(exponential)target.exponentialRampToValueAtTime(Math.max(20,v),at);else target.linearRampToValueAtTime(v,at);}
}

/** Runs a planned transition: A on `out`, B on `incoming`, starting `p0` of the way through. */
export function runMix(ctx:AudioContext,plan:MixPlan,p0:number,out:{chain:MixChain;gain:GainNode},incoming:{chain:MixChain;gain:GainNode},beat:number){
  const start=ctx.currentTime,seconds=plan.duration*(1-p0)>0?plan.duration:0;
  for(const [side,curves] of [[out,plan.a],[incoming,plan.b]] as const){
    schedule(side.gain.gain,curves.gain,p0,start,seconds);
    for(const name of Object.keys(NEUTRAL) as Array<keyof typeof NEUTRAL>)schedule(param(side.chain,name),curves[name],p0,start,seconds,name==='highpass'||name==='lowpass');
  }
  // Echo repeats on the dotted eighth of A's beat, the classic DJ echo-out.
  out.chain.delay.delayTime.setValueAtTime(Math.min(3.9,Math.max(.1,beat*.75)),start);
}

/** Back to a clean signal path (cancelled mix, or the incoming track once the mix is over). */
export function resetChain(ctx:AudioContext,chain:MixChain,seconds=.05){
  const now=ctx.currentTime;
  for(const name of Object.keys(NEUTRAL) as Array<keyof typeof NEUTRAL>){const p=param(chain,name);p.cancelScheduledValues(now);p.setTargetAtTime(NEUTRAL[name],now,seconds);}
}

/** Beat analyses by track id: fetched once, retried while the server is still caching the audio. */
const analyses=new Map<string,MixAnalysis|null>(),asked=new Map<string,number>();
export function mixAnalysis(trackId:string):MixAnalysis|null|undefined{
  const known=analyses.get(trackId);
  if(known)return known;
  const last=asked.get(trackId)||0;
  if(Date.now()-last>15000){
    asked.set(trackId,Date.now());
    void apiClient.request<{status:string}&Partial<MixAnalysis>>(`/tracks/${encodeURIComponent(trackId)}/mix-analysis`)
      .then(data=>{if(data.status==='ready'&&data.bpm)analyses.set(trackId,data as MixAnalysis);})
      .catch(()=>{analyses.set(trackId,null);});
  }
  return known;
}
