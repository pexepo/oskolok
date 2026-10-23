import { Component, memo } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { NormalizedLyricLine } from '../../utils/lyricsParser.js';
import { gradientStops, intervalProgress } from '../../utils/lyricMotion.js';
import { displayText, splitByRanges, type AnnotationRange } from '../../utils/geniusAnnotations.js';
import { isRtlText } from '../../utils/textDirection.js';
import { WordPullUp } from '../ui/word-pull-up.js';
import { CornerMark, GeniusMark } from './GeniusMark.js';

type Props = {
  line: NormalizedLyricLine;
  isActive: boolean;
  isSung: boolean;
  currentTime: number;
  onSeek: (time: number) => void;
  /** Word-timed lines alternate: every other one carries the closing-word glow. */
  glow?: boolean;
  /** Genius fragments inside this line, in displayed-text offsets. */
  notes?: AnnotationRange[];
  lineIndex?: number;
  onAnnotate?: (lineIndex: number, referent: number) => void;
  /** Referent whose note is open in the side panel, when it touches this line. */
  selected?: number;
  /** Translated text shown under the line. */
  translation?: string;
};

function progressStyle(progress:number):CSSProperties {
  const stops=gradientStops(progress);
  return {'--karaoke-progress':progress.toFixed(4),'--karaoke-start':`${stops.start}%`,'--karaoke-end':`${stops.end}%`} as CSSProperties;
}

/** Only the glyph and its small padded hit area open the note. */
function noteHandlers(open:()=>void){
  return {
    onClick:(event:MouseEvent)=>{event.stopPropagation();event.preventDefault();open();},
    onPointerDown:(event:MouseEvent)=>event.stopPropagation(),
    onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' '){event.stopPropagation();event.preventDefault();open();}},
  };
}
/** A fragment is framed, not highlighted: the Genius mark where it starts, a corner where it ends.
 * Both open the note; the accessible control lives outside the seek button. */
const StartMark=({open,selected}:{open:()=>void;selected?:boolean})=><span className="lyric-genius-start" aria-hidden="true" data-selected={selected?'true':undefined} {...noteHandlers(open)}><GeniusMark size={12}/></span>;
const Badge=({open,selected}:{open:()=>void;selected?:boolean})=><span className="lyric-genius-badge" aria-hidden="true" data-selected={selected?'true':undefined} {...noteHandlers(open)}><CornerMark size={11}/></span>;

/** A fault while drawing annotations must never take the player down: the line falls back to plain text. */
class NoteGuard extends Component<{resetKey:unknown;fallback:ReactNode;children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:unknown){console.warn('[lyrics] a line failed to render, showing it plain',error);}
  componentDidUpdate(previous:{resetKey:unknown}){if(this.state.failed&&previous.resetKey!==this.props.resetKey)this.setState({failed:false});}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

