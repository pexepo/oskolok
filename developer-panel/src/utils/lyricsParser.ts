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
      const words: LyricWord[] = tokens.filter(t=>t[2].trim()).map((t,i)=>({
        text:t[2].trim(),start:Math.max(0,lyricTimestamp(t[1])+offset+delta),
        end:Math.max(0,lyricTimestamp(tokens[i+1]?.[1]||t[1])+offset+delta),
      }));
      result.push({ time, text, ...(words.length ? { words } : {}) });
    }
  }
  return result.sort((a,b)=>a.time-b.time);
}

/** Line-only lyrics use approximate word timing, never advertised as measured alignment. */
export function withWordTiming(lines: LyricLine[], duration = 0): LyricLine[] {
  return lines.map((line,i)=>{
    if(line.background?.length)line={...line,background:withWordTiming(line.background,line.end||duration)};
    const boundary = lines[i+1]?.time ?? (duration>line.time ? duration : line.time+5);
    const end = line.end ?? Math.min(boundary,line.time+8);
    if (line.words?.length) return {...line,end:line.end??Math.max(line.time+.08,...line.words.map(w=>w.end>w.start?w.end:end)),words:line.words.map((word,j)=>({...word,end:word.end>word.start ? word.end : Math.max(word.start+.08,line.words?.[j+1]?.start??end)}))};
    const words = line.text.match(/\S+/g)||[];
    const total=words.reduce((sum,word)=>sum+Math.max(2,word.length),0);
    let elapsed=line.time;
    return {...line,end,estimated:true,words:words.map(text=>{
      const start=elapsed;elapsed+=(end-line.time)*Math.max(2,text.length)/Math.max(1,total);
      return {text,start,end:elapsed};
    })};
  });
}

export function validateLyricLines(value: unknown): LyricLine[] {
  if (!Array.isArray(value)||!value.length||value.length>10000) throw new Error('Нужен непустой список строк (не более 10 000).');
  const lines = value.map((line:any)=>{
    if (!line || typeof line.text!=='string'||!Number.isFinite(line.time)||line.time<0||line.time>86400) throw new Error('У каждой строки нужны text и time в секундах.');
    let words:LyricWord[]|undefined;
    if (line.words!==undefined) {
      if(!Array.isArray(line.words)||!line.words.length) throw new Error('Список words должен содержать слова.');
      words=line.words.map((w:any)=>{
        if(typeof w?.text!=='string'||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<line.time||w.end<w.start||w.end>86400)throw new Error('Некорректное время слова: start / end.');
      return {text:w.text,start:w.start,end:w.end,...(w.joinNext?{joinNext:true}:{})};
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
