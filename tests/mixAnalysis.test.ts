import {describe,expect,it} from 'vitest';
import {analyzeMix,MIX_SAMPLE_RATE} from '../server/src/services/mixAnalysis.js';

/** A kick drum on every beat, louder on the bar's first beat, with a quiet intro and outro. */
function song({bpm,offset,seconds,quietIntro,quietOutro}:{bpm:number;offset:number;seconds:number;quietIntro:number;quietOutro:number}){
  const out=new Float32Array(Math.round(seconds*MIX_SAMPLE_RATE)),beat=60/bpm;
  for(let n=0,t=offset;t<seconds;n++,t+=beat){
    const level=(t<quietIntro||t>seconds-quietOutro?.15:1)*(n%4===0?1:.6),start=Math.round(t*MIX_SAMPLE_RATE);
    for(let i=0;i<MIX_SAMPLE_RATE*.12&&start+i<out.length;i++)out[start+i]+=level*Math.sin(2*Math.PI*60*i/MIX_SAMPLE_RATE)*Math.exp(-i/(MIX_SAMPLE_RATE*.03));
  }
  return out;
}

describe('mix analysis',()=>{
  it('finds tempo, beat grid, downbeat and the loud body of the song',()=>{
    const a=analyzeMix(song({bpm:128,offset:.31,seconds:90,quietIntro:15,quietOutro:15}))
    expect(a.bpm).toBeGreaterThan(126.5);expect(a.bpm).toBeLessThan(129.5);
    // The downbeat sits on the grid that started at 0.31 s, on a bar's first beat.
    const beats=(a.downbeat-.31)/(60/128);
    expect(Math.abs(beats-Math.round(beats))).toBeLessThan(.1);
    expect(Math.abs(Math.round(beats)%4)).toBe(0);
    expect(a.introEnd).toBeGreaterThan(12);expect(a.introEnd).toBeLessThan(19);
    expect(a.outroStart).toBeGreaterThan(71);expect(a.outroStart).toBeLessThan(79);
    expect(a.confidence).toBeGreaterThan(0);
  });
  it('reads a slower song as slower',()=>{
    const a=analyzeMix(song({bpm:92,offset:0,seconds:60,quietIntro:0,quietOutro:0}));
    expect(Math.abs(a.bpm-92)).toBeLessThan(1.5);
  });
});
