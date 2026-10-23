import {expect,it} from 'vitest';
import {trackWindow} from '../src/utils/virtualTracks.js';
it('keeps the number of mounted rows bounded for a thousand-track library',()=>{
  for(const offset of [0,880,44000,87560]){
    const range=trackWindow(1000,88,offset,900);
    expect(range.end-range.start).toBeLessThanOrEqual(24);
    expect(range.start).toBeGreaterThanOrEqual(0);expect(range.end).toBeLessThanOrEqual(1000);
    expect(range.start).toBeLessThanOrEqual(Math.floor(offset/88));
  }
});
it('handles a list below the fold, an empty filter and the end of the list',()=>{
  expect(trackWindow(0,88,0,900)).toEqual({start:0,end:0});
  expect(trackWindow(1000,88,-600,900)).toEqual({start:0,end:10});
  expect(trackWindow(10,88,800,900)).toEqual({start:3,end:10});
});
