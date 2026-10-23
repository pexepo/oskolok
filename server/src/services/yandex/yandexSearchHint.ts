/* Search with Yandex's query understanding. Yandex Music fixes typos and knows how listeners spell
   artists («пирокинезис» → pyrokinesis, «оксимирон» → Oxxxymiron); Осколок still answers from its own
   catalogue, but searches Yandex's reading of the query too and lets Yandex's order break ties. */
import type { Track } from '../../types/index.js';
import { matchScore } from '../importMatch.js';
import { nearlySameName, normalizeMusicText } from '../trackRanking.js';
import { yandexSearch, type YandexSearchHint } from './yandexApi.js';

type Rankable = Pick<Track, 'id' | 'title'> & { artist: { name: string } };
export interface QueryHint {
  /** Yandex's reading of the query: the corrected text, or the best result's own name. */
  query: string;
  corrected: boolean;
  /** Yandex's own «лучший результат». */
  best?: YandexSearchHint['best'];
  /** Relevance priors (id → weight) for items that Yandex ranks high; artist cards come with an empty title. */
  priors(items: Rankable[]): Map<string, number>;
}

const cache = new Map<string, { at: number; hint: YandexSearchHint | null }>();
const TTL = 3600_000;

/** Reading of a hint as a search phrase. Pure, for tests. */
export function hintQuery(hint: YandexSearchHint): string {
  if (hint.corrected) return hint.text;
  if (hint.best?.type === 'artist') return hint.best.name;
  if (hint.best) return `${hint.best.artists[0] || ''} ${hint.best.title}`.trim();
  return hint.text;
}

export function hintPriors(hint: YandexSearchHint, items: Rankable[]): Map<string, number> {
  const out = new Map<string, number>();
  const put = (id: string, weight: number) => out.set(id, Math.max(out.get(id) || 0, weight));
  for (const item of items) {
    if (!item.title) {
      if (hint.best?.type === 'artist' && nearlySameName(hint.best.name, item.artist.name)) put(item.id, 50);
      hint.artists.forEach((name, i) => { if (nearlySameName(name, item.artist.name)) put(item.id, 30 - i * 4); });
      continue;
    }
    const candidate = item as Track;
    if (hint.best?.type === 'track' && matchScore(hint.best.artists.join(', '), hint.best.title, candidate) >= 0.7) put(item.id, 50);
    hint.tracks.forEach((t, i) => { if (matchScore(t.artists.join(', '), t.title, candidate) >= 0.7) put(item.id, Math.max(8, 40 - i * 3)); });
  }
  return out;
}

/** Yandex's reading of a query, or null (link, too short, Yandex slow or unreachable). Cached for an hour. */
export async function yandexQueryHint(query: string): Promise<QueryHint | null> {
  const q = query.trim();
  if (q.length < 2 || q.length > 120 || /^https?:|spotify:|\.com\//i.test(q) || process.env.VITEST) return null;
  const key = normalizeMusicText(q);
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > TTL) {
    entry = { at: Date.now(), hint: await yandexSearch(q, 1400) };
    cache.set(key, entry);
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  }
  const hint = entry.hint;
  if (!hint) return null;
  return { query: hintQuery(hint), corrected: hint.corrected, best: hint.best, priors: items => hintPriors(hint, items) };
}
