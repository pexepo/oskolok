// Mirrors server/src/services/GeniusAnnotationService.ts.
export type GeniusDomNode = string | { tag: string; attributes?: Record<string, string>; children?: GeniusDomNode[] };
export interface GeniusAnnotationAuthor { name: string; login?: string; avatar?: string; iq?: number; url?: string; role?: string }
export interface GeniusAnnotation { id: number; body: GeniusDomNode[]; plain: string; votes: number; verified: boolean; state: string; url?: string; authors: GeniusAnnotationAuthor[] }
/** `order`: rank of the fragment on the Genius page (song order), when the server could read it. */
export interface GeniusReferent { id: number; fragment: string; classification: string; annotations: GeniusAnnotation[]; order?: number }
/** `transient`: the lookup failed rather than found nothing; worth asking again shortly. */
export interface GeniusAnnotationSet { song: { id: number; title: string; artist: string; url: string } | null; referents: GeniusReferent[]; transient?: boolean }
/** One annotated stretch inside a line: [start,end) character offsets of the displayed text.
 * `also`: further fragments that overlap the same stretch and share its badge. */
export interface AnnotationRange { referent: number; start: number; end: number; first: boolean; last: boolean; also?: number[] }
type LyricLike = { text: string; role?: string; timingMode?: string; words?: ReadonlyArray<{ text: string; joinNext?: boolean }> };

/** A word of the song as alignment sees it: normalised text and its [start,end) span in the displayed line. */
interface Word { text: string; line: number; start: number; end: number }
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Lowercased, diacritic-folded words of `source`. Apostrophes vanish, anything else that isn't a letter or digit
 * separates words, and scripts written without spaces give one word per character. Spans index `source`. */
function words(source: string, line = 0): Word[] {
  const out: Word[] = [];
  let text = '', start = 0, end = 0;
  const flush = () => { if (text) out.push({ text, line, start, end }); text = ''; };
  for (let i = 0; i < source.length; i++) {
    for (const ch of source[i].toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')) {
      if (/[’'`ʼ‘]/.test(ch)) continue;
      if (!/[\p{L}\p{N}]/u.test(ch)) { flush(); continue; }
      if (SPACELESS.test(ch)) { flush(); out.push({ text: ch, line, start: i, end: i + 1 }); continue; }
      if (!text) start = i;
      text += ch; end = i + 1;
    }
  }
  flush();
  return out;
}
export const normalizeLyricText = (text: string) => words(text).map(word => word.text).join(' ');

/** The text a line actually renders: word-timed lines are drawn from their words. */
export function displayText(line: LyricLike): string {
  if (line.timingMode !== 'syllable' || !line.words?.length) return line.text;
  return line.words.map((word, index) => word.text + (index < line.words!.length - 1 && !word.joinNext && !/\s$/.test(word.text) ? ' ' : '')).join('');
}

const LATIN: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const latin = (word: string) => word.replace(/[а-я]/g, letter => LATIN[letter]);

/** Within one or two edits (two for long words), and starting alike. */
function close(a: string, b: string): boolean {
  const k = Math.max(a.length, b.length) >= 9 ? 2 : 1;
  if (a[0] !== b[0] || Math.abs(a.length - b.length) > k) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(cost);
      if (cost < low) low = cost;
    }
    if (low > k) return false;
    previous = row;
  }
  return previous[b.length] <= k;
}
/** Spelling variants of one word: "ayy"/"aye", "colour"/"color", and one name written in either script
 * ("Томми"/"Tommy"), which Russian lyrics sites do inconsistently. */
const near = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (close(a, b) || (/[а-я]/.test(a + b) && close(latin(a), latin(b))));

/** A stretch of the song's word stream, [from,to] inclusive. */
interface Hit { from: number; to: number; matched: number; exact: boolean; quality: number }

