// Search skeletons collapse repeats and transliterate approximate matches.
// They must never decide whether user library entries can be merged/deleted.
const foldName=(text:string)=>text.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

// One song heard through different catalogues ("Давай сбежим" on Spotify and "давай сбежим" on
// SoundCloud) must count once in a library. Version words (remix, sped up, live…) stay part of the
// key, so a sped-up edit never collapses into the original.

const FEAT = /\s*[([](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/gi;
const mainArtist = (artist: string) => artist.split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bx\b|\band\b|\bи\b)\s*/i)[0]?.trim() || artist;

export function recordingKey(track: { title?: string; artist?: { name?: string } }): string {
  const title = foldName(String(track.title || '').replace(FEAT, ' ').replace(/\s+-\s+(?:feat|ft)\.?\s.*$/i, ''));
  const artist = foldName(mainArtist(String(track.artist?.name || '')));
  return title && artist ? `${artist.replace(/ /g, '')}|${title.replace(/ /g, '')}` : '';
}

/** Same recording: same key and, when both are known, durations within a few seconds. */
export function sameRecording(a: { title?: string; artist?: { name?: string }; duration?: number }, b: { title?: string; artist?: { name?: string }; duration?: number }): boolean {
  const key = recordingKey(a);
  if (!key || key !== recordingKey(b)) return false;
  return !(a.duration && b.duration && Math.abs(a.duration - b.duration) > 6);
}

/** Catalogue copies first: their metadata (cover, release, explicit flag) is the most complete. */
export const SOURCE_RANK: Record<string, number> = { spotify: 0, deezer: 1, apple: 1, tidal: 1, licensed: 2, soundcloud: 3, youtube: 4 };
export const sourceRank = (track: { source?: string; id?: string }) => SOURCE_RANK[String(track.source || String(track.id || '').split(':')[0])] ?? 2;
