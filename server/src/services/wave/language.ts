/* The language of a track's vocals, as far as the catalogue lets us tell. Evidence, strongest first:
   Japanese kana; Cyrillic in the title or artist (Ukrainian letters stay «unknown», not Russian);
   an artist anchored in a language's subgenres. Latin script alone proves nothing (Russian rappers
   sing under Latin names), so it is reported as «latin» and only counts as English where the
   request comes from an English source. Han characters without kana may be Chinese: «unknown». */
import type { Track } from '../../types/index.js';
import { anchorArtists, type WaveLang } from './taxonomy.js';
import { artistKey } from './profile.js';
import { RUSSIAN_ARTISTS } from '../RecommendationService.js';
import { latinFold } from '../trackRanking.js';

export type DetectedLanguage = WaveLang | 'latin' | 'unknown';
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u, HAN = /\p{Script=Han}/u, CYR = /\p{Script=Cyrillic}/u, UKR = /[іїєґІЇЄҐ]/, LATIN = /\p{Script=Latin}/u;
const anchors: Record<WaveLang, Set<string>> = { ru: new Set(), en: new Set(), ja: new Set() };
(['ru', 'en', 'ja'] as WaveLang[]).forEach(lang => anchorArtists(lang).forEach(name => anchors[lang].add(artistKey(name))));
RUSSIAN_ARTISTS.forEach(name => anchors.ru.add(latinFold(name)));

export function languageOf(track: Pick<Track, 'title' | 'artist' | 'release'>): DetectedLanguage {
  const title = `${track.title} ${track.release?.title || ''}`, artist = track.artist?.name || '';
  if (KANA.test(title) || KANA.test(artist)) return 'ja';
  if (CYR.test(title) || CYR.test(artist)) return UKR.test(title) ? 'unknown' : 'ru';
  const key = artistKey(artist);
  if (anchors.ja.has(key)) return 'ja';
  if (anchors.ru.has(key)) return 'ru';
  if (HAN.test(title) || HAN.test(artist)) return 'unknown';
  if (anchors.en.has(key)) return 'en';
  return LATIN.test(title) || LATIN.test(artist) ? 'latin' : 'unknown';
}

/** Hard language filter. Latin-script tracks by unanchored artists are accepted only with context:
 * «source» — the track came from a source of that language (an anchor, its Deezer related acts, a themed
 * playlist, AnimeThemes); «collection» — the listener's own track, counted as English when Latin. */
export function matchesLanguage(track: Pick<Track, 'title' | 'artist' | 'release'>, lang: WaveLang, context: 'source' | 'collection' | 'none' = 'none'): boolean {
  const detected = languageOf(track);
  if (detected === lang) return true;
  if (detected !== 'latin') return false;
  return lang === 'en' ? context !== 'none' : lang === 'ja' && context === 'source';
}
