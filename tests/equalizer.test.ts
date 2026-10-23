import {describe,it,expect} from 'vitest';
import {normalizeEqualizer,EQ_FREQUENCIES,EQ_PRESETS} from '../src/audio/equalizer.js';
describe('equalizer settings migration',()=>{
 it('interpolates the six saved bands onto ten frequencies without dropping the high end',()=>{
  const next=normalizeEqualizer([6,4,2,0,-2,-4]);
  expect(next).toHaveLength(10);expect(next[0]).toBe(6);expect(next[9]).toBe(-4);expect(next[5]).toBe(0);
 });
 it('clamps corrupt values and preserves valid new settings',()=>{
  expect(normalizeEqualizer([99,NaN,-99])).toEqual([12,0,-12,0,0,0,0,0,0,0]);
  for(const preset of Object.values(EQ_PRESETS)){expect(preset).toHaveLength(EQ_FREQUENCIES.length);expect(normalizeEqualizer(preset)).toEqual(preset);}
 });
});
