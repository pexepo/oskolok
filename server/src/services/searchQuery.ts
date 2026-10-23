// Query understanding for catalogue search: layout slips, transliteration and
// small typos. Pure functions so ranking stays testable.

const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
const toRu = new Map([...EN].map((c, i) => [c, RU[i]]));
const toEn = new Map([...RU].map((c, i) => [c, EN[i]]));

/** "ghbdtn" → "привет", "фтвн цфкрщд" → "andy warhol"; null when the swap makes no sense. */
export function swapKeyboardLayout(query: string): string | null {
  const lower = query.toLocaleLowerCase();
  const latin = /[a-z]/.test(lower), cyrillic = /[а-яё]/.test(lower);
  if (latin === cyrillic) return null;
  const map = latin ? toRu : toEn;
  const swapped = [...lower].map(c => map.get(c) ?? c).join('');
  // A swap that leaves punctuation-only words is not a typing slip.
  if (!/[\p{L}]{2,}/u.test(swapped) || swapped === lower) return null;
  return swapped;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Loose Latin skeleton used only for comparison ("Кай Энджел" ≈ "kai endzhel"). */
export function latinSkeleton(text: string): string {
  return [...text.toLocaleLowerCase()].map(c => TRANSLIT[c] ?? c).join('')
    .replace(/(?:kh|x)/g, 'h').replace(/(?:ck|q|c)/g, 'k').replace(/(?:ph)/g, 'f').replace(/(?:dzh|dj|j)/g, 'g')
    .replace(/w/g, 'v').replace(/(?:iy|yi|ii)/g, 'i').replace(/[yj]/g, 'i').replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

const allowedTypos = (length: number) => length >= 8 ? 2 : length >= 4 ? 1 : 0;

/**
 * How well a single query token is present in a phrase, 0..1.
 * Exact substring beats word prefix, which beats transliteration, which beats a typo.
 */
export function tokenMatch(token: string, phrase: string): number {
  if (!token) return 0;
  if (phrase.includes(token)) return 1;
  const words = phrase.split(' ').filter(Boolean);
  if (token.length >= 2 && words.some(w => w.startsWith(token))) return .95;
  const tokenSkeleton = latinSkeleton(token);
  const skeletons = words.map(latinSkeleton);
  if (tokenSkeleton.length >= 2 && skeletons.some(w => w === tokenSkeleton || (tokenSkeleton.length >= 3 && w.startsWith(tokenSkeleton)))) return .85;
  const typos = allowedTypos(token.length);
  if (typos && words.some((w, i) => levenshtein(token, w, typos) <= typos || levenshtein(tokenSkeleton, skeletons[i], typos) <= typos)) return .72;
  return 0;
}

/**
 * Script-independent form for source matching: Spotify spells many Russian
 * artists in Latin ("Slava KPSS") while their channels use Cyrillic
 * ("Слава КПСС"). Keep in sync with fold() in ytdlp_worker.py.
 */
export function foldName(text: string): string {
  // Letters NFKD keeps whole ("Pharaøh", "Straße").
  const words = (text || '').toLocaleLowerCase().replace(/[øæßłđœ]/g, c => ({ ø: 'o', æ: 'ae', ß: 'ss', ł: 'l', đ: 'd', œ: 'oe' } as Record<string, string>)[c]).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return words.split(' ').map(latinSkeleton).join(' ');
}

/** The channel or uploader plausibly belongs to the artist, in either script. */
export function namesMatch(artist: string, channel: string): boolean {
  const a = foldName(artist).replace(/ /g, ''), c = foldName(channel).replace(/ /g, '');
  if (!a || !c) return false;
  if (c.includes(a) || (c.length >= 4 && a.includes(c))) return true;
  // "Scriptonite" vs "Скриптонит": a little spelling drift on longer names.
  if (a.length >= 6 && levenshtein(a, c.slice(0, a.length + 1), 2) <= (a.length >= 10 ? 2 : 1)) return true;
  // Vowels drift most between spellings ("Boulevard Depo" / "Бульвар Депо").
  const consonants = (x: string) => x.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
  const ca = consonants(a);
  return ca.length >= 5 && consonants(c).includes(ca);
}

/** Share of the needle's words (2+ chars) present in the haystack, compared folded. */
export function foldedCoverage(haystack: string, needle: string): number {
  const h = foldName(haystack);
  const tokens = foldName(needle).split(' ').filter(t => t.length >= 2);
  if (!tokens.length) return 1;
  return tokens.filter(t => h.includes(t)).length / tokens.length;
}

/** Average token match of the query against a phrase. */
export function phraseCoverage(query: string, phrase: string): number {
  const tokens = query.split(' ').filter(Boolean);
  if (!tokens.length) return 0;
  return tokens.reduce((sum, token) => sum + tokenMatch(token, phrase), 0) / tokens.length;
}
