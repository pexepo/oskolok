import type { Track, SoundCloudTrackDTO } from '../types/index.js';

export const normalizeMusicText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const trackIdentity = (track: Track) => `${normalizeMusicText(track.artist.name)}:${normalizeMusicText(track.title)}:${Math.round(track.duration / 5)}`;
/** Collapse reuploads only when the release title and running time agree. Edition words stay part of the title. */
export function deduplicateSearchTracks(tracks: Track[]): Track[] {
  const result: Track[] = [];
  for (const track of tracks) {
    const title = normalizeMusicText(track.title);
    const artist = normalizeMusicText(track.artist.name);
    const collision = result.findIndex(other => {
      const otherTitle = normalizeMusicText(other.title);
      if (!title || title !== otherTitle || !track.duration || !other.duration) return false;
      const sameArtist = artist === normalizeMusicText(other.artist.name);
      if (Math.abs(track.duration - other.duration) > (sameArtist ? 8 : 3)) return false;
      if (sameArtist) return true;
      if (editions.some(edition => title.includes(edition))) return false;
      // Uploader handles on SoundCloud are not reliable artist identities.
      return title.split(' ').length >= 2 && (track.source === 'soundcloud' || other.source === 'soundcloud');
    });
    if (collision < 0) { result.push(track); continue; }
    const sourceWeight = (item: Track) => item.source === 'spotify' ? 25 : item.source === 'deezer' ? 15 : item.source === 'soundcloud' ? 5 : 0;
    const quality = (item: Track) => sourceWeight(item) + (item.access === 'playable' ? 20 : item.access === 'preview' ? -20 : -100);
    if (quality(track) > quality(result[collision])) result[collision] = track;
  }
  return result;
}
const editions = ['remix', 'cover', 'кавер', 'slowed', 'sped up', 'nightcore', 'instrumental', 'karaoke', 'mashup', 'live', 'bass boosted', 'snippet', 'preview'];
export function rankTrack(track: Track, query: string): number {
  const q = normalizeMusicText(query), title = normalizeMusicText(track.title), artist = normalizeMusicText(track.artist.name);
  const tokens = q.split(' ').filter(Boolean);
  const combined = `${artist} ${title}`;
  const coverage = tokens.filter(t => combined.includes(t)).length / Math.max(1, tokens.length);
  let score = coverage * 300;
  if (title === q || combined === q) score += 250;
  if (artist === q) score += 160;
  if (coverage < 0.5) score -= 300;
  for (const edition of editions) if (title.includes(edition) && !q.includes(edition)) score -= 90;
  if (track.access === 'blocked' || track.access === 'unavailable') score -= 500;
  if (track.access === 'preview') score -= 220;
  if (track.source === 'spotify') score += 35;
  else if (track.source === 'deezer') score += 15;
  return score;
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
