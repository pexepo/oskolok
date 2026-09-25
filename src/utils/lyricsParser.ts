import type { LyricLine, LyricWord } from '../types/index.js';
import { parseTtmlDocument } from './ttmlParser.js';

export function lyricTimestamp(value: string): number {
  if (/^\d+(\.\d+)?ms$/.test(value)) return parseFloat(value)/1000;
  if (/^\d+(\.\d+)?s$/.test(value)) return parseFloat(value);
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.reduce((total,part) => total*60+part,0);
}

export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const offset = Number(lrcText.match(/\[offset:\s*([+-]?\d+)\]/i)?.[1] || 0)/1000;
  const result: LyricLine[]=[];
  for (const raw of lrcText.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const content = raw.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g,'').trim();
    const tokens = [...content.matchAll(/<(\d{1,3}:\d{2}(?:\.\d{1,3})?)>([^<]*)/g)];
    const text = content.replace(/<\d{1,3}:\d{2}(?:\.\d{1,3})?>/g,'').trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const time = Math.max(0, lyricTimestamp(stamp[1].replace(/:(\d{2}):(\d+)$/, ':$1.$2'))+offset);
      const delta = time - Math.max(0,lyricTimestamp(stamps[0][1])+offset);
      const timedTokens=tokens.map((token,sourceIndex)=>({token,sourceIndex})).filter(({token})=>token[2].trim());
      const words: LyricWord[] = timedTokens.map(({token:t,sourceIndex},tokenIndex)=>{
        const nextStamp=tokens[sourceIndex+1]?.[1],rawText=t[2],joinNext=tokenIndex<timedTokens.length-1&&!/\s$/u.test(rawText);
        return {text:t[2].trim(),start:Math.max(0,lyricTimestamp(t[1])+offset+delta),
          end:Math.max(0,lyricTimestamp(nextStamp||t[1])+offset+delta),...(joinNext?{joinNext:true}:{}),...(nextStamp?{}:{endEstimated:true})};
      });
      result.push({ time, text, ...(words.length ? { words } : {}) });
    }
  }
  return result.sort((a,b)=>a.time-b.time);
}

export type LyricTimingMode = 'line' | 'syllable';
export type NormalizedLyricLine = Omit<LyricLine,'end'|'background'> & {
  end: number;
  timingMode: LyricTimingMode;
  endEstimated: boolean;
  background?: NormalizedLyricLine[];
};

const sameLane = (left: LyricLine, right: LyricLine) =>
  (left.agent || '') === (right.agent || '') && (left.role || 'lead') === (right.role || 'lead');

/** Preserve measured segments and infer only missing line/segment ends. */
export function normalizeLyricTimings(lines: LyricLine[], duration = 0): NormalizedLyricLine[] {
  return lines.map((source,index)=>{
    const {background:sourceBackground,...lineFields}=source;
    const nextInLane=lines.slice(index+1).find(candidate=>candidate.time>source.time&&sameLane(source,candidate));
    const hasExplicitEnd=source.end!==undefined;
    const end=source.end??nextInLane?.time??(duration>source.time?duration:source.time+5);
    const timingMode:LyricTimingMode=!source.estimated&&source.words?.length?'syllable':'line';
    const words=source.words?.map((word,wordIndex)=>{
      if(!word.endEstimated)return {...word};
      const next=source.words?.slice(wordIndex+1).find(candidate=>candidate.start>word.start);
      return {...word,end:next?.start??end,endEstimated:true};
    });
    const background=sourceBackground?.length?normalizeLyricTimings(sourceBackground,end):undefined;
    const normalized:NormalizedLyricLine={...lineFields,end,timingMode,endEstimated:!hasExplicitEnd,...(words?{words}:{}),...(background?{background}:{})};
    return normalized;
  });
}

/** Compatibility alias for callers that used the previous normalizer name. */
export const withWordTiming = normalizeLyricTimings;

export function validateLyricLines(value: unknown): LyricLine[] {
  if (!Array.isArray(value)||!value.length||value.length>10000) throw new Error('Нужен непустой список строк (не более 10 000).');
  const lines = value.map((line:any)=>{
    if (!line || typeof line.text!=='string'||!Number.isFinite(line.time)||line.time<0||line.time>86400) throw new Error('У каждой строки нужны text и time в секундах.');
    let words:LyricWord[]|undefined;
    if (line.words!==undefined) {
      if(!Array.isArray(line.words)||!line.words.length) throw new Error('Список words должен содержать слова.');
      words=line.words.map((w:any)=>{
        if(typeof w?.text!=='string'||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<line.time||w.end<w.start||w.end>86400)throw new Error('Некорректное время слова: start / end.');
      return {text:w.text,start:w.start,end:w.end,...(w.joinNext?{joinNext:true}:{}),...(w.endEstimated?{endEstimated:true}:{})};
      });
      if(words!.some((w,i)=>i>0&&w.start<words![i-1].start))throw new Error('Слова должны идти по времени.');
    }
    if(line.end!==undefined&&(!Number.isFinite(line.end)||line.end<line.time))throw new Error('Некорректное окончание строки.');
    return {time:line.time,text:line.text,...(words?{words}:{}),...(line.end!==undefined?{end:line.end}:{}),...(line.estimated?{estimated:true}:{}),
      ...(typeof line.agent==='string'?{agent:line.agent}:{}),...(typeof line.agentName==='string'?{agentName:line.agentName}:{}),
      ...(line.role==='background'?{role:'background' as const}:{}),
      ...(typeof line.translation==='string'?{translation:line.translation}:{}),...(typeof line.romanization==='string'?{romanization:line.romanization}:{}),
      ...(Array.isArray(line.background)&&line.background.length?{background:validateLyricLines(line.background)}:{})};
  });
  return lines.sort((a,b)=>a.time-b.time);
}

export function parseLyricsFile(text: string, filename: string): LyricLine[] {
  if(text.length>1000000)throw new Error('Файл слишком большой. Максимум 1 МБ.');
  if(/\.json$/i.test(filename)) {
    const json=JSON.parse(text);return validateLyricLines(Array.isArray(json)?json:json.syncedLyrics||json.lines);
  }
  if(/\.(ttml|xml)$/i.test(filename)) {
    const xml=new DOMParser().parseFromString(text,'application/xml');
    if(xml.getElementsByTagName('parsererror').length)throw new Error('Не удалось прочитать TTML.');
    return validateLyricLines(parseTtmlDocument(xml));
  }
  return validateLyricLines(parseLrc(text));
}

export function getActiveLyricIndex(lines: LyricLine[], currentTime: number, offset=0): number {
  let index=-1;
  for(let i=0;i<lines.length;i++){if(currentTime+offset>=lines[i].time)index=i;else break;}
  return index;
}
