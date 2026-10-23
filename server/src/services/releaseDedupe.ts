// One release appears once on an artist page, whichever services listed it.
// Titles are compared without punctuation so «Shh...» on Spotify meets «Shh...» on Deezer,
// but two releases of the same service with different spellings («Shh...» and «Shh!») stay apart.

export type DedupableRelease = { id: string; title?: string; type?: string; explicit?: boolean; date?: string; trackCount?: number };

const EDITION = /\s*[([](?:clean|explicit|censored|радио|radio edit)[^)\]]*[)\]]/gi;
const fold = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const spelling = (s: string) => s.replace(EDITION, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const serviceOf = (id: string) => id.split(':')[0];

export function dedupeReleases<T extends DedupableRelease>(releases: T[]): T[] {
  const info = releases.map((r, index) => {
    const title = String(r.title || '');
    return { r, index, key: fold(title.replace(EDITION, '')) || r.id, spelling: spelling(title), service: serviceOf(r.id) };
  });
  type Info = typeof info[number];
  // A service listing one spelling twice is a single record.
  const records: Info[][] = [];
  for (const x of info) {
    const same = records.find(g => g[0].service === x.service && g[0].spelling === x.spelling);
    if (same) same.push(x); else records.push([x]);
  }
  const groups: Info[][] = [];
  const has = (g: Info[], service: string) => g.some(y => y.service === service);
  // Other services join by exact spelling first, so «Shh!» can't take the place of «Shh...» just because it came earlier.
  const deferred: Info[][] = [];
  for (const rec of records) {
    const x = rec[0];
    const exact = groups.find(g => g[0].key === x.key && !has(g, x.service) && g.some(y => y.spelling === x.spelling));
    if (exact) exact.push(...rec);
    else if (records.some(o => o !== rec && o[0].service !== x.service && o[0].spelling === x.spelling)) groups.push([...rec]);
    else deferred.push(rec);
  }
  for (const rec of deferred) {
    const x = rec[0];
    const loose = groups.find(g => g[0].key === x.key && !has(g, x.service));
    if (loose) loose.push(...rec); else groups.push([...rec]);
  }
  groups.sort((a, b) => Math.min(...a.map(x => x.index)) - Math.min(...b.map(x => x.index)));
  return groups.map(group => {
    const members = group.map(x => x.r);
    // Explicit edition wins; an EP label from any service survives a «single» elsewhere.
    let best = members[0];
    for (const r of members.slice(1)) if (r.explicit && !best.explicit) best = r;
    if (best.type !== 'album' && best.type !== 'ep' && members.some(r => r.type === 'ep')) best = { ...best, type: 'ep' };
    if (!best.date) { const date = members.find(r => r.date)?.date; if (date) best = { ...best, date }; }
    return best;
  });
}
