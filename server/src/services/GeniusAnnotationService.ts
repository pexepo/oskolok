import { prisma } from '../database/client.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { foldName, foldedCoverage } from './searchQuery.js';
import { geniusReferentOrder } from './geniusPage.js';

// Genius referents (the highlighted lyric fragments) with their annotations.
// The authenticated API is used when GENIUS_ACCESS_TOKEN is set; otherwise the
// public web API genius.com itself uses, which accepts the same parameters.
// A missing song is asked again after 20 min: Genius pages of fresh releases appear within hours.
const TTL = 12 * 60 * 60 * 1000, MISS_TTL = 20 * 60 * 1000, PER_PAGE = 50, MAX_PAGES = 12;

export type GeniusDomNode = string | { tag: string; attributes?: Record<string, string>; children?: GeniusDomNode[] };
export interface GeniusAnnotationAuthor { name: string; login?: string; avatar?: string; iq?: number; url?: string; role?: string }
export interface GeniusAnnotation { id: number; body: GeniusDomNode[]; plain: string; votes: number; verified: boolean; state: string; url?: string; authors: GeniusAnnotationAuthor[] }
/** `order`: rank of the fragment on the Genius page (song order), when the page could be read. */
export interface GeniusReferent { id: number; fragment: string; classification: string; annotations: GeniusAnnotation[]; order?: number }
/** `transient`: the lookup failed (not "no such song"), so the answer must not be cached and may be retried. */
export interface GeniusAnnotationSet { song: { id: number; title: string; artist: string; url: string } | null; referents: GeniusReferent[]; transient?: boolean }

const inflight = new Map<string, Promise<GeniusAnnotationSet>>();
const compact = (s: string) => foldName(s).replace(/ /g, '');

async function genius(path: string, timeout = 8000): Promise<any> {
  const token = env.GENIUS_ACCESS_TOKEN;
  if (token) {
    try {
      const res = await fetch(`https://api.genius.com${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return (await res.json() as any).response;
    } catch (err) { logger.debug({ err, path }, 'Genius API failed, trying public API'); }
  }
  const res = await fetch(`https://genius.com/api${path}`, { headers: { 'User-Agent': 'Mozilla/5.0 Oskolok-Music-Player' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Genius ${res.status}`);
  return (await res.json() as any).response;
}

/** Strip version noise so "Song (feat. X) - Remastered 2011" searches as "Song". */
const cleanTitle = (title: string) => title.replace(/\s*[([](?:feat|ft|with|prod|remaster|live|official|explicit|deluxe)[^)\]]*[)\]]/gi, '').replace(/\s+-\s+.*(?:remaster|version|edit|mix|live).*$/i, '').trim();
const mainArtist = (artist: string) => artist.split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bx\b|\band\b|\bи\b)\s*/i)[0]?.trim() || artist;

const VERSION = /\b(?:remix|version|live|instrumental|acoustic|demo|edit|mix|cover|reprise|slowed|sped|karaoke|extended|radio)\b/i;
/** How well a Genius search hit matches the requested artist and title; 0 means it is not the song. */
export function scoreHit(hit: any, lead: string, name: string): number {
  // Genius's translation pages are credited to "Genius <Language> Translations".
  if (/^genius\b/i.test(hit.primary_artist?.name || '') && !/^genius\b/i.test(lead)) return 0;
  const credited = `${hit.artist_names || ''} ${hit.primary_artist?.name || ''}`;
  if (!(compact(credited).includes(compact(lead)) || foldedCoverage(credited, lead) >= .75)) return 0;
  const title = String(hit.title || ''), cover = (candidate: string) => Math.min(foldedCoverage(candidate, name), foldedCoverage(name, candidate) + .25);
  // Non-Latin songs are titled "Утекай (Flow Away)": the bracketed translation is no part of the name asked for. A bracketed
  // "(… Remix)" or "(Video Version)" still costs the hit its place to the plain original.
  const bare = title.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
  return Math.max(cover(title), bare !== title ? cover(bare) - (VERSION.test(title) && !VERSION.test(name) ? .3 : .05) : 0);
}

