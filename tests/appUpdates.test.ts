import {describe,it,expect} from 'vitest';
import {isNewBuild,canApplyUpdate} from '../src/utils/appUpdates.js';
describe('over-the-air web updates',()=>{
 it('only applies a newer valid build, avoiding stale-server reload loops',()=>{
  const current='2026-10-12T01:00:00.000Z';
  expect(isNewBuild({buildId:'2026-10-12T02:00:00.000Z'},current)).toBe(true);
  for(const value of [null,{}, {buildId:current},{buildId:'2026-10-11T01:00:00Z'},{buildId:'garbage'}])expect(isNewBuild(value,current)).toBe(false);
 });
 it('waits for music, forms and dialogs to finish',()=>{
  expect(canApplyUpdate(false,false,false)).toBe(true);
  expect(canApplyUpdate(true,false,false)).toBe(false);
  expect(canApplyUpdate(false,true,false)).toBe(false);
  expect(canApplyUpdate(false,false,true)).toBe(false);
 });
});
