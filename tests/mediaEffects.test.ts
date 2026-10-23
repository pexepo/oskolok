import {expect,it} from 'vitest';
import {normalizeEffects,SPEED_PRESETS,pitchRatio} from '../src/audio/mediaEffects.js';
it('accepts every speed preset and keeps values inside what the media element plays',()=>{
  for(const speed of SPEED_PRESETS)expect(normalizeEffects({speed}).speed).toBe(speed);
  expect(normalizeEffects({speed:3}).speed).toBe(2);
  expect(normalizeEffects({speed:0.1}).speed).toBe(.5);
  expect(normalizeEffects({}).preservePitch).toBe(true);
  expect(pitchRatio(12)).toBe(2);
});
