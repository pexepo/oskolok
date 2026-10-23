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

// Maximum tail beyond measured timing, including the minimum short accent.
export const WORD_PULL_RELEASE_SECONDS=.85;
/** The motion follows local singing cadence and overlaps the next element.
 * Slow segments stretch the entire curve; fast ones retain a gentle minimum
 * duration. One symmetric cosine curve gives growth and return equal speed,
 * without separate easing stages that brake and accelerate midway through.
 * The small downward dip does not restart the scale curve. Long silent gaps
 * never extend the accent across the gap.
 * y is in em. Audio time drives both movement and seek/pause restoration.
 */
export function wordPullMotion(time:number,start:number,end:number,nextStart?:number,nextEnd?:number):{y:number;scale:number;opacity:number} {
  const rest={y:0,scale:1,opacity:1};
  if(end<=start||time<=start)return rest;
  const upcomingStart=nextStart??end;
  const hasHandoff=nextStart!==undefined&&Number.isFinite(nextStart)&&nextStart>start&&nextStart-end<=.65;
  const handoff=hasHandoff?Math.max(end,upcomingStart):end;
  const nextDuration=hasHandoff&&nextEnd!==undefined&&Number.isFinite(nextEnd)&&nextEnd>upcomingStart?nextEnd-upcomingStart:undefined;
  const overlap=nextDuration===undefined ? .24 : Math.min(.4,Math.max(.18,nextDuration*.35));
  const finish=Math.max(start+.85,handoff+overlap);
  if(time>=finish)return rest;
  const progress=intervalProgress(time,start,finish);
  const accent=(1-Math.cos(2*Math.PI*progress))/2;
  const returnProgress=Math.max(0,progress*2-1);
  const dip=(1-Math.cos(2*Math.PI*returnProgress))/2;
  return {y:.025*dip,scale:1+.055*accent,opacity:1};
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
  node.style.setProperty('--karaoke-glow-blur',`${(Math.max(0,1-Math.abs(progress-.5)/.32)*12).toFixed(2)}px`);
  return true;
}

/** Paint only one active DOM line; React does not participate in frame updates. */
export function paintTimedLine(root:HTMLElement,time:number,reducedMotion=false):void {
  const lineStart=Number(root.dataset.start),lineEnd=Number(root.dataset.end);
  const lineProgress=intervalProgress(time,lineStart,lineEnd);
  root.querySelector<HTMLElement>('.interference-line')?.style.setProperty('--line-glow',String((Math.max(0,1-Math.abs(lineProgress-.5)/.2)*.24).toFixed(3)));
  const fill=root.querySelector<HTMLElement>('.lyric-line-fill');
  if(fill)setProgress(fill,lineProgress);
  const last=root.querySelector<HTMLElement>('.lyric-last-word');
  if(last){
    const start=Number(last.dataset.start??last.dataset.wordStart),end=Number(last.dataset.end??last.dataset.wordEnd);
    const lit=String(time>=start);
    if(last.dataset.lit!==lit)last.dataset.lit=lit;
    // The holographic underlay grows in with the word instead of switching on.
    const alpha=(reducedMotion?(time>=start?1:0):intervalProgress(time,start,start+Math.max(.45,(end-start)*.7))).toFixed(3);
    if(last.style.getPropertyValue('--holo-alpha')!==alpha)last.style.setProperty('--holo-alpha',alpha);
  }

  paintTimedWordSegments(root,time,reducedMotion);
}

/** Keep a word's cooldown alive after its containing line has finished.
 * Syllables only fill with colour; the lift and scale belong to the whole
 * word, so its syllables never drift apart and no layout is read per frame.
 */
