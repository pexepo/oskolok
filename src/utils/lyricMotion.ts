export function clamp01(value:number):number {
  return Math.min(1,Math.max(0,value));
}

/** Exact progress for an audio interval. Zero-length intervals switch at start. */
export function intervalProgress(time:number,start:number,end:number):number {
  if(end<=start)return time>=start?1:0;
  return clamp01((time-start)/(end-start));
}

/** Soft gradient boundaries, expressed as percentages. */
export function gradientStops(progress:number):{start:number;end:number} {
  const p=clamp01(progress),start=120*p-20;
  return {start,end:start+20};
}

export function splitGraphemes(text:string):string[] {
  const Segmenter=(Intl as typeof Intl & {Segmenter?:new(locale?:string|string[],options?:{granularity:'grapheme'})=>{segment:(value:string)=>Iterable<{segment:string}>}}).Segmenter;
  return Segmenter?Array.from(new Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment):Array.from(text);
}

export function letterMotion(segmentProgress:number,index:number,count:number):{progress:number;lift:number;scale:number} {
  const progress=clamp01(Math.max(1,count)*clamp01(segmentProgress)-index);
  if(progress===0||progress===1)return {progress,lift:0,scale:1};
  const wave=Math.sin(Math.PI*progress)**2;
  return {progress,lift:-2*wave,scale:1+.025*wave};
}

export function lineBlur(distance:number):number {
  if(distance<=0)return 0;
  return Math.min(1.8,distance*.6);
}

function setProgress(node:HTMLElement,progress:number):boolean {
  const value=clamp01(progress).toFixed(4);
  if(node.dataset.karaokeProgress===value)return false;
  node.dataset.karaokeProgress=value;
  const stops=gradientStops(progress);
  node.style.setProperty('--karaoke-progress',value);
  node.style.setProperty('--karaoke-start',`${stops.start.toFixed(3)}%`);
  node.style.setProperty('--karaoke-end',`${stops.end.toFixed(3)}%`);
  node.style.setProperty('--karaoke-glow',String(Math.max(0,1-Math.abs(progress-.5)/.22).toFixed(3)));
  return true;
}

/** Paint only one active DOM line; React does not participate in frame updates. */
export function paintTimedLine(root:HTMLElement,time:number,reducedMotion=false):void {
  const lineStart=Number(root.dataset.start),lineEnd=Number(root.dataset.end);
  const lineProgress=intervalProgress(time,lineStart,lineEnd);
  root.querySelector<HTMLElement>('.interference-line')?.style.setProperty('--line-glow',String((Math.max(0,1-Math.abs(lineProgress-.5)/.2)*.24).toFixed(3)));
  const fill=root.querySelector<HTMLElement>('.lyric-line-fill');
  if(fill)setProgress(fill,lineProgress);

  root.querySelectorAll<HTMLElement>('.lyric-segment[data-start][data-end]').forEach(segment=>{
    const progress=intervalProgress(time,Number(segment.dataset.start),Number(segment.dataset.end));
    segment.dataset.played=progress>=1?'true':'false';
    if(!setProgress(segment,progress))return;
    const letters=segment.querySelectorAll<HTMLElement>('.lyric-letter');
    letters.forEach((letter,index)=>{
      const motion=letterMotion(progress,index,letters.length);
      if(reducedMotion){motion.lift=0;motion.scale=1;}
      const lift=`${motion.lift.toFixed(3)}px`,scale=motion.scale.toFixed(4);
      if(letter.style.getPropertyValue('--letter-lift')!==lift)letter.style.setProperty('--letter-lift',lift);
      if(letter.style.getPropertyValue('--letter-scale')!==scale)letter.style.setProperty('--letter-scale',scale);
      const lit=`${Math.round(motion.progress*100)}%`;
      if(letter.style.getPropertyValue('--letter-lit')!==lit)letter.style.setProperty('--letter-lit',lit);
    });
  });
}
