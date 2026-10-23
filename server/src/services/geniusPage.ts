// Reading a Genius song page: the lyric containers (plain-text fallback) and the order in which
// annotated fragments appear (so the client can tell which repeat of a phrase an annotation sits on).
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
  mdash: '—', ndash: '–', shy: '', ZeroWidthSpace: '', zwnj: '', zwj: '',
};
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return ENTITIES[name] ?? entity;
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}

/** Genius puts its nested contributors/translation header inside the first
 * lyric container, marked as excluded from lyric selection. */
function stripExcludedElements(html: string): string {
  const tags = /<\/?([a-z][\w:-]*)\b[^>]*>/gi, chunks: string[] = [];
  let match: RegExpExecArray | null, cursor = 0;
  while ((match = tags.exec(html))) {
    if (/^<\//.test(match[0]) || !/\bdata-exclude-from-selection\s*=\s*(?:"true"|'true'|true)(?=\s|>)/i.test(match[0])) continue;
    chunks.push(html.slice(cursor, match.index));
    const name = match[1].toLowerCase();
    let depth = /\/\s*>$/.test(match[0]) || /^(?:br|hr|img|input|meta|link)$/.test(name) ? 0 : 1;
    while (depth && (match = tags.exec(html))) {
      if (match[1].toLowerCase() === name) depth += /^<\//.test(match[0]) ? -1 : /\/\s*>$/.test(match[0]) ? 0 : 1;
    }
    cursor = depth ? html.length : tags.lastIndex;
    if (depth) break;
  }
  return chunks.join('') + html.slice(cursor);
}

/** Inner HTML of every lyric container, without page scripts, comments or the excluded header. */
export function lyricContainers(html: string): string[] {
  html = stripExcludedElements(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ''));
  const containers: string[] = [];
  const tags = /<\/?div\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    if (!/^<div\b/i.test(match[0]) || !(/\bdata-lyrics-container\s*=\s*(?:"true"|'true'|true)(?=\s|>)/i.test(match[0]) || /\bclass\s*=\s*["']lyrics["']/i.test(match[0]))) continue;
    const start = tags.lastIndex;
    let depth = 1, end = start;
    while (depth && (match = tags.exec(html))) {
      depth += /^<\/div/i.test(match[0]) ? -1 : 1;
      end = match.index;
    }
    if (depth) break;
    containers.push(html.slice(start, end));
  }
  return containers;
}

/** Ids of the annotated fragments in the order they appear in the lyrics. Every fragment is a link
 * `/{referentId}/{slug}`; a fragment broken over several lines repeats its link, so only the first counts. */
export function geniusReferentOrder(html: string): number[] {
  const seen = new Set<number>(), order: number[] = [];
  for (const container of lyricContainers(html)) {
    for (const link of container.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']\/(\d+)\/[^"']*["']/gi)) {
      const id = Number(link[1]);
      if (id > 0 && !seen.has(id)) { seen.add(id); order.push(id); }
    }
  }
  return order;
}
