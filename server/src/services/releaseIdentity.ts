// Deezer keeps one profile per name: «pyrokinesis» the Russian rapper shares a page with an American metal band,
// «Rizza» with an Iranian rapper and a Swedish DJ. Releases are grouped by what one act's catalogue shares —
// the label as typed, featured artists, repeated songs (not ISRC registrants: mass distributors such as DistroKid
// hand the same code to strangers) — and every group
// that looks unlike the one the artist's own top tracks come from (script, ISRC country, title style, genre)
// is dropped from the page.
import { prisma } from '../database/client.js';
import { logger } from '../utils/logger.js';

export interface ReleaseFacts {
  id: string;
  title: string;
  label?: string;
  genres: number[];
  coArtists: Array<{ id: number; name: string }>;
  tracks: Array<{ title: string; isrc?: string }>;
}
export interface ArtistContext {
  /** Album ids of the artist's top tracks, most popular first. */
  topAlbums: string[];
  /** Titles already known to be this artist's (top tracks, a linked Spotify discography). */
  referenceTitles: string[];
  /** Names of related artists: the scene the page belongs to. */
  relatedNames: string[];
  /** Titles from an independent source (the card's Spotify discography), not from this Deezer page. */
  trustedTitles?: string[];
}

const key = (title: string) => title.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
// Aggregators every act can use; sharing one says nothing about who released what.
const GENERIC_LABEL = /^(independent|independiente|self[- ]?released|unsigned|none|n\/a|distrokid|tunecore|cd ?baby|amuse|routenote|believe|ditto( music)?|unitedmasters|records dk|\d+ records dk|onerpm|freshtunes|zvonko digital|soundon|level|spinnup|awal|symphonic|vydia|the orchard|label worx|imusician)$/i;
const OTHER_SCRIPTS: Array<[string, RegExp]> = [
  ['arabic', /\p{Script=Arabic}/gu], ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu],
  ['greek', /\p{Script=Greek}/gu], ['hebrew', /\p{Script=Hebrew}/gu], ['indic', /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}]/gu],
  ['thai', /\p{Script=Thai}/gu], ['georgian', /\p{Script=Georgian}/gu], ['armenian', /\p{Script=Armenian}/gu],
];
const SLAVIC_ISRC = new Set(['RU', 'BY', 'UA', 'KZ']);

interface Profile { letters: number; cyr: number; other: Map<string, number>; slavicIsrc: number; isrcs: number; lower: number; caps: number; styled: number; genres: Map<number, number> }
function profile(items: ReleaseFacts[]): Profile {
  const p: Profile = { letters: 0, cyr: 0, other: new Map(), slavicIsrc: 0, isrcs: 0, lower: 0, caps: 0, styled: 0, genres: new Map() };
  for (const r of items) {
    const titles = [r.title, ...r.tracks.map(t => t.title)];
    for (const text of titles) {
      const letters = text.match(/\p{L}/gu)?.length || 0;
      p.letters += letters; p.cyr += text.match(/\p{Script=Cyrillic}/gu)?.length || 0;
      for (const [name, re] of OTHER_SCRIPTS) { const n = text.match(re)?.length || 0; if (n) p.other.set(name, (p.other.get(name) || 0) + n); }
      // Only cased scripts tell lowercase stylisation («чёрное сердце», «rory») from Title Case or CAPS.
      const cased = text.replace(/\s*[([][^)\]]*[)\]]/g, '').match(/[\p{Script=Latin}\p{Script=Cyrillic}]/gu)?.join('') || '';
      if (cased.length >= 3) { p.styled++; if (cased === cased.toLocaleLowerCase()) p.lower++; else if (cased === cased.toLocaleUpperCase()) p.caps++; }
    }
    for (const t of r.tracks) if (t.isrc && /^[A-Z]{2}/.test(t.isrc)) { p.isrcs++; if (SLAVIC_ISRC.has(t.isrc.slice(0, 2))) p.slavicIsrc++; }
    for (const g of r.genres) if (g > 0) p.genres.set(g, (p.genres.get(g) || 0) + 1);
  }
  return p;
}
const ratio = (n: number, d: number) => d ? n / d : 0;
const ROMANCE = /[ñãõçáéíóú¿¡]|(?<![\p{L}])(?:la|el|los|las|de|del|que|tu|mi|pa|por|con|amor|vida|para|sin|eu|não|você|meu|minha|com|uma)(?![\p{L}])/iu;
/** Share of titles that read as Spanish or Portuguese. */
const romance = (items: ReleaseFacts[]) => { const titles = items.flatMap(r => [r.title, ...r.tracks.map(t => t.title)]); return ratio(titles.filter(t => ROMANCE.test(t)).length, titles.length); };
const dominantOther = (p: Profile) => { let best = '', n = 0; for (const [k, v] of p.other) if (v > n) { best = k; n = v; } return ratio(n, p.letters) >= 0.25 ? best : ''; };

