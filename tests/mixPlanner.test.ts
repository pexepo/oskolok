import {describe,expect,it} from 'vitest';
import {curveAt,DEFAULT_MIX_SETTINGS,matchRate,planMix,PRESETS,shapeCurves,type MixAnalysis} from '../src/audio/mixPlanner.js';

const track=(over:Partial<MixAnalysis>={}):MixAnalysis=>{const bpm=over.bpm??124,beat=60/bpm;return {duration:200,bpm,beat,firstBeat:.2,downbeat:.2,confidence:.6,introEnd:.2+8*4*beat,outroStart:180,energy:Array.from({length:100},()=>.8),...over};};

describe('AI mix planner',()=>{
  it('still plans a DJ transition on A\'s bar grid while B is not analysed yet',()=>{
    const a=track(),plan=planMix(a,null,200);
    expect(plan.preset).not.toBe('blend');
    expect(plan).toMatchObject({beatmatched:false,rate:1,bStart:0});
    const bars=(plan.at-a.downbeat)/(4*a.beat);
    expect(Math.abs(bars-Math.round(bars))).toBeLessThan(1e-6);
  });
  it('beatmatches close tempos, including half and double time',()=>{
    expect(matchRate(track({bpm:124}),track({bpm:126}))).toBeCloseTo(124/126,5);
    expect(matchRate(track({bpm:140}),track({bpm:71}))).toBeCloseTo(140/142,5);
    expect(matchRate(track({bpm:124}),track({bpm:100}))).toBeNull();
  });
  it('swaps the basses over 8 bars between two energetic tracks on A\'s bar grid',()=>{
    const a=track(),plan=planMix(a,track({bpm:126}),200);
    expect(plan).toMatchObject({preset:'bass-swap',beatmatched:true,bars:8});
    const bar=4*a.beat,bars=(plan.at-a.downbeat)/bar;
    expect(Math.abs(bars-Math.round(bars))).toBeLessThan(1e-6);
    expect(plan.at+plan.duration).toBeLessThan(200);
    // B's 8-bar intro is cued so its drop lands as A leaves.
    expect(plan.bStart).toBeCloseTo(.2,5);
  });
  it('lets a quiet ending glow out and cuts into a loud intro when tempos clash',()=>{
    const quiet=track({energy:Array.from({length:100},(_,i)=>i>80?.2:.8),outroStart:170});
    expect(planMix(quiet,track({bpm:90}),200).preset).toBe('afterglow');
    const loudIntro=track({bpm:90,energy:Array.from({length:100},()=>.9)});
    expect(planMix(track({energy:Array.from({length:100},()=>.6)}),loudIntro,200).preset).toBe('echo');
  });
  it('falls back to an equal-power fade without analysis',()=>{
    const plan=planMix(null,null,180,6);
    expect(plan).toMatchObject({preset:'blend',rate:1,at:174,duration:6});
    // Equal power: the summed power stays near 1 through the middle.
    const g=(t:number)=>curveAt(PRESETS.blend.a.gain,t)**2+curveAt(PRESETS.blend.b.gain,t)**2;
    expect(g(.5)).toBeGreaterThan(.95);expect(g(.5)).toBeLessThan(1.05);
  });
  it('never lets a transition take more than a third of a short song',()=>{
    const plan=planMix(track({duration:60,outroStart:56}),track({bpm:125}),60);
    expect(plan.duration).toBeLessThanOrEqual(20);
  });
  it('follows the listener: style, bars, no beatmatch, and effect amounts',()=>{
    const set=(over:object)=>({...DEFAULT_MIX_SETTINGS,...over});
    const plan=planMix(track(),track({bpm:126}),200,6,set({style:'dissolve',bars:16,beatmatch:false}));
    expect(plan).toMatchObject({preset:'dissolve',bars:16,beatmatched:false,rate:1});
    // Echo 0 silences the echo send; echo 1 doubles it (capped at 1).
    expect(Math.max(...shapeCurves('echo',set({echo:0})).a.echo.map(([,v])=>v))).toBe(0);
    expect(Math.max(...shapeCurves('echo',set({echo:1})).a.echo.map(([,v])=>v))).toBe(1);
    // Reverb up adds a tail even to styles without their own; at the default it stays off there.
    expect(Math.max(...shapeCurves('bass-swap',DEFAULT_MIX_SETTINGS).a.reverb.map(([,v])=>v))).toBe(0);
    expect(Math.max(...shapeCurves('bass-swap',set({reverb:1})).a.reverb.map(([,v])=>v))).toBeGreaterThan(.25);
    // Muffle: stronger muffling closes the outgoing low-pass further; none leaves it open.
    const end=(m:number)=>shapeCurves('bass-swap',set({muffle:m})).a.lowpass.at(-1)![1];
    expect(end(0)).toBe(20000);expect(end(1)).toBeLessThan(end(.75));
    expect(shapeCurves('filter',set({muffle:1})).a.highpass.at(-1)![1]).toBeGreaterThan(shapeCurves('filter',DEFAULT_MIX_SETTINGS).a.highpass.at(-1)![1]);
  });
});
