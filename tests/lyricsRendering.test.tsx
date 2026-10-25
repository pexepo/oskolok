import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {LyricsLine,PlainLyricLine} from '../src/components/lyrics/LyricsLine.js';
import {LyricsBoundary} from '../src/components/lyrics/LyricsBoundary.js';
import type {NormalizedLyricLine} from '../src/utils/lyricsParser.js';

// Words shorter than a held note (LONG_NOTE_SECONDS), so each lifts as one piece.
const syllableLine:NormalizedLyricLine={time:0,end:2.4,endEstimated:false,timingMode:'syllable',text:'Один долгий текст',words:[{text:'Один',start:0,end:.8},{text:'долгий',start:.8,end:1.6},{text:'текст',start:1.6,end:2.4}]};
const base={onSeek:()=>{},currentTime:0,isActive:false,isSung:false};

describe('karaoke lyric rendering',()=>{
  it('renders translation below plain Genius lyrics without inventing timings',()=>{
    const html=renderToStaticMarkup(<PlainLyricLine text="Hello world" translation="Привет, мир" lineIndex={0}/>);
    expect(html).toContain('Hello world');expect(html).toContain('Привет, мир');
    expect(html).toContain('lyric-translation is-machine');expect(html).not.toContain('<button');
  });
  it('uses one vertical fill for a wrapping line',()=>{
    const line:NormalizedLyricLine={time:1,end:5,endEstimated:true,timingMode:'line',text:'Длинная фраза которая переносится'};
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} isActive currentTime={3}/>);
    expect(html).toContain('line-timed');
    expect(html).toContain('lyric-line-fill');
    expect(html).toContain('--karaoke-progress:0.5000');
  });

  it('pulls up whole measured words without separate letter bounces',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} isActive currentTime={1.2}/>);
    expect(html.match(/class="lyric-segment/g)?.length).toBe(3);
    expect(html).toContain('lyric-word-pull-up');
    expect(html).toContain('--word-pull-y:0em');
    expect(html).not.toContain('lyric-letter');
    expect(html).not.toContain('per-word-crossfade');
  });

  it('sings a held note letter by letter instead of lifting the word',()=>{
    const line:NormalizedLyricLine={time:0,end:3,endEstimated:false,timingMode:'syllable',text:'Ooh yeah',words:[{text:'Ooh',start:0,end:2},{text:'yeah',start:2,end:2.5}]};
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} isActive currentTime={1}/>);
    expect(html.match(/class="lyric-letter"/g)).toHaveLength(3);
    expect(html).toContain('has-letter-motion');
    // The held word does not also pull up as a whole.
    expect(html).not.toMatch(/data-word-start="0"/);
  });

  it('animates short syllables and marks only the syllable being sung',()=>{
    const line:NormalizedLyricLine={time:0,end:.8,endEstimated:false,timingMode:'syllable',text:'мо-ре',words:[{text:'мо',start:0,end:.4,joinNext:true},{text:'ре',start:.4,end:.8}]};
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} isActive currentTime={.2} glow/>);
    expect(html.match(/data-syllable="true"/g)).toHaveLength(2);
    expect(html.match(/class="lyric-pull-word lyric-pull-word--split lyric-last-word"/g)).toHaveLength(1);
    // Syllable-timed words bounce syllable by syllable: each carries its own timing.
    expect(html.match(/data-pull-start=/g)).toHaveLength(2);
    // The glow word spans both syllables, so it is the whole word.
    expect(html).toContain('data-text="море"');
    expect(html).toContain('>мо</span><span');
    expect(html).not.toContain('lyric-letter');
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html.match(/data-current="false"/g)).toHaveLength(1);
  });

  it('keeps line-timed lines plain: no pull-up and no closing-word highlight',()=>{
    const line:NormalizedLyricLine={time:1,end:5,endEstimated:true,timingMode:'line',text:'Обычная строка'};
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} isActive currentTime={3} glow/>);
    expect(html).not.toContain('lyric-word-pull-up');
    expect(html).not.toContain('lyric-last-word');
    expect(html).toContain('<span class="lyric-line-fill" style="--karaoke-progress:0.5000;--karaoke-start:40%;--karaoke-end:60%">Обычная строка</span>');
  });

  it('frames exactly the annotated fragment: Genius mark before, corner after',()=>{
    const line:NormalizedLyricLine={time:0,end:4,endEstimated:false,timingMode:'line',text:'Пожелай мне удачи в бою, пожелай мне'};
    const notes=[{referent:0,start:0,end:23,first:true,last:true}];
    const html=renderToStaticMarkup(<LyricsLine {...base} line={line} notes={notes} lineIndex={2} onAnnotate={()=>{}}/>);
    expect(html).toMatch(/<span class="lyric-annot" data-first="true" data-last="true"><span class="lyric-genius-start"[\s\S]*?<\/span>Пожелай мне удачи в бою<\/span><span class="lyric-genius-badge"/);
    expect(html).toContain('genius-corner');
    expect(html).toContain('<span>, пожелай мне</span>');
    expect(html).toContain('Аннотация Genius: Пожелай мне удачи в бою');
  });

  it('seeks when annotated text is clicked and reserves annotation opening for its badge',()=>{
    const seek=vi.fn(),annotate=vi.fn();
    const line:NormalizedLyricLine={time:12,end:16,endEstimated:false,timingMode:'line',text:'Our annotated phrase'};
    const notes=[{referent:3,start:0,end:20,first:true,last:true}];
    const tree=(LyricsLine as unknown as {type:(props:any)=>React.ReactNode}).type({...base,line,notes,lineIndex:2,onSeek:seek,onAnnotate:annotate});
    const elements:React.ReactElement[]=[];
    const visit=(node:React.ReactNode)=>{React.Children.forEach(node,child=>{if(!React.isValidElement(child))return;elements.push(child);if(typeof child.type==='function'&&child.type.name==='Badge')visit((child.type as (props:any)=>React.ReactNode)(child.props));else visit(child.props.children);});};
    visit(tree);
    expect(elements.find(el=>el.props.className==='lyric-annot')?.props.onClick).toBeUndefined();
    elements.find(el=>String(el.props.className).startsWith('interference-line'))!.props.onClick();
    expect(seek).toHaveBeenCalledWith(12);expect(annotate).not.toHaveBeenCalled();seek.mockClear();
    const event={stopPropagation:vi.fn(),preventDefault:vi.fn()};
    elements.find(el=>el.props.className==='lyric-genius-badge')!.props.onClick(event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();expect(annotate).toHaveBeenCalledWith(2,3);expect(seek).not.toHaveBeenCalled();
  });

  it('wraps annotated word-timed words and closes the range with the mark',()=>{
    const notes=[{referent:0,start:5,end:11,first:true,last:true}];
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} notes={notes} onAnnotate={()=>{}}/>);
    expect(html.match(/class="lyric-annot"/g)).toHaveLength(1);
    expect(html).toMatch(/lyric-annot"[^>]*><span class="lyric-genius-start"[\s\S]*?<\/svg><\/span><span class="lyric-pull-word"[^>]*><span[^>]*>долгий<\/span><\/span><\/span><span class="lyric-genius-badge"/);
  });

  it('closes an annotation that ends on the last word of a word-timed line instead of crashing',()=>{
    const notes=[{referent:0,start:5,end:17,first:true,last:true}];
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} notes={notes} onAnnotate={()=>{}}/>);
    expect(html.match(/class="lyric-annot"/g)).toHaveLength(1);
    expect(html).toMatch(/долгий[\s\S]*текст[\s\S]*<\/span><\/span><span class="lyric-genius-badge"/);
  });

  it('joins every word of an annotated fragment into one highlight with a single badge',()=>{
    const notes=[{referent:0,start:0,end:17,first:true,last:true}];
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} notes={notes} onAnnotate={()=>{}}/>);
    expect(html.match(/class="lyric-annot"/g)).toHaveLength(1);
    expect(html.match(/class="lyric-genius-badge"/g)).toHaveLength(1);
  });

  it('marks the selected fragment, including when it was merged into another range',()=>{
    const line:NormalizedLyricLine={time:0,end:4,endEstimated:false,timingMode:'line',text:'Пожелай мне удачи в бою'};
    const notes=[{referent:4,also:[9],start:0,end:23,first:true,last:true}];
    expect(renderToStaticMarkup(<LyricsLine {...base} line={line} notes={notes} onAnnotate={()=>{}} selected={9}/>)).toContain('data-selected="true"');
    expect(renderToStaticMarkup(<LyricsLine {...base} line={line} notes={notes} onAnnotate={()=>{}} selected={5}/>)).not.toContain('data-selected');
  });

  it('keeps a line with a curly apostrophe, dash or ellipsis left-to-right so the words never reverse',()=>{
    const line:NormalizedLyricLine={time:0,end:3,endEstimated:false,timingMode:'syllable',text:'Don’t stop — me now…',words:[{text:'Don’t',start:0,end:.5},{text:'stop',start:.5,end:1},{text:'—',start:1,end:1.2},{text:'me',start:1.2,end:2},{text:'now…',start:2,end:3}]};
    expect(renderToStaticMarkup(<LyricsLine {...base} line={line}/>)).toContain('dir="ltr"');
    const arabic:NormalizedLyricLine={time:0,end:3,endEstimated:false,timingMode:'line',text:'مرحبا بالعالم'};
    expect(renderToStaticMarkup(<LyricsLine {...base} line={arabic}/>)).toContain('dir="rtl"');
  });

  it('keeps sung state and gives only the closing word the glow underlay',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} isSung currentTime={6} glow/>);
    expect(html).toContain('sung');
    expect(html.match(/data-text=/g)).toHaveLength(1);
    expect(html).toContain('data-text="текст" data-lit="true"');
  });

  it('keeps every word in the line and marks completed words independently',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} isActive currentTime={1.2}/>);
    expect(html).toContain('Один');
    expect(html).toContain('долгий');
    expect(html).toContain('текст');
    expect(html.match(/data-played="true"/g)).toHaveLength(1);
    expect(html.match(/data-played="false"/g)).toHaveLength(2);
  });

  it('renders every unread segment at its original position and size',()=>{
    const html=renderToStaticMarkup(<LyricsLine {...base} line={syllableLine} currentTime={-1}/>);
    expect(html.match(/--word-pull-y:0em/g)).toHaveLength(3);
    expect(html.match(/--word-pull-scale:1;/g)).toHaveLength(3);
    expect(html.match(/--word-pull-opacity:1/g)).toHaveLength(3);
  });
});

