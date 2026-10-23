import {describe,it,expect} from 'vitest';
import {gradientStops,intervalProgress,letterMotion,lineBlur,splitGraphemes,wordPullMotion,paintTimedWordSegments} from '../src/utils/lyricMotion.js';

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

  it('grows first and immediately dips and settles without freezing at peak size',()=>{
    const rest={y:0,scale:1,opacity:1};
    expect(wordPullMotion(.9,1,1.08)).toEqual(rest);
    expect(wordPullMotion(1,1,1.08)).toEqual(rest);
    expect(wordPullMotion(1.425,1,1.08)).toEqual({y:expect.closeTo(0,8),scale:1.055,opacity:1});
    expect(wordPullMotion(1.426,1,1.08).scale).toBeLessThan(wordPullMotion(1.425,1,1.08).scale);
    expect(wordPullMotion(1.6375,1,1.08)).toEqual({y:expect.closeTo(.025,8),scale:expect.closeTo(1.0275,8),opacity:1});
    expect(wordPullMotion(1.7,1,1.08).y).toBeGreaterThan(0);
    expect(wordPullMotion(1.7,1,1.08).y).toBeLessThan(.025);
    expect(wordPullMotion(1.85,1,1.08)).toEqual(rest);
    expect(wordPullMotion(3,1,1.08)).toEqual(rest);
    // Ease-in/out at launch, the dip, and landing.
    expect(wordPullMotion(1.001,1,1.08).scale-1).toBeLessThan(.00001);
    expect(wordPullMotion(1.426,1,1.08).y).toBeLessThan(.00001);
    expect(wordPullMotion(1.849,1,1.08).y).toBeLessThan(.00001);
    const scales=[1.425,1.44,1.48,1.6,1.7,1.8,1.85].map(time=>wordPullMotion(time,1,1.08).scale);
    expect(scales.every((scale,index)=>!index||scale<scales[index-1])).toBe(true);
    expect(wordPullMotion(.9,1,3)).toEqual(rest);
  });

  it('slows the entire curve for sustained words while preserving the same peak size',()=>{
    expect(wordPullMotion(.15,0,2).scale).toBeLessThan(wordPullMotion(.15,0,.08).scale);
    expect(wordPullMotion(.425,0,.08)).toEqual(wordPullMotion(1.12,0,2));
    expect(wordPullMotion(2,0,2).scale).toBeGreaterThan(1);
    expect(wordPullMotion(2.24,0,2)).toEqual({y:0,scale:1,opacity:1});
    expect(wordPullMotion(.85,0,.08)).toEqual({y:0,scale:1,opacity:1});
    expect(wordPullMotion(1,1,1)).toEqual({y:0,scale:1,opacity:1});
  });

  it('uses the same speed curve for approaching and receding at every cadence',()=>{
    for(const duration of [.08,.8,2]){
      const finish=Math.max(.85,duration+.24),epsilon=.0001;
      const scale=(fraction:number)=>wordPullMotion(fraction*finish,0,duration).scale;
      for(const fraction of [.1,.2,.35,.45]){
        expect(scale(fraction)).toBeCloseTo(scale(1-fraction),10);
        const approach=(scale(fraction+epsilon)-scale(fraction-epsilon))/(2*epsilon*finish);
        const recede=(scale(1-fraction+epsilon)-scale(1-fraction-epsilon))/(2*epsilon*finish);
        expect(approach).toBeCloseTo(-recede,9);
      }
    }
  });

  it('overlaps adjacent accents and adjusts the tail to the next word cadence',()=>{
    const previous=wordPullMotion(2.1,0,2,2,3);
    const next=wordPullMotion(2.1,2,3,3,4);
    expect(previous.scale).toBeGreaterThan(1);
    expect(next.scale).toBeGreaterThan(1);
    expect(previous.scale).toBeLessThan(wordPullMotion(2,0,2,2,3).scale);
    expect(wordPullMotion(2.36,0,2,2,3).scale).toBe(1);
    expect(wordPullMotion(2.2,0,2,2,2.1).scale).toBe(1);
    expect(wordPullMotion(2.2,0,2,2,4).scale).toBeGreaterThan(1);
  });

  it('bridges small gaps but settles before long instrumental pauses',()=>{
    expect(wordPullMotion(1.2,0,1,1.3,2).scale).toBeGreaterThan(1);
    expect(wordPullMotion(1.3,0,1,5,6)).toEqual(wordPullMotion(1.3,0,1));
    expect(wordPullMotion(4,0,1,5,6)).toEqual({y:0,scale:1,opacity:1});
  });

  it('finishes a short word cooldown after its line ends and resets on seek',()=>{
    const styles=new Map<string,string>();
    const style={setProperty:(key:string,value:string)=>styles.set(key,value),getPropertyValue:(key:string)=>styles.get(key)||''};
    const segmentStyles=new Map<string,string>();
    const word={dataset:{wordStart:'1',wordEnd:'1.08'} as Record<string,string>,style};
    const segment={dataset:{start:'1',end:'1.08'} as Record<string,string>,querySelectorAll:()=>[],
      style:{setProperty:(key:string,value:string)=>segmentStyles.set(key,value),getPropertyValue:(key:string)=>segmentStyles.get(key)||''}};
    const root={dataset:{start:'1',end:'1.08'},querySelectorAll:(selector:string)=>selector.startsWith('.lyric-pull-word')?[word]:[segment]} as unknown as HTMLElement;
    paintTimedWordSegments(root,1.48);
    expect(root.dataset.wordSettling).toBe('true');
    expect(Number.parseFloat(styles.get('--word-pull-y')!)).toBeGreaterThan(0);
    expect(Number.parseFloat(styles.get('--word-pull-y')!)).toBeLessThan(.025);
    expect(segmentStyles.get('--karaoke-progress')).toBe('1.0000');
    expect(styles.get('--word-pull-opacity')).toBe('1');
    paintTimedWordSegments(root,1.86);
    expect(root.dataset.wordSettling).toBe('false');
    expect(styles.get('--word-pull-scale')).toBe('1');
    // Slowing an accent must not change the measured highlighting interval.
    word.dataset.wordEnd='3';segment.dataset.end='3';
    paintTimedWordSegments(root,1.9);
    expect(Number(styles.get('--word-pull-scale'))).toBeGreaterThan(1);
    expect(segment.dataset.current).toBe('true');
    expect(segment.dataset.played).toBe('false');
    paintTimedWordSegments(root,3.3);
    expect(styles.get('--word-pull-scale')).toBe('1');
    Object.assign(word.dataset,{nextStart:'3',nextEnd:'5'});
    paintTimedWordSegments(root,3.3);
    expect(Number(styles.get('--word-pull-scale'))).toBeGreaterThan(1);
    paintTimedWordSegments(root,3.41);
    expect(styles.get('--word-pull-scale')).toBe('1');
    paintTimedWordSegments(root,.5);
    expect(styles.get('--word-pull-y')).toBe('0.00000em');
  });
});