/**
 * Ids of releases that belong to someone else with the same name. Conservative: a group is dropped only when it is
 * plainly unlike the artist's own group and shares no title with what is known to be the artist's.
 */
export function foreignReleases(releases: ReleaseFacts[], ctx: ArtistContext): Set<string> {
  const dropped = new Set<string>();
  if (releases.length < 2) return dropped;
  // Union-find over releases.
  const parent = releases.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const join = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) parent[y] = x; };
  const seen = new Map<string, number>();
  const link = (k: string, i: number) => { const j = seen.get(k); if (j === undefined) seen.set(k, i); else join(j, i); };
  releases.forEach((r, i) => {
    const label = r.label?.trim();
    // Exact spelling: self-released «rizza» and «Rizza» are two people, «Warner Music Russia» is one label.
    if (label && !GENERIC_LABEL.test(label)) link(`l:${label}`, i);
    for (const a of r.coArtists) link(`a:${a.id}`, i);
    for (const t of new Set([r.title, ...r.tracks.map(t => t.title)].map(key))) if (t.length >= 3) link(`t:${t}`, i);
  });
  const groups = new Map<number, ReleaseFacts[]>();
  releases.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) || []), r]); });
  if (groups.size < 2) return dropped;

  const refs = new Set(ctx.referenceTitles.map(key).filter(k => k.length >= 2));
  const topRank = new Map(ctx.topAlbums.map((id, i) => [id, i] as const));
  const evidence = (items: ReleaseFacts[]) => items.reduce((sum, r) => {
    const rank = topRank.get(r.id);
    const own = [r.title, ...r.tracks.map(t => t.title)].some(t => refs.has(key(t)));
    return sum + (rank !== undefined ? 1 / (1 + rank / 5) : 0) + (own ? 0.5 : 0);
  }, 0);
  const trusted = new Set((ctx.trustedTitles || []).map(key).filter(k => k.length >= 2));
  const refEvidence = (items: ReleaseFacts[]) => items.filter(r => [r.title, ...r.tracks.map(t => t.title)].some(t => trusted.has(key(t)))).length;
  let scored = [...groups.values()].map(items => ({ items, evidence: evidence(items) })).sort((a, b) => b.evidence - a.evidence || b.items.length - a.items.length);
  // The page's most played songs belong to a namesake (a 1970s band on the page of a Russian rapper whose
  // Spotify discography is the card): the group holding the known titles is home, and the rest must look like it.
  const byRefs = [...scored].sort((a, b) => refEvidence(b.items) - refEvidence(a.items));
  const namesakePage = trusted.size > 0 && refEvidence(byRefs[0].items) > 0 && refEvidence(scored[0].items) === 0;
  if (namesakePage) scored = [byRefs[0], ...scored.filter(g => g !== byRefs[0]).map(g => ({ ...g, evidence: refEvidence(g.items) }))];
  const anchor = scored[0];
  // Without any sign of whose page this is, there is nothing to compare against.
  if (anchor.evidence <= 0) return dropped;

  const home = profile(anchor.items);
  const scene = ctx.relatedNames.length ? ratio(ctx.relatedNames.filter(n => /\p{Script=Cyrillic}/u.test(n)).length, ctx.relatedNames.length) : 0;
  const homeSlavic = ratio(home.cyr, home.letters) >= 0.3 || ratio(home.slavicIsrc, home.isrcs) >= 0.3 || scene >= 0.4;
  const homeOther = dominantOther(home);
  const homeLower = ratio(home.lower, home.styled), homeCaps = ratio(home.caps, home.styled);
  const homeGenres = new Set([...home.genres.keys()]);

  for (const group of scored.slice(1)) {
    if (group.evidence > 0) continue;
    const p = profile(group.items);
    const cyr = ratio(p.cyr, p.letters), slavic = ratio(p.slavicIsrc, p.isrcs), other = dominantOther(p);
    let score = 0;
    if (homeSlavic) {
      if (cyr >= 0.15) score += 2;
      if (slavic >= 0.5) score += 2;
      if (cyr === 0 && slavic === 0) score -= 1.5;
    } else if (cyr >= 0.3 || slavic >= 0.5) score -= 2;
    if (other && other !== homeOther) score -= 3;
    if (!other && homeOther) score -= 1;
    if (p.styled) {
      const lower = ratio(p.lower, p.styled), caps = ratio(p.caps, p.styled);
      if (homeLower >= 0.4) score += lower >= 0.5 ? 1 : lower === 0 ? (homeLower >= 0.8 ? -1 : -0.5) : 0;
      if (caps >= 0.6 && homeCaps < 0.2) score -= 0.5;
    }
    if (p.genres.size && homeGenres.size) score += [...p.genres.keys()].some(g => homeGenres.has(g)) ? 0.5 : -0.5;
    if (homeSlavic && group.items.some(r => r.coArtists.some(a => /\p{Script=Cyrillic}/u.test(a.name)))) score += 1;
    // A Russian page with a group of Spanish/Portuguese songs («La Vida Continua», «Sabadão, Bb») is a Latin namesake.
    if (homeSlavic && cyr === 0 && romance(group.items) >= 0.3) score -= 1.5;
    if (score <= -2 || (namesakePage && score < 2)) for (const r of group.items) dropped.add(r.id);
  }
  return dropped;
}

