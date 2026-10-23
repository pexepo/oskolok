import type { Artist, Release, Track, SoundCloudTrackDTO } from '../types/index.js';
import {sameRecording,sourceRank} from './recordingKey.js';
import { phraseCoverage, foldName, levenshtein } from './searchQuery.js';

export const normalizeMusicText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// «Слава КПСС» on Deezer is «Slava KPSS» on Spotify's public page: compare names in one script.
const CYR: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
export const latinFold = (text: string) => normalizeMusicText(text).replace(/[а-яё]/g, ch => CYR[ch] ?? ch).replace(/kh/g, 'h').replace(/(.)\1+/g, '$1').replace(/\s+/g, '');
export const trackIdentity = (track: Track) => `${normalizeMusicText(track.artist.name)}:${normalizeMusicText(track.title)}:${Math.round(track.duration / 5)}`;
/** Collapse reuploads only when the release title and running time agree. Edition words stay part of the title. */
const artistNames = (name: string) => name.split(/\s*(?:,|&|\+|\bfeat\.?|\bft\.?|\bx\b|\bпри уч\.?)\s*/i).map(latinFold).filter(n => n.length >= 2);
const sharesArtist = (a: string, b: string) => { const right = new Set(artistNames(b)); return artistNames(a).some(n => right.has(n)); };
export function deduplicateSearchTracks(tracks: Track[]): Track[] {
  const result: Track[] = [];
  for (const track of tracks) {
    const title = normalizeMusicText(track.title);
    const artist = normalizeMusicText(track.artist.name);
    const collision = result.findIndex(other => {
      if(sameRecording(track,other))return true;
      const otherTitle = normalizeMusicText(other.title);
      if (!title || title !== otherTitle || !track.duration || !other.duration) return false;
      // «Kai Angel, 9mice» on the single and «Kai Angel» on the album, «SLAVA KPSS» on SoundCloud and «Слава КПСС» in the catalogue.
      const sameArtist = artist === normalizeMusicText(other.artist.name) || sharesArtist(track.artist.name, other.artist.name);
      if (Math.abs(track.duration - other.duration) > (sameArtist ? 8 : 3)) return false;
      if (sameArtist) return true;
      if (editions.some(edition => title.includes(edition))) return false;
      // Uploader handles on SoundCloud are not reliable artist identities.
      return title.split(' ').length >= 2 && (track.source === 'soundcloud' || other.source === 'soundcloud');
    });
    if (collision < 0) { result.push(track); continue; }
    const sourceWeight = (item: Track) => item.source === 'spotify' ? 25 : item.source === 'deezer' ? 15 : item.source === 'soundcloud' ? 5 : 0;
    const quality = (item: Track) => sourceWeight(item) + (item.access === 'playable' ? 20 : item.access === 'preview' ? -20 : -100);
    // Catalogue availability describes its own platform, not our audio resolver.
    // Keep canonical metadata for lyrics even when playback comes from an upload.
    if (sourceRank(track)<sourceRank(result[collision]) || (sourceRank(track)===sourceRank(result[collision])&&quality(track)>quality(result[collision]))) result[collision] = track;
  }
  return result;
}
/** Uploads that are playlists rather than songs. */
export const JUNK_TITLE = /\b\d+\s*(hours?|hrs?|h)\b|\b(full album|compilation|playlist|megamix|dj mix|mixed by|non ?stop|top \d+|best of \d{4})\b|\bmix\s*(20\d\d|vol)|※|#\w|\.(mp3|wav|m4a)\b/i;
const editions = ['remix', 'cover', 'кавер', 'slowed', 'sped up', 'speed up', 'reverb', 'nightcore', 'instrumental', 'karaoke', 'mashup', 'live', 'bass boosted', 'snippet', 'preview', 'rework', 'bootleg'];
/**
 * Relevance of a catalogue track for a query. `prior` carries the upstream
 * catalogue's own ordering (Spotify sorts by relevance and popularity).
 */
