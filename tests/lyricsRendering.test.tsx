import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {LyricsLine} from '../src/components/lyrics/LyricsLine.js';
import type {NormalizedLyricLine} from '../src/utils/lyricsParser.js';

const syllableLine:NormalizedLyricLine={time:0,end:5,endEstimated:false,timingMode:'syllable',text:'Один долгий текст',words:[{text:'Один',start:0,end:1},{text:'долгий',start:1,end:3},{text:'текст',start:3,end:5}]};
const base={onSeek:()=>{},currentTime:0,focusDistance:0,isActive:false,isSung:false};

describe('karaoke lyric rendering',()=>{
  it('uses one vertical fill for a wrapping line',()=>{
    const line:NormalizedLyricLine={time:1,end:5,endEstimated:true,timingMode:'line',text:'Длинная фраза которая переносится'};
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} isActive currentTime={3}/>);
    expect(html).toContain('line-timed');
    expect(html).toContain('lyric-line-fill');
    expect(html).toContain('--karaoke-progress:0.5000');
  });

  it('uses measured segments and letter accents on the active words',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} isActive currentTime={2}/>);
    expect(html.match(/class="lyric-segment/g)?.length).toBe(3);
    expect(html).toContain('lyric-letter');
    expect(html).not.toContain('per-word-crossfade');
  });

  it('animates short syllables and marks only the syllable being sung',()=>{
    const line:NormalizedLyricLine={time:0,end:.8,endEstimated:false,timingMode:'syllable',text:'мо-ре',words:[{text:'мо',start:0,end:.4,joinNext:true},{text:'ре',start:.4,end:.8}]};
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} isActive currentTime={.2}/>);
    expect(html.match(/class="lyric-letter"/g)).toHaveLength(4);
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html.match(/data-current="false"/g)).toHaveLength(1);
  });

  it('keeps sung state and exposes the bounded focus blur',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} isSung focusDistance={8} currentTime={6}/>);
    expect(html).toContain('sung');
    expect(html).toContain('--line-blur:1.8px');
  });

  it('keeps every word in the line and marks completed words independently',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} isActive currentTime={2}/>);
    expect(html).toContain('Один');
    expect(html).toContain('долгий');
    expect(html).toContain('текст');
    expect(html.match(/data-played="true"/g)).toHaveLength(1);
    expect(html.match(/data-played="false"/g)).toHaveLength(2);
  });
});