async function findSong(artist: string, title: string): Promise<GeniusAnnotationSet['song']> {
  const name = cleanTitle(title), lead = mainArtist(artist), q = encodeURIComponent(`${lead} ${name}`);
  const response = await genius(env.GENIUS_ACCESS_TOKEN ? `/search?q=${q}` : `/search/song?q=${q}&per_page=10`, 6000).catch(() => genius(`/search/song?q=${q}&per_page=10`, 6000));
  const hits: any[] = (response.hits || response.sections?.[0]?.hits || []).map((h: any) => h.result).filter((r: any) => r?.id && r.url);
  const scored = hits.map(r => ({ r, score: scoreHit(r, lead, name) })).filter(s => s.score >= .75).sort((a, b) => b.score - a.score);
  const hit = scored[0]?.r;
  return hit ? { id: Number(hit.id), title: String(hit.title || name), artist: String(hit.primary_artist?.name || hit.artist_names || lead), url: String(hit.url) } : null;
}

const songLookups = new Map<string, { at: number; value: GeniusAnnotationSet['song'] }>();
const songRequests = new Map<string, Promise<GeniusAnnotationSet['song']>>();
/** Shared matching for annotations and the plain-lyrics fallback. */
export async function findGeniusSong(artist: string, title: string): Promise<GeniusAnnotationSet['song']> {
  if (!artist.trim() || !title.trim()) return null;
  const key = `${compact(mainArtist(artist))}|${compact(cleanTitle(title))}`;
  const cached = songLookups.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? TTL : MISS_TTL)) return cached.value;
  const pending = songRequests.get(key);
  if (pending) return pending;
  const task = findSong(artist, title).then(value => {
    songLookups.set(key, { at: Date.now(), value });
    if (songLookups.size > 500) songLookups.delete(songLookups.keys().next().value!);
    return value;
  }).finally(() => songRequests.delete(key));
  songRequests.set(key, task);
  return task;
}

const SAFE_TAGS = new Set(['p', 'br', 'em', 'i', 'strong', 'b', 'a', 'blockquote', 'ul', 'ol', 'li', 'img', 'small', 'code', 'hr', 'sup', 'sub', 's', 'u']);
const RENAME: Record<string, string> = { h1: 'strong', h2: 'strong', h3: 'strong', h4: 'strong', h5: 'strong', h6: 'strong', del: 's', ins: 'u', pre: 'code' };
const DROP = new Set(['script', 'style', 'iframe', 'embedly', 'object', 'embed', 'video', 'audio', 'form', 'input', 'button', 'svg', 'math']);
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try { const url = new URL(value, 'https://genius.com'); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined; } catch { return undefined; }
}
/** Genius's `dom` text format reduced to a whitelist the client renders as React nodes. */
export function sanitizeGeniusDom(node: any, depth = 0): GeniusDomNode[] {
  if (depth > 24 || node == null) return [];
  if (typeof node === 'string') return node ? [node] : [];
  if (typeof node !== 'object') return [];
  const tag = String(node.tag || '').toLowerCase();
  if (DROP.has(tag)) return [];
  const children = (Array.isArray(node.children) ? node.children : []).flatMap((child: any) => sanitizeGeniusDom(child, depth + 1));
  const name = RENAME[tag] || tag;
  if (!SAFE_TAGS.has(name)) return tag === 'div' || tag === 'root' ? (tag === 'div' ? [{ tag: 'p', children }] : children) : children;
  const attributes: Record<string, string> = {};
  if (name === 'a') { const href = safeUrl(node.attributes?.href); if (!href) return children; attributes.href = href; }
  if (name === 'img') { const src = safeUrl(node.attributes?.src); if (!src || !src.startsWith('https:')) return []; attributes.src = src; if (typeof node.attributes?.alt === 'string') attributes.alt = node.attributes.alt.slice(0, 200); }
  return [{ tag: name, ...(Object.keys(attributes).length ? { attributes } : {}), ...(children.length ? { children } : {}) }];
}

