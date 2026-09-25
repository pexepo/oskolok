import { describe, it, expect } from 'vitest';
import { parseLrc, getActiveLyricIndex } from '../src/utils/lyricsParser.js';

describe('LRC Lyrics Parser', () => {
  const sampleLrc = `
[00:12.43]First line text
[00:16.80]Second line text
[00:25.10]Third line text
  `;

  it('should parse LRC format timestamped lines into ordered seconds', () => {
    const lines = parseLrc(sampleLrc);
    expect(lines.length).toBe(3);
    expect(lines[0].time).toBeCloseTo(12.43);
    expect(lines[0].text).toBe('First line text');
    expect(lines[1].time).toBeCloseTo(16.80);
    expect(lines[2].time).toBeCloseTo(25.10);
  });

  it('should calculate active line index correctly for given currentTime', () => {
    const lines = parseLrc(sampleLrc);

    expect(getActiveLyricIndex(lines, 5)).toBe(-1);
    expect(getActiveLyricIndex(lines, 13)).toBe(0);
    expect(getActiveLyricIndex(lines, 20)).toBe(1);
    expect(getActiveLyricIndex(lines, 30)).toBe(2);
  });

  it('should support anticipation offset in getActiveLyricIndex', () => {
    const lines = parseLrc(sampleLrc);

    // At 12.2s without offset -> not yet active (-1)
    expect(getActiveLyricIndex(lines, 12.2, 0)).toBe(-1);
    // At 12.2s with +0.3s lead offset (effective time 12.5s >= 12.43s) -> active line 0!
    expect(getActiveLyricIndex(lines, 12.2, 0.3)).toBe(0);
  });

  it('should parse [offset: +/-ms] tags correctly', () => {
    const lrcWithOffset = `
[offset: 500]
[00:10.00]Hello world
    `;
    const lines = parseLrc(lrcWithOffset);
    expect(lines.length).toBe(1);
    expect(lines[0].time).toBeCloseTo(10.5);
  });
});

import {parseLyricsFile,normalizeLyricTimings} from '../src/utils/lyricsParser.js';
describe('Interference word timing',()=>{
 it('imports enhanced LRC including word ends and offset',()=>{
  const lines=parseLrc('[offset:500]\n[00:10.00]<00:10.00>Glass <00:11.20>moves<00:12.00>');
  expect(lines[0].text).toBe('Glass moves');
  expect(lines[0].words).toEqual([{text:'Glass',start:10.5,end:11.7},{text:'moves',start:11.7,end:12.5}]);
 });
 it('accepts minute and second stamps without fractions',()=>{expect(parseLrc('[01:02]Hello')[0].time).toBe(62);});
 it('preserves enhanced LRC punctuation joins and written spaces',()=>{
  const line=parseLrc('[00:01.00]<00:01.00>Hello<00:01.50>, <00:02.00>world<00:03.00>')[0];
  expect(line.words).toEqual([
   {text:'Hello',start:1,end:1.5,joinNext:true},
   {text:',',start:1.5,end:2},
   {text:'world',start:2,end:3},
  ]);
 });
 it('keeps line-only timing as one line segment',()=>{
  const lines=normalizeLyricTimings([{time:2,text:'one two'},{time:6,text:'three'}],10);
  expect(lines[0]).toMatchObject({timingMode:'line',end:6,endEstimated:true});
  expect(lines[0].words).toBeUndefined();
 });
 it('retains measured word times',()=>{
  const lines=normalizeLyricTimings([{time:2,text:'one',words:[{text:'one',start:2,end:4}]}],8);
  expect(lines[0].timingMode).toBe('syllable');expect(lines[0].words?.[0].end).toBe(4);expect(lines[0].end).toBe(8);
 });
 it('infers a missing segment end without changing explicit zero-length segments',()=>{
  const inferred=normalizeLyricTimings([{time:1,text:'a b',words:[{text:'a',start:1,end:1,endEstimated:true},{text:'b',start:2,end:2,endEstimated:true}]}],4)[0];
  expect(inferred.words?.map(word=>word.end)).toEqual([2,4]);
  const explicit=normalizeLyricTimings([{time:1,text:'a',words:[{text:'a',start:1,end:1}]}],4)[0];
  expect(explicit.words?.[0].end).toBe(1);
 });
 it('rejects malformed JSON and reversed word timing',()=>{
  expect(()=>parseLyricsFile('{"lines":[{"text":"a","time":-1}]}','test.json')).toThrow();
  expect(()=>parseLyricsFile(JSON.stringify([{time:1,text:'a',words:[{text:'a',start:3,end:2}]}]),'test.json')).toThrow();
 });
 it('round-trips shared lyric files without losing word boundaries',()=>{
  const lines=[{time:1,text:'hello',words:[{text:'hello',start:1,end:2}]}];
  expect(parseLyricsFile(JSON.stringify({version:1,lines}),'test.json')).toEqual(lines);
 });
});
