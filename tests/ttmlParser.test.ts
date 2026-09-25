import {describe,it,expect,vi} from 'vitest';
import {DOMParser} from '@xmldom/xmldom';
import {parseLyricsFile,withWordTiming} from '../src/utils/lyricsParser.js';
vi.stubGlobal('DOMParser',DOMParser);
const sample=`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata><ttm:agent xml:id="v1"><ttm:name>Main</ttm:name></ttm:agent><ttm:agent xml:id="v2"><ttm:name>Guest</ttm:name></ttm:agent></metadata></head><body><div><p begin="10s" end="15s" ttm:agent="v1"><span begin="10s" end="11s">Hel</span><span begin="11s" end="12s">lo</span> <span begin="12s" end="13s">world</span><span ttm:role="x-bg" begin="11s" end="14s" ttm:agent="v2"><span begin="11s" end="14s">Echo</span></span><span ttm:role="x-translation">Привет</span><span ttm:role="x-romanization">Hello</span></p><p begin="12s" end="16s" ttm:agent="v2"><span begin="12s" end="16s">Duet</span></p></div></body></tt>`;
describe('TTML voices',()=>{
 it('keeps lead syllables, whitespace, guest and timed background separate',()=>{
  const lines=parseLyricsFile(sample,'song.ttml');
  expect(lines[0].text).toBe('Hello world');expect(lines[0].agentName).toBe('Main');
  expect(lines[0].words?.map(w=>w.text).join('')).toBe('Hello world');
  expect(lines[0].words).toHaveLength(3);expect(lines[0].words?.[0].joinNext).toBe(true);
  expect(lines[0].background?.[0]).toMatchObject({text:'Echo',time:11,end:14,agent:'v2',agentName:'Guest',role:'background'});
  expect(lines[0].background?.[0].words?.[0]).toMatchObject({text:'Echo',start:11,end:14});
  expect(lines[1]).toMatchObject({time:12,end:16,agentName:'Guest'});
 });
 it('preserves translation, romanization and vocal lanes through JSON export/import',()=>{
  const lines=parseLyricsFile(sample,'song.ttml');
  expect(lines[0].translation).toBe('Привет');expect(lines[0].romanization).toBe('Hello');
  expect(parseLyricsFile(JSON.stringify({lines}),'song.json')).toEqual(lines);
  expect(withWordTiming(lines,20)[0].background?.[0].words?.[0].end).toBe(14);
 });
 it('supports namespaces, milliseconds, frame timestamps and nested timed spans without duplication',()=>{
  const lines=parseLyricsFile(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25"><body><div><p begin="1000ms" end="00:00:03:00"><span begin="1s" end="3s"><span begin="00:00:01:00" end="00:00:02:12">Yes</span></span></p></div></body></tt>`,'x.ttml');
  expect(lines[0].words).toHaveLength(1);expect(lines[0].words?.[0].end).toBeCloseTo(2.48);
 });
 it('rejects invalid timestamps instead of silently marking a line at zero',()=>{
  expect(()=>parseLyricsFile('<tt><body><p begin="garbage">Hello</p></body></tt>','x.ttml')).toThrow();
 });
});
