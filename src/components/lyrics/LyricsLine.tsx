import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { NormalizedLyricLine } from '../../utils/lyricsParser.js';
import { gradientStops, intervalProgress, letterMotion, lineBlur, splitGraphemes } from '../../utils/lyricMotion.js';

type Props = {
  line: NormalizedLyricLine;
  isActive: boolean;
  isSung: boolean;
  currentTime: number;
  focusDistance: number;
  onSeek: (time: number) => void;
};

const isRtl = (text:string) => /[\u0590-\u08ff\ufb1d-\ufefc]/.test(text);

function progressStyle(progress:number):CSSProperties {
  const stops=gradientStops(progress);
  return {'--karaoke-progress':progress.toFixed(4),'--karaoke-start':`${stops.start}%`,'--karaoke-end':`${stops.end}%`} as CSSProperties;
}

export const LyricsLine = memo(function LyricsLine({line,isActive,isSung,currentTime,focusDistance,onSeek}:Props) {
  const rtl=isRtl(line.text),lineProgress=intervalProgress(currentTime,line.time,line.end);
  return <div className={`lyric-voice ${line.role==='background'?'lyric-background':''}`} data-agent={line.agent}>
    {line.agentName&&!/^v\d+$/i.test(line.agentName)&&<span className="lyric-agent">{line.agentName}</span>}
    <button
      onClick={()=>onSeek(line.time)}
      aria-label={line.text}
      aria-current={isActive?'true':undefined}
      dir={rtl?'rtl':'ltr'}
      style={{'--line-blur':`${lineBlur(focusDistance)}px`} as CSSProperties}
      className={`interference-line ${isActive?'active':''} ${isSung?'sung':'not-sung'} ${line.timingMode==='syllable'?'word-timed':'line-timed'}`}
    >
      <span aria-hidden="true">{line.timingMode==='syllable'&&line.words?.length?line.words.map((word,index)=>{
        const progress=intervalProgress(currentTime,word.start,word.end),graphemes=splitGraphemes(word.text),letterCount=graphemes.filter(g=>!/^\s+$/u.test(g)).length;
        const isSyllable=word.joinNext||line.words![index-1]?.joinNext;
        const emphasize=(isSyllable||word.end-word.start>=1)&&letterCount>0&&letterCount<=12&&!rtl;
        const needsSpace=index<line.words!.length-1&&!word.joinNext&&!/\s$/.test(word.text);
        let letterIndex=0;
        return <span key={`${word.start}:${index}`} className={`lyric-segment ${word.joinNext?'lyric-syllable':''} ${emphasize?'has-letter-motion':''}`} data-start={word.start} data-end={word.end} data-played={currentTime>=word.end?'true':'false'} data-current={currentTime>=word.start&&currentTime<word.end?'true':'false'} style={progressStyle(progress)}>
          {emphasize?graphemes.map((grapheme,glyphIndex)=>{
            if(/^\s+$/u.test(grapheme))return <span key={glyphIndex}>{grapheme}</span>;
            const motion=letterMotion(progress,letterIndex++,letterCount);
            return <span key={glyphIndex} className="lyric-letter" style={{'--letter-lift':`${motion.lift}px`,'--letter-scale':motion.scale,'--letter-lit':`${Math.round(motion.progress*100)}%`} as CSSProperties}>{grapheme}</span>;
          }):word.text}{needsSpace?' ':''}
        </span>;
      }):<span className="lyric-line-fill" style={progressStyle(lineProgress)}>{line.text}</span>}</span>
    </button>
    {line.romanization&&<p className="lyric-romanization">{line.romanization}</p>}
    {line.translation&&<p className="lyric-translation">{line.translation}</p>}
  </div>;
},(previous,next)=>previous.line===next.line&&previous.isActive===next.isActive&&previous.isSung===next.isSung&&previous.focusDistance===next.focusDistance&&previous.onSeek===next.onSeek);