// ---- Deezer facts, cached: a release's label, ISRCs and credits do not change.
const API = 'https://api.deezer.com';
// Background work stays well under Deezer's quota (50 calls / 5 s) so pages keep their share.
let active = 0, nextStart = 0; const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>(r => waiting.push(r));
  active++;
  const now = Date.now(), at = Math.max(now, nextStart); nextStart = at + 160;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
async function dz(path: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await slot(async () => { const r = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() as Promise<any> : null; }).catch(() => null);
    // Deezer answers its quota (50 calls / 5 s) with a 200 and an error body.
    if (data?.error?.code === 4) { await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); continue; }
    return data && !data.error ? data : null;
  }
  return null;
}
const FACTS_TTL = 30 * 24 * 3600_000;
async function releaseFacts(id: string, artistId: string): Promise<ReleaseFacts | null> {
  const cacheKey = `dz-release:v1:${id}`;
  const row = await prisma.artistEnrichment.findUnique({ where: { id: cacheKey } }).catch(() => null);
  if (row && Date.now() - row.updatedAt.getTime() < FACTS_TTL) return JSON.parse(row.data);
  const [album, tracks] = await Promise.all([dz(`album/${id}`), dz(`album/${id}/tracks?limit=200`)]);
  if (!album) return null;
  const facts: ReleaseFacts = {
    id, title: String(album.title || ''), label: album.label || undefined,
    genres: (album.genres?.data || []).map((g: any) => Number(g.id)).filter(Number.isFinite),
    coArtists: (album.contributors || []).filter((c: any) => String(c.id) !== artistId).map((c: any) => ({ id: Number(c.id), name: String(c.name || '') })),
    tracks: (tracks?.data || album.tracks?.data || []).map((t: any) => ({ title: String(t.title || ''), isrc: t.isrc || undefined })),
  };
  if (!facts.genres.length && Number(album.genre_id) > 0) facts.genres.push(Number(album.genre_id));
  const data = JSON.stringify(facts);
  void prisma.artistEnrichment.upsert({ where: { id: cacheKey }, create: { id: cacheKey, data }, update: { data } }).catch(() => {});
  return facts;
}

