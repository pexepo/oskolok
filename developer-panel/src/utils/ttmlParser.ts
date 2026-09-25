import type { LyricLine, LyricWord } from '../types/index.js';

const attr = (el: Element, name: string): string | undefined => {
  for (const a of Array.from(el.attributes)) if (a.localName === name || a.name === name) return a.value;
  return undefined;
};
const children = (el: Element) => Array.from(el.childNodes).filter(n => n.nodeType === 1) as Element[];
const descendants = (el: Element): Element[] => children(el).flatMap(c => [c, ...descendants(c)]);

/** Apple-style TTML agents, background lanes and timed syllables. Styling is owned by the player. */
export function parseTtmlDocument(xml: Document): LyricLine[] {
  if (xml.getElementsByTagName('parsererror').length) throw new Error('Не удалось прочитать TTML.');
  const root = xml.documentElement;
  const frameRate = Number(attr(root, 'frameRate') || 30);
  const tickRate = Number(attr(root, 'tickRate') || frameRate);
  const stamp = (value: string): number => {
    const offset = value.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/);
    if (offset) return Number(offset[1]) * ({ h: 3600, m: 60, s: 1, ms: .001, f: 1 / frameRate, t: 1 / tickRate }[offset[2]]!);
    if (/^\d+:\d{2}:\d{2}:\d+$/.test(value)) {
      const [h,m,s,f] = value.split(':').map(Number); return h*3600+m*60+s+f/frameRate;
    }
    if (!/^\d+(?::\d{2}){0,2}(?:\.\d+)?$/.test(value)) throw new Error(`Неподдерживаемая метка TTML: ${value}`);
    return value.split(':').map(Number).reduce((a,b)=>a*60+b,0);
  };
  const agents = new Map(descendants(root).filter(e => e.localName === 'agent').map(e => [attr(e,'id'), descendants(e).find(n=>n.localName==='name')?.textContent || attr(e,'id')]));
  const isBackground = (el: Element) => /(?:^|:)x-bg|background/.test(attr(el,'role') || '');
  const isAux = (el: Element) => /translation|romanization/.test(attr(el,'role') || '');
  const read = (el: Element, inheritedAgent?: string, inheritedTime = 0): LyricLine => {
    const time = attr(el,'begin') ? stamp(attr(el,'begin')!) : inheritedTime;
    const end = attr(el,'end') ? stamp(attr(el,'end')!) : attr(el,'dur') ? time+stamp(attr(el,'dur')!) : undefined;
    const agent = attr(el,'agent') || inheritedAgent;
    const words: LyricWord[] = [], backgrounds: LyricLine[] = [];
    let text = '', translation: string | undefined, romanization: string | undefined;
    const walk = (node: Element) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3 || child.nodeType === 4) { text += child.textContent || ''; continue; }
        if (child.nodeType !== 1) continue;
        const c = child as Element;
        if (isBackground(c)) { backgrounds.push({...read(c,agent,time),role:'background'}); continue; }
        if (isAux(c)) { if ((attr(c,'role')||'').includes('translation')) translation=c.textContent||''; else romanization=c.textContent||''; continue; }
        const nestedTimed = descendants(c).some(n=>attr(n,'begin') && !isBackground(n));
        if (attr(c,'begin') && !nestedTimed) {
          const value = (c.textContent||'').replace(/\s+/g,' ');
          const start = stamp(attr(c,'begin')!);
          words.push({text:value,start,end:attr(c,'end')?stamp(attr(c,'end')!):attr(c,'dur')?start+stamp(attr(c,'dur')!):start,joinNext:true});
          text += value;
        } else walk(c);
      }
    };
    walk(el);
    // Whitespace between timed spans belongs to the preceding word, not an extra lyric token.
    if (words.length && words.map(w=>w.text).join('').replace(/\s/g,'')===text.replace(/\s/g,'')) {
      let cursor=0;
      for (const word of words) { const at=text.indexOf(word.text,cursor); cursor=Math.max(cursor,at)+word.text.length; const spaces=text.slice(cursor).match(/^\s+/)?.[0]; if(spaces){word.text+=spaces;cursor+=spaces.length;} }
    }
    return {time,end,text:text.replace(/\s+/g,' ').trim(),...(words.length?{words}:{}),...(agent?{agent,agentName:agents.get(agent)||agent}:{}),...(backgrounds.length?{background:backgrounds}:{}),...(translation?{translation}:{}),...(romanization?{romanization}:{})};
  };
  return descendants(root).filter(e=>e.localName==='p').map(p=>{
    let parent=p.parentNode as Element|null, agent=attr(p,'agent');
    while(parent?.nodeType===1&&!agent){agent=attr(parent,'agent');parent=parent.parentNode as Element|null;}
    return {...read(p,agent),...(isBackground(p)?{role:'background' as const}:{})};
  }).filter(l=>l.text||l.background?.length);
}