function mapAnnotation(a: any): GeniusAnnotation | null {
  if (!a?.id) return null;
  const plain = String(a.body?.plain || '').trim();
  const body = a.body?.dom ? sanitizeGeniusDom(a.body.dom) : plain ? plain.split(/\n{2,}/).map(p => ({ tag: 'p', children: [p] })) : [];
  if (!plain && !body.length) return null;
  const authors: GeniusAnnotationAuthor[] = (a.authors || []).map((entry: any) => {
    const user = entry?.user || {};
    return { name: String(user.name || user.login || 'Genius'), ...(user.login ? { login: String(user.login) } : {}), ...(safeUrl(user.avatar?.thumb?.url || user.avatar?.small?.url) && !/default_avatar/.test(user.avatar?.thumb?.url || '') ? { avatar: safeUrl(user.avatar?.thumb?.url || user.avatar?.small?.url) } : {}), ...(typeof user.iq === 'number' ? { iq: user.iq } : {}), ...(safeUrl(user.url) ? { url: safeUrl(user.url) } : {}), ...(entry?.pinned_role || user.role_for_display ? { role: String(entry.pinned_role || user.role_for_display) } : {}) };
  }).filter((author: GeniusAnnotationAuthor) => author.name);
  return { id: Number(a.id), body, plain, votes: Number(a.votes_total) || 0, verified: Boolean(a.verified), state: String(a.state || ''), ...(safeUrl(a.share_url || a.url) ? { url: safeUrl(a.share_url || a.url) } : {}), authors };
}

/** Where each annotated fragment sits in the song: the page lists them in lyric order, the API does not. */
async function pageOrder(songUrl: string): Promise<Map<number, number>> {
  try {
    const url = new URL(songUrl);
    if (url.protocol !== 'https:' || !/^(?:www\.)?genius\.com$/.test(url.hostname)) return new Map();
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Oskolok-Music-Player', Accept: 'text/html' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) return new Map();
    const html = await response.text();
    return html.length > 3_000_000 ? new Map() : new Map(geniusReferentOrder(html).map((id, index) => [id, index] as [number, number]));
  } catch (err) {
    logger.debug({ err }, 'Genius page order unavailable');
    return new Map();
  }
}

async function loadReferents(songId: number, songUrl: string): Promise<GeniusReferent[]> {
  const referents: GeniusReferent[] = [], ordering = pageOrder(songUrl);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await genius(`/referents?song_id=${songId}&text_format=dom,plain&per_page=${PER_PAGE}&page=${page}`);
    const batch: any[] = response?.referents || [];
    for (const r of batch) {
      const fragment = String(r?.fragment || '').trim();
      // Song-level "description" referents carry no lyric fragment.
      if (!r?.id || !fragment || r.is_description || (r.annotatable?.type && r.annotatable.type !== 'Song')) continue;
      const annotations = (r.annotations || []).map(mapAnnotation).filter(Boolean) as GeniusAnnotation[];
      if (annotations.length) referents.push({ id: Number(r.id), fragment, classification: String(r.classification || ''), annotations });
    }
    // `next_page` is null on the last page; without the field a short page ends the list.
    const next = response?.next_page;
    if (!batch.length || next === null || (next === undefined && batch.length < 20)) break;
  }
  const order = await ordering;
  if (order.size) {
    for (const referent of referents) { const at = order.get(referent.id); if (at !== undefined) referent.order = at; }
    referents.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  }
  return referents;
}

/** Referents for one song, cached in the enrichment table for half a day. */
export async function geniusAnnotations(artist: string, title: string): Promise<GeniusAnnotationSet> {
  const key = `geniusrefs2:${compact(mainArtist(artist))}|${compact(cleanTitle(title))}`;
  if (!artist.trim() || !title.trim() || key.length < 13) return { song: null, referents: [] };
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const row = await prisma.artistEnrichment.findUnique({ where: { id: key } }).catch(() => null);
    let stale: GeniusAnnotationSet | null = null;
    try { stale = row ? JSON.parse(row.data) : null; } catch { /* Ignore a corrupt cache entry. */ }
    if (row && stale && Date.now() - row.updatedAt.getTime() < (stale.song ? TTL : MISS_TTL)) return stale;
    try {
      const song = await findGeniusSong(artist, title);
      const fresh: GeniusAnnotationSet = { song, referents: song ? await loadReferents(song.id, song.url) : [] };
      await prisma.artistEnrichment.upsert({ where: { id: key }, create: { id: key, data: JSON.stringify(fresh) }, update: { data: JSON.stringify(fresh) } }).catch(() => {});
      return fresh;
    } catch (err) {
      logger.debug({ err, key }, 'Genius annotations lookup failed');
      return stale || { song: null, referents: [], transient: true };
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