/** Finds where `fragment` sits in `stream`: a fitting alignment (the whole fragment, anywhere in the song) that
 * tolerates a missing or extra word and, when `loose`, one-letter spelling differences. Lyrics sites disagree
 * about ad-libs, contractions and line breaks, so a fragment is accepted when most of its words line up in order. */
function locate(fragment: string[], stream: string[], loose: boolean): Hit[] {
  const m = fragment.length, n = stream.length, W = n + 1;
  if (!m || !n) return [];
  const H = new Float32Array((m + 1) * W), D = new Uint8Array((m + 1) * W); // D: 1 match, 2 mismatch, 3 fragment word missing, 4 extra song word
  for (let i = 1; i <= m; i++) { H[i * W] = H[(i - 1) * W] - 1; D[i * W] = 3; }
  for (let i = 1; i <= m; i++) {
    const f = fragment[i - 1];
    for (let j = 1; j <= n; j++) {
      const s = stream[j - 1], kind = f === s ? 2 : loose && near(f, s) ? 1 : 0;
      let best = H[(i - 1) * W + j - 1] + (kind === 2 ? 2 : kind === 1 ? 1.3 : -1.5), dir = kind ? 1 : 2;
      const missing = H[(i - 1) * W + j] - 1;
      if (missing > best) { best = missing; dir = 3; }
      const extra = H[i * W + j - 1] - .8;
      if (extra > best) { best = extra; dir = 4; }
      H[i * W + j] = best; D[i * W + j] = dir;
    }
  }
  // Long fragments are whole verses: vocalisations and repeats rarely agree, yet 55% of them in order and compact is no accident.
  const need = m <= 3 ? m : Math.ceil(m * (m >= 20 ? .55 : m >= 10 ? .65 : .75)), hits: Hit[] = [];
  for (let end = 1; end <= n; end++) {
    const score = H[m * W + end];
    if (score <= 0 || score < H[m * W + end - 1] || (end < n && score <= H[m * W + end + 1])) continue;
    let i = m, k = end, matched = 0, exact = 0, from = -1, to = -1;
    while (i > 0 && k > 0) {
      const dir = D[i * W + k];
      if (dir <= 2) {
        if (dir === 1) { matched++; if (fragment[i - 1] === stream[k - 1]) exact++; if (to < 0) to = k - 1; from = k - 1; }
        i--; k--;
      } else if (dir === 3) i--; else k--;
    }
    const span = to - from + 1;
    if (matched < need || span > matched + Math.max(1, Math.floor(m * .4))) continue;
    hits.push({ from, to, matched, exact: exact === m && matched === m, quality: matched / Math.max(m, span) });
  }
  // The same stretch can surface from neighbouring end cells; keep the best of any that overlap.
  hits.sort((a, b) => b.quality - a.quality || a.from - b.from);
  const kept: Hit[] = [];
  for (const hit of hits) if (!kept.some(other => hit.from <= other.to && other.from <= hit.to)) kept.push(hit);
  return kept.sort((a, b) => a.from - b.from);
}

/** Fragments that overlap one stretch share a single badge; the fragment that ends there owns it. */
function mergeOverlaps(list: AnnotationRange[]): AnnotationRange[] {
  list.sort((a, b) => a.start - b.start || b.end - a.end);
  const groups: Array<{ start: number; end: number; members: AnnotationRange[] }> = [];
  for (const range of list) {
    const group = groups[groups.length - 1];
    if (group && range.start < group.end) { group.end = Math.max(group.end, range.end); group.members.push(range); }
    else groups.push({ start: range.start, end: range.end, members: [range] });
  }
  return groups.map(({ start, end, members }) => {
    if (members.length === 1) return members[0];
    const ending = members.filter(member => member.last), ids = [...new Set((ending.length ? ending : members).map(member => member.referent))];
    return { referent: ids[0], start, end, first: members.some(member => member.first), last: ending.length > 0, ...(ids.length > 1 ? { also: ids.slice(1) } : {}) };
  });
}

