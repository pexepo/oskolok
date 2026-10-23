import { findGeniusSong } from './GeniusAnnotationService.js';
import { geniusApi, geniusCached } from './GeniusService.js';
import { foldName } from './searchQuery.js';

// «Информация о треке»: the song's Genius page — bio, release date, the people
// behind it (featured artists, writers, producers, engineers, label). No
// popularity figures: Genius pageviews say nothing about how a song is heard.

export interface GeniusPerson { id?: number; name: string; url?: string; image?: string }
export interface GeniusCredit { role: string; people: GeniusPerson[] }
export interface GeniusSongInfo {
  id: number; url: string; title: string; artist: string; artwork?: string;
  description?: string; releaseDate?: string;
  album?: { name: string; url?: string; cover?: string };
  primaryArtists: GeniusPerson[]; featuredArtists: GeniusPerson[];
  /** Writers, producers and every custom credit Genius lists, grouped by role in Genius's order. */
  credits: GeniusCredit[];
  labels: string[];
  recordingLocation?: string;
  /** Samples, interpolations, remixes… ("interpolates" → the songs). */
  relationships: Array<{ type: string; songs: Array<{ title: string; artist: string; url: string }> }>;
}

const MISS_TTL = 30 * 60 * 1000;
const misses = new Map<string, number>();
const key = (s: string) => foldName(s).replace(/ /g, '');

const person = (a: any): GeniusPerson => ({
  ...(typeof a?.id === 'number' ? { id: a.id } : {}),
  name: String(a?.name || '').trim(),
  ...(a?.url ? { url: String(a.url) } : {}),
  ...(a?.image_url && !/default_(?:avatar|cover)/.test(a.image_url) ? { image: String(a.image_url) } : {}),
});
const people = (list: any): GeniusPerson[] => (Array.isArray(list) ? list : []).map(person).filter(p => p.name);

/** Label-like credits: shown as the release's label, not as a person. */
const LABEL_ROLES = /^(?:label|distributor|publisher|phonographic copyright|copyright)/i;

export function mapGeniusSong(song: any): GeniusSongInfo {
  const description = String(song.description?.plain || '').replace(/\n{3,}/g, '\n\n').trim();
  const credits: GeniusCredit[] = [];
  const add = (role: string, list: GeniusPerson[]) => {
    if (!list.length) return;
    const existing = credits.find(c => c.role.toLowerCase() === role.toLowerCase());
    if (existing) for (const p of list) { if (!existing.people.some(q => q.name === p.name)) existing.people.push(p); }
    else credits.push({ role, people: list });
  };
  add('Producer', people(song.producer_artists));
  add('Writer', people(song.writer_artists));
  for (const group of song.custom_performances || []) {
    const role = String(group?.label || '').trim();
    if (role && !LABEL_ROLES.test(role)) add(role, people(group.artists));
  }
  const labels = [...new Set((song.custom_performances || [])
    .filter((g: any) => /^label$/i.test(String(g?.label || '')))
    .flatMap((g: any) => people(g.artists).map(p => p.name)))] as string[];
  // Fall back to the copyright holder when no label is credited.
  if (!labels.length) for (const g of song.custom_performances || []) if (/copyright/i.test(String(g?.label || ''))) for (const p of people(g.artists)) if (!labels.includes(p.name)) labels.push(p.name);
  const date = song.release_date || [song.release_date_components?.year, song.release_date_components?.month && String(song.release_date_components.month).padStart(2, '0')].filter(Boolean).join('-');
  return {
    id: Number(song.id), url: String(song.url), title: String(song.title || ''),
    artist: String(song.primary_artist?.name || song.artist_names || ''),
    ...(song.song_art_image_url && !/default_cover/.test(song.song_art_image_url) ? { artwork: String(song.song_art_image_url) } : {}),
    ...(description && description !== '?' ? { description } : {}),
    ...(date ? { releaseDate: String(date) } : {}),
    ...(song.album?.name ? { album: { name: String(song.album.name), ...(song.album.url ? { url: String(song.album.url) } : {}), ...(song.album.cover_art_url ? { cover: String(song.album.cover_art_url) } : {}) } } : {}),
    primaryArtists: people(song.primary_artists?.length ? song.primary_artists : [song.primary_artist]),
    featuredArtists: people(song.featured_artists),
    credits,
    labels,
    ...(song.recording_location ? { recordingLocation: String(song.recording_location) } : {}),
    relationships: (song.song_relationships || [])
      .filter((r: any) => r?.songs?.length && r.relationship_type)
      .map((r: any) => ({ type: String(r.relationship_type), songs: r.songs.slice(0, 6).map((s: any) => ({ title: String(s.title || ''), artist: String(s.primary_artist?.name || s.artist_names || ''), url: String(s.url || '') })).filter((s: any) => s.title) }))
      .slice(0, 6),
  };
}

/** Cached for 12 h (Genius credits fill in over the first days of a release); misses are retried after 30 min. */
export async function geniusSongInfo(artist: string, title: string): Promise<GeniusSongInfo | null> {
  if (!artist.trim() || !title.trim()) return null;
  const id = `${key(artist)}|${key(title)}`, missed = misses.get(id);
  if (missed && Date.now() - missed < MISS_TTL) return null;
  const info = await geniusCached(`geniussong2:${id}`, async () => {
    const song = await findGeniusSong(artist, title);
    if (!song) return null;
    return mapGeniusSong((await geniusApi(`/songs/${song.id}?text_format=plain`)).song);
  });
  if (!info) { misses.set(id, Date.now()); if (misses.size > 1000) misses.delete(misses.keys().next().value!); }
  return info;
}