export function rankTrack(track: Track, query: string, prior = 0): number {
  const q = normalizeMusicText(query), title = normalizeMusicText(track.title), artist = normalizeMusicText(track.artist.name);
  const combined = `${artist} ${title}`;
  const coverage = phraseCoverage(q, combined);
  let score = coverage * 300 + prior;
  if (title === q || combined === q || `${title} ${artist}` === q) score += 250;
  // The same words in another script: «земфира искала» for «Zemfira — ИСКАЛА».
  else if (latinFold(combined) === latinFold(q) || latinFold(`${title} ${artist}`) === latinFold(q)) score += 230;
  else if (title.startsWith(q) || combined.startsWith(q)) score += 70;
  // Typing an artist's name asks for that artist's songs, not for songs titled after them (also with a slip).
  if (artist === q) score += 330;
  else if (q.length >= 4 && nearlySameName(artist.split(' , ')[0], q)) score += 260 + (coverage < .5 ? 300 : 0);
  // "kai angel andy warhol": the artist part and the title part both land.
  const artistTokens = artist.split(' ').filter(Boolean);
  if (artistTokens.length && q.split(' ').length > artistTokens.length && phraseCoverage(artist, q) === 1 && phraseCoverage(q.replace(artist, '').trim(), title) >= .85) score += 90;
  if (coverage < 0.5) score -= 300;
  // Popular recordings first (0..100 → up to +150); an exact title match from an unknown act falls behind.
  if (typeof track.popularity === 'number') {
    score += track.popularity * 1.5;
    if (title === q && artist !== q && !q.includes(artist) && track.popularity < 20) score -= 140;
  }
  // Hour-long mixes, playlists and compilations are not songs.
  if (JUNK_TITLE.test(track.title) && !JUNK_TITLE.test(query)) score -= 420;
  for (const edition of editions) if (title.includes(edition) && !q.includes(edition)) score -= 90;
  if (track.access === 'blocked' || track.access === 'unavailable') score -= 500;
  if (track.access === 'preview') score -= 220;
  if (track.source === 'spotify') score += 35;
  else if (track.source === 'deezer') score += 15;
  return score;
}