import {annotationRanges} from '../src/utils/geniusAnnotations.js';
describe('Genius fragment binding',()=>{
  const ref=(id:number,fragment:string)=>({id,fragment,classification:'accepted',annotations:[]});
  it('finds where a fragment starts and ends inside a line, ignoring case and punctuation',()=>{
    const ranges=annotationRanges([{text:'Пожелай мне удачи в бою, пожелай мне'}],[ref(1,'пожелай мне удачи в бою')]);
    expect(ranges.get(0)).toEqual([{referent:0,start:0,end:23,first:true,last:true}]);
  });
  it('spans a multi-line fragment across consecutive lines with one start and one end',()=>{
    const lines=[{text:'Мой порядковый номер на рукаве'},{text:'Пожелай мне удачи в бою'},{text:'Не остаться в этой траве'}];
    const ranges=annotationRanges(lines,[ref(7,'Мой порядковый номер на рукаве\nПожелай мне удачи в бою')]);
    expect(ranges.get(0)?.[0]).toMatchObject({first:true,last:false});
    expect(ranges.get(1)?.[0]).toMatchObject({first:false,last:true});
    expect(ranges.has(2)).toBe(false);
  });
  it('never binds a lone short word such as "yeah" inside a longer line',()=>{
    expect(annotationRanges([{text:'Yeah, back to the lab again'}],[ref(1,'Yeah')]).size).toBe(0);
  });
});

describe('lyrics fault isolation',()=>{
  it('swaps a crashed lyrics view for a small retry card instead of the full-screen error page',()=>{
    expect(LyricsBoundary.getDerivedStateFromError()).toEqual({failed:true});
    const boundary=new LyricsBoundary({children:null});
    boundary.state={failed:true};
    const html=renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Повторить');
    boundary.state={failed:false};
    expect(boundary.render()).toBeNull();
  });
});
