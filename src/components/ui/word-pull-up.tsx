"use client";

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { AnnotationRange } from '@/utils/geniusAnnotations';
import { motion, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { LyricWord } from '@/types';
import { gradientStops, intervalProgress, isLongNote, letterMotion, letterStyle, splitGraphemes, wordPullMotion } from '@/utils/lyricMotion';
import './word-pull-up.css';

interface WordPullUpProps {
  words: string;
  delayMultiple?: number;
  wrapperFramerProps?: Variants;
  framerProps?: Variants;
  className?: string;
  /** Measured audio timing replaces the demo's fixed stagger for karaoke. */
  timedWords?: LyricWord[];
  currentTime?: number;
  /** Give the closing word the holographic glow (every other line). */
  glowLast?: boolean;
  /** Annotated character ranges of the displayed text (words joined as rendered). */
  marks?: AnnotationRange[];
  renderMark?: (range: AnnotationRange, children: ReactNode, key: string) => ReactNode;
  renderBadge?: (range: AnnotationRange) => ReactNode;
}

function WordPullUp({
  words,
  delayMultiple = 0.2,
  wrapperFramerProps,
  framerProps = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
  },
  className,
  timedWords,
  currentTime = 0,
  glowLast = false,
  marks,
  renderMark,
  renderBadge,
}: WordPullUpProps) {
  if (timedWords?.length) {
    const groups: Array<Array<{word: LyricWord; index: number}>> = [];
    timedWords.forEach((word, index) => {
      if (!index || !timedWords[index - 1].joinNext) groups.push([]);
      groups[groups.length - 1].push({word, index});
    });
    // Character offset of each word group in the rendered text, to place annotation ranges.
    let cursor = 0;
    const offsets = groups.map(group => {
      const last = group[group.length - 1], text = group.map(({word}) => word.text).join('');
      const start = cursor; cursor += text.length + (last.index < timedWords.length - 1 && !/\s$/.test(last.word.text) ? 1 : 0);
      return {start, end: start + text.trimEnd().length};
    });
    // The group after the last one does not exist: asking about it (to see whether a mark continues) is simply "no".
    const markFor = (groupIndex: number) => { const at = offsets[groupIndex]; return at && marks?.find(range => range.start < at.end && range.end > at.start); };
    const parts = groups.map((group, groupIndex) => {
      const first = group[0].word, last = group[group.length - 1];
      const needsSpace = last.index < timedWords.length - 1 && !/\s$/.test(last.word.text);
      // The closing word (all of its syllables) carries the holographic glow.
      const isLast = glowLast && groupIndex === groups.length - 1;
      // One-syllable words lift as one piece. Syllable-timed words (Spicy Lyrics, TTML) bounce
      // syllable by syllable, each on its own timing, so the motion follows how the word is sung.
      const nextWord = groups[groupIndex + 1];
      const nextStart = nextWord?.[0].word.start;
      const nextEnd = nextWord?.[nextWord.length - 1].word.end;
      const split = group.length > 1;
      // A held one-syllable note is sung letter by letter instead of lifting as a whole word.
      const held = !split && !isLast && isLongNote(first.text, first.start, first.end);
      const pull = split || held ? { y: 0, scale: 1, opacity: 1 } : wordPullMotion(currentTime, first.start, last.word.end, nextStart, nextEnd);
      const mark = markFor(groupIndex), closesMark = !!mark?.last && offsets[groupIndex].end >= mark.end - 1 && markFor(groupIndex + 1) !== mark;
      const wordNode = <span
        className={cn('lyric-pull-word', split && 'lyric-pull-word--split', isLast && 'lyric-last-word')}
        data-text={isLast ? group.map(({word}) => word.text).join('').trim() : undefined}
        data-lit={isLast ? String(currentTime >= first.start) : undefined}
        data-start={isLast ? first.start : undefined}
        data-end={isLast ? last.word.end : undefined}
        data-word-start={split || held ? undefined : first.start}
        data-word-end={split || held ? undefined : last.word.end}
        data-next-start={split || held ? undefined : nextStart}
        data-next-end={split || held ? undefined : nextEnd}
        data-animating={pull.y !== 0 || pull.scale !== 1 ? 'true' : 'false'}
        style={{
          '--word-pull-y': `${pull.y}em`,
          '--word-pull-scale': pull.scale,
          '--word-pull-glow': (pull.scale - 1) * 5,
          '--word-pull-opacity': pull.opacity,
        } as CSSProperties}
      >{group.map(({word, index}, at) => {
      const syllable = Boolean(word.joinNext || timedWords[index - 1]?.joinNext);
      const progress = intervalProgress(currentTime, word.start, word.end);
      const stops = gradientStops(progress);
      // Within a split word the next syllable hands the bounce on; the last one hands it to the next word.
      const after = group[at + 1]?.word, handStart = after ? after.start : nextStart, handEnd = after ? after.end : nextWord?.[0].word.end;
      const own = split ? wordPullMotion(currentTime, word.start, word.end, handStart, handEnd) : undefined;
      return <span
          key={`${word.start}:${index}`}
          className={cn('lyric-segment lyric-pull-segment', syllable && 'lyric-syllable', held && 'has-letter-motion')}
          data-start={word.start}
          data-end={word.end}
          data-syllable={syllable ? 'true' : 'false'}
          data-played={currentTime >= word.end ? 'true' : 'false'}
          data-current={currentTime >= word.start && currentTime < word.end ? 'true' : 'false'}
          data-pull-start={split ? word.start : undefined}
          data-pull-end={split ? word.end : undefined}
          data-next-start={split ? handStart : undefined}
          data-next-end={split ? handEnd : undefined}
          style={{
            '--karaoke-progress': progress.toFixed(4),
            '--karaoke-start': `${stops.start}%`,
            '--karaoke-end': `${stops.end}%`,
            ...(own ? { '--word-pull-y': `${own.y}em`, '--word-pull-scale': own.scale, '--word-pull-glow': (own.scale - 1) * 5 } : {}),
          } as CSSProperties}
        >{held ? (() => { const letters = splitGraphemes(word.text); return letters.map((letter, i) => <span key={i} className="lyric-letter" style={letterStyle(letterMotion(currentTime - word.start, i, letters.length, word.end - word.start)) as CSSProperties}>{letter}</span>);  })() : word.text}</span>;
      })}</span>;
      return { key: `${first.start}:${group[0].index}`, mark, wordNode, needsSpace, closesMark };
    });
    // Consecutive words of one annotated fragment share a single highlight, so it reads as one continuous stretch
    // with the badge right after its last word.
    const nodes: ReactNode[] = [];
    for (let at = 0; at < parts.length;) {
      const part = parts[at];
      if (!part.mark || !renderMark) { nodes.push(<Fragment key={part.key}>{part.wordNode}{part.needsSpace ? ' ' : ''}</Fragment>); at++; continue; }
      let end = at;
      while (end + 1 < parts.length && parts[end + 1].mark === part.mark) end++;
      const run = parts.slice(at, end + 1), tail = run[run.length - 1];
      nodes.push(<Fragment key={part.key}>
        {renderMark(part.mark, <>{run.map((item, i) => <Fragment key={item.key}>{item.wordNode}{item.needsSpace && i < run.length - 1 ? ' ' : ''}</Fragment>)}</>, 'm')}
        {tail.closesMark && renderBadge ? renderBadge(part.mark) : null}{tail.needsSpace ? ' ' : ''}</Fragment>);
      at = end + 1;
    }
    return <span className={cn('lyric-word-pull-up', className)}>{nodes}</span>;
  }

  return <motion.h1
    variants={wrapperFramerProps ?? {
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { staggerChildren: delayMultiple } },
    }}
    initial="hidden"
    animate="show"
    className={cn('font-display text-center text-4xl font-bold leading-[5rem] tracking-[-0.02em] drop-shadow-sm', className)}
  >
    {words.split(' ').map((word, index) => <motion.span
      key={index}
      variants={framerProps}
      style={{ display: 'inline-block', paddingRight: '8px' }}
    >{word === '' ? <span>&nbsp;</span> : word}</motion.span>)}
  </motion.h1>;
}

export { WordPullUp };
