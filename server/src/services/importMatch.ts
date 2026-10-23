// Matching a line of an exported playlist («Artist — Title») to a catalogue track. Exports and catalogues spell the
// same song differently: «(feat. X)», «- Remastered 2011», «A, B» vs «A & B», Cyrillic vs transliteration.
import type { Track } from '../types/index.js';
import { latinFold } from './trackRanking.js';

const fold = (s: string) => latinFold(s || '');
/** Title without versions and credits in brackets or after « - ». */
export const coreTitle = (title: string) => fold(title.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+[-–—]\s+.*$/, '').replace(/\b(feat|ft)\.?\s.*$/i, ''));
const VERSION = /\b(remix|live|acoustic|instrumental|karaoke|cover|slowed|sped up|speed up|nightcore|8d|reverb|bootleg|mashup)\b|ремикс|кавер|минус|м[эе]шап/i;
/** Every performer named: «A, B & C feat. D». */
export const performers = (name: string) => name.split(/\s*(?:,|&|\+|\bx\b|\bfeat\.?|\bft\.?|\bwith\b|\bvs\.?)\s*/i).map(fold).filter(Boolean);

/** 0…1: how surely the candidate is the requested recording. */
export function matchScore(artist: string, title: string, candidate: Track): number {
  const wantTitle = coreTitle(title), gotTitle = coreTitle(candidate.title);
  if (!wantTitle || !gotTitle) return 0;
  // A remix or live take is only right when the export asked for one.
  if (VERSION.test(candidate.title) !== VERSION.test(title)) return 0.1;
  const titleScore = wantTitle === gotTitle ? 1 : gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle) ? 0.7 : 0;
  if (!titleScore) return 0;
  const want = performers(artist), got = performers(candidate.artist.name);
  const shared = want.filter(a => got.some(b => a === b || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))))).length;
  const artistScore = !want.length ? 0.5 : shared === want.length ? 1 : shared ? 0.75 : 0;
  return titleScore * (0.35 + 0.65 * artistScore);
}

/** The confident match (or null) and the candidates ranked best-first for a manual or low-accuracy pick. */
export function pickMatch(artist: string, title: string, candidates: Track[]): { track: Track | null; ranked: Track[] } {
  const scored = candidates.map(track => ({ track, score: matchScore(artist, title, track) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { track: best && best.score >= 0.95 ? best.track : null, ranked: scored.filter(s => s.score > 0).map(s => s.track) };
}