const decided = new Map<string, { ids: Set<string>; until: number }>();
/** Decisions depend on the titles known to be the artist's (a linked Spotify discography). */
const refsKey = (titles: string[]) => { let h = 0; for (const t of [...new Set(titles.map(key))].sort().join('|')) h = Math.imul(h ^ t.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
const pending = new Map<string, Promise<Set<string>>>();
const DECISION_TTL = 12 * 3600_000;
async function decide(artistId: string, referenceTitles: string[]): Promise<{ ids: Set<string>; complete: boolean }> {
  const [albums, top, related] = await Promise.all([dz(`artist/${artistId}/albums?limit=300`), dz(`artist/${artistId}/top?limit=25`), dz(`artist/${artistId}/related?limit=20`)]);
  const list: any[] = albums?.data || [];
  if (list.length < 2 || list.length > 400) return { ids: new Set(), complete: !!albums };
  const facts = (await Promise.all(list.map(a => releaseFacts(String(a.id), artistId)))).filter((f): f is ReleaseFacts => !!f);
  const topTracks: any[] = top?.data || [];
  const ids = foreignReleases(facts, {
    topAlbums: topTracks.map(t => String(t.album?.id || '')).filter(Boolean),
    referenceTitles: [...referenceTitles, ...topTracks.slice(0, 10).map(t => String(t.title || ''))],
    relatedNames: (related?.data || []).map((a: any) => String(a.name || '')),
    trustedTitles: referenceTitles,
  });
  // Deezer's quota can starve a first look; a partial one is used but retried soon.
  const complete = facts.length >= list.length * 0.95;
  if (ids.size) logger.info({ artistId, dropped: ids.size, of: facts.length, listed: list.length }, 'Namesake releases hidden from artist page');
  const data = JSON.stringify([...ids]), cacheKey = `dz-foreign:v2:${artistId}:${refsKey(referenceTitles)}`;
  if (complete) void prisma.artistEnrichment.upsert({ where: { id: cacheKey }, create: { id: cacheKey, data }, update: { data } }).catch(() => {});
  return { ids, complete };
}

/** Whether a finished decision for this artist is at hand (callers cache their own results briefly until it is). */
export function namesakeDecisionReady(artistId: string): boolean {
  const prefix = `${artistId.replace(/^(deezer:artist:|artist:)/, '')}:`, now = Date.now();
  for (const [k, hit] of decided) if (k.startsWith(prefix) && now < hit.until) return true;
  return false;
}

/**
 * Deezer album ids (numeric strings) on this artist's page that belong to a namesake. Answers within `budgetMs`;
 * a first look that takes longer keeps running in the background and an older decision (or nothing) is used meanwhile.
 */
export async function namesakeReleaseIds(artistId: string, options: { referenceTitles?: string[]; budgetMs?: number } = {}): Promise<Set<string>> {
  if (process.env.VITEST) return new Set();
  const bare = artistId.replace(/^(deezer:artist:|artist:)/, '');
  if (!/^\d+$/.test(bare)) return new Set();
  const refsList = options.referenceTitles || [];
  const raw = `${bare}:${refsKey(refsList)}`;
  const hit = decided.get(raw);
  if (hit && Date.now() < hit.until) return hit.ids;
  let job = pending.get(raw);
  if (!job) {
    job = decide(bare, refsList).then(({ ids, complete }) => { decided.set(raw, { ids, until: Date.now() + (complete ? DECISION_TTL : 5 * 60_000) }); return ids; })
      .catch(err => { logger.warn({ err, artistId: bare }, 'Namesake check failed'); return new Set<string>(); })
      .finally(() => pending.delete(raw));
    pending.set(raw, job);
  }
  const stored = async () => {
    const row = await prisma.artistEnrichment.findUnique({ where: { id: `dz-foreign:v2:${raw}` } }).catch(() => null);
    return row ? new Set<string>(JSON.parse(row.data)) : new Set<string>();
  };
  const timeout = new Promise<null>(r => setTimeout(() => r(null), options.budgetMs ?? 7000));
  return (await Promise.race([job, timeout])) || stored();
}
