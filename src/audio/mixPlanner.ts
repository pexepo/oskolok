/**
 * «ИИ-микс»: how one track hands over to the next, chosen from both tracks' beat analysis.
 * Modelled on Spotify Playlist Mixing (a transition = volume curve + EQ swap + filter/echo/reverb effects,
 * measured in bars, optionally beatmatched), but planned automatically for every pair in any queue and
 * tuned by the listener: style, length, beatmatching, and how much echo, reverb and muffling it uses.
 * Pure: the mixer in AudioManager turns a plan into Web Audio automation.
 */
export interface MixAnalysis{duration:number;bpm:number;beat:number;firstBeat:number;downbeat:number;confidence:number;introEnd:number;outroStart:number;energy:number[]}
export type MixPreset='bass-swap'|'filter'|'echo'|'dissolve'|'afterglow'|'rise'|'blend';
/** Automation over the transition: [progress 0..1, value]. gain 0..1, bass in dB, filters in Hz, echo/reverb sends 0..1. */
export type Curve=Array<[number,number]>;
export interface TrackCurves{gain:Curve;bass:Curve;highpass:Curve;lowpass:Curve;echo:Curve;reverb:Curve}
export interface MixPlan{preset:MixPreset;beatmatched:boolean;rate:number;at:number;duration:number;bStart:number;bars:number;a:TrackCurves;b:TrackCurves}
/** The listener's mix settings. Effect amounts are 0..1; 0.5 is the preset as designed. */
export interface MixSettings{style:'auto'|MixPreset;bars:'auto'|2|4|8|16;beatmatch:boolean;echo:number;reverb:number;muffle:number}
export const DEFAULT_MIX_SETTINGS:MixSettings={style:'auto',bars:'auto',beatmatch:true,echo:.5,reverb:.5,muffle:.5};

const MAX_RATE_SHIFT=.06,CONFIDENT=.15;
const flat=(gain:Curve):TrackCurves=>({gain,bass:[[0,0]],highpass:[[0,20]],lowpass:[[0,20000]],echo:[[0,0]],reverb:[[0,0]]});
const mean=(xs:number[])=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:0;

/** Spotify's preset ideas, as curves. A is the outgoing track, B the incoming one. */
export const PRESETS:Record<MixPreset,{a:TrackCurves;b:TrackCurves}>={
  // Blend / BassSwap: both play full range, the basses swap on the middle downbeat so they never stack.
  'bass-swap':{a:{...flat([[0,1],[.75,1],[1,0]]),bass:[[0,0],[.49,0],[.51,-26]]},b:{...flat([[0,0],[.25,1],[1,1]]),bass:[[0,-26],[.49,-26],[.51,0]]}},
  // Melt / FilterFadeInOut: A thins out through a rising high-pass, B opens up from a low-pass.
  filter:{a:{...flat([[0,1],[.5,1],[1,0]]),highpass:[[0,20],[1,1400]]},b:{...flat([[0,0],[.5,1],[1,1]]),lowpass:[[0,350],[.8,20000],[1,20000]]}},
  // Slam / EchoCut: A is cut on the beat; the echo send closes with it, so only the tail rings on under B.
  echo:{a:{...flat([[0,1],[.5,1],[.52,0],[1,0]]),echo:[[0,0],[.45,.85],[.52,.85],[.54,0]]},b:flat([[0,0],[.5,0],[.52,1],[1,1]])},
  // Dissolve: A washes out into reverb and muffles, B surfaces from under it.
  dissolve:{a:{...flat([[0,1],[.6,.6],[1,0]]),lowpass:[[0,20000],[1,2600]],reverb:[[0,0],[.45,.85],[.85,.85],[1,0]]},b:{...flat([[0,0],[.35,.3],[1,1]]),lowpass:[[0,700],[.7,20000],[1,20000]]}},
  // Afterglow / ReverbOutEnd: a quiet ending glows on in echo and reverb while B rises gently.
  afterglow:{a:{...flat([[0,1],[.2,.9],[1,0]]),lowpass:[[0,20000],[1,1800]],echo:[[0,0],[.3,.6],[.8,.6],[1,0]],reverb:[[0,0],[.4,.5],[.85,.5],[1,0]]},b:flat([[0,0],[.4,0],[1,1]])},
  // Rise / RiserCut: A climbs through a high-pass sweep and B lands on the cut.
  rise:{a:{...flat([[0,1],[.95,1],[.97,0]]),highpass:[[0,20],[.95,2600]]},b:flat([[0,0],[.95,0],[.97,1],[1,1]])},
  // Fade: equal-power crossfade when nothing is known about the tracks.
  blend:{a:flat([[0,1],[.25,.92],[.5,.71],[.75,.38],[1,0]]),b:flat([[0,0],[.25,.38],[.5,.71],[.75,.92],[1,1]])},
};

/** A light tail every style gets when the listener turns reverb up (presets with their own reverb keep it). */
const REVERB_TAIL:Curve=[[0,0],[.55,.3],[.9,.3],[1,0]];
const scale=(curve:Curve,k:number):Curve=>curve.map(([t,v])=>[t,Math.min(1,v*k)]);
/** Filter sweeps reach further or stop shorter on a log scale; muffle 0.5 keeps the preset's sweep. */
const sweep=(curve:Curve,from:number,k:number):Curve=>curve.map(([t,v])=>[t,Math.min(20000,Math.max(20,from*(v/from)**k))]);