export function paintTimedWordSegments(root:HTMLElement,time:number,reducedMotion=false):void {
  let settling=false;
  root.querySelectorAll<HTMLElement>('.lyric-pull-word[data-word-start]').forEach(word=>{
    const d=word.dataset;
    const pull=wordPullMotion(time,Number(d.wordStart),Number(d.wordEnd),d.nextStart===undefined?undefined:Number(d.nextStart),d.nextEnd===undefined?undefined:Number(d.nextEnd));
    const moving=pull.y!==0||pull.scale!==1;
    settling ||= moving;
    const animating=!reducedMotion&&moving?'true':'false';
    if(d.animating===animating&&!moving&&word.style.getPropertyValue('--word-pull-scale')==='1')return;
    d.animating=animating;
    word.style.setProperty('--word-pull-y',`${(reducedMotion?0:pull.y).toFixed(5)}em`);
    word.style.setProperty('--word-pull-scale',String(reducedMotion?1:pull.scale));
    word.style.setProperty('--word-pull-glow',String(reducedMotion?0:(pull.scale-1)*5));
    word.style.setProperty('--word-pull-opacity',String(reducedMotion?1:pull.opacity));
  });
  // Syllables of split words carry their own bounce (see WordPullUp).
  root.querySelectorAll<HTMLElement>('.lyric-pull-segment[data-pull-start]').forEach(syllable=>{
    const d=syllable.dataset;
    if(d.pullStart===undefined)return;
    const pull=wordPullMotion(time,Number(d.pullStart),Number(d.pullEnd),d.nextStart===undefined?undefined:Number(d.nextStart),d.nextEnd===undefined?undefined:Number(d.nextEnd));
    const moving=pull.y!==0||pull.scale!==1;
    settling ||= moving;
    const animating=!reducedMotion&&moving?'true':'false';
    if(d.animating===animating&&!moving&&syllable.style.getPropertyValue('--word-pull-scale')==='1')return;
    d.animating=animating;
    syllable.style.setProperty('--word-pull-y',`${(reducedMotion?0:pull.y).toFixed(5)}em`);
    syllable.style.setProperty('--word-pull-scale',String(reducedMotion?1:pull.scale));
    syllable.style.setProperty('--word-pull-glow',String(reducedMotion?0:(pull.scale-1)*5));
  });
  root.querySelectorAll<HTMLElement>('.lyric-segment[data-start][data-end]').forEach(segment=>{
    const progress=intervalProgress(time,Number(segment.dataset.start),Number(segment.dataset.end));
    segment.dataset.played=progress>=1?'true':'false';
    segment.dataset.current=progress>0&&progress<1?'true':'false';
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
  root.dataset.wordSettling=settling?'true':'false';
}

/** Interludes shorter than this keep the previous line on screen. */
export const LYRIC_GAP_MIN_SECONDS=3;
export interface LyricGap {index:number;start:number;end:number}
/** Waiting gaps before lead lines: the intro before the first line and long
 * instrumental breaks. A gap ends exactly where its line starts. */
export function lyricGaps(lines:ReadonlyArray<{time:number;end:number;role?:string}>,min=LYRIC_GAP_MIN_SECONDS):LyricGap[] {
  const gaps:LyricGap[]=[];let reach=0;
  lines.forEach((line,index)=>{
    if(line.role!=='background'&&line.time-reach>=min)gaps.push({index,start:reach,end:line.time});
    reach=Math.max(reach,line.end);
  });
  return gaps;
}

/** Progress and edge fades of an open gap indicator, driven by audio time. */
export function paintLyricGap(node:HTMLElement,time:number):void {
  const start=Number(node.dataset.gapStart),end=Number(node.dataset.gapEnd);
  const progress=intervalProgress(time,start,end).toFixed(3),alpha=clamp01(Math.min(start<=0?1:(time-start)/.5,(end-time)/.45)).toFixed(3);
  if(node.dataset.progress===progress&&node.dataset.alpha===alpha)return;
  node.dataset.progress=progress;node.dataset.alpha=alpha;
  node.style.setProperty('--gap-progress',progress);
  node.style.setProperty('--gap-alpha',alpha);
}
