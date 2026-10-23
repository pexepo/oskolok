import { describe, expect, it } from 'vitest';
import { annotationRanges, splitByRanges } from '../src/utils/geniusAnnotations.js';
import { isRtlText } from '../src/utils/textDirection.js';

const ref = (id: number, fragment: string, order?: number) => ({ id, fragment, classification: 'accepted', annotations: [], ...(order === undefined ? {} : { order }) });
/** The annotated pieces of a line, as drawn. */
const marked = (lines: Array<{ text: string }>, map: Map<number, ReturnType<typeof annotationRanges> extends Map<number, infer R> ? R : never>, line: number) =>
  splitByRanges(lines[line].text, map.get(line) || []).filter(piece => piece.range).map(piece => piece.text);

describe('Genius fragment placement', () => {
  it('keeps a fragment nested inside another instead of dropping it: both share one badge', () => {
    const lines = [{ text: "I been movin' calm, don't start no trouble with me" }];
    const map = annotationRanges(lines, [ref(1, "I been movin’ calm, don’t start no trouble with me"), ref(2, 'don’t start no trouble')]);
    expect(map.get(0)).toEqual([{ referent: 0, also: [1], start: 0, end: lines[0].text.length, first: true, last: true }]);
  });

  it('picks the repeat the page order points at, which also lets a lone short word bind', () => {
    const lines = [{ text: 'Dior on my wrist now' }, { text: 'Gold chains everywhere' }, { text: 'Dior on my wrist now' }];
    const map = annotationRanges(lines, [ref(1, 'Gold chains everywhere', 0), ref(2, 'Dior', 1)]);
    expect(map.has(0)).toBe(false);
    expect(marked(lines, map, 2)).toEqual(['Dior']);
  });

  it('binds a lone word without page order only when it is distinctive', () => {
    const lines = [{ text: 'Parmesan where my accountant lives' }, { text: 'Dior on my wrist' }, { text: 'Dior again' }];
    expect(marked(lines, annotationRanges(lines, [ref(1, 'Parmesan')]), 0)).toEqual(['Parmesan']);
    expect(annotationRanges(lines, [ref(1, 'Dior')]).size).toBe(0);
    expect(annotationRanges([{ text: 'Yeah, back to the lab again' }], [ref(1, 'Yeah')]).size).toBe(0);
  });

  it('tolerates spelling variants and a different way of breaking lines', () => {
    const lines = [{ text: 'This shit way too crazy, aye' }, { text: 'You do not amaze me, aye' }, { text: 'Unrelated closing line' }];
    const map = annotationRanges(lines, [ref(1, 'Ayy, this shit way too crazy, ayy, you do not amaze me, ayy')]);
    expect(map.get(0)?.[0]).toMatchObject({ first: true, last: false });
    expect(map.get(1)?.[0]).toMatchObject({ first: false, last: true });
    expect(map.has(2)).toBe(false);
  });

  it('ignores section labels and finds a fragment that includes back-vocal asides', () => {
    expect(annotationRanges([{ text: 'Look, if you had one shot' }], [ref(1, '[Verse 1]'), ref(2, '[Intro]')]).size).toBe(0);
    const lines = [{ text: 'I finessed down Weston Road' }, { text: 'Ayy, nessed', role: 'background' }];
    const map = annotationRanges(lines, [ref(1, 'I finessed down Weston Road (Ayy, ’nessed)')]);
    expect(marked(lines, map, 0)).toEqual(['I finessed down Weston Road']);
    expect(map.has(1)).toBe(false);
  });

  it('matches a name written in the other script', () => {
    const lines = [{ text: 'Томми Хилфигер, Волга, smoking session' }];
    expect(marked(lines, annotationRanges(lines, [ref(1, 'Tommy Hilfiger (У), Волга, smoking session')]), 0)).toEqual(['Томми Хилфигер, Волга, smoking session']);
  });

  it('does not bind unrelated lines', () => {
    expect(annotationRanges([{ text: 'Completely different words here' }], [ref(1, 'I been movin calm dont start no trouble')]).size).toBe(0);
  });

  it('marks a long phrase wherever it is sung word for word', () => {
    const lines = [{ text: 'You better lose yourself in the music' }, { text: 'Something else entirely' }, { text: 'You better lose yourself in the music' }];
    const map = annotationRanges(lines, [ref(1, 'You better lose yourself in the music', 0)]);
    expect([...map.keys()].sort()).toEqual([0, 2]);
  });

  it('places ranges in the text a word-timed line actually renders', () => {
    const lines = [{ text: 'Один долгий текст', timingMode: 'syllable', words: [{ text: 'Один' }, { text: 'долгий' }, { text: 'текст' }] }];
    expect(annotationRanges(lines, [ref(1, 'долгий текст')]).get(0)).toEqual([{ referent: 0, start: 5, end: 17, first: true, last: true }]);
  });
});

describe('text direction', () => {
  it('is decided by the first letter, never by punctuation or symbols', () => {
    for (const line of ['Don’t stop me now…', '— Привет, мир', '“Quoted”', '愛してる', '(Ayy) — yeah', '’Cause I do', '']) expect(isRtlText(line)).toBe(false);
    for (const line of ['שלום עולם', 'مرحبا بالعالم', '123 שלום', '“שלום”']) expect(isRtlText(line)).toBe(true);
    expect(isRtlText('Hello שלום')).toBe(false);
  });
});
