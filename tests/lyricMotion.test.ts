import {describe,it,expect} from 'vitest';
import {gradientStops,intervalProgress,letterMotion,lineBlur,splitGraphemes} from '../src/utils/lyricMotion.js';

describe('audio-derived karaoke motion',()=>{
  it('maps intervals exactly and rewinds without retained state',()=>{
    expect(intervalProgress(1,1,3)).toBe(0);
    expect(intervalProgress(2,1,3)).toBe(.5);
    expect(intervalProgress(3,1,3)).toBe(1);
    expect(intervalProgress(1.5,1,3)).toBe(.25);
    expect(intervalProgress(1,1,1)).toBe(1);
    expect(intervalProgress(.99,1,1)).toBe(0);
  });

  it('keeps the soft gradient outside the text at exact boundaries',()=>{
    expect(gradientStops(0)).toEqual({start:-20,end:0});
    expect(gradientStops(.5)).toEqual({start:40,end:60});
    expect(gradientStops(1)).toEqual({start:100,end:120});
  });

  it('returns every letter to rest after its sequential accent',()=>{
    expect(letterMotion(0,0,4)).toEqual({progress:0,lift:0,scale:1});
    expect(letterMotion(1,3,4)).toEqual({progress:1,lift:expect.closeTo(0,8),scale:1});
    expect(letterMotion(.125,0,4)).toMatchObject({progress:.5,lift:-2,scale:1.025});
  });

  it('preserves grapheme clusters and caps distance blur',()=>{
    expect(splitGraphemes('е\u0301👩‍🎤')).toEqual(['е\u0301','👩‍🎤']);
    expect([0,1,2,10].map(lineBlur)).toEqual([0,.6,1.2,1.8]);
  });
});
