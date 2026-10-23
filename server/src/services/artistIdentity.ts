// One name, several people: «pyrokinesis» the Russian rapper and «Pyrokinesis» the metal band fold to the same string.
// Catalogue profiles are joined into one card only on evidence that they are the same artist — a shared title.
import type { Artist } from '../types/index.js';
import { officialCatalogService } from './OfficialCatalogService.js';
import { soundCloudService } from './SoundCloudService.js';

/** A title reduced to what survives between catalogues: case, accents, brackets («(Remastered)», «(feat. …)») and punctuation dropped. */
export const titleKey = (title: string) => title.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

/** How many distinct titles two discographies share. */
export function titleOverlap(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  const known = new Set(a.map(titleKey).filter(key => key.length >= 2));
  let shared = 0;
  for (const key of new Set(b.map(titleKey))) if (known.has(key)) shared++;
  return shared;
}

/** Track and release titles of a Deezer or SoundCloud profile, to compare with a Spotify discography. */
export async function ownTitles(artist: Artist): Promise<string[]> {
  const tracks = artist.source === 'deezer' ? await officialCatalogService.getArtistTracks(artist.id, { limit: 50 }).catch(() => [])
    : artist.source === 'soundcloud' ? await soundCloudService.getArtistTracks(artist.id, { limit: 50 }).catch(() => []) : [];
  return [...new Set(tracks.flatMap(track => [track.title, (track as any).release?.title, (track as any).album?.title].filter((t): t is string => typeof t === 'string' && !!t)))];
}
