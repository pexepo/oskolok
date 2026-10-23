import {expect,it} from 'vitest';
import {loudnessGain,parseLoudness} from '../server/src/services/LoudnessService.js';
import {elementVolume,normalizationGain,outputVolume} from '../src/audio/loudness.js';
it('attenuates loud masters, preserves quiet tracks and respects true-peak headroom',()=>{
 expect(loudnessGain(-8,-.2)).toBe(-6);expect(loudnessGain(-19,-3)).toBe(0);expect(loudnessGain(-14,1)).toBe(-2);
 expect(loudnessGain(NaN,-1)).toBe(-6);
});
it('reads FFmpeg measurements and rejects malformed/silent analysis',()=>{
 expect(parseLoudness('log\n{"input_i":"-9.0","input_tp":"-0.2"}')).toEqual({lufs:-9,truePeak:-.2,gainDb:-5});
 expect(()=>parseLoudness('{}')).toThrow();expect(()=>parseLoudness('{"input_i":"-inf","input_tp":"-inf"}')).toThrow();
});
it('avoids amplification and reserves headroom for boosted EQ bands',()=>{
 expect(normalizationGain(-6,true,[0,0])).toBeCloseTo(.501187);
 expect(normalizationGain(-6,true,[5,0])).toBeCloseTo(.281838);
 expect(outputVolume(1)).toBe(.7);expect(outputVolume(.5)).toBeCloseTo(.175);expect(outputVolume(-1)).toBe(0);
});
it('plays at full element volume on touch-only devices, where hardware buttons set the level',()=>{
 expect(elementVolume(.6,true)).toBe(1);expect(elementVolume(1,false)).toBe(.7);
});