/** Annotated character ranges per line index. A fragment is located in the whole song's word stream, so it may
 * begin or end mid-line and run across lines however they are broken; one range per line it touches, with
 * `first`/`last` marking where it begins and ends so the badge sits after its final word.
 *
 * When the server could read the Genius page, fragments carry their song order: each is looked for from where the
 * previous one began, which picks the right repeat of a chorus and lets a lone word like "Dior" bind. Without it,
 * only distinctive short fragments bind and a phrase marks every place it is sung. */
export function annotationRanges(lines: ReadonlyArray<LyricLike>, referents: ReadonlyArray<GeniusReferent>): Map<number, AnnotationRange[]> {
  const result = new Map<number, AnnotationRange[]>();
  const stream: Word[] = [];
  lines.forEach((line, index) => { if (line.role !== 'background' && referents.length) stream.push(...words(displayText(line), index)); });
  if (!stream.length) return result;
  const song = stream.map(word => word.text), perLine = new Map<number, AnnotationRange[]>();
  const place = (referent: number, from: number, to: number) => {
    for (let k = from; k <= to;) {
      const line = stream[k].line;
      let end = k;
      while (end < to && stream[end + 1].line === line) end++;
      if (!perLine.has(line)) perLine.set(line, []);
      perLine.get(line)!.push({ referent, start: stream[k].start, end: stream[end].end, first: line === stream[from].line, last: line === stream[to].line });
      k = end + 1;
    }
  };
  const queue = referents.map((referent, index) => ({ referent, index })).sort((a, b) => (a.referent.order ?? 1e9) - (b.referent.order ?? 1e9) || a.index - b.index);
  let cursor = 0;
  for (const { referent, index } of queue) {
    const text = referent.fragment.replace(/\[[^\]]*\]/g, ' ');
    const positioned = referent.order !== undefined;
    let hits: Hit[] = [], m = 0;
    // Back-vocal asides "(Ayy, 'nessed)" are separate background lines in timed lyrics, so a fragment that
    // includes them is tried again without.
    for (const variant of [text, text.replace(/\([^)]*\)/g, ' ')]) {
      const fragment = words(variant).map(word => word.text);
      m = fragment.length;
      if (!m) continue;
      if (m === 1) {
        // A lone word binds only where it is rare, or where the page order says which occurrence is meant.
        if (fragment[0].length < (positioned ? 3 : 5)) continue;
        hits = song.flatMap((word, at) => word === fragment[0] ? [{ from: at, to: at, matched: 1, exact: true, quality: 1 }] : []);
        if (!positioned && hits.length > 2) hits = [];
      } else {
        hits = locate(fragment, song, m >= 4);
        if (!positioned && m <= 3 && hits.length > 3) hits = [];
      }
      if (hits.length) break;
    }
    if (!hits.length) continue;
    let chosen = hits;
    if (positioned) {
      const top = Math.max(...hits.map(hit => hit.quality)), after = hits.filter(hit => hit.from >= cursor && hit.quality >= top - .15);
      const main = after[0] || hits.reduce((best, hit) => hit.quality > best.quality ? hit : best);
      chosen = [main];
      if (main.from >= cursor) cursor = main.from;
      // A long phrase sung again (chorus) is marked wherever it repeats word for word.
      if (m >= 5) chosen.push(...hits.filter(hit => hit !== main && hit.exact).slice(0, 3));
    } else chosen = hits.slice(0, 6);
    for (const hit of chosen) place(index, hit.from, hit.to);
  }
  for (const [line, list] of perLine) result.set(line, mergeOverlaps(list));
  return result;
}

/** Splits `text` into plain and annotated pieces for rendering. */
export function splitByRanges(text: string, ranges: ReadonlyArray<AnnotationRange>): Array<{ text: string; start: number; range?: AnnotationRange }> {
  const out: Array<{ text: string; start: number; range?: AnnotationRange }> = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) out.push({ text: text.slice(at, range.start), start: at });
    out.push({ text: text.slice(range.start, range.end), start: range.start, range });
    at = range.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), start: at });
  return out;
}