/** Annotated text keeps the line's seek action; only its trailing badge opens a note. */
export const LyricsLine = memo(function LyricsLine({line,isActive,isSung,currentTime,onSeek,glow=false,notes,lineIndex=-1,onAnnotate,selected,translation}:Props) {
  const rtl=isRtlText(line.text),lineProgress=intervalProgress(currentTime,line.time,line.end),wordTimed=line.timingMode==='syllable'&&!!line.words?.length;
  const marks=onAnnotate&&notes?.length?notes:undefined,open=(range:AnnotationRange)=>()=>onAnnotate?.(lineIndex,range.referent);
  const isOpen=(range:AnnotationRange)=>selected!==undefined&&(range.referent===selected||!!range.also?.includes(selected));
  const annotated=(range:AnnotationRange,children:ReactNode,key:string|number)=><span key={key} className="lyric-annot" data-first={range.first?'true':'false'} data-last={range.last?'true':'false'} data-selected={isOpen(range)?'true':undefined}>{range.first&&<StartMark open={open(range)} selected={isOpen(range)}/>}{children}</span>;
  const plain=marks?splitByRanges(displayText(line),marks).map((piece,i)=>piece.range?<span key={i} className="lyric-annot-wrap">{annotated(piece.range,piece.text,'t')}{piece.range.last&&<Badge open={open(piece.range)} selected={isOpen(piece.range)}/>}</span>:<span key={i}>{piece.text}</span>):line.text;
  return <div className={`lyric-voice ${line.role==='background'?'lyric-background':''} ${marks?'has-annotation':''}`} data-agent={line.agent}>
    {line.agentName&&!/^v\d+$/i.test(line.agentName)&&<span className="lyric-agent">{line.agentName}</span>}
    <button
      onClick={()=>onSeek(line.time)}
      aria-label={line.text}
      aria-current={isActive?'true':undefined}
      dir={rtl?'rtl':'ltr'}
      className={`interference-line ${isActive?'active':''} ${isSung?'sung':'not-sung'} ${wordTimed?'word-timed':'line-timed'}`}
    >
      <span className="lyric-text" aria-hidden="true"><NoteGuard resetKey={marks} fallback={<span className="lyric-line-fill">{displayText(line)}</span>}>{wordTimed?<WordPullUp words={line.text} timedWords={line.words} currentTime={currentTime} glowLast={glow} marks={marks} renderMark={(range,children,key)=>annotated(range,children,key)} renderBadge={range=><Badge open={open(range)} selected={isOpen(range)}/>}/>:<span className="lyric-line-fill" style={progressStyle(lineProgress)}>{plain}</span>}</NoteGuard></span>
    </button>
    {marks?.map((range,i)=>range.first&&<button key={i} type="button" className="sr-only" onClick={open(range)}>{`Аннотация Genius: ${displayText(line).slice(range.start,range.end)}`}</button>)}
    {line.romanization&&<p className="lyric-romanization" dir="auto">{line.romanization}</p>}
    {(translation||line.translation)&&<p className={`lyric-translation${translation?' is-machine':''}`} dir="auto">{translation||line.translation}</p>}
  </div>;
},(previous,next)=>previous.line===next.line&&previous.isActive===next.isActive&&previous.isSung===next.isSung&&previous.onSeek===next.onSeek&&previous.glow===next.glow&&previous.notes===next.notes&&previous.lineIndex===next.lineIndex&&previous.onAnnotate===next.onAnnotate&&previous.selected===next.selected&&previous.translation===next.translation);

/** An unsynced line (Genius plain text) framed with the same annotation marks; it has no timing to seek to. */
export const PlainLyricLine = memo(function PlainLyricLine({text,translation,notes,lineIndex,onAnnotate,selected}:{text:string;translation?:string;notes?:AnnotationRange[];lineIndex:number;onAnnotate?:(lineIndex:number,referent:number)=>void;selected?:number}) {
  if(!text.trim())return <div className="plain-lyrics-gap" aria-hidden="true"/>;
  if(!notes?.length||!onAnnotate)return <><p className="plain-lyrics-line" dir="auto">{text}</p>{translation&&<p className="lyric-translation is-machine" dir="auto">{translation}</p>}</>;
  const open=(range:AnnotationRange)=>()=>onAnnotate(lineIndex,range.referent);
  const isOpen=(range:AnnotationRange)=>selected!==undefined&&(range.referent===selected||!!range.also?.includes(selected));
  return <><p className="plain-lyrics-line" dir="auto">
    {splitByRanges(text,notes).map((piece,i)=>piece.range?<span key={i} className="lyric-annot-wrap"><span className="lyric-annot" data-selected={isOpen(piece.range)?'true':undefined}>{piece.range.first&&<StartMark open={open(piece.range)} selected={isOpen(piece.range)}/>}{piece.text}</span>{piece.range.last&&<Badge open={open(piece.range)} selected={isOpen(piece.range)}/>}</span>:<span key={i}>{piece.text}</span>)}
    {notes.map((range,i)=>range.first&&<button key={`a${i}`} type="button" className="sr-only" onClick={open(range)}>{`Аннотация Genius: ${text.slice(range.start,range.end)}`}</button>)}
  </p>{translation&&<p className="lyric-translation is-machine" dir="auto">{translation}</p>}</>;
});