/** Applies the listener's effect amounts to a preset's curves. */
export function shapeCurves(preset:MixPreset,settings:MixSettings):{a:TrackCurves;b:TrackCurves}{
  const base=PRESETS[preset],e=settings.echo*2,r=settings.reverb*2,m=settings.muffle*2;
  const hasOwnReverb=base.a.reverb.some(([,v])=>v>0),hasOwnLowpass=base.a.lowpass.some(([,v])=>v<20000);
  const shape=(c:TrackCurves,outgoing:boolean):TrackCurves=>({
    ...c,
    echo:scale(c.echo,e),
    reverb:outgoing?scale(hasOwnReverb?c.reverb:REVERB_TAIL,hasOwnReverb?r:Math.max(0,r-1)):c.reverb,
    highpass:sweep(c.highpass,20,m),
    // «Заглушение»: the outgoing track is muffled toward the end even in styles without their own low-pass.
    lowpass:outgoing&&!hasOwnLowpass&&preset!=='blend'?sweep([[0,20000],[.45,20000],[1,3000]],20000,Math.max(0,m-1)*2):sweep(c.lowpass,20000,m),
  });
  return {a:shape(base.a,true),b:shape(base.b,false)};
}

/** Playback rate for B that puts it on A's tempo (half/double time allowed), or null if the gap is too wide. */
export function matchRate(a:MixAnalysis,b:MixAnalysis):number|null{
  const rates=[1,2,.5].map(m=>a.bpm/(b.bpm*m)),rate=rates.sort((x,y)=>Math.abs(Math.log(x))-Math.abs(Math.log(y)))[0];
  return Math.abs(rate-1)<=MAX_RATE_SHIFT?rate:null;
}

export function planMix(a:MixAnalysis|null,b:MixAnalysis|null,durationA:number,fallbackSeconds=6,settings:MixSettings=DEFAULT_MIX_SETTINGS):MixPlan{
  const aOk=!!a&&a.confidence>=CONFIDENT&&a.beat>0,bOk=!!b&&b.confidence>=CONFIDENT&&b.beat>0;
  if(!aOk){
    const preset=settings.style==='auto'?'blend':settings.style;
    const duration=Math.max(2,Math.min(12,fallbackSeconds));
    const at=Math.max(durationA*.5,durationA-duration);
    return {preset,beatmatched:false,rate:1,at,duration:Math.min(duration,durationA-at),bStart:bOk?Math.max(0,b!.downbeat):0,bars:0,...shapeCurves(preset,settings)};
  }
  // Only A analysed (B's audio not ready yet): still a DJ transition on A's bar grid, just not beatmatched;
  // B is treated as a mid-energy intro starting from its beginning.
  const A=a!,B=bOk?b!:null,rate=B&&settings.beatmatch?matchRate(A,B):null,bar=4*A.beat;
  const lastBar=Math.max(0,Math.floor((A.outroStart-A.downbeat)/bar)-1),outroEnergy=mean(A.energy.slice(Math.max(0,lastBar-3),lastBar+1));
  const firstBar=B?Math.max(0,Math.round((B.introEnd-B.downbeat)/(4*B.beat))):0,introEnergy=B?mean(B.energy.slice(firstBar,firstBar+4)):.5;
  let preset:MixPreset,bars:number;
  if(rate!==null){preset=outroEnergy>.5&&introEnergy>.35?'bass-swap':'filter';bars=preset==='bass-swap'?8:4;}
  else if(outroEnergy<.35){preset='afterglow';bars=4;}
  else if(introEnergy>.6){preset='echo';bars=2;}
  else if(outroEnergy>.7){preset='rise';bars=4;}
  else{preset='dissolve';bars=4;}
  if(settings.style!=='auto')preset=settings.style;
  if(settings.bars!=='auto')bars=settings.bars;
  let duration=bars*bar;
  // A long transition never eats more than a third of a short song.
  while(duration>durationA/3&&bars>1){bars/=2;duration=bars*bar;}
  // Start so the transition is centred on A's outro, snapped down to A's bar grid, ending before A does.
  const latest=durationA-duration-.25,wanted=Math.min(latest,A.outroStart-duration/2);
  let at=A.downbeat+Math.floor((wanted-A.downbeat)/bar)*bar;
  if(at<durationA*.4)at=Math.max(durationA*.4,latest);
  // B starts so its intro ends as A leaves: the drop lands on the hand-over.
  const lead=B?Math.max(0,Math.round((B.introEnd-B.downbeat)/(4*B.beat))-bars):0;
  const bStart=B?Math.max(0,B.downbeat+lead*4*B.beat):0;
  return {preset,beatmatched:rate!==null,rate:rate??1,at,duration,bStart,bars,...shapeCurves(preset,settings)};
}

/** Value of a curve at progress t (linear between points, held outside them). */
export function curveAt(curve:Curve,t:number):number{
  if(t<=curve[0][0])return curve[0][1];
  for(let i=1;i<curve.length;i++)if(t<=curve[i][0]){const [t0,v0]=curve[i-1],[t1,v1]=curve[i];return t1===t0?v1:v0+(v1-v0)*(t-t0)/(t1-t0);}
  return curve[curve.length-1][1];
}