/** The same name typed with a slip or in another script: «kai angle» ≈ «Kai Angel», «скриптонит» = «Skryptonit». */
export function nearlySameName(a: string, b: string): boolean {
  const x = foldName(a).replace(/ /g, ''), y = foldName(b).replace(/ /g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const allowed = Math.min(x.length, y.length) >= 8 ? 2 : Math.min(x.length, y.length) >= 4 ? 1 : 0;
  return allowed > 0 && levenshtein(x, y, allowed) <= allowed;
}

/** Relevance of an artist for a query, 0 when it only shares a stray word. */
export function rankArtist(artist: Artist, query: string, prior = 0): number {
  const q = normalizeMusicText(query), name = normalizeMusicText(artist.name);
  if (!q || !name) return 0;
  let score = phraseCoverage(q, name) * 200 * Math.min(1, phraseCoverage(name, q) + .35);
  const exact = name === q || name.replace(/ /g, '') === q.replace(/ /g, '');
  // An exact name wins over a prefix — except a near-empty SoundCloud account named after a half-typed query
  // («boulevard dep»): those are fan pages and re-upload accounts, not the artist being typed.
  const strayUpload = artist.source === 'soundcloud' && (artist.followersCount || 0) < 500;
  if (exact) score += strayUpload ? 110 : 350;
  else if (name.startsWith(q) || q.startsWith(`${name} `)) score += 90;
  else if (nearlySameName(name, q)) score = Math.max(score, 160);
  if (score < 90) return 0;
  // Search order is only a tie-breaker: homonyms with a real audience must beat
  // an obscure account that happened to be returned first by another provider.
  score += Math.min(2, prior * .05) + Math.min(160, Math.log10(1 + Math.max(0, artist.followersCount || 0)) * 20);
  score += Math.max(0, Math.min(100, artist.popularity || 0)) * .3;
  return score;
}

/** Keep the most popular matching profile, then attach other platform links. */
export function mergeSearchArtists(artists: Artist[], query: string, priors = new Map<string, number>()): Artist[] {
  const best = new Map<string, Artist>();
  const ranked = artists.map(artist => ({ artist, score: rankArtist(artist, query, priors.get(artist.id) || 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  for (const { artist } of ranked) {
    const key = normalizeMusicText(artist.name).replace(/ /g, '');
    const kept = best.get(key);
    if (!kept) { best.set(key, { ...artist, alsoOn: [...(artist.alsoOn || [])] }); continue; }
    if (kept.source !== artist.source && !kept.alsoOn?.some(link => link.source === artist.source)) {
      kept.alsoOn = [...(kept.alsoOn || []), { source: artist.source, id: artist.id, url: artist.permalinkUrl }];
    }
  }
  return [...best.values()];
}

export function rankAlbum(album: Release, query: string, prior = 0): number {
  const q = normalizeMusicText(query), title = normalizeMusicText(album.title), artist = normalizeMusicText(album.artist?.name || '');
  if (!q || !title) return 0;
  const combined = `${artist} ${title}`.trim();
  const coverage = phraseCoverage(q, combined);
  if (coverage < .65) return 0;
  let score = coverage * 300 + Math.min(30, prior);
  if (title === q || combined === q || `${title} ${artist}` === q) score += 250;
  // The same words in another script: «земфира искала» for «Zemfira — ИСКАЛА».
  else if (latinFold(combined) === latinFold(q) || latinFold(`${title} ${artist}`) === latinFold(q)) score += 230;
  if (artist === q) score += 200;
  score += Math.max(0, Math.min(100, album.popularity || 0));
  score += Math.min(60, Math.log10(1 + Math.max(0, album.artist?.followersCount || 0)) * 9);
  return score;
}

/** Album IDs remain navigable through /release/:id; versions keep distinct titles. */
export function deduplicateSearchAlbums(albums: Release[]): Release[] {
  const seen = new Map<string, Release>();
  for (const album of albums) {
    if (!album.id || !album.title) continue;
    const key = `${normalizeMusicText(album.artist?.name || album.id)}:${normalizeMusicText(album.title)}:${album.type || 'album'}`;
    const kept = seen.get(key);
    if (!kept || (album.id.startsWith('spotify:') && !kept.id.startsWith('spotify:'))) seen.set(key, album);
  }
  return [...seen.values()];
}

export function rankSoundCloud(dto: SoundCloudTrackDTO, query: string): number {
  const track = { title: dto.title, artist: { name: dto.user?.username || '' }, access: dto.policy === 'BLOCK' ? 'blocked' : dto.policy === 'SNIP' ? 'preview' : 'playable' } as Track;
  const trans = dto.media?.transcodings;
  let score = rankTrack(track, query);
  if (dto.user?.verified || dto.user?.badges?.verified) score += 35;
  score += Math.min(40, Math.log10(1 + (dto.playback_count || 0)) * 6);
  if (trans?.length && trans.every(t => t.snipped)) score -= 200;
  if (dto.duration < 45000 && !/snippet|preview|intro/i.test(query)) score -= 90;
  return score;
}
export function diversifyTracks(tracks: Track[], limit: number, cap = 2): Track[] {
  const seen = new Set<string>(), counts = new Map<string, number>();
  return deduplicateSearchTracks(tracks).filter(t => {
    const key = trackIdentity(t), artist = normalizeMusicText(t.artist.name);
    if (seen.has(key) || (counts.get(artist) || 0) >= cap) return false;
    seen.add(key); counts.set(artist, (counts.get(artist) || 0) + 1); return true;
  }).slice(0, limit);
}

/** Keep one recommendation seed from occupying the entire first page. */
export function balanceRecommendationSeeds(tracks: Track[], limit: number): Track[] {
  const unique = diversifyTracks(tracks, tracks.length, 3);
  const cap = Math.max(1, Math.ceil(limit / 3));
  const counts = new Map<string, number>();
  const preferred: Track[] = [], deferred: Track[] = [];
  for (const track of unique) {
    const seed = track.recommendationReason || 'collection';
    const count = counts.get(seed) || 0;
    if (count < cap) {
      preferred.push(track);
      counts.set(seed, count + 1);
    } else deferred.push(track);
  }
  return [...preferred, ...deferred].slice(0, limit);
}

/** A catalogue-text heuristic, not language recognition from the audio. */
export function matchesMetadataLanguage(track: Track, language: string, russianArtists = new Set<string>()): boolean {
  if (language === 'all') return true;
  const russian = /[а-яё]/i.test(`${track.title} ${track.artist.name}`) || russianArtists.has(normalizeMusicText(track.artist.name));
  return language === 'ru' ? russian : !russian;
}

/** Artist search must not confuse a song title with the requested artist. */
export function matchesArtistSeed(track: Track, name: string): boolean {
  const seed = normalizeMusicText(name), artist = normalizeMusicText(track.artist.name);
  if (!seed) return false;
  if (` ${artist} `.includes(` ${seed} `)) return true;
  return track.source === 'soundcloud' && normalizeMusicText(track.title).startsWith(`${seed} `);
}
